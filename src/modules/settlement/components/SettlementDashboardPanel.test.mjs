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

// golden 为提取前 SettlementView.vue 结算总览区片段的 SSR 渲染结果
// （治理批次 5 结算第三步采集；片段 / 提取前 SFC / 用例 / golden 归档于 .ai/qa/closure-20261025/goldens-settlement-panels/SettlementDashboardPanel/）；
// 提取后本组件必须逐字节复现同一 DOM。cases 中 __fn 为函数 prop 源码，渲染前求值。
const GOLDENS = {
  "empty": "<section class=\"settlement-dashboard\"><section class=\"settlement-cards\"><!--[--><article class=\"tone-blue\"><span>应收总额（未结清）</span><b>¥0</b><small>0 笔正式应收 · 按币种汇总</small></article><article class=\"tone-green\"><span>本月已回款</span><b>¥0</b><small>本月回款 · 服务端按币种汇总</small></article><article class=\"tone-orange\"><span>待开票金额</span><b>¥0</b><small>0 笔待处理 · 按币种汇总</small></article><article class=\"tone-purple\"><span>逾期应收</span><b>¥0</b><small>0 笔需要催收 · 按币种汇总</small></article><!--]--></section><section class=\"settlement-dashboard-grid\"><div><article class=\"settlement-panel settlement-workbench\"><div class=\"settlement-panel-head\"><div><h2>待办事项 <small>需我处理</small></h2><p> 收款计划、开票审核和核销任务按真实业务状态自动汇总。 </p></div><button class=\"console-text-button\"> 查看全部 </button></div><div class=\"settlement-empty\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M4 3h7v5H4V3Zm9 0h7v5h-7V3ZM9 10h6v4h5v7h-7v-5H11v5H4v-7h5v-4Zm-3 6v3h3v-3H6Zm9 0v3h3v-3h-3Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><strong>当前没有待处理事项</strong><span>应收确认、开票审批和催收任务将自动汇总。</span></div></article><article class=\"settlement-panel settlement-aging\"><div class=\"settlement-panel-head\"><div><h2> 应收账款账龄分布 <small>服务端全量按币种聚合</small></h2><p> 按应收单到期日计算，用于辅助识别逾期风险；权威催收状态以催收中心为准。 </p></div><button class=\"console-text-button\"> 查看催收 </button></div><div class=\"settlement-aging-list\"><!--[--><!--]--></div></article></div><article class=\"settlement-panel settlement-top10\"><div class=\"settlement-panel-head\"><div><h2> 已开票未回款应收 TOP10 <small>服务端权威排序</small></h2><p>按币种内剩余未回款金额排序，仅展示已进入开票流程的应收单。</p></div><button class=\"console-text-button\"> 查看应收 </button></div><div class=\"settlement-empty\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3v2h14V7H5Zm3 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm4.2 4.5h5.3v-1.2c0-1.1-1.2-1.8-2.6-1.8s-2.7.7-2.7 1.8v1.2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><strong>暂无开票未回款应收</strong><span>开票申请进入流程后，将按未回款金额自动排序展示。</span></div></article><article class=\"settlement-panel settlement-guide\"><h2>业务快捷入口</h2><p>从应收、回款、核销到开票，形成完整且可追溯的资金闭环。</p><div><button class=\"console-button\"> 查看应收</button><button class=\"console-button secondary\"> 发起开票</button><button class=\"console-button secondary\"> 登记回款 </button></div></article></section></section>",
  "populated": "<section class=\"settlement-dashboard\"><section class=\"settlement-cards\"><!--[--><article class=\"tone-blue\"><span>应收总额（未结清）</span><b>CNY 12.5万 · USD ¥300</b><small>6 笔正式应收 · 按币种汇总</small></article><article class=\"tone-green\"><span>本月已回款</span><b>CNY 2.3万</b><small>本月回款 · 服务端按币种汇总</small></article><article class=\"tone-orange\"><span>待开票金额</span><b>¥999</b><small>2 笔待处理 · 按币种汇总</small></article><article class=\"tone-purple\"><span>逾期应收</span><b>CNY 1.5亿</b><small>3 笔需要催收 · 按币种汇总</small></article><!--]--></section><section class=\"settlement-dashboard-grid\"><div><article class=\"settlement-panel settlement-workbench\"><div class=\"settlement-panel-head\"><div><h2>待办事项 <small>需我处理</small></h2><p> 收款计划、开票审核和核销任务按真实业务状态自动汇总。 </p></div><button class=\"console-text-button\"> 查看全部 </button></div><div class=\"settlement-todo-list\"><!--[--><div class=\"settlement-todo\"><span class=\"settlement-todo-icon tone-orange\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><div><strong>2 笔收款计划待确认</strong><p>确认后将生成正式应收并进入催收统计口径。</p></div><button class=\"console-text-button\">去确认</button></div><div class=\"settlement-todo\"><span class=\"settlement-todo-icon tone-blue\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3v2h14V7H5Zm3 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm4.2 4.5h5.3v-1.2c0-1.1-1.2-1.8-2.6-1.8s-2.7.7-2.7 1.8v1.2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><div><strong>1 笔开票申请待审核</strong><p>请核验购方税号、金额与可开票余额。</p></div><button class=\"console-text-button\">去审核</button></div><div class=\"settlement-todo\"><span class=\"settlement-todo-icon tone-purple\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><div><strong>3 笔核销分配待关注</strong><p>回款分配与冲销结果均以业务单据为准。</p></div><button class=\"console-text-button\">去核销</button></div><!--]--></div></article><article class=\"settlement-panel settlement-aging\"><div class=\"settlement-panel-head\"><div><h2> 应收账款账龄分布 <small>服务端全量按币种聚合</small></h2><p> 按应收单到期日计算，用于辅助识别逾期风险；权威催收状态以催收中心为准。 </p></div><button class=\"console-text-button\"> 查看催收 </button></div><div class=\"settlement-aging-list\"><!--[--><div class=\"settlement-aging-row\"><span>0–30 天 · CNY</span><i><b class=\"tone-green\" style=\"width:40%;\"></b></i><strong>¥1,000</strong><em>40%</em></div><div class=\"settlement-aging-row\"><span>31–60 天 · CNY</span><i><b class=\"tone-blue\" style=\"width:32%;\"></b></i><strong>¥800</strong><em>32%</em></div><div class=\"settlement-aging-row\"><span>61–90 天 · CNY</span><i><b class=\"tone-orange\" style=\"width:20%;\"></b></i><strong>¥500</strong><em>20%</em></div><div class=\"settlement-aging-row\"><span>90 天以上 · USD</span><i><b class=\"tone-red\" style=\"width:8%;\"></b></i><strong>US$200</strong><em>8%</em></div><!--]--></div></article></div><article class=\"settlement-panel settlement-top10\"><div class=\"settlement-panel-head\"><div><h2> 已开票未回款应收 TOP10 <small>服务端权威排序</small></h2><p>按币种内剩余未回款金额排序，仅展示已进入开票流程的应收单。</p></div><button class=\"console-text-button\"> 查看应收 </button></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>#</th><th>客户</th><th>合同</th><th>应收单</th><th>未回款金额</th><th>状态</th></tr></thead><tbody><!--[--><tr><td><span class=\"settlement-rank top\">1</span></td><td>甲公司</td><td>HT-2026-001</td><td>AR-001</td><td class=\"settlement-money\">¥80,000</td><td>未知</td></tr><tr><td><span class=\"settlement-rank top\">2</span></td><td>乙公司</td><td>—</td><td>AR-002</td><td class=\"settlement-money\">¥50,000</td><td>部分开票</td></tr><tr><td><span class=\"settlement-rank top\">3</span></td><td>丙公司</td><td>HT-2026-003</td><td>AR-003</td><td class=\"settlement-money\">US$3,000</td><td>未知</td></tr><tr><td><span class=\"settlement-rank\">4</span></td><td>丁公司</td><td>HT-2026-004</td><td>AR-004</td><td class=\"settlement-money\">¥1,200</td><td>未开票</td></tr><!--]--></tbody></table></div></article><article class=\"settlement-panel settlement-guide\"><h2>业务快捷入口</h2><p>从应收、回款、核销到开票，形成完整且可追溯的资金闭环。</p><div><button class=\"console-button\"> 查看应收</button><button class=\"console-button secondary\"> 发起开票</button><button class=\"console-button secondary\"> 登记回款 </button></div></article></section></section>"
}
const CASES = {
  "empty": {
    "dashboardKpis": [
      {
        "label": "应收总额（未结清）",
        "value": "¥0",
        "note": "0 笔正式应收 · 按币种汇总",
        "tone": "blue"
      },
      {
        "label": "本月已回款",
        "value": "¥0",
        "note": "本月回款 · 服务端按币种汇总",
        "tone": "green"
      },
      {
        "label": "待开票金额",
        "value": "¥0",
        "note": "0 笔待处理 · 按币种汇总",
        "tone": "orange"
      },
      {
        "label": "逾期应收",
        "value": "¥0",
        "note": "0 笔需要催收 · 按币种汇总",
        "tone": "purple"
      }
    ],
    "workItems": [],
    "agingRows": [],
    "invoicedReceivableTop10": {
      "items": []
    }
  },
  "populated": {
    "dashboardKpis": [
      {
        "label": "应收总额（未结清）",
        "value": "CNY 12.5万 · USD ¥300",
        "note": "6 笔正式应收 · 按币种汇总",
        "tone": "blue"
      },
      {
        "label": "本月已回款",
        "value": "CNY 2.3万",
        "note": "本月回款 · 服务端按币种汇总",
        "tone": "green"
      },
      {
        "label": "待开票金额",
        "value": "¥999",
        "note": "2 笔待处理 · 按币种汇总",
        "tone": "orange"
      },
      {
        "label": "逾期应收",
        "value": "CNY 1.5亿",
        "note": "3 笔需要催收 · 按币种汇总",
        "tone": "purple"
      }
    ],
    "workItems": [
      {
        "icon": "audit",
        "tone": "orange",
        "title": "2 笔收款计划待确认",
        "description": "确认后将生成正式应收并进入催收统计口径。",
        "section": "receivables",
        "action": "去确认"
      },
      {
        "icon": "account",
        "tone": "blue",
        "title": "1 笔开票申请待审核",
        "description": "请核验购方税号、金额与可开票余额。",
        "section": "invoices",
        "action": "去审核"
      },
      {
        "icon": "save",
        "tone": "purple",
        "title": "3 笔核销分配待关注",
        "description": "回款分配与冲销结果均以业务单据为准。",
        "section": "allocations",
        "action": "去核销"
      }
    ],
    "agingRows": [
      {
        "key": "CNY-0-30",
        "label": "0–30 天 · CNY",
        "tone": "green",
        "currency": "CNY",
        "bucket": "0-30",
        "amount": "1000",
        "count": 2,
        "percent": 40
      },
      {
        "key": "CNY-31-60",
        "label": "31–60 天 · CNY",
        "tone": "blue",
        "currency": "CNY",
        "bucket": "31-60",
        "amount": "800",
        "count": 1,
        "percent": 32
      },
      {
        "key": "CNY-61-90",
        "label": "61–90 天 · CNY",
        "tone": "orange",
        "currency": "CNY",
        "bucket": "61-90",
        "amount": "500",
        "count": 1,
        "percent": 20
      },
      {
        "key": "USD-90+",
        "label": "90 天以上 · USD",
        "tone": "red",
        "currency": "USD",
        "bucket": "90+",
        "amount": "200",
        "count": 1,
        "percent": 8
      }
    ],
    "invoicedReceivableTop10": {
      "items": [
        {
          "id": "AR-1",
          "customer_name": "甲公司",
          "contract_no": "HT-2026-001",
          "receivable_no": "AR-001",
          "open_amount": "80000",
          "currency": "CNY",
          "invoice_status": "INVOICED"
        },
        {
          "id": "AR-2",
          "customer_name": "乙公司",
          "contract_no": "",
          "receivable_no": "AR-002",
          "open_amount": "50000",
          "currency": "CNY",
          "invoice_status": "PARTIALLY_INVOICED"
        },
        {
          "id": "AR-3",
          "customer_name": "丙公司",
          "contract_no": "HT-2026-003",
          "receivable_no": "AR-003",
          "open_amount": "3000",
          "currency": "USD",
          "invoice_status": "INVOICED"
        },
        {
          "id": "AR-4",
          "customer_name": "丁公司",
          "contract_no": "HT-2026-004",
          "receivable_no": "AR-004",
          "open_amount": "1200",
          "currency": "CNY",
          "invoice_status": "NOT_INVOICED"
        }
      ]
    }
  }
}
const materialize = ({ __fn = {}, ...data }) => ({ ...data, ...Object.fromEntries(Object.entries(__fn).map(([key, src]) => [key, new Function(`return (${src})`)()])) })

const component = await loadSfc(new URL('./SettlementDashboardPanel.vue', import.meta.url).pathname)
const render = (name) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, materialize(CASES[name])) }))

test("总览面板复现提取前 golden：无待办 / 无账龄 / 无 TOP10（三处空态）", async () => {
  assert.equal(await render("empty"), GOLDENS["empty"])
})

test("总览面板复现提取前 golden：待办三项、账龄四档、TOP10 四行（含前三名高亮与合同号缺省）", async () => {
  assert.equal(await render("populated"), GOLDENS["populated"])
})

test("总览面板所有跳转以 navigate(section) 回传，不再直接引用视图的 go", () => {
  const source = readFileSync(new URL('./SettlementDashboardPanel.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("$emit('navigate', 'tasks')"), "$emit('navigate', 'tasks')")
  assert.ok(source.includes("$emit('navigate', item.section)"), "$emit('navigate', item.section)")
  assert.ok(source.includes("$emit('navigate', 'dunning')"), "$emit('navigate', 'dunning')")
  assert.ok(source.includes("$emit('navigate', 'receivables')"), "$emit('navigate', 'receivables')")
  assert.ok(source.includes("$emit('navigate', 'invoices')"), "$emit('navigate', 'invoices')")
  assert.ok(source.includes("$emit('navigate', 'receipts')"), "$emit('navigate', 'receipts')")
  assert.doesNotMatch(source, /go\(/)
  assert.doesNotMatch(source, /active ===/)
  assert.doesNotMatch(source, /window\.prompt/)
})
