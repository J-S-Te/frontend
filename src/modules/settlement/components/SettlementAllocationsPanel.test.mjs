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

// golden 为提取前 SettlementView.vue 「核销与冲销」区片段的 SSR 渲染结果
// （治理批次 5 结算第三步采集；片段 / 提取前 SFC / 用例 / golden 归档于 .ai/qa/closure-20261025/goldens-settlement-panels/SettlementAllocationsPanel/）；
// 提取后本组件必须逐字节复现同一 DOM。cases 中 __fn 为函数 prop 源码，渲染前求值。
const GOLDENS = {
  "allocationsTabEmpty": "<section class=\"settlement-allocations\"><div class=\"settlement-section-head\"><div><p> 管理回款与应收的核销关系；如发现匹配错误，可按原核销单发起冲销并恢复余额。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><button class=\"console-button\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>发起核销 </button></div></div><div class=\"settlement-tabs\"><button class=\"active\"> 全部核销单 </button><button class=\"\"> 已冲销核销单 </button></div><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>核销单号</th><th>回款号</th><th>应收单号</th><th>金额</th><th>币种</th><th>确认时间</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"8\" class=\"settlement-table-empty\">暂无已确认的核销单</td></tr></tbody></table></div></article><!--v-if--><!--v-if--></section>",
  "reversalsTabComposersOpen": "<section class=\"settlement-allocations\"><div class=\"settlement-section-head\"><div><p> 管理回款与应收的核销关系；如发现匹配错误，可按原核销单发起冲销并恢复余额。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><button class=\"console-button\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>发起核销 </button></div></div><div class=\"settlement-tabs\"><button class=\"\"> 全部核销单 </button><button class=\"active\"> 已冲销核销单 </button></div><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>核销单号</th><th>回款号</th><th>应收单号</th><th>金额</th><th>币种</th><th>确认时间</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"8\" class=\"settlement-table-empty\">暂无已冲销核销单</td></tr></tbody></table></div></article><article class=\"settlement-panel settlement-invoice-composer\"><div class=\"settlement-panel-head\"><div><h2>发起核销</h2><p> 请选择一笔尚有余额的回款和应收，系统将校验客户、币种与金额。 </p></div><button class=\"console-text-button\"> 收起 </button></div><form class=\"settlement-form\"><select required><option value>选择待核销回款</option><!--[--><option value=\"RC1\">RCPT-001 · 甲公司 · ¥1,200</option><!--]--></select><select required><option value>选择待核销应收</option><!--[--><option value=\"AR-1\">AR-001 · 甲公司 · ¥400</option><!--]--></select><input placeholder=\"本次核销金额\" required maxlength=\"18\" value=\"1000\"><button>确认核销</button></form></article><article class=\"settlement-panel settlement-invoice-composer\"><div class=\"settlement-panel-head\"><div><h2>确认冲销</h2><p> 冲销后会恢复原回款的未分配余额和应收未收余额，请确认后提交。 </p></div><button class=\"console-text-button\"> 收起 </button></div><form class=\"settlement-form\"><select required><option value>选择需要冲销的核销单</option><!--[--><option value=\"AL-1\">ALLOC-001 · ¥1,000</option><option value=\"AL-2\">ALLOC-002 · US$300</option><!--]--></select><input placeholder=\"冲销金额\" required maxlength=\"18\" value=\"200\"><select required><option value=\"MATCH_ERROR\">回款匹配错误</option><option value=\"CUSTOMER_CORRECTION\">客户归属修正</option><option value=\"AMOUNT_ERROR\">金额录入错误</option><option value=\"DUPLICATE_ALLOCATION\">重复核销</option><option value=\"OTHER\">其他原因</option></select><input placeholder=\"补充说明冲销原因\" required maxlength=\"500\" value=\"重复核销，冲销 200\"><button>确认冲销</button></form></article></section>",
  "saving": "<section class=\"settlement-allocations\"><div class=\"settlement-section-head\"><div><p> 管理回款与应收的核销关系；如发现匹配错误，可按原核销单发起冲销并恢复余额。 </p></div><div><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新</button><button class=\"console-button\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>发起核销 </button></div></div><div class=\"settlement-tabs\"><button class=\"active\"> 全部核销单 </button><button class=\"\"> 已冲销核销单 </button></div><article class=\"settlement-panel settlement-invoice-table\"><div class=\"settlement-table-scroll\"><table><thead><tr><th>核销单号</th><th>回款号</th><th>应收单号</th><th>金额</th><th>币种</th><th>确认时间</th><th>状态</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">ALLOC-001</td><td>RCPT-001</td><td>AR-001</td><td class=\"settlement-money\">¥1,000</td><td>CNY</td><td>2026-10-22 10:00</td><td><span class=\"settlement-badge tone-success\">已核销</span></td><td><button class=\"console-text-button\"> 冲销 </button></td></tr><!--]--><!--v-if--></tbody></table></div></article><article class=\"settlement-panel settlement-invoice-composer\"><div class=\"settlement-panel-head\"><div><h2>发起核销</h2><p> 请选择一笔尚有余额的回款和应收，系统将校验客户、币种与金额。 </p></div><button class=\"console-text-button\"> 收起 </button></div><form class=\"settlement-form\"><select required><option value>选择待核销回款</option><!--[--><option value=\"RC1\">RCPT-001 · 甲公司 · ¥1,200</option><!--]--></select><select required><option value>选择待核销应收</option><!--[--><option value=\"AR-1\">AR-001 · 甲公司 · ¥400</option><!--]--></select><input placeholder=\"本次核销金额\" required maxlength=\"18\" value=\"500\"><button disabled>确认核销</button></form></article><article class=\"settlement-panel settlement-invoice-composer\"><div class=\"settlement-panel-head\"><div><h2>确认冲销</h2><p> 冲销后会恢复原回款的未分配余额和应收未收余额，请确认后提交。 </p></div><button class=\"console-text-button\"> 收起 </button></div><form class=\"settlement-form\"><select required><option value>选择需要冲销的核销单</option><!--[--><option value=\"AL-1\">ALLOC-001 · ¥1,000</option><!--]--></select><input placeholder=\"冲销金额\" required maxlength=\"18\" value><select required><option value=\"MATCH_ERROR\">回款匹配错误</option><option value=\"CUSTOMER_CORRECTION\">客户归属修正</option><option value=\"AMOUNT_ERROR\">金额录入错误</option><option value=\"DUPLICATE_ALLOCATION\">重复核销</option><option value=\"OTHER\">其他原因</option></select><input placeholder=\"补充说明冲销原因\" required maxlength=\"500\" value><button disabled>确认冲销</button></form></article></section>"
}
const CASES = {
  "allocationsTabEmpty": {
    "allocations": [],
    "receipts": [],
    "receivables": [],
    "saving": false,
    "allocationForm": {
      "receipt_id": "",
      "receivable_id": "",
      "amount": "",
      "match_mode": "MANUAL",
      "match_confidence": 0
    },
    "reversalForm": {
      "allocation_id": "",
      "amount": "",
      "reason_code": "MATCH_ERROR",
      "reason_detail": ""
    },
    "allocationTab": "allocations",
    "allocationComposerOpen": false,
    "reversalComposerOpen": false
  },
  "reversalsTabComposersOpen": {
    "allocations": [
      {
        "id": "AL-1",
        "allocation_no": "ALLOC-001",
        "receipt_no": "RCPT-001",
        "receivable_no": "AR-001",
        "customer_name": "甲公司",
        "amount": "1000",
        "currency": "CNY",
        "status": "CONFIRMED",
        "confirmed_at": "2026-10-22 10:00"
      },
      {
        "id": "AL-2",
        "allocation_no": "ALLOC-002",
        "receipt_no": "RCPT-001",
        "receivable_no": "AR-002",
        "customer_name": "乙公司",
        "amount": "300",
        "currency": "USD",
        "status": "PARTIALLY_REVERSED",
        "confirmed_at": ""
      }
    ],
    "receipts": [
      {
        "id": "RC1",
        "receipt_no": "RCPT-001",
        "customer_name": "甲公司",
        "unallocated_amount": "1200",
        "currency": "CNY",
        "amount": "5000"
      },
      {
        "id": "RC0",
        "receipt_no": "RCPT-000",
        "customer_name": "已用完",
        "unallocated_amount": "0",
        "currency": "CNY",
        "amount": "100"
      }
    ],
    "receivables": [
      {
        "id": "AR-1",
        "receivable_no": "AR-001",
        "customer_name": "甲公司",
        "open_amount": "400",
        "currency": "CNY"
      },
      {
        "id": "AR-0",
        "receivable_no": "AR-009",
        "customer_name": "已结清",
        "open_amount": "0",
        "currency": "CNY"
      }
    ],
    "saving": false,
    "allocationForm": {
      "receipt_id": "RC1",
      "receivable_id": "AR-1",
      "amount": "1000",
      "match_mode": "SUGGESTED",
      "match_confidence": 0.95
    },
    "reversalForm": {
      "allocation_id": "AL-1",
      "amount": "200",
      "reason_code": "DUPLICATE",
      "reason_detail": "重复核销，冲销 200"
    },
    "allocationTab": "reversals",
    "allocationComposerOpen": true,
    "reversalComposerOpen": true
  },
  "saving": {
    "allocations": [
      {
        "id": "AL-1",
        "allocation_no": "ALLOC-001",
        "receipt_no": "RCPT-001",
        "receivable_no": "AR-001",
        "customer_name": "甲公司",
        "amount": "1000",
        "currency": "CNY",
        "status": "CONFIRMED",
        "confirmed_at": "2026-10-22 10:00"
      }
    ],
    "receipts": [
      {
        "id": "RC1",
        "receipt_no": "RCPT-001",
        "customer_name": "甲公司",
        "unallocated_amount": "1200",
        "currency": "CNY",
        "amount": "5000"
      }
    ],
    "receivables": [
      {
        "id": "AR-1",
        "receivable_no": "AR-001",
        "customer_name": "甲公司",
        "open_amount": "400",
        "currency": "CNY"
      }
    ],
    "saving": true,
    "allocationForm": {
      "receipt_id": "RC1",
      "receivable_id": "AR-1",
      "amount": "500",
      "match_mode": "MANUAL",
      "match_confidence": 0
    },
    "reversalForm": {
      "allocation_id": "",
      "amount": "",
      "reason_code": "MATCH_ERROR",
      "reason_detail": ""
    },
    "allocationTab": "allocations",
    "allocationComposerOpen": true,
    "reversalComposerOpen": true
  }
}
const materialize = ({ __fn = {}, ...data }) => ({ ...data, ...Object.fromEntries(Object.entries(__fn).map(([key, src]) => [key, new Function(`return (${src})`)()])) })

const component = await loadSfc(new URL('./SettlementAllocationsPanel.vue', import.meta.url).pathname)
const render = (name) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, { can: () => true, ...materialize(CASES[name]) }) }))

test("核销面板复现提取前 golden：核销页签、无单据空态、两个编辑器关闭", async () => {
  assert.equal(await render("allocationsTabEmpty"), GOLDENS["allocationsTabEmpty"])
})

test("核销面板复现提取前 golden：冲销页签、单据两行（状态徽章）、两个编辑器打开且已填（下拉过滤零余额行）", async () => {
  assert.equal(await render("reversalsTabComposersOpen"), GOLDENS["reversalsTabComposersOpen"])
})

test("核销面板复现提取前 golden：保存中（确认核销 / 确认冲销禁用）", async () => {
  assert.equal(await render("saving"), GOLDENS["saving"])
})

test("核销面板：提交以事件回传，页签与编辑器开关以 defineModel 双向绑定，「预填冲销表单再打开」的直接赋值原样保留", () => {
  const source = readFileSync(new URL('./SettlementAllocationsPanel.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("$emit('reload')"), "$emit('reload')")
  assert.ok(source.includes("$emit('submit-allocation')"), "$emit('submit-allocation')")
  assert.ok(source.includes("$emit('submit-reversal')"), "$emit('submit-reversal')")
  assert.ok(source.includes("defineModel('allocationTab')"), "defineModel('allocationTab')")
  assert.ok(source.includes("defineModel('allocationComposerOpen')"), "defineModel('allocationComposerOpen')")
  assert.ok(source.includes("defineModel('reversalComposerOpen')"), "defineModel('reversalComposerOpen')")
  assert.ok(source.includes("reversalForm.allocation_id = item.id"), "reversalForm.allocation_id = item.id")
  assert.ok(source.includes("v-model=\"allocationForm.receipt_id\""), "v-model=\"allocationForm.receipt_id\"")
  assert.ok(source.includes("v-model=\"reversalForm.reason_code\""), "v-model=\"reversalForm.reason_code\"")
  assert.doesNotMatch(source, /submitAllocation/)
  assert.doesNotMatch(source, /submitReversal/)
  assert.doesNotMatch(source, /active ===/)
  assert.doesNotMatch(source, /window\.prompt/)
})

// 角色补齐改变写动作边界，显式拒绝能力时即使弹层模型已打开也必须隐藏写入口。
test('SettlementAllocationsPanel：权限撤销后关闭写表单及操作入口', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component,
    { ...materialize(CASES['reversalsTabComposersOpen']), can: () => false }) }))
  assert.doesNotMatch(html, /发起核销|确认冲销/)
})
