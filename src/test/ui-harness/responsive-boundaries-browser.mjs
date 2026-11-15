// 隔离布局回归：实际Vue组件、实际模块CSS、合成数据；全部请求在浏览器内处理。
// CI 入口：npm run test:layout（无需 dev server；用 CHROMIUM_PATH 指定本机 Chrome/Chromium）。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import { chromium, firefox, webkit } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const run = process.env.LAYOUT_RUN_LABEL || 'latest'
assert.match(run, /^[A-Za-z0-9_-]{1,48}$/, 'layout result label must remain inside the evidence directory')
const output = process.env.LAYOUT_OUTPUT_DIR ? (process.env.LAYOUT_OUTPUT_DIR.endsWith('/') ? process.env.LAYOUT_OUTPUT_DIR : process.env.LAYOUT_OUTPUT_DIR + '/') : fileURLToPath(new URL(`../../../../.ai/qa/responsive-boundaries-20261103/${run}/`, import.meta.url))
const token = 'A'.repeat(240)
const longText = '超长业务名称与说明'.repeat(24)
const modules = [
  ['platform', 'platform/styles/console.css',
    'console-content', 'console-card', 'console-page-head', 'console-table-scroll',
    'console-data-table', 'console-form-grid', 'console-button'],
  ['contract', 'contract_management/styles/contract-management.css',
    'contract-content', 'contract-card', 'contract-page-head', 'contract-table-scroll',
    'contract-data-table', 'contract-form-grid', 'contract-button'],
  ['project', 'project_management/styles/project-management.css',
    'pm-page', 'pm-panel', 'pm-page-head', 'pm-table-scroll', 'pm-table', 'pm-form', 'pm-button'],
  ['crm', 'customer_opportunity/styles/customer-opportunity.css',
    'crm-content', 'crm-panel', 'crm-page-head', 'console-table-scroll',
    'console-data-table', 'console-form-grid', 'console-button'],
  ['portal', 'customer_portal/styles/customer-portal.css',
    'portal-content', 'portal-card', 'portal-title', 'console-table-scroll',
    'console-data-table', 'console-form-grid', 'console-button'],
  ['settlement', 'settlement/styles/settlement.css',
    'settlement-content', 'settlement-panel', 'settlement-panel-head', 'settlement-table-scroll',
    'settlement-plan-table', 'console-form-grid', 'console-button'],
  ['analysis', 'data_analysis/styles/data-analysis.css',
    'da-page', 'da-panel', 'da-page-head', 'da-table-scroll', 'da-table', 'da-modal', 'da-button'],
  // 报销表格：`.expense-table` 仍是横向滚动容器，表体改用稳定挂点 `.expense-table-body`
  //（承载 880px 可读宽度下限）；第 9 项补充列表页骨架（提示条、状态页签、操作条、指标、宽表）。
  ['reimbursement', 'reimbursement/reimbursement.css',
    'console-content', 'expense-panel', 'expense-head', 'expense-table', 'expense-table-body',
    'expense-form-grid', 'expense-button',
    { alert: 'expense-alert', tabs: 'expense-tabs', toolbar: 'expense-toolbar', metric: 'expense-metric', wideTable: true }],
]
const componentStyles = new Map()

// 用途：编译真实单文件组件，保留作用域样式，不启动应用或业务服务。
// 参数：无；组件入口和依赖取当前源码树。
// 返回值：浏览器脚本与编译后的样式；编译错误直接失败。
async function componentBundle() {
  const result = await build({
    stdin: { contents: `import {createApp, h} from 'vue';
      import Wizard from './src/modules/platform/applications/components/SubsystemAccessWizard.vue';
      import Confirm from './src/modules/shared/components/ConfirmDialog.vue';
      import LicenseEventsSheet from './src/modules/platform/features/licenses/LicenseEventsSheet.vue';
      import LicenseAppCard from './src/modules/platform/features/licenses/LicenseAppCard.vue';
      import ArchivePackagePanel from './src/modules/reimbursement/components/ArchivePackagePanel.vue';
      import PaymentExceptionPanel from './src/modules/reimbursement/components/PaymentExceptionPanel.vue';
      import ClaimSyncPanel from './src/modules/reimbursement/components/ClaimSyncPanel.vue';
      import ErrorState from './src/modules/shared/components/ErrorState.vue';
      window.mountWizard=props=>createApp(Wizard,props).mount('#fixture');
      window.mountConfirm=props=>createApp(Confirm,props).mount('#fixture');
      window.mountLicenseEventsSheet=props=>createApp(LicenseEventsSheet,props).mount('#fixture');
      window.mountLicenseCards=(rows,el)=>createApp({render:()=>rows.map(row=>h(LicenseAppCard,{row, busy:false, loading:false}))}).mount(el);
      window.mountArchivePackage=(props,el)=>createApp(ArchivePackagePanel,props).mount(el);
      window.mountPaymentException=(props,el)=>createApp(PaymentExceptionPanel,props).mount(el);
      window.mountClaimSync=(props,el)=>createApp(ClaimSyncPanel,props).mount(el);
      window.mountErrorState=(props,el)=>createApp(ErrorState,props).mount(el);`, resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'import.meta.env': '{}' }, alias: { '@': root + 'src' },
    plugins: [{ name: 'layout-vue',
      // 用途：只为布局夹具接入当前Vue组件编译器。
      // 参数：builder 为本次隔离打包的esbuild插件接口。
      // 返回值：无；注册单文件组件转换规则。
      setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
        const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
        const id = 'data-v-' + createHash('sha256').update(path).digest('hex').slice(0, 8)
        const script = compileScript(descriptor, { id, inlineTemplate: true,
          genDefaultAs: '__fixtureComponent', templateOptions: { compilerOptions: { scopeId: id } } })
        componentStyles.set(path, descriptor.styles.map(style => compileStyle({
          source: style.content, filename: path, id, scoped: style.scoped,
        }).code).join('\n'))
        // 组件可写成 `<script setup lang="ts">`：compileScript 不擦除类型标注，先交给 esbuild 降级。
        const transpiled = await transform(script.content, { loader: 'ts' })
        return { contents: transpiled.code + `\n__fixtureComponent.__scopeId=${JSON.stringify(id)};export default __fixtureComponent;`,
          loader: 'js', resolveDir: fileURLToPath(new URL('.', 'file://' + path)) }
      })
    } }],
  })
  return result.outputFiles[0].text
}

// 用途：按真实模块结构组织长文本、原生控件、表格和格式化内容。
// 参数：item 为模块既有样式类集合；可选的最后一组补充类名依次开启提示条、页签、操作条、指标与宽表示例。
// 返回值：仅包含合成内容的HTML；不创建业务对象。
function moduleMarkup(item) {
  const [, , content, card, heading, scroll, table, form, button, chrome = {}] = item
  const tableClass = table ? ` class="${table}"` : ''
  // 补充骨架只由模块数据开启：未声明的模块保持原结构，已有用例的选择器与几何不变。
  const alert = chrome.alert
    ? `<div class="${chrome.alert}" data-boundary="alert" role="note">${longText} <code>${token}</code></div>` : ''
  const tabs = chrome.tabs
    ? `<div class="${chrome.tabs}" role="group" aria-label="合成状态页签">
      <button type="button" class="${button}" aria-pressed="true">${longText}</button>
      <button type="button" class="${button}" aria-pressed="false">待处理</button>
    </div>` : ''
  const toolbar = chrome.toolbar
    ? `<div class="${chrome.toolbar}" data-boundary="toolbar"><span>${longText}</span>
      <button type="button" class="${button}">刷新列表</button></div>` : ''
  const metrics = chrome.metric
    ? `<p data-boundary="metrics"><span class="${chrome.metric}">单据 128</span>
      <span class="${chrome.metric}">超标 ${token}</span></p>` : ''
  // 宽表按单据列表的真实列数合成：窄屏下应由滚动容器承接，而不是把整页撑宽。
  const wideTable = chrome.wideTable
    ? `<div class="${scroll}" data-scroll data-wide-table><table${tableClass}>
      <thead><tr><th scope="col">导出选择</th><th scope="col">编号 / 标题</th><th scope="col">状态 / 版本</th>
        <th scope="col">应付金额</th><th scope="col">类型 / 报销人</th><th scope="col">当前节点</th>
        <th scope="col">创建时间</th><th scope="col">操作</th></tr></thead>
      <tbody><tr><td><input type="checkbox" aria-label="选择导出 ${token}"></td>
        <td>${token}<small>${longText}</small></td><td>审批中<small>版本 7</small></td><td>1288.00 CNY</td>
        <td>差旅费 / subject-identity-01</td><td>财务复核 <span class="expense-flag danger">超标</span></td>
        <td>2026-11-03 14:05:06<small>当前待办起点 2026-11-04 09:00:00</small></td>
        <td><button type="button" class="${button}">复核详情</button>
          <button type="button" class="${button}">下载</button></td></tr></tbody></table></div>` : ''
  return `<main class="${content}" data-boundary="page">
    <header class="${heading}" data-boundary="heading"><div><h1>${longText}</h1><p>https://example.invalid/${token}</p></div>
      <button class="${button}" data-action>查看${longText}</button></header>
    ${alert}
    <section class="${card}" data-boundary="card"><h2>${token}</h2>
      ${tabs}${toolbar}
      <form class="${form}" data-boundary="form"><label>${longText}<input value="${token}"></label>
        <label>系统<select><option>${longText}${token}</option></select></label>
        <fieldset data-boundary="fieldset"><legend>${longText}</legend><textarea>${token}</textarea></fieldset></form>
      ${metrics}
      <div class="${scroll}" data-scroll><table${tableClass}><thead><tr><th>编号</th><th>说明</th><th>操作</th></tr></thead>
        <tbody><tr><td>${token}</td><td>${longText}</td><td><button>查看详情</button></td></tr></tbody></table></div>
      ${wideTable}
      <pre data-scroll>${token.repeat(3)}\n  第二行保留缩进</pre>
    </section></main>`
}

// 用途：拼出真实组件要的六行许可事实，交给浏览器里挂载的 LicenseAppCard 渲染。
// 参数：无；数值均为合成事实，不含真实许可证或凭据。
// 返回值：行对象数组；第一张卡同时带原因码与执行计数，代表内容最高的情况。
function licenseCardRows() {
  const expiry = days => Math.floor(Date.now() / 1000) + days * 86400
  const summary = { available: true, revision: 7, deploymentRevision: 42, memberCount: 2, ready: 2, acknowledged: 1, latestReadyAt: '2026-10-27T05:54:38Z', latestAckAt: '2026-10-26T01:02:03Z' }
  const license = (label, tone) => ({ key: 'IMPORTED', label, tone })
  const counters = true
  return [
    { name: '结算管理', code: 'settlement', tone: 'danger', application: { kind: 'FULL', expires_at: expiry(-12) }, license: license('已过期', 'danger'), enforcement: { key: 'ENFORCED', label: '已强制执行', tone: 'success', note: '' }, summary, showEnforcementCounters: counters, reasonCode: 'EXPIRED', action: { key: 'REIMPORT', label: '重新导入', target: 'import', hint: '已过期，需要供应商签发更高版本后再导入' } },
    { name: '客户与商机', code: 'customer_and_opportunity', tone: 'success', application: { kind: 'FULL', expires_at: expiry(268) }, license: license('已导入', 'success'), enforcement: { key: 'ENFORCED', label: '已强制执行', tone: 'success', note: '' }, summary, showEnforcementCounters: counters, reasonCode: '', action: { key: 'DETAIL', label: '查看运行详情', target: 'runtime', hint: '已强制执行，不提供重复激活' } },
    { name: '客户门户', code: 'customer_portal', tone: 'info', application: { kind: 'TRIAL', expires_at: expiry(252) }, license: license('待生效', 'info'), enforcement: { key: 'APPLYING', label: '激活中', tone: 'info', note: '' }, summary, showEnforcementCounters: counters, reasonCode: 'NOT_EFFECTIVE', action: { key: 'PROGRESS', label: '查看激活进度', target: 'runtime', hint: '激活已提交，等待组件准备并确认当前修订' } },
    { name: '合同管理', code: 'contract_management', tone: 'warning', application: { kind: 'FULL', expires_at: expiry(237) }, license: license('已导入', 'success'), enforcement: { key: 'PENDING_ENFORCEMENT', label: '待激活', tone: 'warning', note: '' }, summary, showEnforcementCounters: counters, reasonCode: '', action: { key: 'ACTIVATE', label: '去激活', target: 'runtime', hint: '在下方运行详情中核对执行修订并勾选确认后启用' } },
    { name: '项目管理', code: 'project_management', tone: 'neutral', application: { kind: 'FULL', expires_at: expiry(208) }, license: license('已导入', 'success'), enforcement: { key: 'UNREGISTERED', label: '未纳管', tone: 'neutral', note: '运行组件尚未登记，运行执行事实不存在' }, summary: null, showEnforcementCounters: false, reasonCode: '', action: { key: 'ENROLL', label: '查看运行详情', target: 'runtime', hint: '运行组件尚未登记，未接入运行时授权执行' } },
    { name: '数据分析', code: 'data_analysis', tone: 'neutral', application: { kind: 'TRIAL', expires_at: expiry(206) }, license: license('已导入', 'success'), enforcement: { key: 'UNKNOWN', label: '状态未知', tone: 'neutral', note: longText }, summary: null, showEnforcementCounters: false, reasonCode: '', action: { key: 'CONTACT', label: '联系授权管理员', target: 'none', hint: '需要商业授权管理权限才能发起激活' } },
  ]
}

// 用途：拼出真实报销面板需要的合成事实，覆盖异步建包、同步诊断与外部付款异常。
// 参数：无；金额、流水号、主体标识均为合成值，不含真实业务数据或凭据。
// 返回值：三个组件的 props 与浏览器内响应体；任务直接给终态，避免真实轮询等待。
function reimbursementFacts() {
  const exceptionRow = index => ({
    id: '01H0000000000000000000' + String(index).padStart(4, '0'),
    transaction_no: 'EXT-' + token, amount_minor: '128800', currency: 'CNY',
    observed_claim_status: 'APPROVED_PENDING_PAYMENT', observed_claim_version: 7,
    status: index % 2 ? 'VERIFIED_CONFLICT' : 'PENDING', version: index + 1,
  })
  const selected = {
    ...exceptionRow(1), method: 'BANK', paid_date: '2026-11-03',
    source_account_ref: 'ACC-' + token, recorder_subject_id: 'subject-finance-01',
    claim_version: 7, reason: longText, voucher_file_ids: ['file-01', 'file-02'],
    allowed_actions: ['REVIEW_EXCEPTION'],
    reviews: [{ id: 'rev-01', decision: 'CONFIRM_CONFLICT', created_at: '2026-11-04T06:07:08Z',
      actor_subject_id: 'subject-finance-02', previous_version: 1, version: 2,
      status: 'VERIFIED_CONFLICT', reason: longText, evidence_file_ids: ['file-03'], linked_payment_id: '' }],
  }
  return {
    job: { id: '01H000000000000000000000424', archive_id: 'arc-2026-03', status: 'DONE' },
    syncState: { current_revision: 12, successful_revision: 11, status: 'AUTHORITATIVE_SNAPSHOT_MISSING',
      last_error: 'DELIVERY_OR_PROCESSING_FAILED', next_attempt_at: '2026-11-11T03:04:05Z' },
    capacity: { allocations_used: 19, allocation_limit: 20, allocation_reservation: 2, can_record: false, warning: true },
    failure: { code: 'SYNC_UNAVAILABLE', message: longText + token },
    archives: { items: [
      { id: 'arc-2026-03', package_version: 3, status: 'SEALED' },
      { id: 'arc-2026-02', package_version: 2, status: 'PENDING' },
    ] },
    resolutionOptions: {
      claim_id: 'claim-01', claim_version: 7, exception_version: selected.version,
      payments: [{ id: '01H000000000000000000000099', name: '已登记付款',
        paid_date: selected.paid_date, amount_minor: selected.amount_minor,
        currency: selected.currency, method: selected.method,
        transaction_no: selected.transaction_no, can_resolve_payment: true }],
      reversals: [],
    },
    syncClaim: { id: 'claim-01', version: 7 },
    permissions: ['expense.payment.read', 'expense.integration.manage'],
    payment: {
      claim: { id: 'claim-01', claim_no: 'BX-2026-0001', status: 'APPROVED_PENDING_PAYMENT', version: 7, currency: 'CNY' },
      rows: Array.from({ length: 4 }, (_, index) => exceptionRow(index + 1)),
      page: 1, total: 120, selected,
      form: { amount: '1288.00', currency: 'CNY', paid_date: '2026-11-03', method: 'BANK',
        source_account_ref: 'ACC-' + token, transaction_no: 'EXT-' + token, payee_profile_id: 'payee-01',
        voucher_file_ids: 'file-01,file-02', reason: longText },
      reviewForm: { decision: 'RESOLVE_WITH_PAYMENT', reason: longText, evidence_file_ids: 'file-03',
        linked_payment_id: '01H000000000000000000000099' },
      canRecord: true, canReview: true, saving: false, pending: false,
    },
  }
}

// 用途：用可观察几何边界检查页面、控件与局部滚动，不依赖具体CSS实现。
// 参数：page 为隔离页面；wizard 为是否检查真实向导弹层。
// 返回值：边界违规列表；局部滚动区域内部的宽表格不记作越界。
async function violations(page, wizard = false) {
  return page.evaluate(wizard => {
    const errors = []
    // 用途：读取元素实际边界，判定是否超出容器与视口。
    // 参数：e 为本次隔离页面中的DOM元素。
    // 返回值：浏览器布局产生的DOMRect。
    const box = e => e.getBoundingClientRect()
    const viewport = document.documentElement.clientWidth
    if (document.documentElement.scrollWidth > viewport + 1) errors.push('document horizontal overflow')
    const selector = wizard
      ? '.subsystem-access-wizard__dialog,.subsystem-access-wizard__header,.subsystem-access-wizard__fieldset,.subsystem-access-progress'
      : '[data-boundary],input,select,textarea,[data-action]'
    for (const element of document.querySelectorAll(selector)) {
      const r = box(element)
      if (r.width && (r.left < -1 || r.right > viewport + 1)) errors.push(element.className + ': outside viewport')
      if (element.matches('[data-boundary],.subsystem-access-wizard__dialog') && element.scrollWidth > element.clientWidth + 1) {
        errors.push((element.className || element.tagName) + ': child horizontal overflow')
      }
      if (element.matches('[data-action]') && (element.scrollWidth > element.clientWidth + 1
        || element.scrollHeight > element.clientHeight + 1)) errors.push('action text exceeds button')
    }
    if (wizard) {
      const dialog = document.querySelector('.subsystem-access-wizard__dialog')
      const close = document.querySelector('.subsystem-access-wizard__close')
      if (box(dialog).top < -1 || box(dialog).bottom > innerHeight + 1) errors.push('dialog exceeds viewport height')
      if (box(close).right > viewport + 1) errors.push('close action unreachable')
    }
    for (const dialog of document.querySelectorAll('[role="alertdialog"]')) {
      const r = box(dialog)
      if (r.left < -1 || r.right > viewport + 1 || r.top < -1 || r.bottom > innerHeight + 1) {
        errors.push('confirmation exceeds viewport')
      }
      if (dialog.scrollWidth > dialog.clientWidth + 1) errors.push('confirmation child horizontal overflow')
      // 字体墨迹可能超出关闭图标的行框；正文操作按钮应完整容纳文字。
      for (const button of dialog.querySelectorAll('footer button')) {
        if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) {
          errors.push('confirmation action text exceeds button')
        }
      }
    }
    for (const pre of document.querySelectorAll('pre')) {
      // 报销模板已无 <pre>（遗留的 pre-wrap 规则已删除），恢复严格断言：
      // 预格式文本必须保留换行与缩进，不能靠降级成 pre-wrap 掩盖问题。
      if (getComputedStyle(pre).whiteSpace !== 'pre') errors.push('pre formatting lost')
      if (!['auto', 'scroll'].includes(getComputedStyle(pre).overflowX)) errors.push('pre cannot scroll')
    }
    for (const region of document.querySelectorAll('[data-scroll]')) {
      if (region.scrollWidth > region.clientWidth + 1
        && !['auto', 'scroll'].includes(getComputedStyle(region).overflowX)) errors.push('wide content cannot scroll')
    }
    return errors
  }, wizard)
}

// 用途：读取报销宽表的滚动几何，确认窄屏由滚动容器承接而不是撑破页面。
// 参数：page 为已渲染报销列表骨架的页面。
// 返回值：滚动容器与表体的像素测量；找不到宽表时为 null。
async function reimbursementTableMetrics(page) {
  return page.evaluate(() => {
    const region = document.querySelector('[data-wide-table]')
    if (!region) return null
    const table = region.querySelector('table')
    return {
      scrollWidth: region.scrollWidth,
      clientWidth: region.clientWidth,
      overflowX: getComputedStyle(region).overflowX,
      tableWidth: Math.round(table.getBoundingClientRect().width),
      scrollLeft: region.scrollLeft,
    }
  })
}

// 用途：读取付款历史 / 冲正历史两张表的滚动几何与列宽，确认窄屏由滚动容器承接而不是逐字压窄。
// 参数：page 为渲染了这两张历史表骨架的页面。
// 返回值：两张表的滚动容器、表体宽度、列头宽度与滚动位置；缺表时为 null。
async function reimbursementHistoryMetrics(page) {
  return page.evaluate(() => {
    const read = selector => {
      const region = document.querySelector(selector)
      const body = region?.querySelector('.expense-table-body')
      if (!region) return null
      return {
        scrollWidth: region.scrollWidth,
        clientWidth: region.clientWidth,
        overflowX: getComputedStyle(region).overflowX,
        tableWidth: body ? Math.round(body.getBoundingClientRect().width) : 0,
        headers: body ? [...body.querySelectorAll('thead th')]
          .map(head => Math.round(head.getBoundingClientRect().width)) : [],
        scrollLeft: region.scrollLeft,
      }
    }
    return { payment: read('#payment-history-table'), reversal: read('#reversal-history-table') }
  })
}

// 用途：替换浏览器 fetch，用合成响应驱动真实报销组件；未覆盖的路径明确失败，证明没有连真实后端。
// 参数：page 为隔离页面；payload 为组件需要的合成响应与失败开关。
// 返回值：无；调用记录留在 window.__reimbursementCalls / __reimbursementMissing。
async function reimbursementNetwork(page, payload) {
  await page.evaluate(payload => {
    const reply = (status, body) => ({ ok: status < 400, status,
      headers: { get: () => 'application/json' }, json: async () => body })
    const calls = []
    const missing = []
    // about:blank 不是安全上下文，命令号生成器默认不可用；夹具只注入一个固定命令号。
    if (typeof crypto.randomUUID !== 'function') {
      Object.defineProperty(crypto, 'randomUUID', {
        value: () => '00000000-0000-4000-8000-000000000000', configurable: true,
      })
    }
    window.__reimbursementCalls = calls
    window.__reimbursementMissing = missing
    window.fetch = async (input, init = {}) => {
      const path = String(input)
      const method = String(init.method || 'GET').toUpperCase()
      calls.push(method + ' ' + path)
      if (method === 'POST' && /^\/reimbursement\/api\/v1\/archives\/[^/]+\/packages$/.test(path)) {
        return reply(200, { code: 'OK', data: payload.job })
      }
      if (method === 'GET' && /^\/reimbursement\/api\/v1\/archive-packages\/[^/]+$/.test(path)) {
        return reply(200, { code: 'OK', data: payload.job })
      }
      if (method === 'GET' && /\/claims\/[^/]+\/sync-status$/.test(path)) {
        return payload.syncFails
          ? reply(503, { code: payload.failure.code, message: payload.failure.message })
          : reply(200, { code: 'OK', data: payload.syncState })
      }
      if (method === 'GET' && /\/claims\/[^/]+\/spend-capacity$/.test(path)) {
        return reply(200, { code: 'OK', data: payload.capacity })
      }
      if (method === 'GET' && path ===
        `/reimbursement/api/v1/payment-exceptions/${payload.payment.selected.id}/resolution-options`) {
        return reply(200, { code: 'OK', data: payload.resolutionOptions })
      }
      // 付款表单与外部异常表单按既有付款选项接口选账户，夹具给出受控账户与收款档案。
      if (method === 'GET' && /\/claims\/[^/]+\/payment-options$/.test(path)) {
        return reply(200, { code: 'OK', data: {
          source_accounts: [
            { id: 'acct-01', name: '财务主体基本户', account_ref: 'ACC-PRIMARY' },
            { id: 'acct-02', name: '财务主体一般户', account_ref: 'ACC-SECONDARY' },
          ],
          payee_profiles: [
            { id: 'payee-01', name: '本人已审核收款资料', account_ref: 'PAYEE-PRIMARY', version: 3 },
          ],
        } })
      }
      missing.push(method + ' ' + path)
      return reply(500, { code: 'FIXTURE_UNEXPECTED_REQUEST', message: 'isolated layout fixture must not reach the network' })
    }
  }, payload)
}

// 用途：用真实 console.css 骨架检查授权事件抽屉的几何契约。
// 参数：page 为挂载了真实 LicenseEventsSheet 的页面；width/height 为当前视口。
// 返回值：违规列表；≤720px 要求整屏，>720px 要求右贴边且不超过 560px。
async function sheetViolations(page, width, height) {
  return page.evaluate(({ width, height }) => {
    const errors = []
    const box = element => element.getBoundingClientRect()
    const sheet = document.querySelector('.console-sheet')
    if (!sheet) return ['event sheet missing']
    const rect = box(sheet)
    const fullScreen = width <= 720
    if (fullScreen) {
      if (Math.abs(rect.left) > 1 || Math.abs(rect.top) > 1
        || Math.abs(rect.right - width) > 1 || Math.abs(rect.bottom - height) > 1) {
        errors.push('mobile sheet must cover viewport: ' + JSON.stringify(rect))
      }
    } else {
      if (Math.abs(rect.right - width) > 1) errors.push('desktop sheet must stick to the right edge')
      if (rect.width > 561 || rect.width < 200) errors.push('desktop sheet width out of range: ' + rect.width)
      if (Math.abs(rect.height - height) > 1) errors.push('desktop sheet must be full height')
    }
    const close = box(document.querySelector('.console-sheet__close'))
    if (close.width < (fullScreen ? 44 : 36)) errors.push('close target too small: ' + close.width)
    if (close.left < -1 || close.right > width + 1 || close.top < -1 || close.bottom > height + 1) errors.push('close action unreachable')
    const body = document.querySelector('.console-sheet__body')
    if (body.scrollWidth > body.clientWidth + 1) errors.push('event sheet body horizontal overflow')
    const footer = box(document.querySelector('.console-sheet__footer'))
    if (footer.bottom > height + 1) errors.push('sheet pagination unreachable')
    if (document.documentElement.scrollWidth > width + 1) errors.push('document horizontal overflow (sheet)')
    // 行高契约：桌面 48px、移动 64px；摘要行内部不允许横向溢出。
    const summary = document.querySelector('.license-event-summary')
    if (summary) {
      const measured = box(summary)
      const expected = fullScreen ? 64 : 48
      if (measured.height < expected - 1) errors.push(`event summary height ${measured.height} < ${expected}`)
      if (summary.scrollWidth > summary.clientWidth + 1) errors.push('event summary horizontal overflow')
    }
    return errors
  }, { width, height })
}

// 用途：拦截所有浏览器请求，用只读合成响应驱动真实向导恢复到结果步骤。
// 参数：page 为独立页面；errors 为收集非预期请求的数组。
// 返回值：无；禁止对外请求与任何业务写入。
async function fixtureNetwork(page, errors) {
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== 'http://layout.invalid' || request.method() !== 'GET') {
      errors.push('unexpected network ' + request.method() + ' ' + url.pathname)
      return route.abort()
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="fixture"></div>' })
    const operation = { operation_id: '01H000000000000000000000001', application_code: 'project_management',
      environment: 'prod', status: 'SUCCEEDED', stage: 'ready', action: 'UPDATE',
      result_ref: 'sha256:' + token, attempt_count: 1,
      stages: [{ stage: 'ready', status: 'SUCCEEDED', attempt_count: 1, evidence_ref: 'https://example.invalid/' + token }] }
    const data = url.pathname.endsWith('/subsystem-capabilities')
      ? { supported_application_codes: ['project_management'] } : operation
    return route.fulfill({ json: { code: 'OK', data } })
  })
  await page.goto('http://layout.invalid/')
}

await mkdir(output, { recursive: true })
const bundle = await componentBundle()
// 用途：读取当前模块的真实样式文件，不写入业务目录。
// 参数：name 为src/modules下的相对样式路径。
// 返回值：样式文本Promise；缺文件时失败。
const load = name => readFile(root + 'src/modules/' + name, 'utf8')
const base = await load('platform/shared/styles/main.css')
const consoleCss = await load('platform/styles/console.css')
const sharedCss = await load('shared/styles/global-ux.css')
// 统一三态（Loading / Empty / Error）由 src/main.js 全局加载；独立组件页也要带上，
// 否则 ErrorState 在夹具里会缺图标尺寸与重试按钮样式，几何结论不成立。
const stateCss = await load('platform/shared/styles/state.css')
const moduleCss = await Promise.all(modules.slice(1).map(item => load(item[1])))
moduleCss.push(await load('platform/iam/styles/iam-settings.css'))
const licenseSource = await readFile(root + 'src/modules/platform/features/licenses/CommercialLicenseView.vue', 'utf8')
const licenseCardSource = await readFile(root + 'src/modules/platform/features/licenses/LicenseAppCard.vue', 'utf8')
const licenseScope = 'data-v-layout-license'
// 许可页与卡片分别编译、共用同一个作用域 id：夹具里两组规则都只认属性存在，与真实两份 scope 等价。
for (const source of [licenseSource, licenseCardSource]) {
  moduleCss.push(parse(source).descriptor.styles.map(style => compileStyle({
    source: style.content, id: licenseScope, scoped: style.scoped,
  }).code).join('\n'))
}
const scoped = [...componentStyles.values()].join('\n')
// 抽屉夹具单独用一份完整样式（含真实组件 scoped 样式），在宽度循环里只跑一次。
const sheetCss = base + stateCss + consoleCss + sharedCss + moduleCss.join('\n') + scoped
// 默认仍用 CI 的本机 Chrome；LAYOUT_BROWSER=firefox|webkit 可复跑同一套几何断言。
const layoutBrowser = process.env.LAYOUT_BROWSER || 'chromium'
const firefoxHome = process.env.LAYOUT_FIREFOX_HOME
const firefoxEnv = firefoxHome
  ? { ...process.env, HOME: firefoxHome, CFFIXED_USER_HOME: firefoxHome, TMPDIR: firefoxHome + '/tmp' }
  : undefined
const browser = layoutBrowser === 'firefox'
  ? await firefox.launch({ headless: true, ...(firefoxEnv ? { env: firefoxEnv } : {}) })
  : layoutBrowser === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    })
console.log('layout browser:', layoutBrowser)
const results = []
try {
  for (const [width, height] of [[1440, 900], [1024, 768], [800, 600], [640, 480], [375, 667], [320, 568]]) {
    for (const item of modules) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      // 三个独立壳层不依赖console.css，避免其它模块规则掩盖首次直达的问题。
      const needsConsole = !['contract', 'project', 'analysis'].includes(item[0])
      const css = base + sharedCss + (needsConsole ? consoleCss : '')
        + (item[0] === 'platform' ? '' : await load(item[1]))
      await page.setContent(`<style>${css}</style><div id="app">${moduleMarkup(item)}</div>`)
      const result = { module: item[0], width, height, order: 'module-only', errors: await violations(page) }
      if (item[0] === 'reimbursement') {
        result.metrics = await reimbursementTableMetrics(page)
        assert.ok(result.metrics, '报销骨架必须包含按真实列数合成的宽表')
        // 栅格契约：375px 单列、1440px 多列，且表单栅格在窄容器内不横向溢出。
        const formGrid = await page.evaluate(() => {
          const grid = document.querySelector('.expense-form-grid')
          const tracks = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/)
          return { columns: tracks.filter(size => size !== '0px').length,
            clientWidth: grid.clientWidth, scrollWidth: grid.scrollWidth }
        })
        result.metrics.formGrid = formGrid
        assert.ok(formGrid.scrollWidth <= formGrid.clientWidth + 1,
          '报销表单栅格不得横向溢出：' + JSON.stringify(formGrid))
        if (width === 1440) assert.ok(formGrid.columns > 1, '1440px 下报销栅格应为多列')
        if (width <= 375) assert.equal(formGrid.columns, 1, '375px 下报销栅格必须单列')
        // 宽表的滚动契约：1440 能整表放下，375/320 交给滚动容器而不是撑破页面。
        if (width === 1440) {
          assert.ok(result.metrics.scrollWidth <= result.metrics.clientWidth + 1,
            '1440px 下报销宽表不应需要横向滚动：' + JSON.stringify(result.metrics))
        }
        if (width <= 375) {
          assert.ok(result.metrics.scrollWidth > result.metrics.clientWidth + 1,
            `${width}px 下报销宽表必须由滚动容器承接：` + JSON.stringify(result.metrics))
          assert.ok(['auto', 'scroll'].includes(result.metrics.overflowX),
            '报销表格滚动容器必须可横向滚动：' + result.metrics.overflowX)
          await page.locator('[data-wide-table]').evaluate(region => { region.scrollLeft = region.scrollWidth })
          result.metrics.scrolledLeft = await page.locator('[data-wide-table]').evaluate(region => region.scrollLeft)
          assert.ok(result.metrics.scrolledLeft > 0, '375px 下宽表必须能滚到右侧操作列')
        }
        if (width === 1440 || width === 375 || width === 320) {
          await page.screenshot({ path: output + `reimbursement-page-${width}-module-only.png`, fullPage: true })
        }
        if (width === 1440 || width === 375) {
          await page.locator('.expense-form-grid')
            .screenshot({ path: output + `reimbursement-form-grid-${width}-module-only.png` })
        }
        if (width === 375) {
          // 视口截图保留「滚动到右侧操作列」的真实状态，整表元素截图另存为完整证据。
          await page.locator('[data-wide-table]').evaluate(region => region.scrollIntoView({ block: 'start' }))
          await page.screenshot({ path: output + 'reimbursement-table-375-viewport.png' })
          await page.locator('[data-wide-table]').screenshot({ path: output + 'reimbursement-table-375-scrolled.png' })
        }
      }
      results.push(result)
      await page.close()
    }
    for (const order of ['shared-first', 'shared-last']) {
      const css = base + stateCss + consoleCss + (order === 'shared-first' ? sharedCss : '') + moduleCss.join('\n')
        + (order === 'shared-last' ? sharedCss : '') + scoped
      for (const item of modules) {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
        await page.setContent(`<style>${css}</style><div id="app">${moduleMarkup(item)}</div>`)
        const errors = await violations(page)
        const control = await page.locator('form input:not([type="checkbox"])').inputValue()
        assert.equal(control, token, 'layout must preserve complete input values')
        results.push({ module: item[0], width, height, order, errors })
        await page.close()
      }
      for (const grid of ['expense-grid', 'crm-customer-cards', 'crm-stage-alert-grid', 'pm-detail-summary', 'project-list',
        'license-facts', 'license-app-grid', 'license-field-row', 'iam-person-summary-grid']) {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
        const scope = grid.startsWith('license-') ? licenseScope : ''
        await page.setContent(`<style>${css}</style><section class="console-card" style="width:min(220px,100%);padding:20px" data-boundary>
          <div class="${grid}" ${scope} data-boundary><article ${scope}>${longText}</article><article ${scope}>${token}</article></div></section>`)
        const gridErrors = await violations(page)
        // 报销栅格固定放在 180px 内容宽度里：即使轨道下限 210px 也必须落成单列，不能溢出卡片。
        if (grid === 'expense-grid') {
          const metrics = await page.evaluate(() => {
            const element = document.querySelector('.expense-grid')
            const tracks = getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            return { containerWidth: element.clientWidth, scrollWidth: element.scrollWidth,
              columns: tracks.filter(size => size !== '0px').length }
          })
          assert.equal(metrics.columns, 1, '180px 内容宽度下报销栅格必须单列：' + JSON.stringify(metrics))
          assert.ok(metrics.scrollWidth <= metrics.containerWidth + 1,
            '180px 内容宽度下报销栅格不得溢出：' + JSON.stringify(metrics))
          results.push({ module: grid, width, height, order, errors: gridErrors, metrics })
        } else {
          results.push({ module: grid, width, height, order, errors: gridErrors })
        }
        await page.close()
      }
      // 逐应用卡片网格：挂载真实 LicenseAppCard 渲染六张卡，1440 下应 4 列 2 行、近方形、无横向溢出。
      const cardPage = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      await cardPage.setContent(`<style>${css}</style><main class="console-content"><section class="license-page" ${licenseScope}>
        <section class="console-card license-section" ${licenseScope} data-boundary>
          <ul class="license-app-grid" ${licenseScope} data-boundary></ul>
        </section></section></main>`)
      await cardPage.addScriptTag({ content: bundle })
      await cardPage.evaluate(rows => window.mountLicenseCards(rows, document.querySelector('.license-app-grid')), licenseCardRows())
      const cardErrors = await violations(cardPage)
      const cardMetrics = await cardPage.evaluate(() => {
        const boxes = [...document.querySelectorAll('.license-app-card')].map(card => card.getBoundingClientRect())
        const columns = new Set(boxes.map(box => Math.round(box.left))).size
        const rows = new Set(boxes.map(box => Math.round(box.top))).size
        const widths = boxes.map(box => Math.round(box.width))
        const heights = boxes.map(box => Math.round(box.height))
        const ratio = Math.max(...boxes.map(box => box.height / box.width))
        return { cards: boxes.length, columns, rows, width: Math.min(...widths), maxWidth: Math.max(...widths), height: Math.max(...heights), ratio: Math.round(ratio * 1000) / 1000 }
      })
      if (width === 1440) {
        assert.equal(cardMetrics.cards, 6, '六张卡片必须全部渲染')
        assert.equal(cardMetrics.columns, 4, '≥1280 期望四列，实际 ' + JSON.stringify(cardMetrics))
        assert.ok(cardMetrics.rows <= 2, '六张卡在 1440 下不得超过两行：' + JSON.stringify(cardMetrics))
        assert.ok(cardMetrics.ratio <= 1.15, '卡片应接近方形（高/宽 ≤ 1.15）：' + JSON.stringify(cardMetrics))
      }
      if (width === 375 || width === 1440) {
        await cardPage.screenshot({ path: output + `license-app-cards-${width}-${order}.png`, fullPage: true })
      }
      results.push({ module: 'license-app-cards', width, height, order, errors: cardErrors, metrics: cardMetrics })
      await cardPage.close()
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await fixtureNetwork(page, errors)
      await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: bundle })
      await page.evaluate(({ name }) => window.mountWizard({ canPreview: true, canSubmit: true,
        reconnectOnOpen: true, defaultApplicationCode: 'project_management', defaultEnvironment: 'prod',
        applications: [{ code: 'project_management', name }] }), { name: longText })
      await page.locator('.subsystem-access-wizard__trigger').click()
      await page.locator('.subsystem-access-progress__stages').waitFor()
      errors.push(...await violations(page, true))
      const dialog = page.locator('.subsystem-access-wizard__dialog')
      await dialog.evaluate(e => { e.scrollTop = e.scrollHeight })
      assert.ok((await page.locator('.subsystem-access-progress__evidence').textContent()).includes(token))
      if (width === 1440 || width === 375) {
        await dialog.evaluate(e => { e.scrollTop = 0 })
        await page.screenshot({ path: output + `wizard-${width}-${order}.png`, fullPage: true })
      }
      results.push({ module: 'actual-access-wizard', width, height, order, errors })
      await page.close()
      const confirm = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      const confirmationErrors = []
      confirm.on('pageerror', error => confirmationErrors.push(error.message))
      await fixtureNetwork(confirm, confirmationErrors)
      await confirm.addStyleTag({ content: css })
      await confirm.addScriptTag({ content: bundle })
      await confirm.evaluate(({ title, description }) => window.mountConfirm({ title, description,
        confirmText: title, cancelText: '取消' }), { title: longText, description: token.repeat(2) })
      await confirm.getByRole('alertdialog').waitFor()
      confirmationErrors.push(...await violations(confirm))
      await confirm.locator('.shared-confirm').evaluate(e => { e.scrollTop = 0 })
      const closeBox = await confirm.locator('.shared-confirm-close').boundingBox()
      if (!(closeBox && closeBox.x >= 0 && closeBox.x + closeBox.width <= width
        && closeBox.y >= 0 && closeBox.y + closeBox.height <= height)) {
        confirmationErrors.push('close action unreachable: ' + JSON.stringify(closeBox))
      }
      await confirm.locator('.shared-confirm').evaluate(e => { e.scrollTop = e.scrollHeight })
      const action = confirm.locator('.shared-confirm-button.primary')
      await action.scrollIntoViewIfNeeded()
      assert.ok(await action.isVisible(), 'long dialogs must retain a reachable confirmation action')
      results.push({ module: 'actual-shared-confirm', width, height, order, errors: confirmationErrors })
      await confirm.close()
      // 报销异步/异常面板：挂载真实组件，用浏览器内合成响应覆盖全部请求（含建包任务）。
      {
        const panelPage = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
        const panelErrors = []
        panelPage.on('pageerror', error => panelErrors.push(error.message))
        await panelPage.setContent(`<style>${css}</style><main class="console-content" data-boundary="page">
          <header class="expense-head" data-boundary="heading"><div><p class="expense-kicker">REIMBURSEMENT</p>
            <h1>${longText}</h1><p>合成异步建包、同步诊断与外部付款异常面板。</p></div>
            <button type="button" class="expense-button primary" data-action>刷新</button></header>
          <div class="expense-alert warning" data-boundary="alert" role="alert">${longText} ${token}</div>
          <section class="expense-panel" data-boundary="card"><h2>证据包与项目支出同步</h2>
            <div id="archive-panel"></div><div id="sync-panel"></div></section>
          <div id="exception-panel"></div></main>`)
        await panelPage.addScriptTag({ content: bundle })
        const facts = reimbursementFacts()
        await reimbursementNetwork(panelPage, facts)
        await panelPage.evaluate(facts => {
          window.mountArchivePackage({ archives: facts.archives }, document.querySelector('#archive-panel'))
          window.mountClaimSync({ claim: facts.syncClaim, permissions: facts.permissions }, document.querySelector('#sync-panel'))
          window.mountPaymentException({ ...facts.payment, 'data-boundary': 'card' }, document.querySelector('#exception-panel'))
        }, facts)
        // 同步状态读取完成后再生成本地响应驱动的建包任务，两个面板都来自真实组件。
        await panelPage.waitForFunction(() => document.querySelector('#sync-panel')?.textContent.includes('同步快照待恢复'))
        await panelPage.getByRole('button', { name: '生成文件包' }).click()
        await panelPage.waitForFunction(() => document.querySelector('#archive-panel')?.textContent.includes('已完成'))
        const paymentChoice = panelPage.getByRole('combobox', { name: '已有合法付款', exact: true })
        await paymentChoice.locator('option', { hasText: '已登记付款' }).waitFor({ state: 'attached' })
        assert.equal(await paymentChoice.locator('option', { hasText: '已登记付款' })
          .getAttribute('value'), facts.resolutionOptions.payments[0].id,
        '异常解除选择器必须显示真实响应契约中的付款候选')
        panelErrors.push(...await violations(panelPage))
        const network = await panelPage.evaluate(() => ({
          calls: window.__reimbursementCalls, missing: window.__reimbursementMissing,
        }))
        assert.deepEqual(network.missing, [], '夹具必须覆盖全部报销请求：' + network.missing.join(', '))
        assert.ok(network.calls.includes('POST /reimbursement/api/v1/archives/arc-2026-03/packages'),
          '档案包生成必须走真实命令入口：' + network.calls.join(', '))
        assert.ok(network.calls.includes('GET /reimbursement/api/v1/payment-exceptions/'
          + facts.payment.selected.id + '/resolution-options'),
        '异常面板必须读取当前异常的真实解除选项接口：' + network.calls.join(', '))
        assert.ok(network.calls.some(call => call.endsWith('/sync-status')),
          '同步面板必须读取真实同步状态接口：' + network.calls.join(', '))
        // 记录真实异常表的几何：它是 5 列表格在 375px 的实际表现，必须由滚动容器承接，
        // 并靠表体 880px 下限避免列被逐字压窄。
        const panelMetrics = await panelPage.evaluate(() => {
          const region = document.querySelector('#exception-panel .expense-table')
          const body = region?.querySelector('.expense-table-body')
          return {
            exceptionTable: region ? {
              scrollWidth: region.scrollWidth, clientWidth: region.clientWidth,
              overflowX: getComputedStyle(region).overflowX,
              tableWidth: body ? Math.round(body.getBoundingClientRect().width) : 0,
              headers: body ? [...body.querySelectorAll('thead th')]
                .map(head => Math.round(head.getBoundingClientRect().width)) : [],
            } : null,
            jobFinished: (document.querySelector('#archive-panel')?.textContent || '').includes('下载证据包'),
            capacityWarning: (document.querySelector('#sync-panel')?.textContent || '')
              .includes('当前不能安全预留全额冲正空间'),
          }
        })
        assert.ok(panelMetrics.exceptionTable, '真实付款异常面板必须渲染异常事实表')
        assert.equal(panelMetrics.exceptionTable.headers.length, 5, '真实异常表必须是 5 列')
        if (width === 1440) {
          assert.ok(panelMetrics.exceptionTable.scrollWidth <= panelMetrics.exceptionTable.clientWidth + 1,
            '1440px 下真实异常表不应横向滚动：' + JSON.stringify(panelMetrics.exceptionTable))
        }
        if (width <= 375) {
          assert.ok(panelMetrics.exceptionTable.scrollWidth > panelMetrics.exceptionTable.clientWidth + 1,
            `${width}px 下 5 列异常表必须由滚动容器承接：` + JSON.stringify(panelMetrics.exceptionTable))
          assert.ok(['auto', 'scroll'].includes(panelMetrics.exceptionTable.overflowX),
            '异常表滚动容器必须可横向滚动：' + panelMetrics.exceptionTable.overflowX)
          assert.ok(panelMetrics.exceptionTable.tableWidth >= 880,
            '5 列异常表必须保留 880px 最小可读宽度：' + JSON.stringify(panelMetrics.exceptionTable))
          assert.ok(Math.min(...panelMetrics.exceptionTable.headers) >= 48,
            '窄屏下异常表列头不得被压成逐字换行：' + JSON.stringify(panelMetrics.exceptionTable.headers))
          const scrolledLeft = await panelPage.locator('#exception-panel .expense-table')
            .evaluate(region => { region.scrollLeft = region.scrollWidth; return region.scrollLeft })
          assert.ok(scrolledLeft > 0, `${width}px 下 5 列异常表必须能滚到右侧状态与操作列`)
          if (width === 375) {
            await panelPage.locator('#exception-panel .expense-table').screenshot({
              path: output + `reimbursement-exception-table-375-scrolled-${order}.png`,
            })
            // 复位滚动位置，后面的整页与未滚动元素截图仍记录初始状态。
            await panelPage.locator('#exception-panel .expense-table')
              .evaluate(region => { region.scrollLeft = 0 })
          }
        }
        assert.ok(panelMetrics.jobFinished, '档案包任务必须渲染完成态与下载入口')
        assert.ok(panelMetrics.capacityWarning, '同步面板必须渲染容量预警')
        if (width === 1440 || width === 375) {
          await panelPage.screenshot({ path: output + `reimbursement-panels-${width}-${order}.png`, fullPage: true })
        }
        if (width === 375) {
          await panelPage.locator('#exception-panel .expense-table')
            .screenshot({ path: output + `reimbursement-exception-table-375-${order}.png` })
        }
        results.push({ module: 'actual-reimbursement-panels', width, height, order, errors: panelErrors,
          metrics: { calls: network.calls.length, ...panelMetrics } })
        await panelPage.close()
      }
      // 报销失败态：共享 ErrorState + 真实同步面板的失败响应，验证窄屏下错误态不塌。
      {
        const errorPage = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
        const errorErrors = []
        errorPage.on('pageerror', error => errorErrors.push(error.message))
        await errorPage.setContent(`<style>${css}</style><main class="console-content" data-boundary="page">
          <header class="expense-head" data-boundary="heading"><div><h1>${longText}</h1>
            <p>合成加载失败：列表错误态与同步面板错误。</p></div>
            <button type="button" class="expense-button" data-action>刷新</button></header>
          <section class="expense-panel" data-boundary="card"><h2>项目归档包</h2>
            <p>列表读取失败后应给出可重试的错误态，而不是空白面板。</p><div id="error-state"></div></section>
          <section class="expense-panel" data-boundary="card"><h2>项目支出同步</h2><div id="sync-error"></div></section></main>`)
        await errorPage.addScriptTag({ content: bundle })
        const facts = reimbursementFacts()
        await reimbursementNetwork(errorPage, { ...facts, syncFails: true })
        await errorPage.evaluate(({ message, claim }) => {
          window.mountErrorState({ title: '列表加载失败', error: new Error(message) },
            document.querySelector('#error-state'))
          window.mountClaimSync({ claim, permissions: [] }, document.querySelector('#sync-error'))
        }, { message: longText + token, claim: { id: 'claim-fail-01', version: 3 } })
        await errorPage.waitForFunction(() => document.querySelector('#sync-error .ui-state__title')
          ?.textContent.includes('同步状态读取失败'))
        const errorMetrics = await errorPage.evaluate(() => {
          const box = element => {
            const rect = element.getBoundingClientRect()
            return { left: Math.round(rect.left), right: Math.round(rect.right),
              width: Math.round(rect.width), height: Math.round(rect.height) }
          }
          const state = document.querySelector('#error-state .ui-state')
          const syncState = document.querySelector('#sync-error .ui-state')
          return {
            title: state.querySelector('.ui-state__title')?.textContent,
            state: { ...box(state), scrollWidth: state.scrollWidth, clientWidth: state.clientWidth },
            retry: box(state.querySelector('.ui-state__retry')),
            sync: {
              title: syncState?.querySelector('.ui-state__title')?.textContent || '',
              description: syncState?.querySelector('.ui-state__description')?.textContent || '',
              text: syncState?.textContent || '',
              state: syncState ? { ...box(syncState), scrollWidth: syncState.scrollWidth, clientWidth: syncState.clientWidth } : null,
              retry: syncState?.querySelector('.ui-state__retry') ? box(syncState.querySelector('.ui-state__retry')) : null,
            },
          }
        })
        errorErrors.push(...await violations(errorPage))
        assert.equal(errorMetrics.title, '列表加载失败')
        assert.ok(errorMetrics.state.scrollWidth <= errorMetrics.state.clientWidth + 1,
          '错误态内部不得横向溢出：' + JSON.stringify(errorMetrics.state))
        assert.ok(errorMetrics.retry.left >= 0 && errorMetrics.retry.right <= width + 1,
          '错误态重试按钮必须留在视口内：' + JSON.stringify(errorMetrics.retry))
        assert.ok(errorMetrics.retry.height >= 30 && errorMetrics.retry.width >= 60,
          '错误态重试按钮必须带真实三态样式：' + JSON.stringify(errorMetrics.retry))
        // 同步面板读取失败也必须走共享 ErrorState：有标题、有重试，且不再直出原始长错误。
        assert.equal(errorMetrics.sync.title, '同步状态读取失败')
        assert.match(errorMetrics.sync.description, /服务暂时无法完成请求/,
          '同步错误态必须经过 formatUserError：' + JSON.stringify(errorMetrics.sync.description))
        assert.ok(!errorMetrics.sync.text.includes(token),
          '同步错误态不得直出原始长错误：' + errorMetrics.sync.text.slice(0, 120))
        assert.ok(errorMetrics.sync.retry, '同步读取失败必须提供重试入口')
        assert.ok(errorMetrics.sync.retry.height >= 30 && errorMetrics.sync.retry.width >= 60,
          '同步错误态重试按钮必须带真实三态样式：' + JSON.stringify(errorMetrics.sync.retry))
        assert.ok(errorMetrics.sync.retry.left >= 0 && errorMetrics.sync.retry.right <= width + 1,
          '同步错误态重试按钮必须留在视口内：' + JSON.stringify(errorMetrics.sync.retry))
        assert.ok(errorMetrics.sync.state.scrollWidth <= errorMetrics.sync.state.clientWidth + 1,
          '同步错误态内部不得横向溢出：' + JSON.stringify(errorMetrics.sync.state))
        if (width === 375) {
          await errorPage.locator('#sync-error').screenshot({
            path: output + `reimbursement-sync-error-375-${order}.png`,
          })
        }
        if (width === 1440 || width === 375) {
          await errorPage.screenshot({ path: output + `reimbursement-error-${width}-${order}.png`, fullPage: true })
        }
        results.push({ module: 'actual-reimbursement-error-state', width, height, order,
          errors: errorErrors, metrics: errorMetrics })
        await errorPage.close()
      }
      // 报销付款历史 / 冲正历史表：这两张表此前是裸 <table>，375px 会被逐字压窄。
      // 合成行沿用真实模板的 7 列付款历史与 4 列冲正历史，验证 .expense-table 滚动容器
      // 与 880px 表体下限对历史表同样生效（与异常表断言语义一致）。
      {
        const historyPage = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
        const historyErrors = []
        historyPage.on('pageerror', error => historyErrors.push(error.message))
        // 合成行沿用真实模板的单元格形状（单据号、金额、货币、日期、方式、外部流水号、状态串），
        // 不额外塞超长文本：这里要证的是容器与 880px 下限，不是单列内容宽度。
        const paymentRows = Array.from({ length: 3 }, (_, index) => `<tr>
          <td>01H0000000000000000000000A${index + 1}</td><td>1,288.00</td><td>CNY</td>
          <td>2026-11-0${index + 1}</td><td>银行转账</td><td>EXT-20261111-0001${index + 1}</td>
          <td>已核销 · 冲正：待审批</td></tr>`).join('')
        const reversalRows = Array.from({ length: 2 }, (_, index) => `<tr>
          <td>01H0000000000000000000000B${index + 1}</td><td>实际未付款</td><td>待审批</td>
          <td>v${index + 2}</td></tr>`).join('')
        await historyPage.setContent(`<style>${css}</style><main class="console-content" data-boundary="page">
          <section class="expense-panel" data-boundary="card"><div class="expense-item">
            <h3>付款历史</h3><p>共 12 条，第 1 页。</p>
            <div class="expense-table" id="payment-history-table" data-scroll><table class="expense-table-body">
              <thead><tr><th scope="col">付款单号</th><th scope="col">金额</th><th scope="col">货币</th>
                <th scope="col">实际付款日</th><th scope="col">方式</th><th scope="col">流水号</th>
                <th scope="col">状态 / 关联</th></tr></thead><tbody>${paymentRows}</tbody></table></div>
            <h4>冲正申请</h4>
            <div class="expense-table" id="reversal-history-table" data-scroll><table class="expense-table-body">
              <thead><tr><th scope="col">申请</th><th scope="col">事实类型</th><th scope="col">状态</th>
                <th scope="col">版本</th></tr></thead><tbody>${reversalRows}</tbody></table></div>
          </div></section></main>`)
        historyErrors.push(...await violations(historyPage))
        const historyMetrics = await reimbursementHistoryMetrics(historyPage)
        assert.ok(historyMetrics.payment && historyMetrics.reversal,
          '付款分区必须渲染付款历史与冲正历史两张表')
        for (const [label, table, columns] of [['付款历史', historyMetrics.payment, 7],
          ['冲正历史', historyMetrics.reversal, 4]]) {
          assert.equal(table.headers.length, columns, `${label}表必须是 ${columns} 列`)
          if (width === 1440) {
            assert.ok(table.scrollWidth <= table.clientWidth + 1,
              `1440px 下${label}表不应横向滚动：` + JSON.stringify(table))
          }
        }
        if (width <= 375) {
          for (const [label, table] of [['付款历史', historyMetrics.payment],
            ['冲正历史', historyMetrics.reversal]]) {
            assert.ok(table.scrollWidth > table.clientWidth + 1,
              `${width}px 下${label}表必须由滚动容器承接：` + JSON.stringify(table))
            assert.ok(['auto', 'scroll'].includes(table.overflowX),
              `${label}表滚动容器必须可横向滚动：` + table.overflowX)
            assert.ok(table.tableWidth >= 880,
              `${label}表必须保留 880px 最小可读宽度：` + JSON.stringify(table))
            assert.ok(Math.min(...table.headers) >= 48,
              `窄屏下${label}表列头不得被压成逐字换行：` + JSON.stringify(table.headers))
          }
          const scrolled = await historyPage.evaluate(() => {
            const move = selector => {
              const region = document.querySelector(selector)
              region.scrollLeft = region.scrollWidth
              return region.scrollLeft
            }
            return { payment: move('#payment-history-table'), reversal: move('#reversal-history-table') }
          })
          assert.ok(scrolled.payment > 0, `${width}px 下付款历史表必须能滚到右侧「状态 / 关联」列`)
          assert.ok(scrolled.reversal > 0, `${width}px 下冲正历史表必须能滚到右侧「版本」列`)
          historyMetrics.payment.scrolledLeft = scrolled.payment
          historyMetrics.reversal.scrolledLeft = scrolled.reversal
          if (width === 375) {
            // 先存「滚动到右侧列」的证据，再复位存初始状态（列头从第一列开始）。
            await historyPage.locator('#payment-history-table').screenshot({
              path: output + `reimbursement-payment-history-375-scrolled-${order}.png`,
            })
            await historyPage.locator('#reversal-history-table').screenshot({
              path: output + `reimbursement-reversal-history-375-scrolled-${order}.png`,
            })
            await historyPage.evaluate(() => {
              document.querySelector('#payment-history-table').scrollLeft = 0
              document.querySelector('#reversal-history-table').scrollLeft = 0
            })
            await historyPage.locator('#payment-history-table').screenshot({
              path: output + `reimbursement-payment-history-375-${order}.png`,
            })
            await historyPage.locator('#reversal-history-table').screenshot({
              path: output + `reimbursement-reversal-history-375-${order}.png`,
            })
          }
        }
        if (width === 1440 || width === 375) {
          await historyPage.screenshot({ path: output + `reimbursement-history-${width}-${order}.png`, fullPage: true })
        }
        results.push({ module: 'actual-reimbursement-history-tables', width, height, order,
          errors: historyErrors, metrics: historyMetrics })
        await historyPage.close()
      }
    }
    // 授权事件抽屉：挂真实组件，用真实 console.css 骨架检查「移动端整屏 / 桌面 560px 右贴边」。
    {
      const sheetPage = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      const sheetErrors = []
      sheetPage.on('pageerror', error => sheetErrors.push(error.message))
      await sheetPage.setContent('<div id="fixture"></div>')
      await sheetPage.addStyleTag({ content: sheetCss })
      await sheetPage.addScriptTag({ content: bundle })
      // 抽屉自己取数：只替换 fetch，注入 20 条合成事件，不发任何真实请求。
      await sheetPage.evaluate(({ longText, pageSize }) => {
        const items = Array.from({ length: pageSize }, (_, index) => ({
          id: '01H0000000000000000000' + String(index).padStart(4, '0'),
          kind: index === 0 ? 'FUTURE_EVENT' : 'IMPORTED_CURRENT',
          version: 3, revision: index + 1, created_at: '2026-10-13T04:34:56Z',
          digest: 'sha256:' + 'a'.repeat(40), tenant_id: '', user_id: '',
          note: longText,
        }))
        window.fetch = async () => ({
          ok: true, status: 200, headers: { get: () => 'application/json' },
          json: async () => ({ code: 'OK', data: { items, total: 120, page: 1 } }),
        })
        window.mountLicenseEventsSheet({ open: true })
      }, { longText, pageSize: 20 })
      await sheetPage.locator('.console-sheet').waitFor()
      await sheetPage.locator('.license-event-summary').first().waitFor()
      sheetErrors.push(...await sheetViolations(sheetPage, width, height))
      if (width === 1440 || width === 375) await sheetPage.screenshot({ path: output + `license-events-sheet-${width}.png` })
      results.push({ module: 'actual-license-events-sheet', width, height, order: 'sheet-only', errors: sheetErrors })
      await sheetPage.close()
    }
  }
} finally {
  await browser.close()
}
await writeFile(output + 'results.json', JSON.stringify(results, null, 2))
const failures = results.filter(item => item.errors.length)
console.log(JSON.stringify({ cases: results.length, failures: failures.length, examples: failures.slice(0, 8) }, null, 2))
assert.equal(failures.length, 0, 'long content must remain within each module and dialog boundary')
