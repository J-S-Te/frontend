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

// golden 为提取前 SettlementView.vue 「回款核销」区（回款登记与匹配建议）片段的 SSR 渲染结果
// （治理批次 5 结算第三步采集；片段 / 提取前 SFC / 用例 / golden 归档于 .ai/qa/closure-20261025/goldens-settlement-panels/SettlementReceiptsPanel/）；
// 提取后本组件必须逐字节复现同一 DOM。cases 中 __fn 为函数 prop 源码，渲染前求值。
const GOLDENS = {
  "closedEmpty": "<section class=\"settlement-allocations\"><div class=\"settlement-section-head\"><div><p> 会计录入回款，系统按客户、合同与金额匹配生成核销单，确认后生效。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><button class=\"console-button\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>登记回款 </button></div></div><!--v-if--><!--v-if--><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>回款号</th><th>客户</th><th>金额</th><th>回款日期</th><th>方式</th><th>银行凭证号</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"8\" class=\"settlement-table-empty\"> 暂无回款记录 </td></tr></tbody></table></div></article></section>",
  "composerOpenWithMatches": "<section class=\"settlement-allocations\"><div class=\"settlement-section-head\"><div><p> 会计录入回款，系统按客户、合同与金额匹配生成核销单，确认后生效。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><button class=\"console-button\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>登记回款 </button></div></div><article class=\"settlement-panel settlement-invoice-composer\"><div class=\"settlement-panel-head\"><div><h2>登记回款</h2><p>银行凭证号用于回款去重与后续审计追溯。</p></div><button class=\"console-text-button\"> 收起 </button></div><form class=\"settlement-form\"><select required><option value disabled>选择回款客户</option><!--[--><option value=\"C1\">甲公司</option><option value=\"C2\">乙公司</option><!--]--></select><input placeholder=\"金额\" required maxlength=\"18\" value=\"5000\"><input type=\"date\" required value=\"2026-10-20\"><select><option value=\"TRANSFER\">电汇</option><option value=\"BANK_ACCEPTANCE\">银行承兑</option><option value=\"CHEQUE\">支票</option><option value=\"CASH\">现金</option></select><input placeholder=\"银行凭证号\" required maxlength=\"128\" value=\"BANK-123\"><button>确认登记</button></form></article><article class=\"settlement-panel settlement-match-panel\"><div class=\"settlement-panel-head\"><div><h2>回款匹配建议</h2><p>仅展示同租户、同客户、同币种且仍有余额的正式应收。</p></div><button class=\"console-text-button\"> 关闭 </button></div><div class=\"settlement-match-list\"><!--[--><button type=\"button\"><span><strong>AR-001</strong><small>HT-2026-001 · 到期 2026-11-01</small></span><span><strong>¥1,000</strong><small>匹配度 0.95</small></span></button><button type=\"button\"><span><strong>AR-002</strong><small>未关联合同 · 到期 2026-12-01</small></span><span><strong>¥200</strong><small>匹配度 0.6</small></span></button><!--]--></div></article><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>回款号</th><th>客户</th><th>金额</th><th>回款日期</th><th>方式</th><th>银行凭证号</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">RCPT-001</td><td>甲公司</td><td class=\"settlement-money\">¥5,000</td><td>2026-10-20</td><td>电汇</td><td>BANK-123</td><td><span class=\"settlement-badge tone-info\">部分核销</span></td><td><button class=\"console-text-button\"> 发起核销</button></td></tr><tr><td class=\"settlement-contract-cell\">RCPT-002</td><td>乙公司</td><td class=\"settlement-money\">US$300</td><td>2026-10-21</td><td>现金</td><td></td><td><span class=\"settlement-badge tone-success\">已核销</span></td><td><button class=\"console-text-button\"> 查看核销结果 </button></td></tr><!--]--><!--v-if--></tbody></table></div></article></section>",
  "noPermissionSaving": "<section class=\"settlement-allocations\"><div class=\"settlement-section-head\"><div><p> 会计录入回款，系统按客户、合同与金额匹配生成核销单，确认后生效。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><!--v-if--></div></div><article class=\"settlement-panel settlement-invoice-composer\"><div class=\"settlement-panel-head\"><div><h2>登记回款</h2><p>银行凭证号用于回款去重与后续审计追溯。</p></div><button class=\"console-text-button\"> 收起 </button></div><form class=\"settlement-form\"><select required><option value disabled>选择回款客户</option><!--[--><option value=\"C3\">丙公司</option><!--]--></select><input placeholder=\"金额\" required maxlength=\"18\" value><input type=\"date\" required value=\"2026-10-26\"><select><option value=\"TRANSFER\">电汇</option><option value=\"BANK_ACCEPTANCE\">银行承兑</option><option value=\"CHEQUE\">支票</option><option value=\"CASH\">现金</option></select><input placeholder=\"银行凭证号\" required maxlength=\"128\" value><button disabled>确认登记</button></form></article><article class=\"settlement-panel settlement-match-panel\"><div class=\"settlement-panel-head\"><div><h2>回款匹配建议</h2><p>仅展示同租户、同客户、同币种且仍有余额的正式应收。</p></div><button class=\"console-text-button\"> 关闭 </button></div><div class=\"settlement-empty compact\"> 暂无可匹配应收，可在核销页手动选择。 </div></article><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>回款号</th><th>客户</th><th>金额</th><th>回款日期</th><th>方式</th><th>银行凭证号</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">RCPT-003</td><td>丙公司</td><td class=\"settlement-money\">¥80</td><td>2026-10-22</td><td>电汇</td><td></td><td><span class=\"settlement-badge tone-purple\">待核销</span></td><td><button class=\"console-text-button\"> 发起核销</button></td></tr><!--]--><!--v-if--></tbody></table></div></article></section>"
}
const CASES = {
  "closedEmpty": {
    "receipts": [],
    "receiptCustomers": [],
    "saving": false,
    "receiptForm": {
      "customer_id": "",
      "customer_name": "",
      "amount": "",
      "currency": "CNY",
      "receipt_date": "2026-10-26",
      "payment_method": "TRANSFER",
      "bank_transaction_reference": ""
    },
    "receiptComposerOpen": false,
    "receiptMatchFor": "",
    "receiptMatches": [],
    "__fn": {
      "can": "(code) => code === 'settlement.invoice.request'"
    }
  },
  "composerOpenWithMatches": {
    "receipts": [
      {
        "id": "RC1",
        "receipt_no": "RCPT-001",
        "customer_name": "甲公司",
        "amount": "5000",
        "currency": "CNY",
        "receipt_date": "2026-10-20",
        "payment_method": "TRANSFER",
        "bank_transaction_reference": "BANK-123",
        "status": "PARTIALLY_ALLOCATED",
        "unallocated_amount": "1200"
      },
      {
        "id": "RC2",
        "receipt_no": "RCPT-002",
        "customer_name": "乙公司",
        "amount": "300",
        "currency": "USD",
        "receipt_date": "2026-10-21",
        "payment_method": "CASH",
        "bank_transaction_reference": "",
        "status": "FULLY_ALLOCATED",
        "unallocated_amount": "0"
      }
    ],
    "receiptCustomers": [
      {
        "id": "C1",
        "name": "甲公司"
      },
      {
        "id": "C2",
        "name": "乙公司"
      }
    ],
    "saving": false,
    "receiptForm": {
      "customer_id": "C1",
      "customer_name": "甲公司",
      "amount": "5000",
      "currency": "CNY",
      "receipt_date": "2026-10-20",
      "payment_method": "TRANSFER",
      "bank_transaction_reference": "BANK-123"
    },
    "receiptComposerOpen": true,
    "receiptMatchFor": "RC1",
    "receiptMatches": [
      {
        "receivable_id": "AR-1",
        "receivable_no": "AR-001",
        "contract_no": "HT-2026-001",
        "due_date": "2026-11-01",
        "suggested_amount": "1000",
        "score": 0.95
      },
      {
        "receivable_id": "AR-2",
        "receivable_no": "AR-002",
        "contract_no": "",
        "due_date": "2026-12-01",
        "suggested_amount": "200",
        "score": 0.6
      }
    ],
    "__fn": {
      "can": "(code) => code === 'settlement.invoice.request'"
    }
  },
  "noPermissionSaving": {
    "receipts": [
      {
        "id": "RC3",
        "receipt_no": "RCPT-003",
        "customer_name": "丙公司",
        "amount": "80",
        "currency": "CNY",
        "receipt_date": "2026-10-22",
        "payment_method": "TRANSFER",
        "bank_transaction_reference": "",
        "status": "AVAILABLE",
        "unallocated_amount": "80"
      }
    ],
    "receiptCustomers": [
      {
        "id": "C3",
        "name": "丙公司"
      }
    ],
    "saving": true,
    "receiptForm": {
      "customer_id": "",
      "customer_name": "",
      "amount": "",
      "currency": "CNY",
      "receipt_date": "2026-10-26",
      "payment_method": "TRANSFER",
      "bank_transaction_reference": ""
    },
    "receiptComposerOpen": true,
    "receiptMatchFor": "RC3",
    "receiptMatches": [],
    "__fn": {
      "can": "() => false"
    }
  }
}
const materialize = ({ __fn = {}, ...data }) => ({ ...data, ...Object.fromEntries(Object.entries(__fn).map(([key, src]) => [key, new Function(`return (${src})`)()])) })

const component = await loadSfc(new URL('./SettlementReceiptsPanel.vue', import.meta.url).pathname)
const render = (name) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, materialize(CASES[name])) }))

test("回款面板复现提取前 golden：编辑器关闭、无回款、无匹配建议、登记按钮可见", async () => {
  assert.equal(await render("closedEmpty"), GOLDENS["closedEmpty"])
})

test("回款面板复现提取前 golden：编辑器打开且已填、客户两项、匹配建议两条、回款两行（含去核销按钮与已核销）", async () => {
  assert.equal(await render("composerOpenWithMatches"), GOLDENS["composerOpenWithMatches"])
})

test("回款面板复现提取前 golden：无登记权限（按钮隐藏）、保存中禁用、匹配面板打开但无建议", async () => {
  assert.equal(await render("noPermissionSaving"), GOLDENS["noPermissionSaving"])
})

test("回款面板：动作以事件回传，编辑器开关 / 匹配回款 / 建议列表以 defineModel 双向绑定，模板直接赋值原样保留", () => {
  const source = readFileSync(new URL('./SettlementReceiptsPanel.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("$emit('reload')"), "$emit('reload')")
  assert.ok(source.includes("$emit('submit-receipt')"), "$emit('submit-receipt')")
  assert.ok(source.includes("$emit('sync-customer')"), "$emit('sync-customer')")
  assert.ok(source.includes("$emit('select-match', match)"), "$emit('select-match', match)")
  assert.ok(source.includes("$emit('navigate', 'allocations')"), "$emit('navigate', 'allocations')")
  assert.ok(source.includes("defineModel('receiptComposerOpen')"), "defineModel('receiptComposerOpen')")
  assert.ok(source.includes("defineModel('receiptMatchFor')"), "defineModel('receiptMatchFor')")
  assert.ok(source.includes("defineModel('receiptMatches')"), "defineModel('receiptMatches')")
  assert.ok(source.includes("@click=\"receiptMatchFor = ''; receiptMatches = []\""), "@click=\"receiptMatchFor = ''; receiptMatches = []\"")
  assert.ok(source.includes("can: { type: Function, required: true }"), "can: { type: Function, required: true }")
  assert.doesNotMatch(source, /submitReceipt/)
  assert.doesNotMatch(source, /syncReceiptCustomer/)
  assert.doesNotMatch(source, /selectReceiptMatch/)
  assert.doesNotMatch(source, /go\(/)
  assert.doesNotMatch(source, /active ===/)
  assert.doesNotMatch(source, /window\.prompt/)
})
