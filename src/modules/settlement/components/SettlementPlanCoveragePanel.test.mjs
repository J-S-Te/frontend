import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const SRC = new URL('../../../', import.meta.url).pathname

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier}`)
}

async function loadSfc(file) {
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

const component = await loadSfc(new URL('./SettlementPlanCoveragePanel.vue', import.meta.url).pathname)
const render = (props) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, props) }))
const can = (...granted) => (permission) => granted.includes(permission)

const GAP_ROW = {
  contract_snapshot_id: 'SNAP-1',
  contract_no: 'HT-2026-001',
  contract_amount: '100.00',
  plan_total: '94.50',
  gap: '5.50',
  gap_percent: '5.50',
  exceeds_threshold: true,
  triggered: ['COVERAGE_GAP'],
  contract_event_plan: true,
}

// SET-04：差额面板只展示服务端只读视图，超阈值必须提示财务 override 且不自动重试。
test('计划差额面板：展示合同金额 / 计划合计 / 差额列与超阈值判定', async () => {
  const html = await render({ can: can('settlement.receivable.read'), coverageItems: [GAP_ROW] })
  assert.match(html, /计划差额（合同金额对计划合计）/)
  for (const header of ['合同编号', '合同金额', '计划合计', '差额', '差额比例', '判定', '触发原因']) {
    assert.match(html, new RegExp(`<th scope="col">${header}</th>`), header)
  }
  assert.match(html, /HT-2026-001/)
  assert.match(html, /¥100\.00/)
  assert.match(html, /¥94\.50/)
  assert.match(html, /¥5\.50/)
  assert.match(html, /计划少计/)
  assert.match(html, /5\.50%/)
  assert.match(html, /settlement-badge tone-danger">超阈值 · 需财务 override/)
  assert.match(html, /合计差额超阈值/)
  assert.match(html, /计划来自合同财务事件基线/)
  // 无 override 权限时给出"会被 409 拒绝、联系财务负责人、不自动重试"的处置说明。
  assert.match(html, /data-testid="plan-coverage-override-hint"/)
  assert.match(html, /没有结算财务 override 权限/)
  assert.match(html, /不会自动重试/)
  assert.doesNotMatch(html, /plan-coverage-empty/)
})

test('计划差额面板：有 override 权限时提示由财务负责人重新提交，不显示无权限文案', async () => {
  const html = await render({ can: can('settlement.receivable.read', 'settlement.finance.override'), coverageItems: [GAP_ROW] })
  assert.match(html, /settlement\.finance\.override/)
  assert.match(html, /不会自动重试/)
  assert.doesNotMatch(html, /没有结算财务 override 权限/)
})

test('计划差额面板：阈值内不出现 override 提示，负差额标注计划超计，未知触发原因保留原文', async () => {
  const html = await render({
    can: can('settlement.receivable.read'),
    coverageItems: [{ ...GAP_ROW, gap: '-2.00', gap_percent: '2.00', exceeds_threshold: false, triggered: [], contract_event_plan: false }],
  })
  assert.match(html, /settlement-badge tone-success">阈值内/)
  assert.match(html, /计划超计/)
  assert.match(html, /<td>—<\/td>/)
  assert.doesNotMatch(html, /plan-coverage-override-hint/)
  assert.doesNotMatch(html, /计划来自合同财务事件基线/)
})

test('计划差额面板：无差额合同时显示空态，且不渲染表格与超出范围的入口', async () => {
  const html = await render({ can: can('settlement.receivable.read'), coverageItems: [] })
  assert.match(html, /data-testid="plan-coverage-empty"/)
  assert.match(html, /当前没有计划合计与合同金额不一致的合同。/)
  assert.doesNotMatch(html, /<table>/)
  assert.doesNotMatch(html, /plan-coverage-override-hint/)
})

test('计划差额面板：只读展示，不含写入控件；刷新以事件回传父级', () => {
  const source = readFileSync(new URL('./SettlementPlanCoveragePanel.vue', import.meta.url), 'utf8')
  assert.equal(source.includes("$emit('reload')"), true)
  assert.equal(source.includes('getPlanCoverage'), false, '数据由父级按结算读取能力装载，组件不自取数')
  assert.equal(source.includes('saveRoleResource'), false, '只读面板不得内置写入')
  assert.equal(source.includes('adjust'), false, '不得在只读面板中提交计划调整')
  assert.equal(source.includes('settlement.finance.override'), true)
})
