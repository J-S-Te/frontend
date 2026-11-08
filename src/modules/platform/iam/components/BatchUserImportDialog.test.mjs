import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const dialogFile = new URL('./BatchUserImportDialog.vue', import.meta.url)
const previewTableFile = new URL('./BatchUserImportPreviewTable.vue', import.meta.url)

const confirmDialogStub = {
  props: ['title', 'description'],
  render() { return Vue.h('section', { role: 'alertdialog' }, [this.title, this.description]) },
}
const emptyComponentStub = { render: () => null }

// Load one production SFC exactly like the bundler would: only the dependencies it
// actually imports are injected. A missing composable import must fail instead of
// being supplied by the test harness. `.vue` dependencies are stubs unless the test
// explicitly provides a real component (preview table rendering assertions below).
async function loadSfc(fileUrl, id, componentStubs = {}) {
  const filename = fileUrl.pathname.split('/').pop()
  const { descriptor } = parse(readFileSync(fileUrl, 'utf8'))
  const script = compileScript(descriptor, { id })
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename,
    id,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(compiled.errors, [])

  const imports = {}
  for (const node of script.scriptSetupAst.filter(node => node.type === 'ImportDeclaration')) {
    const path = node.source.value
    let dependency
    if (path.endsWith('.vue')) {
      dependency = {
        default: componentStubs[path]
          || (path.includes('ConfirmDialog') ? confirmDialogStub : emptyComponentStub),
      }
    } else if (path.startsWith('@/')) {
      dependency = path.includes('/api/')
        ? { createEmployeesBatch: () => { throw new Error('unexpected API write') } }
        : await import(new URL(`../../../../${path.slice(2)}`, fileUrl))
    } else {
      dependency = path.startsWith('.') ? await import(new URL(path, fileUrl)) : await import(path)
    }
    for (const specifier of node.specifiers) {
      imports[specifier.local.name] = specifier.type === 'ImportDefaultSpecifier'
        ? dependency.default : dependency[specifier.imported.name]
    }
  }
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import .*$/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

// 真实装载预览表格组件：分页断言必须看到真实渲染行数，而不是空组件占位。
const previewTable = await loadSfc(previewTableFile, 'batch-import-preview-table')
const component = await loadSfc(dialogFile, 'batch-import-runtime', {
  './BatchUserImportPreviewTable.vue': previewTable,
})

async function mountState(prepare = () => {}) {
  let state
  const events = []
  const app = Vue.createSSRApp({
    ...component,
    setup(props, context) {
      state = component.setup(props, { ...context, emit: (...args) => events.push(args) })
      prepare(state)
      return state
    },
  })
  return { html: await renderToString(app), state, events }
}

// 生成 count 行数据（第 1 行是表头，数据行从 CSV 第 2 行开始）。invalidAt 中的
// 序号对应数据行序号（1-based），用于制造“姓名必填”的异常行。
function dialogCsv(count, { invalidAt = [] } = {}) {
  const lines = ['姓名,邮箱,手机号,状态,组织,岗位,应用角色']
  for (let index = 1; index <= count; index += 1) {
    const name = invalidAt.includes(index) ? '' : `用户${index}`
    lines.push(`${name},user${index}@example.com,1380000${String(index).padStart(4, '0')},启用,华东事业部,销售经理,`)
  }
  return lines.join('\n')
}

async function mountPreview(count, options) {
  return mountState(state => {
    state.rawText.value = dialogCsv(count, options)
    state.rebuildRows()
    state.step.value = 2
  })
}

function renderedLines(html) {
  return [...html.matchAll(/data-line="(\d+)"/g)].map(match => Number(match[1]))
}

test('batch import opens at the upload step without setup errors', async () => {
  const { html, state } = await mountState()
  assert.match(html, /aria-label="批量导入用户"/)
  assert.match(html, /从 CSV 导入用户/)
  assert.equal(state.step.value, 1)
})

test('preview shows close confirmation without a failed import result', async () => {
  let pending
  const { html, state, events } = await mountState(state => {
    state.step.value = 2
    pending = state.close()
  })
  assert.match(html, /role="alertdialog"/)
  assert.match(html, /关闭导入？/)
  assert.deepEqual(events, [])
  state.cancelClose()
  await pending
  assert.deepEqual(events, [])
  const closing = state.close()
  state.acceptClose()
  await closing
  assert.deepEqual(events, [['close']])
})

test('successful results show the one-time credential close warning', async () => {
  let pending
  const { html, state, events } = await mountState(state => {
    state.step.value = 3
    state.submitResult.value = {
      createdCount: 1, requestedCount: 1, failedCount: 0,
      initialCredentials: [{ accountName: 'test', initialPassword: 'test-only' }],
    }
    pending = state.close()
  })
  assert.match(html, /role="alertdialog"/)
  assert.match(html, /关闭并放弃初始凭据？/)
  state.cancelClose()
  await pending
  assert.deepEqual(events, [])
  assert.equal(state.submitResult.value.initialCredentials.length, 1)
  const credential = state.submitResult.value.initialCredentials[0]
  const closing = state.close()
  state.acceptClose()
  await closing
  assert.deepEqual(events, [['close']])
  assert.equal(credential.initialPassword, '')
  assert.deepEqual(state.submitResult.value.initialCredentials, [])
})

test('upload closes directly and an in-flight submit cannot close', async () => {
  const { state, events } = await mountState()
  state.submitting.value = true
  await state.close()
  assert.deepEqual(events, [])
  state.submitting.value = false
  await state.close()
  assert.deepEqual(events, [['close']])
})

// 422 batchValidation 的逐行问题区域：无 issues 时按钮禁用，有 issues 时逐行展示。
test('issue report area renders row details and only enables download when issues exist', async () => {
  const withoutIssues = await mountState(state => {
    state.step.value = 2
    state.submitError.value = '本次导入未写入任何数据，请检查后重试。'
  })
  assert.match(withoutIssues.html, /下载错误报告 CSV/)
  assert.match(withoutIssues.html, /服务端未返回逐行问题/)
  assert.match(withoutIssues.html, /<button[^>]*\bdisabled\b[^>]*>(?:(?!<\/button>)[\s\S])*下载错误报告 CSV/)

  const withIssues = await mountState(state => {
    state.step.value = 2
    state.submitError.value = '本次导入未写入任何数据：服务端返回 2 条问题，请按行修正后重新导入（可下载错误报告）。'
    state.submitIssues.value = [
      { row: 2, field: '组织', code: 'ORGANIZATION_NOT_FOUND', message: '组织不存在或已停用' },
      { row: 5, field: '岗位', code: 'POSITION_REQUIRED', message: '岗位名称必填' },
      { row: 0, field: '整批', code: 'BATCH_VALIDATION_FAILED', message: '批量数据未通过服务端校验' },
    ]
  })
  assert.match(withIssues.html, /第 2 行/)
  assert.match(withIssues.html, /组织不存在或已停用/)
  assert.match(withIssues.html, /第 5 行/)
  assert.match(withIssues.html, /岗位名称必填/)
  assert.match(withIssues.html, /整批问题/)
  assert.doesNotMatch(withIssues.html, /第 整批 行/)
  assert.doesNotMatch(withIssues.html, /<button[^>]*\bdisabled\b[^>]*>(?:(?!<\/button>)[\s\S])*下载错误报告 CSV/)
})

// 下载触发：Blob 内容必须是 BOM + CRLF 的错误报告，且链接与对象 URL 被清理。
test('downloading the issue report writes a BOM CSV and cleans up the object URL', async () => {
  const issues = [{ row: 2, field: '组织', code: 'ORGANIZATION_NOT_FOUND', message: '组织不存在或已停用' }]
  const { state } = await mountState(state => { state.submitIssues.value = issues })
  let blob
  let clicks = 0
  let removes = 0
  let revokes = 0
  const link = { download: '', click() { clicks += 1 }, remove() { removes += 1 } }
  const originalDocument = globalThis.document
  const originalURL = globalThis.URL
  globalThis.document = { createElement() { return link }, body: { appendChild(value) { assert.equal(value, link) } } }
  globalThis.URL = { createObjectURL(value) { blob = value; return 'blob:issue-report' }, revokeObjectURL(url) { assert.equal(url, 'blob:issue-report'); revokes += 1 } }
  try {
    state.downloadIssueReport()
  } finally {
    globalThis.document = originalDocument
    globalThis.URL = originalURL
  }
  assert.equal(clicks, 1)
  assert.equal(removes, 1)
  assert.equal(revokes, 1)
  assert.equal(link.download, '员工导入错误.csv')
  // Blob.text() 的 UTF-8 解码会吞掉 BOM，改为按字节断言 BOM 真实存在。
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], '错误报告必须带 UTF-8 BOM')
  const text = await blob.text()
  const lines = text.split('\r\n')
  assert.equal(lines[0], '行号,字段,错误码,说明')
  assert.equal(lines[1], '2,组织,ORGANIZATION_NOT_FOUND,组织不存在或已停用')

  // 没有 issues 时不触发任何下载，避免出现“空报告”。
  state.submitIssues.value = []
  state.downloadIssueReport()
  assert.equal(clicks, 1)
})

// ---- 预览分页（阶段 4）----

test('预览默认每页 25 行，只有当前页参与渲染，统计基于完整批次', async () => {
  const { html, state } = await mountPreview(60)
  assert.equal(state.pageSize.value, 25)
  assert.equal(state.page.value, 1)
  assert.equal(state.stats.value.total, 60, '统计必须基于完整批次而不是当前页')
  assert.equal(state.stats.value.valid, 60)
  assert.equal(state.totalPages.value, 3)
  assert.equal(state.filteredRows.value.length, 60)
  assert.equal(state.pageRows.value.length, 25)

  // 渲染断言：25 行/页时表格只渲染 25 个数据行，行号是原始 CSV 行号（2..26）。
  const lines = renderedLines(html)
  assert.ok(lines.length <= 25, `渲染行数不得超过每页 25 行：${lines.length}`)
  assert.deepEqual(lines, Array.from({ length: 25 }, (_, index) => index + 2))

  state.page.value = 2
  assert.equal(state.currentPage.value, 2)
  assert.deepEqual(state.pageRows.value.slice(0, 2).map(row => row.lineNo), [27, 28])
  assert.equal(state.pageRows.value.length, 25)
})

test('跨页勾选保留，翻页只切换切片、不重建记录', async () => {
  const { state } = await mountPreview(60)
  state.toggleAll(false)
  const firstPageRow = state.pageRows.value[0]
  firstPageRow.selected = true
  state.page.value = 2
  state.pageRows.value[2].selected = true
  assert.equal(state.stats.value.selected, 2)
  assert.equal(state.selectedValidRows.value.length, 2)
  assert.equal(state.pageRows.value[2].lineNo, 29)

  state.page.value = 1
  assert.equal(state.pageRows.value[0], state.rows[0], '翻页后仍复用同一行对象')
  assert.equal(state.pageRows.value[0].selected, true)
  assert.ok(state.selectedValidRows.value.includes(firstPageRow))
})

test('表头全选是“全部有效行”（跨筛选、跨页），不会退化成全选当前页', async () => {
  const { state } = await mountPreview(60, { invalidAt: [3] })
  state.toggleAll(false)
  state.page.value = 3
  state.changeFilter('invalid')
  assert.equal(state.filteredRows.value.length, 1, '仅异常筛选下只剩 1 行')

  state.toggleAll(true)
  assert.equal(state.stats.value.selected, 59, '全选必须覆盖完整批次里的全部合法行')
  assert.equal(state.selectedValidRows.value.length, 59)
  assert.equal(state.allSelected.value, true)
  assert.equal(state.someSelected.value, false)

  state.changeFilter('all')
  assert.equal(state.page.value, 1)
  // 第 1 页共 25 行，其中第 4 行（唯一异常行）不允许勾选，所以已勾选 24 行。
  assert.equal(state.pageRows.value.filter(row => row.selected).length, 24)
  // 关闭勾选同样作用于完整批次
  state.toggleAll(false)
  assert.equal(state.stats.value.selected, 0)
})

test('筛选变化回到第 1 页，记录集缩小后页码收敛到有效页', async () => {
  const { state } = await mountPreview(60, { invalidAt: [3, 4] })
  state.page.value = 3
  assert.equal(state.currentPage.value, 3)
  state.changeFilter('invalid')
  assert.equal(state.page.value, 1)
  assert.equal(state.currentPage.value, 1)
  assert.equal(state.filteredRows.value.length, 2)

  // 停在末页后用更小的文件重新校验：页码收敛，不出现空白页。
  state.changeFilter('all')
  state.page.value = 3
  assert.equal(state.currentPage.value, 3)
  state.rawText.value = dialogCsv(10)
  state.rebuildRows()
  assert.equal(state.currentPage.value, 1, '越界页码在渲染前就收敛')
  assert.equal(state.page.value, 1, '重新校验后 page 本身也收敛到有效页')
  assert.equal(state.totalPages.value, 1)
  assert.equal(state.pageRows.value.length, 10)
})

test('每页档位 25 / 50 / 100 切换后回到第 1 页', async () => {
  const { state } = await mountPreview(60)
  assert.deepEqual(state.PAGE_SIZE_OPTIONS, [25, 50, 100])
  state.page.value = 2
  state.changePageSize(50)
  assert.equal(state.pageSize.value, 50)
  assert.equal(state.page.value, 1)
  assert.equal(state.pageRows.value.length, 50)
  state.changePageSize(100)
  assert.equal(state.pageRows.value.length, 60)
})

test('101 行仍按既有批次上限拒绝，分页不能绕过限制', async () => {
  const { html, state } = await mountPreview(101)
  assert.equal(state.rows.length, 101)
  assert.equal(state.totalPages.value, 5, '分页仍展示完整批次')
  assert.match(state.parseError.value, /超过单次 100 上限/)
  const submitMarkup = html.slice(Math.max(0, html.indexOf('提交 101 行') - 400), html.indexOf('提交 101 行'))
  assert.match(submitMarkup, /<button[^>]*\bdisabled\b/, '超限时提交按钮必须禁用')

  await state.submit()
  assert.match(state.submitError.value, /超过单次 100 行上限/)
  assert.equal(state.submitting.value, false)
})

test('错误定位会翻到该行所在页，被筛选隐藏时先恢复全部', async () => {
  const { state } = await mountPreview(60, { invalidAt: [3] })
  state.submitIssues.value = [
    { row: 45, field: '组织', code: 'ORGANIZATION_NOT_FOUND', message: '组织不存在或已停用' },
  ]
  state.locateLine(45)
  // 每页 25 行：第 1 页是 CSV 第 2..26 行，第 45 行落在第 2 页。
  assert.equal(state.currentPage.value, 2)
  assert.equal(state.highlightedLineNo.value, 45)
  assert.ok(state.pageRows.value.some(row => row.lineNo === 45))

  // 目标行被“仅异常”筛选隐藏时，定位先切回全部再翻页。
  state.changeFilter('invalid')
  assert.equal(state.filteredRows.value.some(row => row.lineNo === 45), false)
  state.locateLine(45)
  assert.equal(state.filterMode.value, 'all')
  assert.equal(state.currentPage.value, 2)
  assert.equal(state.highlightedLineNo.value, 45)
})

test('预览表格保留原始行号、错误信息与勾选状态', async () => {
  const { html, state } = await mountPreview(30, { invalidAt: [3] })
  assert.match(html, /data-line="4"/)
  assert.match(html, /姓名必填/, '异常行要展示错误信息')
  assert.match(html, /全选全部有效行（跨筛选、跨页生效）/, '表头全选语义必须显式说明')
  assert.equal(state.rows[2].lineNo, 4)
  assert.equal(state.rows[2].valid, false)
  assert.equal(state.rows[2].selected, false)
  assert.match(html, /aria-label="第 4 行"/)
})
