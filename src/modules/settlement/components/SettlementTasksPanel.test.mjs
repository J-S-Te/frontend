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
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

// golden 为提取前 SettlementView.vue 「我的待办」区片段的 SSR 渲染结果
// （治理批次 5 结算第三步采集；片段 / 提取前 SFC / 用例 / golden 归档于 .ai/qa/closure-20261025/goldens-settlement-panels/SettlementTasksPanel/）；
// 提取后本组件必须逐字节复现同一 DOM。cases 中 __fn 为函数 prop 源码，渲染前求值。
const GOLDENS = {
  "empty": "<section class=\"settlement-tasks\"><div class=\"settlement-section-head\"><div><p> 按真实业务状态聚合的待办任务；点击「去处理」可直接跳到相关页面。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><!--[--><article class=\"settlement-panel settlement-task-group\"><div class=\"settlement-panel-head\"><div><h2>待确认收款计划</h2><p>确认后将自动生成正式应收并进入催收统计口径。</p></div><span class=\"settlement-task-count\">0 项</span></div><div class=\"settlement-empty compact\"> 当前没有待办，暂无待确认计划。</div></article><article class=\"settlement-panel settlement-task-group\"><div class=\"settlement-panel-head\"><div><h2>待审批开票申请</h2><p>请核验购方税号、金额与可开票余额。</p></div><span class=\"settlement-task-count\">0 项</span></div><div class=\"settlement-empty compact\"> 当前没有待办，当前没有待审批的开票申请。</div></article><!--]--></section>",
  "populated": "<section class=\"settlement-tasks\"><div class=\"settlement-section-head\"><div><p> 按真实业务状态聚合的待办任务；点击「去处理」可直接跳到相关页面。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><!--[--><article class=\"settlement-panel settlement-task-group\"><div class=\"settlement-panel-head\"><div><h2>待确认收款计划</h2><p>确认后将自动生成正式应收并进入催收统计口径。</p></div><span class=\"settlement-task-count\">2 项</span></div><div class=\"settlement-task-list\"><!--[--><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">HT-2026-001 · 第 1 期</span><span class=\"settlement-task-meta\">计划收款日 2026-11-01 · 金额 ¥1,000</span></button><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">HT-2026-002 · 第 2 期</span><span class=\"settlement-task-meta\">计划收款日 2026-11-15 · 金额 ¥2,000</span></button><!--]--><!--v-if--></div></article><article class=\"settlement-panel settlement-task-group\"><div class=\"settlement-panel-head\"><div><h2>活跃催收案件</h2><p>到期未结清的应收案件，需持续跟进。</p></div><span class=\"settlement-task-count\">9 项</span></div><div class=\"settlement-task-list\"><!--[--><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">AR-001</span><span class=\"settlement-task-meta\">剩余 ¥100 · 逾期 1 级</span></button><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">AR-002</span><span class=\"settlement-task-meta\">剩余 ¥200 · 逾期 1 级</span></button><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">AR-003</span><span class=\"settlement-task-meta\">剩余 ¥300 · 逾期 2 级</span></button><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">AR-004</span><span class=\"settlement-task-meta\">剩余 ¥400 · 逾期 2 级</span></button><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">AR-005</span><span class=\"settlement-task-meta\">剩余 ¥500 · 逾期 3 级</span></button><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">AR-006</span><span class=\"settlement-task-meta\">剩余 ¥600 · 逾期 3 级</span></button><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">AR-007</span><span class=\"settlement-task-meta\">剩余 ¥700 · 逾期 4 级</span></button><button type=\"button\" class=\"settlement-task-item\"><span class=\"settlement-task-id\">AR-008</span><span class=\"settlement-task-meta\">剩余 ¥800 · 逾期 4 级</span></button><!--]--><p class=\"settlement-task-more\"> 还有 1 项未展示，进入「账龄与催收」查看全部。 </p></div></article><article class=\"settlement-panel settlement-task-group\"><div class=\"settlement-panel-head\"><div><h2>待确认核销分配</h2><p>回款分配需经会计复核后方可生效。</p></div><span class=\"settlement-task-count\">0 项</span></div><div class=\"settlement-empty compact\"> 当前没有待办，没有待确认的核销单。</div></article><!--]--></section>"
}
const CASES = {
  "empty": {
    "taskGroups": [
      {
        "key": "plans",
        "label": "待确认收款计划",
        "description": "确认后将自动生成正式应收并进入催收统计口径。",
        "section": "receivables",
        "action": "应收计划与应收单",
        "doneHint": "暂无待确认计划。",
        "items": []
      },
      {
        "key": "invoices",
        "label": "待审批开票申请",
        "description": "请核验购方税号、金额与可开票余额。",
        "section": "invoices",
        "action": "开票管理",
        "doneHint": "当前没有待审批的开票申请。",
        "items": []
      }
    ]
  },
  "populated": {
    "taskGroups": [
      {
        "key": "plans",
        "label": "待确认收款计划",
        "description": "确认后将自动生成正式应收并进入催收统计口径。",
        "section": "receivables",
        "action": "应收计划与应收单",
        "doneHint": "暂无待确认计划。",
        "items": [
          {
            "key": "plan-1",
            "label": "HT-2026-001 · 第 1 期",
            "meta": "计划收款日 2026-11-01 · 金额 ¥1,000"
          },
          {
            "key": "plan-2",
            "label": "HT-2026-002 · 第 2 期",
            "meta": "计划收款日 2026-11-15 · 金额 ¥2,000"
          }
        ]
      },
      {
        "key": "dunning",
        "label": "活跃催收案件",
        "description": "到期未结清的应收案件，需持续跟进。",
        "section": "dunning",
        "action": "账龄与催收",
        "doneHint": "当前没有活跃催收案件。",
        "items": [
          {
            "key": "case-1",
            "label": "AR-001",
            "meta": "剩余 ¥100 · 逾期 1 级"
          },
          {
            "key": "case-2",
            "label": "AR-002",
            "meta": "剩余 ¥200 · 逾期 1 级"
          },
          {
            "key": "case-3",
            "label": "AR-003",
            "meta": "剩余 ¥300 · 逾期 2 级"
          },
          {
            "key": "case-4",
            "label": "AR-004",
            "meta": "剩余 ¥400 · 逾期 2 级"
          },
          {
            "key": "case-5",
            "label": "AR-005",
            "meta": "剩余 ¥500 · 逾期 3 级"
          },
          {
            "key": "case-6",
            "label": "AR-006",
            "meta": "剩余 ¥600 · 逾期 3 级"
          },
          {
            "key": "case-7",
            "label": "AR-007",
            "meta": "剩余 ¥700 · 逾期 4 级"
          },
          {
            "key": "case-8",
            "label": "AR-008",
            "meta": "剩余 ¥800 · 逾期 4 级"
          },
          {
            "key": "case-9",
            "label": "AR-009",
            "meta": "剩余 ¥900 · 逾期 5 级"
          }
        ]
      },
      {
        "key": "allocations",
        "label": "待确认核销分配",
        "description": "回款分配需经会计复核后方可生效。",
        "section": "allocations",
        "action": "核销与冲销",
        "doneHint": "没有待确认的核销单。",
        "items": []
      }
    ]
  }
}
const materialize = ({ __fn = {}, ...data }) => ({ ...data, ...Object.fromEntries(Object.entries(__fn).map(([key, src]) => [key, new Function(`return (${src})`)()])) })

const component = await loadSfc(new URL('./SettlementTasksPanel.vue', import.meta.url).pathname)
const render = (name) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, materialize(CASES[name])) }))

test("待办面板复现提取前 golden：全部分组为空（doneHint 分支）", async () => {
  assert.equal(await render("empty"), GOLDENS["empty"])
})

test("待办面板复现提取前 golden：有任务项、超过 8 项折叠提示、含空分组", async () => {
  assert.equal(await render("populated"), GOLDENS["populated"])
})

test("待办面板以 navigate(section) / reload 事件与父级交互，不再直接引用视图的 go/load", () => {
  const source = readFileSync(new URL('./SettlementTasksPanel.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("$emit('navigate', group.section)"), "$emit('navigate', group.section)")
  assert.ok(source.includes("$emit('reload')"), "$emit('reload')")
  assert.ok(source.includes("taskGroups: { type: Array, required: true }"), "taskGroups: { type: Array, required: true }")
  assert.doesNotMatch(source, /go\(/)
  assert.doesNotMatch(source, /active ===/)
  assert.doesNotMatch(source, /window\.prompt/)
})
