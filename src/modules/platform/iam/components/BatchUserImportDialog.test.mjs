import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const filename = new URL('./BatchUserImportDialog.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'batch-import-runtime' })
const compiled = compileTemplate({
  source: descriptor.template.content,
  filename: 'BatchUserImportDialog.vue',
  id: 'batch-import-runtime',
  compilerOptions: { bindingMetadata: script.bindings },
})
assert.deepEqual(compiled.errors, [])

// Load only dependencies actually imported by the production SFC. A missing
// composable import must fail instead of being supplied by the test harness.
const imports = {}
for (const node of script.scriptSetupAst.filter(node => node.type === 'ImportDeclaration')) {
  const path = node.source.value
  let dependency
  if (path.endsWith('.vue')) {
    dependency = { default: path.includes('ConfirmDialog') ? {
      props: ['title', 'description'],
      render() { return Vue.h('section', { role: 'alertdialog' }, [this.title, this.description]) },
    } : { render: () => null } }
  } else if (path.startsWith('@/')) {
    dependency = path.includes('/api/')
      ? { createEmployeesBatch: () => { throw new Error('unexpected API write') } }
      : await import(new URL(`../../../../${path.slice(2)}`, filename))
  } else {
    dependency = path.startsWith('.') ? await import(new URL(path, filename)) : await import(path)
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
