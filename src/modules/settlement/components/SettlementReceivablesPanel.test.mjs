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
  // compileScript 会为 defineModel 等宏注入 `import { useModel as _useModel } from 'vue'`；
  // 这些不在原始 AST 中，须从 Vue 补齐，否则下方剥掉 import 后帮助函数未定义。
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

// golden 为提取前 SettlementView.vue 「应收计划与应收单」区片段的 SSR 渲染结果
// （治理批次 5 结算第三步采集；片段 / 提取前 SFC / 用例 / golden 归档于 .ai/qa/closure-20261025/goldens-settlement-panels/SettlementReceivablesPanel/）；
// 提取后本组件必须逐字节复现同一 DOM。cases 中 __fn 为函数 prop 源码，渲染前求值。
const GOLDENS = {
  "closedEmpty": "<section class=\"settlement-receivables\"><div class=\"settlement-section-head\"><div><p> 合同生效后按付款节点自动生成应收计划，确认后纳入应收与催收口径。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><!--v-if--><div class=\"settlement-filter-bar\"><label><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M10.8 4a6.8 6.8 0 1 0 4.3 12.1l4.4 4.4 1.4-1.4-4.4-4.4A6.8 6.8 0 0 0 10.8 4Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><input placeholder=\"搜索合同号 / 客户 / 应收单号\" maxlength=\"100\" value></label><select><option value>全部确认状态</option><option>待确认</option><option>已确认</option></select><select><option value>全部状态</option><option>未到期</option><option>即将到期</option><option>逾期</option></select><button class=\"console-button secondary\"> 重置 </button></div><article class=\"settlement-panel settlement-plan-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>合同编号</th><th>客户</th><th>期次</th><th>计划收款日</th><th>计划金额</th><th>确认状态</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"8\" class=\"settlement-table-empty\"> 暂无匹配的应收计划 </td></tr></tbody></table></div></article><article class=\"settlement-panel settlement-formal-receivables\"><div class=\"settlement-panel-head\"><div><h2>正式应收 <small>已确认计划自动生成</small></h2><p>确认后的应收单可用于开票、回款、核销与账龄催收。</p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>应收单号</th><th>合同编号</th><th>客户</th><th>到期日</th><th>应收金额</th><th>未收余额</th><th>收款状态</th><th>开票状态</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"8\" class=\"settlement-table-empty\"> 暂无正式应收，确认收款计划后将在此展示。 </td></tr></tbody></table></div></article></section>",
  "editorOpenPopulated": "<section class=\"settlement-receivables\"><div class=\"settlement-section-head\"><div><p> 合同生效后按付款节点自动生成应收计划，确认后纳入应收与催收口径。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><article class=\"settlement-panel settlement-operation-card\"><div class=\"settlement-panel-head\"><div><h2>收款计划确认</h2><p>HT-2026-001 · 甲公司</p></div><button type=\"button\" class=\"console-text-button\"> 取消 </button></div><form class=\"settlement-operation-form\"><label><span>计划收款日</span><input type=\"date\" required value=\"2026-11-01\"></label><label><span>计划金额</span><input inputmode=\"decimal\" required maxlength=\"18\" value=\"1000\"></label><label class=\"wide\"><span>调整原因</span><textarea rows=\"3\" placeholder=\"如调整日期或金额，此项必填；原值将保留在审计记录中。\" maxlength=\"500\">客户申请延期</textarea></label><div class=\"settlement-operation-actions wide\"><button type=\"button\" class=\"console-button secondary\"> 取消 </button><button class=\"console-button\"> 确认并生成应收 </button></div></form></article><div class=\"settlement-filter-bar\"><label><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M10.8 4a6.8 6.8 0 1 0 4.3 12.1l4.4 4.4 1.4-1.4-4.4-4.4A6.8 6.8 0 0 0 10.8 4Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><input placeholder=\"搜索合同号 / 客户 / 应收单号\" maxlength=\"100\" value=\"HT-2026\"></label><select><option value>全部确认状态</option><option>待确认</option><option>已确认</option></select><select><option value>全部状态</option><option>未到期</option><option>即将到期</option><option>逾期</option></select><button class=\"console-button secondary\"> 重置 </button></div><article class=\"settlement-panel settlement-plan-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>合同编号</th><th>客户</th><th>期次</th><th>计划收款日</th><th>计划金额</th><th>确认状态</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">HT-2026-001</td><td>甲公司</td><td>第 1 期</td><td>2000-01-01</td><td class=\"settlement-money\">¥1,000</td><td><span class=\"settlement-badge tone-warning\">待确认</span></td><td><span class=\"settlement-badge tone-danger\">逾期</span></td><td><button class=\"console-button secondary small\"> 确认</button></td></tr><tr><td class=\"settlement-contract-cell\">—</td><td>—</td><td>第 — 期</td><td>2999-01-01</td><td class=\"settlement-money\">¥2,501</td><td><span class=\"settlement-badge tone-success\">已确认</span></td><td><span class=\"settlement-badge tone-info\">未到期</span></td><td><span class=\"settlement-muted\">—</span></td></tr><!--]--><!--v-if--></tbody></table></div></article><article class=\"settlement-panel settlement-formal-receivables\"><div class=\"settlement-panel-head\"><div><h2>正式应收 <small>已确认计划自动生成</small></h2><p>确认后的应收单可用于开票、回款、核销与账龄催收。</p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>应收单号</th><th>合同编号</th><th>客户</th><th>到期日</th><th>应收金额</th><th>未收余额</th><th>收款状态</th><th>开票状态</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">AR-001</td><td>HT-2026-001</td><td>甲公司</td><td>2026-11-01</td><td class=\"settlement-money\">¥1,000</td><td class=\"settlement-money\">¥400</td><td>未知</td><td>未知</td></tr><tr><td class=\"settlement-contract-cell\">AR-002</td><td>—</td><td>乙公司</td><td>2026-12-01</td><td class=\"settlement-money\">¥2,500</td><td class=\"settlement-money\">¥2,500</td><td>未回款</td><td>未开票</td></tr><!--]--><!--v-if--></tbody></table></div></article></section>",
  "saving": "<section class=\"settlement-receivables\"><div class=\"settlement-section-head\"><div><p> 合同生效后按付款节点自动生成应收计划，确认后纳入应收与催收口径。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><article class=\"settlement-panel settlement-operation-card\"><div class=\"settlement-panel-head\"><div><h2>收款计划确认</h2><p>未关联合同 · 未命名客户</p></div><button type=\"button\" class=\"console-text-button\"> 取消 </button></div><form class=\"settlement-operation-form\"><label><span>计划收款日</span><input type=\"date\" required value=\"2026-11-01\"></label><label><span>计划金额</span><input inputmode=\"decimal\" required maxlength=\"18\" value=\"1000\"></label><label class=\"wide\"><span>调整原因</span><textarea rows=\"3\" placeholder=\"如调整日期或金额，此项必填；原值将保留在审计记录中。\" maxlength=\"500\"></textarea></label><div class=\"settlement-operation-actions wide\"><button type=\"button\" class=\"console-button secondary\"> 取消 </button><button class=\"console-button\" disabled> 确认并生成应收 </button></div></form></article><div class=\"settlement-filter-bar\"><label><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M10.8 4a6.8 6.8 0 1 0 4.3 12.1l4.4 4.4 1.4-1.4-4.4-4.4A6.8 6.8 0 0 0 10.8 4Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><input placeholder=\"搜索合同号 / 客户 / 应收单号\" maxlength=\"100\" value></label><select><option value>全部确认状态</option><option>待确认</option><option>已确认</option></select><select><option value>全部状态</option><option>未到期</option><option>即将到期</option><option>逾期</option></select><button class=\"console-button secondary\"> 重置 </button></div><article class=\"settlement-panel settlement-plan-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>合同编号</th><th>客户</th><th>期次</th><th>计划收款日</th><th>计划金额</th><th>确认状态</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">HT-2026-001</td><td>甲公司</td><td>第 1 期</td><td>2000-01-01</td><td class=\"settlement-money\">¥1,000</td><td><span class=\"settlement-badge tone-warning\">待确认</span></td><td><span class=\"settlement-badge tone-danger\">逾期</span></td><td><button class=\"console-button secondary small\" disabled> 确认</button></td></tr><!--]--><!--v-if--></tbody></table></div></article><article class=\"settlement-panel settlement-formal-receivables\"><div class=\"settlement-panel-head\"><div><h2>正式应收 <small>已确认计划自动生成</small></h2><p>确认后的应收单可用于开票、回款、核销与账龄催收。</p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>应收单号</th><th>合同编号</th><th>客户</th><th>到期日</th><th>应收金额</th><th>未收余额</th><th>收款状态</th><th>开票状态</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"8\" class=\"settlement-table-empty\"> 暂无正式应收，确认收款计划后将在此展示。 </td></tr></tbody></table></div></article></section>"
}
const CASES = {
  "closedEmpty": {
    "visiblePlans": [],
    "receivables": [],
    "saving": false,
    "planEditor": {
      "id": "",
      "version": 0,
      "contract_no": "",
      "customer_name": "",
      "due_date": "",
      "planned_amount": "",
      "original_due_date": "",
      "original_planned_amount": "",
      "reason": ""
    },
    "planEditorOpen": false,
    "planKeyword": "",
    "planConfirmationFilter": "",
    "planMaturityFilter": ""
  },
  "editorOpenPopulated": {
    "visiblePlans": [
      {
        "id": "P1",
        "contract_no": "HT-2026-001",
        "customer_name": "甲公司",
        "installment_no": 1,
        "due_date": "2000-01-01",
        "planned_amount": "1000",
        "status": "PENDING_CONFIRMATION"
      },
      {
        "id": "P2",
        "contract_no": "",
        "customer_name": "",
        "installment_no": null,
        "due_date": "2999-01-01",
        "planned_amount": "2500.5",
        "status": "CONFIRMED"
      }
    ],
    "receivables": [
      {
        "id": "R1",
        "receivable_no": "AR-001",
        "contract_no": "HT-2026-001",
        "customer_name": "甲公司",
        "due_date": "2026-11-01",
        "original_amount": "1000",
        "open_amount": "400",
        "collection_status": "PARTIALLY_PAID",
        "invoice_status": "INVOICED"
      },
      {
        "id": "R2",
        "receivable_no": "AR-002",
        "contract_no": "",
        "customer_name": "乙公司",
        "due_date": "2026-12-01",
        "original_amount": "2500",
        "open_amount": "2500",
        "collection_status": "UNPAID",
        "invoice_status": "NOT_INVOICED"
      }
    ],
    "saving": false,
    "planEditor": {
      "id": "P1",
      "version": 2,
      "contract_no": "HT-2026-001",
      "customer_name": "甲公司",
      "due_date": "2026-11-01",
      "planned_amount": "1000",
      "original_due_date": "2026-11-01",
      "original_planned_amount": "1000",
      "reason": "客户申请延期"
    },
    "planEditorOpen": true,
    "planKeyword": "HT-2026",
    "planConfirmationFilter": "待确认",
    "planMaturityFilter": "逾期"
  },
  "saving": {
    "visiblePlans": [
      {
        "id": "P1",
        "contract_no": "HT-2026-001",
        "customer_name": "甲公司",
        "installment_no": 1,
        "due_date": "2000-01-01",
        "planned_amount": "1000",
        "status": "PENDING_CONFIRMATION"
      }
    ],
    "receivables": [],
    "saving": true,
    "planEditor": {
      "id": "P1",
      "version": 2,
      "contract_no": "",
      "customer_name": "",
      "due_date": "2026-11-01",
      "planned_amount": "1000",
      "original_due_date": "2026-11-01",
      "original_planned_amount": "1000",
      "reason": ""
    },
    "planEditorOpen": true,
    "planKeyword": "",
    "planConfirmationFilter": "",
    "planMaturityFilter": ""
  }
}
const materialize = ({ __fn = {}, ...data }) => ({ ...data, ...Object.fromEntries(Object.entries(__fn).map(([key, src]) => [key, new Function(`return (${src})`)()])) })

const component = await loadSfc(new URL('./SettlementReceivablesPanel.vue', import.meta.url).pathname)
const render = (name) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, materialize(CASES[name])) }))

test("应收面板复现提取前 golden：编辑器关闭、无计划、无应收、筛选为空", async () => {
  assert.equal(await render("closedEmpty"), GOLDENS["closedEmpty"])
})

test("应收面板复现提取前 golden：编辑器打开且已填、筛选三路有值、计划两行（待确认带确认按钮 / 已确认）、正式应收两行", async () => {
  assert.equal(await render("editorOpenPopulated"), GOLDENS["editorOpenPopulated"])
})

test("应收面板复现提取前 golden：保存中（确认与提交按钮禁用，编辑器标题回落未关联/未命名）", async () => {
  assert.equal(await render("saving"), GOLDENS["saving"])
})

test("应收面板：动作以事件回传，编辑器开关与筛选以 defineModel 双向绑定，模板原文保留 v-model 与直接赋值", () => {
  const source = readFileSync(new URL('./SettlementReceivablesPanel.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("$emit('reload')"), "$emit('reload')")
  assert.ok(source.includes("$emit('submit-plan')"), "$emit('submit-plan')")
  assert.ok(source.includes("$emit('reset-filters')"), "$emit('reset-filters')")
  assert.ok(source.includes("$emit('confirm-plan', plan)"), "$emit('confirm-plan', plan)")
  assert.ok(source.includes("defineModel('planEditorOpen')"), "defineModel('planEditorOpen')")
  assert.ok(source.includes("defineModel('planKeyword')"), "defineModel('planKeyword')")
  assert.ok(source.includes("defineModel('planConfirmationFilter')"), "defineModel('planConfirmationFilter')")
  assert.ok(source.includes("defineModel('planMaturityFilter')"), "defineModel('planMaturityFilter')")
  assert.ok(source.includes("@click=\"planEditorOpen = false\""), "@click=\"planEditorOpen = false\"")
  assert.ok(source.includes("v-model.trim=\"planKeyword\""), "v-model.trim=\"planKeyword\"")
  assert.doesNotMatch(source, /confirmPlan\(/)
  assert.doesNotMatch(source, /resetPlanFilters/)
  assert.doesNotMatch(source, /submitPlanConfirmation/)
  assert.doesNotMatch(source, /active ===/)
  assert.doesNotMatch(source, /window\.prompt/)
})
