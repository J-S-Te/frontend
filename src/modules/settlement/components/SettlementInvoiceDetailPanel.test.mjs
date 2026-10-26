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

// golden 为提取前 SettlementView.vue 「开票详情」区（发票台账详情 + 红冲）片段的 SSR 渲染结果
// （治理批次 5 结算第三步采集；片段 / 提取前 SFC / 用例 / golden 归档于 .ai/qa/closure-20261025/goldens-settlement-panels/SettlementInvoiceDetailPanel/）；
// 提取后本组件必须逐字节复现同一 DOM。cases 中 __fn 为函数 prop 源码，渲染前求值。
const GOLDENS = {
  "noDetail": "<section class=\"settlement-invoices\"><div class=\"settlement-empty\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3v2h14V7H5Zm3 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm4.2 4.5h5.3v-1.2c0-1.1-1.2-1.8-2.6-1.8s-2.7.7-2.7 1.8v1.2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><strong>未找到发票详情</strong><span>该发票可能不存在，或当前账号无权访问。</span><button class=\"console-button secondary\"> 返回发票台账 </button></div></section>",
  "detailIssuedRedFlushReview": "<section class=\"settlement-invoices\"><div class=\"settlement-invoice-detail\"><button class=\"console-text-button settlement-back-link\"> ‹ 返回发票台账 </button><div class=\"settlement-section-head\"><div><h2>发票详情</h2><p>电子发票交付与红冲管理</p></div><div><input class=\"settlement-visually-hidden\" type=\"file\" accept=\".pdf,.ofd,.xml,.png,.jpg,.jpeg\"><button class=\"console-button secondary\"> 上传电子发票</button><button class=\"console-button secondary\" disabled> 发起红冲</button><button class=\"console-button\"> 下载电子发票 </button></div></div><p class=\"settlement-detail-notice\"> 红冲申请状态：待财务复核；原发票在收到有效税控回执前仍保持已开具状态。 <!--[--> 驳回原因：核对购方税号。 <!--]--></p><div class=\"settlement-operation-actions\"><button class=\"console-button secondary\"> 驳回红冲 </button><button class=\"console-button danger\"> 通过并提交税控 </button></div><!--v-if--><div class=\"settlement-detail-kpis\"><article class=\"tone-blue\"><span>发票号码</span><b>NO-9</b></article><article class=\"tone-green\"><span>价税合计</span><b>¥10,600</b></article><article class=\"tone-purple\"><span>状态</span><b>已开票</b></article></div><div class=\"settlement-detail-grid\"><article class=\"settlement-panel\"><h2>发票信息</h2><dl class=\"settlement-detail-list\"><div><dt>发票类型</dt><dd>电子普通发票</dd></div><div><dt>开票日期</dt><dd>2026-10-20</dd></div><div><dt>发票代码</dt><dd>CODE-9</dd></div><div><dt>不含税金额</dt><dd>¥10,000</dd></div><div><dt>税额</dt><dd>¥600</dd></div><div><dt>开具渠道</dt><dd>税控直连</dd></div></dl></article><article class=\"settlement-panel\"><h2>购方信息</h2><dl class=\"settlement-detail-list\"><div><dt>购方名称</dt><dd>甲公司</dd></div><div><dt>纳税人识别号</dt><dd>9111****MA</dd></div><div><dt>关联合同</dt><dd>HT-2026-001</dd></div><div><dt>关联申请</dt><dd>—</dd></div><div><dt>电子票附件</dt><dd><!--[--><button class=\"console-text-button settlement-document-link\">invoice.pdf</button><!--]--></dd></div></dl></article><article class=\"settlement-panel settlement-detail-items\"><h2>票面明细</h2><!--v-if--><div class=\"settlement-table-scroll\"><table><thead><tr><th>项目</th><th>税收分类编码</th><th>不含税金额</th><th>税率</th><th>税额</th><th>价税合计</th></tr></thead><tbody><!--[--><tr><td>测评服务</td><td>3040201</td><td>¥10,000</td><td>6%</td><td>¥600</td><td>¥10,600</td></tr><!--]--></tbody></table></div></article><!--v-if--><article class=\"settlement-panel\"><h2>开票记录</h2><ol class=\"settlement-timeline-list\"><!--[--><li class=\"settlement-timeline-event tone-info\"><span class=\"settlement-timeline-dot\" aria-hidden=\"true\"></span><div class=\"settlement-timeline-body\"><div class=\"settlement-timeline-head\"><strong>提交开票申请</strong><!--v-if--></div><p></p><p class=\"settlement-timeline-detail\">申请号 REQ-1 · 合同 HT-2026-001</p></div></li><li class=\"settlement-timeline-event tone-success\"><span class=\"settlement-timeline-dot\" aria-hidden=\"true\"></span><div class=\"settlement-timeline-body\"><div class=\"settlement-timeline-head\"><strong>开票完成</strong><small>2026-10-20</small></div><p></p><p class=\"settlement-timeline-detail\">税控回执已写入台账</p></div></li><li class=\"settlement-timeline-event tone-warning\"><span class=\"settlement-timeline-dot\" aria-hidden=\"true\"></span><div class=\"settlement-timeline-body\"><div class=\"settlement-timeline-head\"><strong>红冲申请 · 待财务复核</strong><small>2026-10-21</small></div><p></p><p class=\"settlement-timeline-detail\">复核意见：核对购方税号</p></div></li><!--]--></ol><p class=\"settlement-timeline-hint\"> 红冲流程中，原发票在收到有效税控回执前仍保持已开具状态。 </p></article></div></div></section>",
  "redFlushOpenSaving": "<section class=\"settlement-invoices\"><div class=\"settlement-invoice-detail\"><button class=\"console-text-button settlement-back-link\"> ‹ 返回发票台账 </button><div class=\"settlement-section-head\"><div><h2>发票详情</h2><p>电子发票交付与红冲管理</p></div><div><input class=\"settlement-visually-hidden\" type=\"file\" accept=\".pdf,.ofd,.xml,.png,.jpg,.jpeg\"><button class=\"console-button secondary\" disabled> 上传电子发票</button><button class=\"console-button secondary\" disabled> 发起红冲</button><button class=\"console-button\" disabled> 下载电子发票 </button></div></div><!--v-if--><!--v-if--><article class=\"settlement-panel settlement-operation-card\"><div class=\"settlement-panel-head\"><div><h2>发起红冲申请</h2><p>申请先由财务复核，通过后才提交税控，最终结果以税控回执为准。</p></div><button class=\"console-text-button\"> 取消 </button></div><form class=\"settlement-operation-form\"><label><span>红冲原因类型</span><select required><option value=\"INVOICE_ERROR\">开票信息错误</option><option value=\"CONTRACT_CHANGE\">合同变更</option><option value=\"RETURN_OR_DISCOUNT\">退货或折让</option><option value=\"OTHER\">其他</option></select></label><label class=\"wide\"><span>具体原因</span><textarea rows=\"3\" maxlength=\"500\" required>合同主体变更后重新开票</textarea></label><div class=\"settlement-operation-actions wide\"><button type=\"button\" class=\"console-button secondary\"> 取消 </button><button class=\"console-button danger\" disabled> 提交红冲申请 </button></div></form></article><div class=\"settlement-detail-kpis\"><article class=\"tone-blue\"><span>发票号码</span><b>NO-8</b></article><article class=\"tone-green\"><span>价税合计</span><b>¥318</b></article><article class=\"tone-purple\"><span>状态</span><b>已开票</b></article></div><div class=\"settlement-detail-grid\"><article class=\"settlement-panel\"><h2>发票信息</h2><dl class=\"settlement-detail-list\"><div><dt>发票类型</dt><dd>电子专用发票</dd></div><div><dt>开票日期</dt><dd></dd></div><div><dt>发票代码</dt><dd></dd></div><div><dt>不含税金额</dt><dd>¥300</dd></div><div><dt>税额</dt><dd>¥18</dd></div><div><dt>开具渠道</dt><dd>人工登记</dd></div></dl></article><article class=\"settlement-panel\"><h2>购方信息</h2><dl class=\"settlement-detail-list\"><div><dt>购方名称</dt><dd>乙公司</dd></div><div><dt>纳税人识别号</dt><dd>9112****MB</dd></div><div><dt>关联合同</dt><dd>HT-2026-002</dd></div><div><dt>关联申请</dt><dd>—</dd></div><div><dt>电子票附件</dt><dd>尚未归档</dd></div></dl></article><article class=\"settlement-panel settlement-detail-items\"><h2>票面明细</h2><p class=\"settlement-muted\"> 该发票为历史人工登记，未留存票面明细，以下展示开票申请明细。 </p><div class=\"settlement-table-scroll\"><table><thead><tr><th>项目</th><th>税收分类编码</th><th>不含税金额</th><th>税率</th><th>税额</th><th>价税合计</th></tr></thead><tbody><!--[--><!--]--></tbody></table></div></article><!--v-if--><article class=\"settlement-panel\"><h2>开票记录</h2><ol class=\"settlement-timeline-list\"><!--[--><li class=\"settlement-timeline-event tone-info\"><span class=\"settlement-timeline-dot\" aria-hidden=\"true\"></span><div class=\"settlement-timeline-body\"><div class=\"settlement-timeline-head\"><strong>提交开票申请</strong><!--v-if--></div><p></p><p class=\"settlement-timeline-detail\">申请号 REQ-2 · 合同 HT-2026-002</p></div></li><!--]--></ol><!--v-if--></article></div></div></section>"
}
const CASES = {
  "noDetail": {
    "invoiceDetail": null,
    "saving": false,
    "redFlushForm": {
      "reason_code": "INVOICE_ERROR",
      "reason_detail": ""
    },
    "invoiceTimelineEvents": [],
    "redFlushOpen": false
  },
  "detailIssuedRedFlushReview": {
    "invoiceDetail": {
      "id": "INV-1",
      "invoice_code": "CODE-9",
      "invoice_no": "NO-9",
      "contract_no": "HT-2026-001",
      "status": "ISSUED",
      "buyer_name": "甲公司",
      "buyer_tax_no_masked": "9111****MA",
      "invoice_type": "ELECTRONIC_NORMAL",
      "issue_date": "2026-10-20",
      "issued_by_channel": "TAX_ADAPTER",
      "amount_excl_tax": "10000",
      "tax_amount": "600",
      "amount_incl_tax": "10600",
      "items_source": "INVOICE",
      "items": [
        {
          "line_no": 1,
          "item_name": "测评服务",
          "tax_classification_code": "3040201",
          "amount_excl_tax": "10000",
          "tax_rate_display": "6%",
          "tax_amount": "600",
          "amount_incl_tax": "10600"
        }
      ],
      "request_items": [],
      "documents": [
        {
          "id": "DOC-1",
          "original_name": "invoice.pdf"
        }
      ],
      "red_flush_request": {
        "status": "SUBMITTED",
        "review_reason": "核对购方税号",
        "can_review": true
      }
    },
    "saving": false,
    "redFlushForm": {
      "reason_code": "INVOICE_ERROR",
      "reason_detail": ""
    },
    "invoiceTimelineEvents": [
      {
        "tone": "info",
        "title": "提交开票申请",
        "detail": "申请号 REQ-1 · 合同 HT-2026-001"
      },
      {
        "tone": "success",
        "title": "开票完成",
        "timestamp": "2026-10-20",
        "detail": "税控回执已写入台账"
      },
      {
        "tone": "warning",
        "title": "红冲申请 · 待财务复核",
        "timestamp": "2026-10-21",
        "detail": "复核意见：核对购方税号"
      }
    ],
    "redFlushOpen": false
  },
  "redFlushOpenSaving": {
    "invoiceDetail": {
      "id": "INV-2",
      "invoice_code": "",
      "invoice_no": "NO-8",
      "contract_no": "HT-2026-002",
      "status": "ISSUED",
      "buyer_name": "乙公司",
      "buyer_tax_no_masked": "9112****MB",
      "invoice_type": "ELECTRONIC_SPECIAL",
      "issue_date": "",
      "issued_by_channel": "MANUAL",
      "amount_excl_tax": "300",
      "tax_amount": "18",
      "amount_incl_tax": "318",
      "items_source": "REQUEST",
      "items": [],
      "request_items": [
        {
          "line_no": 1,
          "item_name": "咨询费",
          "tax_classification_code": "3040201",
          "amount_excl_tax": "300",
          "tax_rate_display": "6%",
          "tax_amount": "18",
          "amount_incl_tax": "318"
        }
      ],
      "documents": [],
      "red_flush_request": null
    },
    "saving": true,
    "redFlushForm": {
      "reason_code": "CONTRACT_CHANGE",
      "reason_detail": "合同主体变更后重新开票"
    },
    "invoiceTimelineEvents": [
      {
        "tone": "info",
        "title": "提交开票申请",
        "detail": "申请号 REQ-2 · 合同 HT-2026-002"
      }
    ],
    "redFlushOpen": true
  }
}
const materialize = ({ __fn = {}, ...data }) => ({ ...data, ...Object.fromEntries(Object.entries(__fn).map(([key, src]) => [key, new Function(`return (${src})`)()])) })

const component = await loadSfc(new URL('./SettlementInvoiceDetailPanel.vue', import.meta.url).pathname)
const render = (name) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, materialize(CASES[name])) }))

test("开票详情面板复现提取前 golden：无详情数据（整区空渲染）", async () => {
  assert.equal(await render("noDetail"), GOLDENS["noDetail"])
})

test("开票详情面板复现提取前 golden：已开具、红冲待复核（禁用按钮 + 复核提示 + 文档 + 票面明细 + 时间线）", async () => {
  assert.equal(await render("detailIssuedRedFlushReview"), GOLDENS["detailIssuedRedFlushReview"])
})

test("开票详情面板复现提取前 golden：红冲弹窗打开且已填、保存中、人工登记发票展示申请明细", async () => {
  assert.equal(await render("redFlushOpenSaving"), GOLDENS["redFlushOpenSaving"])
})

test("开票详情面板：关闭/上传/下载/复核/提交红冲以事件回传，红冲开关为 defineModel，文件输入句柄迁入本组件", () => {
  const source = readFileSync(new URL('./SettlementInvoiceDetailPanel.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("$emit('close-detail')"), "$emit('close-detail')")
  assert.ok(source.includes("$emit('upload-document', $event)"), "$emit('upload-document', $event)")
  assert.ok(source.includes("$emit('download-document', document)"), "$emit('download-document', document)")
  assert.ok(source.includes("$emit('review-red-flush', false)"), "$emit('review-red-flush', false)")
  assert.ok(source.includes("$emit('submit-red-flush')"), "$emit('submit-red-flush')")
  assert.ok(source.includes("defineModel('redFlushOpen')"), "defineModel('redFlushOpen')")
  assert.ok(source.includes("ref=\"invoiceDocumentInput\""), "ref=\"invoiceDocumentInput\"")
  assert.ok(source.includes("@click=\"redFlushOpen = true\""), "@click=\"redFlushOpen = true\"")
  assert.ok(source.includes("@cancel=\"redFlushOpen = false\""), "@cancel=\"redFlushOpen = false\"")
  assert.ok(source.includes("@click=\"chooseInvoiceDocument\""), "@click=\"chooseInvoiceDocument\"")
  assert.doesNotMatch(source, /closeInvoiceDetail/)
  assert.doesNotMatch(source, /uploadInvoiceDocument/)
  assert.doesNotMatch(source, /downloadInvoiceDocument\(document\)/)
  assert.doesNotMatch(source, /reviewRedFlush/)
  assert.doesNotMatch(source, /submitRedFlush/)
  assert.doesNotMatch(source, /active ===/)
})
