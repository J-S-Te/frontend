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

// golden 为提取前 SettlementView.vue 「开票管理」区（申请编辑器 / 审核弹层 / 申请与台账两页签）片段的 SSR 渲染结果
// （治理批次 5 结算第三步采集；片段 / 提取前 SFC / 用例 / golden 归档于 .ai/qa/closure-20261025/goldens-settlement-panels/SettlementInvoiceListPanel/）；
// 提取后本组件必须逐字节复现同一 DOM。cases 中 __fn 为函数 prop 源码，渲染前求值。
const GOLDENS = {
  "requestsTabEmpty": "<section class=\"settlement-invoices\"><div class=\"settlement-section-head\"><div><p>关联合同发起开票申请，财务审核通过后驱动税控开票并回填。</p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><button class=\"console-button\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3v2h14V7H5Zm3 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm4.2 4.5h5.3v-1.2c0-1.1-1.2-1.8-2.6-1.8s-2.7.7-2.7 1.8v1.2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>发起开票申请 </button></div></div><!--v-if--><!--v-if--><div class=\"settlement-tabs\" role=\"tablist\" aria-label=\"开票数据\"><button class=\"active\"> 开票申请</button><button class=\"\"> 发票台账 </button></div><div class=\"settlement-filter-bar settlement-invoice-filters\"><label><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M10.8 4a6.8 6.8 0 1 0 4.3 12.1l4.4 4.4 1.4-1.4-4.4-4.4A6.8 6.8 0 0 0 10.8 4Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><input placeholder=\"搜索申请号 / 合同号 / 购方\" maxlength=\"100\" value></label><select><option value>全部状态</option><option value=\"SPECIAL_REVIEW\">待总监加签</option><option value=\"SUBMITTED\"> 待审核 </option><option value=\"ISSUE_PENDING\"> 待开具 </option><option value=\"REJECTED\"> 已驳回 </option><option value=\"ISSUED\">已开票</option></select><button class=\"console-button secondary\"> 重置 </button></div><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>申请号</th><th>合同号</th><th>购方名称</th><th>税号</th><th>金额</th><th>税率</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"8\" class=\"settlement-table-empty\"> 暂无匹配的开票申请 </td></tr></tbody></table></div></article></section>",
  "requestsTabFull": "<section class=\"settlement-invoices\"><div class=\"settlement-section-head\"><div><p>关联合同发起开票申请，财务审核通过后驱动税控开票并回填。</p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><button class=\"console-button\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3v2h14V7H5Zm3 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm4.2 4.5h5.3v-1.2c0-1.1-1.2-1.8-2.6-1.8s-2.7.7-2.7 1.8v1.2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>发起开票申请 </button></div></div><article class=\"settlement-panel settlement-invoice-composer\"><div class=\"settlement-panel-head\"><div><h2>发起开票申请</h2><p> 申请提交后将锁定对应应收的可开票余额，提交人不能审批本人申请。 </p></div><button class=\"console-text-button\" type=\"button\"> 收起 </button></div><form class=\"settlement-form\"><select required><option value disabled>选择可开票应收</option><!--[--><option value=\"AR-1\">AR-001 · HT-2026-001 · 甲公司 · ¥10,600</option><option value=\"AR-2\">AR-002 · HT-2026-002 · 乙公司 · ¥318</option><!--]--></select><input placeholder=\"购方税号\" required maxlength=\"64\" value=\"91110000MA\"><input placeholder=\"项目名称\" required maxlength=\"255\" value=\"测评服务\"><input placeholder=\"税收分类编码\" required maxlength=\"64\" value=\"3040201\"><input placeholder=\"不含税金额\" required maxlength=\"18\" value=\"10000\"><input placeholder=\"税率，如 0.06\" required maxlength=\"10\" value=\"0.06\"><input placeholder=\"税额\" required maxlength=\"18\" value=\"600\"><input placeholder=\"价税合计\" required maxlength=\"18\" value=\"10600\"><textarea maxlength=\"1000\" placeholder=\"特殊事项或折扣原因（填写后需总监加签）\"></textarea><button>提交申请</button></form></article><article class=\"settlement-panel settlement-operation-card\"><div class=\"settlement-panel-head\"><div><h2>审核开票申请</h2><p>申请号 REQ-001</p></div><button type=\"button\" class=\"console-text-button\"> 取消 </button></div><label class=\"settlement-review-reason\"><span>审核意见 / 驳回原因</span><textarea rows=\"3\" placeholder=\"驳回时必填；审批通过时可填写审核说明。\" maxlength=\"500\">税号与合同不一致</textarea></label><div class=\"settlement-operation-actions\"><button type=\"button\" class=\"console-button danger\"> 驳回申请 </button><button type=\"button\" class=\"console-button\"> 审批通过 </button></div></article><div class=\"settlement-tabs\" role=\"tablist\" aria-label=\"开票数据\"><button class=\"active\"> 开票申请</button><button class=\"\"> 发票台账 </button></div><div class=\"settlement-filter-bar settlement-invoice-filters\"><label><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M10.8 4a6.8 6.8 0 1 0 4.3 12.1l4.4 4.4 1.4-1.4-4.4-4.4A6.8 6.8 0 0 0 10.8 4Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><input placeholder=\"搜索申请号 / 合同号 / 购方\" maxlength=\"100\" value=\"REQ\"></label><select><option value>全部状态</option><option value=\"SPECIAL_REVIEW\">待总监加签</option><option value=\"SUBMITTED\"> 待审核 </option><option value=\"ISSUE_PENDING\"> 待开具 </option><option value=\"REJECTED\"> 已驳回 </option><option value=\"ISSUED\">已开票</option></select><button class=\"console-button secondary\"> 重置 </button></div><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>申请号</th><th>合同号</th><th>购方名称</th><th>税号</th><th>金额</th><th>税率</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">REQ-001</td><td>HT-2026-001</td><td>甲公司</td><td>9111****MA</td><td class=\"settlement-money\">¥10,600</td><td>—</td><td><span class=\"settlement-badge tone-warning\">待审核</span><!--v-if--></td><td><!--v-if--><button class=\"console-button small\"> 审核</button></td></tr><tr><td class=\"settlement-contract-cell\">REQ-002</td><td>HT-2026-002</td><td>乙公司</td><td>9112****MB</td><td class=\"settlement-money\">¥318</td><td>—</td><td><span class=\"settlement-badge tone-info\">待开具</span><!--v-if--></td><td><!--v-if--><button class=\"console-button secondary small\"> 登记发票</button></td></tr><tr><td class=\"settlement-contract-cell\">REQ-003</td><td>—</td><td>丙公司</td><td>—</td><td class=\"settlement-money\">¥5,000</td><td>—</td><td><span class=\"settlement-badge tone-danger\">开具失败</span><p class=\"settlement-muted\">服务响应超时，请稍后重新加载；仍失败时请联系管理员。</p></td><td><!--v-if--><button class=\"console-button secondary small\">失败复核</button></td></tr><tr><td class=\"settlement-contract-cell\">REQ-004</td><td>HT-2026-004</td><td>丁公司</td><td>9114****MD</td><td class=\"settlement-money\">¥100</td><td>—</td><td><span class=\"settlement-badge tone-gray\">APPROVED</span><!--v-if--></td><td><!--v-if--><span class=\"settlement-muted\">—</span></td></tr><!--]--><!--v-if--></tbody></table></div></article></section>",
  "ledgerTabNoPermissionSaving": "<section class=\"settlement-invoices\"><div class=\"settlement-section-head\"><div><p>关联合同发起开票申请，财务审核通过后驱动税控开票并回填。</p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><!--v-if--></div></div><!--v-if--><!--v-if--><div class=\"settlement-tabs\" role=\"tablist\" aria-label=\"开票数据\"><button class=\"\"> 开票申请</button><button class=\"active\"> 发票台账 </button></div><div class=\"settlement-filter-bar settlement-invoice-filters\"><label><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M10.8 4a6.8 6.8 0 1 0 4.3 12.1l4.4 4.4 1.4-1.4-4.4-4.4A6.8 6.8 0 0 0 10.8 4Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><input placeholder=\"搜索发票号码 / 合同号 / 购方\" maxlength=\"100\" value></label><select><option value>全部状态</option><!--v-if--><!--v-if--><!--v-if--><!--v-if--><option value=\"ISSUED\">已开票</option></select><button class=\"console-button secondary\"> 重置 </button></div><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>发票号码</th><th>发票代码</th><th>合同号</th><th>购方名称</th><th>开票日期</th><th>价税合计</th><th>类型</th><th>状态</th><th>红冲流程</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">NO-9</td><td>CODE-9</td><td>HT-2026-001</td><td>甲公司</td><td>2026-10-20</td><td class=\"settlement-money\">¥10,600</td><td>电子普通发票</td><td><span class=\"settlement-badge tone-success\">已开票</span></td><td>待财务复核</td><td><button class=\"console-text-button\"> 查看 </button></td></tr><tr><td class=\"settlement-contract-cell\">NO-8</td><td></td><td>—</td><td>乙公司</td><td>2026-10-21</td><td class=\"settlement-money\">¥318</td><td>电子专用发票</td><td><span class=\"settlement-badge tone-gray\">RED_FLUSHED</span></td><td>—</td><td><button class=\"console-text-button\"> 查看 </button></td></tr><!--]--><!--v-if--></tbody></table></div></article></section>"
}
const CASES = {
  "requestsTabEmpty": {
    "visibleInvoiceRequests": [],
    "visibleTaxInvoices": [],
    "invoiceEligibleReceivables": [],
    "saving": false,
    "invoiceForm": {
      "receivable_id": "",
      "invoice_type": "ELECTRONIC_NORMAL",
      "buyer_tax_no": "",
      "item_name": "服务费",
      "tax_classification_code": "",
      "amount_excl_tax": "",
      "tax_rate": "0.06",
      "tax_amount": "",
      "amount_incl_tax": ""
    },
    "invoiceReview": {
      "id": "",
      "version": 0,
      "request_no": "",
      "reason": ""
    },
    "invoiceTab": "requests",
    "invoiceComposerOpen": false,
    "invoiceReviewOpen": false,
    "invoiceKeyword": "",
    "invoiceStatusFilter": "",
    "__fn": {
      "can": "() => true"
    }
  },
  "requestsTabFull": {
    "visibleInvoiceRequests": [
      {
        "id": "R1",
        "request_no": "REQ-001",
        "contract_no": "HT-2026-001",
        "receivable_no": "AR-001",
        "buyer_name": "甲公司",
        "buyer_tax_no_masked": "9111****MA",
        "invoice_type": "ELECTRONIC_NORMAL",
        "amount_incl_tax": "10600",
        "currency": "CNY",
        "status": "SUBMITTED",
        "issue_channel": "TAX_ADAPTER",
        "failure_code": "",
        "failure_message": ""
      },
      {
        "id": "R2",
        "request_no": "REQ-002",
        "contract_no": "HT-2026-002",
        "receivable_no": "AR-002",
        "buyer_name": "乙公司",
        "buyer_tax_no_masked": "9112****MB",
        "invoice_type": "ELECTRONIC_SPECIAL",
        "amount_incl_tax": "318",
        "currency": "CNY",
        "status": "ISSUE_PENDING",
        "issue_channel": "MANUAL",
        "failure_code": "",
        "failure_message": ""
      },
      {
        "id": "R3",
        "request_no": "REQ-003",
        "contract_no": "",
        "receivable_no": "AR-003",
        "buyer_name": "丙公司",
        "buyer_tax_no_masked": "",
        "invoice_type": "ELECTRONIC_NORMAL",
        "amount_incl_tax": "5000",
        "currency": "USD",
        "status": "ISSUE_FAILED",
        "issue_channel": "TAX_ADAPTER",
        "failure_code": "SETTLEMENT_TAX_TIMEOUT",
        "failure_message": "tax adapter timeout"
      },
      {
        "id": "R4",
        "request_no": "REQ-004",
        "contract_no": "HT-2026-004",
        "receivable_no": "AR-004",
        "buyer_name": "丁公司",
        "buyer_tax_no_masked": "9114****MD",
        "invoice_type": "ELECTRONIC_NORMAL",
        "amount_incl_tax": "100",
        "currency": "CNY",
        "status": "APPROVED",
        "issue_channel": "TAX_ADAPTER",
        "failure_code": "",
        "failure_message": ""
      }
    ],
    "visibleTaxInvoices": [],
    "invoiceEligibleReceivables": [
      {
        "id": "AR-1",
        "receivable_no": "AR-001",
        "customer_name": "甲公司",
        "contract_no": "HT-2026-001",
        "invoiceable_amount": "10600",
        "currency": "CNY"
      },
      {
        "id": "AR-2",
        "receivable_no": "AR-002",
        "customer_name": "乙公司",
        "contract_no": "HT-2026-002",
        "invoiceable_amount": "318",
        "currency": "CNY"
      }
    ],
    "saving": false,
    "invoiceForm": {
      "receivable_id": "AR-1",
      "invoice_type": "ELECTRONIC_NORMAL",
      "buyer_tax_no": "91110000MA",
      "item_name": "测评服务",
      "tax_classification_code": "3040201",
      "amount_excl_tax": "10000",
      "tax_rate": "0.06",
      "tax_amount": "600",
      "amount_incl_tax": "10600"
    },
    "invoiceReview": {
      "id": "R1",
      "version": 2,
      "request_no": "REQ-001",
      "reason": "税号与合同不一致"
    },
    "invoiceTab": "requests",
    "invoiceComposerOpen": true,
    "invoiceReviewOpen": true,
    "invoiceKeyword": "REQ",
    "invoiceStatusFilter": "SUBMITTED",
    "__fn": {
      "can": "() => true"
    }
  },
  "ledgerTabNoPermissionSaving": {
    "visibleInvoiceRequests": [
      {
        "id": "R1",
        "request_no": "REQ-001",
        "contract_no": "HT-2026-001",
        "receivable_no": "AR-001",
        "buyer_name": "甲公司",
        "buyer_tax_no_masked": "9111****MA",
        "invoice_type": "ELECTRONIC_NORMAL",
        "amount_incl_tax": "10600",
        "currency": "CNY",
        "status": "SUBMITTED",
        "issue_channel": "TAX_ADAPTER",
        "failure_code": "",
        "failure_message": ""
      }
    ],
    "visibleTaxInvoices": [
      {
        "id": "INV-1",
        "invoice_code": "CODE-9",
        "invoice_no": "NO-9",
        "contract_no": "HT-2026-001",
        "receivable_no": "AR-001",
        "customer_name": "甲公司",
        "buyer_name": "甲公司",
        "invoice_type": "ELECTRONIC_NORMAL",
        "amount_incl_tax": "10600",
        "currency": "CNY",
        "issue_date": "2026-10-20",
        "issue_channel": "TAX_ADAPTER",
        "status": "ISSUED",
        "red_flush_status": "SUBMITTED"
      },
      {
        "id": "INV-2",
        "invoice_code": "",
        "invoice_no": "NO-8",
        "contract_no": "",
        "receivable_no": "AR-002",
        "customer_name": "乙公司",
        "buyer_name": "乙公司",
        "invoice_type": "ELECTRONIC_SPECIAL",
        "amount_incl_tax": "318",
        "currency": "CNY",
        "issue_date": "2026-10-21",
        "issue_channel": "MANUAL",
        "status": "RED_FLUSHED",
        "red_flush_status": ""
      }
    ],
    "invoiceEligibleReceivables": [],
    "saving": true,
    "invoiceForm": {
      "receivable_id": "",
      "invoice_type": "ELECTRONIC_NORMAL",
      "buyer_tax_no": "",
      "item_name": "服务费",
      "tax_classification_code": "",
      "amount_excl_tax": "",
      "tax_rate": "0.06",
      "tax_amount": "",
      "amount_incl_tax": ""
    },
    "invoiceReview": {
      "id": "",
      "version": 0,
      "request_no": "",
      "reason": ""
    },
    "invoiceTab": "ledger",
    "invoiceComposerOpen": false,
    "invoiceReviewOpen": false,
    "invoiceKeyword": "",
    "invoiceStatusFilter": "ISSUED",
    "__fn": {
      "can": "() => false"
    }
  }
}
const materialize = ({ __fn = {}, ...data }) => ({ ...data, ...Object.fromEntries(Object.entries(__fn).map(([key, src]) => [key, new Function(`return (${src})`)()])) })

const component = await loadSfc(new URL('./SettlementInvoiceListPanel.vue', import.meta.url).pathname)
const render = (name) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, materialize(CASES[name])) }))

test("开票管理面板角色权限基线：申请页签、无数据、编辑器与审核关闭、筛选为空", async () => {
  assert.equal(await render("requestsTabEmpty"), GOLDENS["requestsTabEmpty"])
})

test("开票管理面板角色权限基线：编辑器与审核弹层打开且已填、可开票应收两项、申请四行覆盖批准 / 人工登记 / 失败复核 / 无动作分支", async () => {
  assert.equal(await render("requestsTabFull"), GOLDENS["requestsTabFull"])
})

test("开票管理面板角色权限基线：台账页签两行（含红冲状态）、无权限隐藏动作、保存中禁用", async () => {
  assert.equal(await render("ledgerTabNoPermissionSaving"), GOLDENS["ledgerTabNoPermissionSaving"])
})

test("开票管理面板：八类动作以事件回传，页签 / 两开关 / 两筛选以 defineModel 双向绑定，权限谓词 can 为函数 prop", () => {
  const source = readFileSync(new URL('./SettlementInvoiceListPanel.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("$emit('reload')"), "$emit('reload')")
  assert.ok(source.includes("$emit('submit-invoice')"), "$emit('submit-invoice')")
  assert.ok(source.includes("$emit('submit-review', 'reject')"), "$emit('submit-review', 'reject')")
  assert.ok(source.includes("$emit('submit-review', 'approve')"), "$emit('submit-review', 'approve')")
  assert.ok(source.includes("$emit('reset-filters')"), "$emit('reset-filters')")
  assert.ok(source.includes("$emit('approve', item)"), "$emit('approve', item)")
  assert.ok(source.includes("$emit('manual-issue', item)"), "$emit('manual-issue', item)")
  assert.ok(source.includes("$emit('review-failure', item)"), "$emit('review-failure', item)")
  assert.ok(source.includes("$emit('open-detail', item)"), "$emit('open-detail', item)")
  assert.ok(source.includes("defineModel('invoiceTab')"), "defineModel('invoiceTab')")
  assert.ok(source.includes("defineModel('invoiceComposerOpen')"), "defineModel('invoiceComposerOpen')")
  assert.ok(source.includes("defineModel('invoiceReviewOpen')"), "defineModel('invoiceReviewOpen')")
  assert.ok(source.includes("defineModel('invoiceKeyword')"), "defineModel('invoiceKeyword')")
  assert.ok(source.includes("defineModel('invoiceStatusFilter')"), "defineModel('invoiceStatusFilter')")
  assert.ok(source.includes("can: { type: Function, required: true }"), "can: { type: Function, required: true }")
  assert.ok(source.includes("@click=\"invoiceTab = 'ledger'\""), "@click=\"invoiceTab = 'ledger'\"")
  assert.doesNotMatch(source, /submitInvoiceReview/)
  assert.doesNotMatch(source, /resetInvoiceFilters/)
  assert.doesNotMatch(source, /approveInvoice\(/)
  assert.doesNotMatch(source, /manualIssue\(/)
  assert.doesNotMatch(source, /openReviewFailure/)
  assert.doesNotMatch(source, /openInvoiceDetail/)
  assert.doesNotMatch(source, /active ===/)
  assert.doesNotMatch(source, /window\.prompt/)
})

// 角色补齐改变写动作边界，显式拒绝能力时即使弹层模型已打开也必须隐藏写入口。
test('SettlementInvoiceListPanel：权限撤销后关闭写表单及操作入口', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component,
    { ...materialize(CASES['requestsTabFull']), can: () => false }) }))
  assert.doesNotMatch(html, />\s*(?:发起开票申请|审批通过|登记发票|失败复核)\s*</)
})
