import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
for (const path of ['contract_management/views/ContractManagementView.vue', 'project_management/views/ProjectManagementView.vue', 'data_analysis/views/AlertRulesView.vue', 'data_analysis/views/DictionaryView.vue', 'settlement/views/SettlementView.vue', 'customer_opportunity/views/CustomerOpportunityView.vue', 'customer_portal/views/CustomerPortalView.vue']) {
  test(`${path} 操作结果使用共享顶层提示`, () => {
    const source = read('../' + path)
    assert.match(source, /import OperationToast from/)
    assert.match(source, /<OperationToast\b/)
  })
}
test('共享提示脱离模块层叠上下文，高于确认框并支持长文字和小屏幕', () => {
  const source = read('./components/OperationToast.vue')
  assert.match(source, /<Teleport to="body">/)
  assert.match(source, /z-index:\s*12000/)
  assert.match(source, /overflow-wrap:\s*anywhere/)
  assert.match(source, /aria-atomic="true"/)
  assert.match(source, /max-width:/)
})

// ---------------------------------------------------------------------------
// 业务编号（reference）契约：写操作返回的单据号必须能被用户带走。
// 这些用例把 OperationToast 真编译后渲染：SSR 看编号行是否出现，
// setup 绑定看「复制失败」时是否退化为可手动选择的提示，而不是静默丢掉编号。
// ---------------------------------------------------------------------------

const SRC = new URL('../../', import.meta.url).pathname

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadToastSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier}`)
}

async function loadToastSfc(file) {
  const { descriptor } = parse(readFileSync(file, 'utf8'))
  const script = compileScript(descriptor, { id: file })
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(compiled.errors, [], file)
  const imports = {}
  for (const node of script.scriptSetupAst.filter((item) => item.type === 'ImportDeclaration')) {
    const dependency = await resolveDependency(file, node.source.value)
    for (const spec of node.specifiers) {
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier' ? (dependency.default ?? dependency) : dependency[spec.imported.name]
    }
  }
  for (const match of script.content.matchAll(/import \{([^}]+)\} from ['"]vue['"]/g)) {
    for (const part of match[1].split(',')) {
      const [imported, local = imported] = part.trim().split(/\s+as\s+/)
      if (imported && !(local in imports)) imports[local] = Vue[imported]
    }
  }
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

const OperationToast = await loadToastSfc(join(SRC, 'modules/shared/components/OperationToast.vue'))

// Teleport 的内容不在主 HTML 里，SSR 会放进 context.teleports.body。
async function renderToast(props) {
  const context = {}
  await renderToString(Vue.createSSRApp(OperationToast, props), context)
  return context.teleports?.body || ''
}

test('返回业务编号的写操作：提示里出现可复制的编号，用户不会丢单据号', async () => {
  const html = await renderToast({ message: '回款已登记。', tone: 'success', reference: 'RCPT-2026-0007', referenceLabel: '回款号' })
  assert.match(html, /回款已登记。/)
  assert.match(html, /回款号/)
  assert.match(html, /RCPT-2026-0007/, '编号必须出现在提示里')
  assert.match(html, /shared-operation-toast-reference-value/, '编号有独立可选中样式钩子')
  assert.match(html, /<button type="button" class="shared-operation-toast-copy-button"/, '编号旁有复制按钮')
  assert.match(html, />复制</)
})

test('没有编号的操作不渲染编号行（不伪造单据号）', async () => {
  const html = await renderToast({ message: '规则已更新。', tone: 'success' })
  assert.match(html, /规则已更新。/)
  assert.doesNotMatch(html, /shared-operation-toast-reference/)
  assert.doesNotMatch(html, /业务编号/)
})

test('detail 是可选的一行补充说明', async () => {
  const withDetail = await renderToast({ message: '回款已登记。', reference: 'RCPT-1', detail: '可在核销页继续匹配应收。' })
  assert.match(withDetail, /可在核销页继续匹配应收。/)
  const without = await renderToast({ message: '回款已登记。', reference: 'RCPT-1' })
  assert.doesNotMatch(without, /shared-operation-toast-detail/)
})

test('复制失败时退化为「请手动选择复制」，不静默丢失编号', async () => {
  const events = []
  const ctx = OperationToast.setup(
    { message: '回款已登记。', tone: 'success', reference: 'RCPT-2026-0009', referenceLabel: '回款号', detail: '' },
    { emit: (...args) => events.push(args), expose: () => {}, attrs: {}, slots: {} },
  )
  assert.ok(ctx.copyState, '复制状态是组件对外可观察的绑定')
  assert.equal(ctx.copyState.value, '')
  await ctx.copyReference()
  // Node 里没有可用的剪贴板：必须走失败分支，且按钮文案告诉用户手动选择。
  assert.equal(ctx.copyState.value, 'failed')
  assert.match(JSON.stringify(events), /^\[\]$/, '复制不产生事件，只影响自身提示')
})
