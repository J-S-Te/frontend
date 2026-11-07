import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { MAX_LICENSE_BYTES, commitLicense, getLicenseEvents, getLicenseRequest, getLicenseStatus, initializeLicense, previewLicense, validateLicenseInput } from './api.js'
import { licenseRows, licensedOnly, previewCanCommit, riskyChange, statusRows } from './presentation.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
function respond(data, status = 200) {
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => ({ data, message: '授权状态冲突' }) }
}
test('all license requests use shared authenticated no-store transport and exact contract', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return respond({ deployment: { revision: 3 }, initialized: true, systems: [], server_time: 'now', runtime_enforcement: 'AVAILABLE', runtime_enforcement_source: 'per_application_coordination', configured_environment: 'production' }) }
  assert.deepEqual(await getLicenseStatus(), { revision: 3, initialized: true, systems: [], server_time: 'now', runtime_enforcement: 'AVAILABLE', runtime_enforcement_source: 'per_application_coordination', configured_environment: 'production' })
  await initializeLicense('customer-a', 'production')
  await getLicenseRequest()
  await previewLicense('signed.token.value')
  await commitLicense('signed.token.value', { digest: 'digest', revision: 3, current_version: 2, pending_digest: 'pending' }, true, false)
  await getLicenseEvents(2)
  assert.deepEqual(requests.map(item => item.url), ['/api/v1/licenses/status', '/api/v1/licenses/initialize', '/api/v1/licenses/request', '/api/v1/licenses/imports/preview', '/api/v1/licenses/imports/commit', '/api/v1/licenses/events?page=2&page_size=20'])
  for (const { options } of requests) { assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store') }
  assert.deepEqual(JSON.parse(requests[1].options.body), { customer_id: 'customer-a', environment: 'production' })
  assert.deepEqual(JSON.parse(requests[4].options.body), { raw_jws: 'signed.token.value', digest: 'digest', expected_revision: 3, expected_current_version: 2, expected_pending_digest: 'pending', confirm_changes: true, confirm_replace_pending: false })
})
test('input validation bounds UTF-8 byte size and rejects private keys without requesting', () => {
  assert.throws(() => validateLicenseInput(' '), /请选择/)
  assert.throws(() => validateLicenseInput('-----BEGIN PRIVATE KEY-----'), /私钥/)
  assert.throws(() => validateLicenseInput('界'.repeat(MAX_LICENSE_BYTES / 3 + 1)), /256 KiB/)
  assert.doesNotThrow(() => validateLicenseInput('a'.repeat(MAX_LICENSE_BYTES)))
})
test('six system rows retain unpurchased systems and exclusive expiry boundaries', () => {
  const rows = licenseRows({ not_before: 50, applications: [{ code: 'settlement', not_before: 80, expires_at: 100, kind: 'FULL' }, { code: 'data_analysis', not_before: 120, expires_at: 150, kind: 'TRIAL' }] }, 100)
  assert.equal(rows.length, 6)
  assert.equal(rows.find(row => row.code === 'settlement').state, '已到期')
  assert.equal(rows.find(row => row.code === 'data_analysis').state, '尚未生效')
  assert.equal(rows.find(row => row.code === 'project_management').state, '未购买')
})
test('display uses authoritative server statuses, including clock and integrity failures', () => {
  const rows = statusRows({ systems: [{ code: 'settlement', status: 'CLOCK_ABNORMAL', kind: 'FULL', expires_at: 100 }, { code: 'customer_portal', status: 'VALIDATION_ERROR' }] })
  assert.equal(rows.length, 6)
  assert.equal(rows.find(row => row.code === 'settlement').state, '时钟异常')
  assert.equal(rows.find(row => row.code === 'customer_portal').state, '校验异常')
})
test('current authorization panel keeps only licensed systems and hides unpurchased noise', () => {
  const rows = statusRows({ systems: [{ code: 'customer_and_opportunity', status: 'VALID', kind: 'FULL', not_before: 10, expires_at: 99 }, { code: 'settlement', status: 'EXPIRED', kind: 'FULL', expires_at: 1 }] })
  const visible = licensedOnly(rows)
  assert.deepEqual(visible.map(row => row.code).sort(), ['customer_and_opportunity', 'settlement'])
  assert.equal(visible.length, 2, '未购买/未授权的系统不得出现在当前授权面板')
  assert.ok(visible.every(row => row.application), '每行都携带许可证内的应用条目')
  const empty = licensedOnly(statusRows({ systems: [{ code: 'contract_management', status: 'NOT_PURCHASED' }] }))
  assert.equal(empty.length, 0)
})
test('removed, shortened, delayed and downgraded grants require explicit confirmation', () => {
  for (const change of [{ kind: 'REMOVED' }, { kind: 'UPDATED', old: { expires_at: 100 }, new: { expires_at: 90 } }, { kind: 'UPDATED', old: { not_before: 20 }, new: { not_before: 30 } }, { kind: 'UPDATED', old: { kind: 'FULL' }, new: { kind: 'TRIAL' } }]) {
    assert.equal(riskyChange(change), true)
    assert.equal(previewCanCommit({ changes: [change] }, false, true), false)
    assert.equal(previewCanCommit({ changes: [change] }, true, true), true)
  }
  assert.equal(previewCanCommit(null, true, true), false)
  assert.equal(previewCanCommit({ requires_pending_replacement: true }, true, false), false)
})
test('transport preserves conflict status for invalidating stale preview', async () => {
  globalThis.fetch = async () => respond({}, 409)
  await assert.rejects(getLicenseStatus(), error => error.status === 409)
})
test('commercial authorization Vue view compiles with actual script bindings', () => {
  const filename = new URL('./CommercialLicenseView.vue', import.meta.url)
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename: filename.pathname })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'license-view' })
  const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'license-view', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
})
test('license app card compiles and renders both license and runtime facts', async () => {
  const card = await loadLicenseAppCard()
  const html = await renderCard(card, {
    code: 'settlement', name: '结算管理', tone: 'warning',
    application: { kind: 'FULL', expires_at: 4102444800 },
    license: { key: 'IMPORTED', label: '已导入', tone: 'success' },
    enforcement: { key: 'PENDING_ENFORCEMENT', label: '待激活', tone: 'warning', note: '' },
    summary: { available: true, revision: 7, deploymentRevision: 42, memberCount: 2, ready: 2, acknowledged: 1, latestReadyAt: '2026-10-27T05:54:38Z', latestAckAt: '2026-10-26T01:02:03Z' },
    showEnforcementCounters: true,
    reasonCode: 'EXPIRED',
    action: { key: 'ACTIVATE', label: '去激活', target: 'runtime', hint: '在下方运行详情中核对执行修订并勾选确认后启用' },
  })
  // 标题、许可层面与运行执行必须同时存在，且两区各自独立成块。
  assert.match(html, /id="license-app-title-settlement"/)
  assert.match(html, /aria-labelledby="license-app-title-settlement"/)
  assert.equal(html.match(/许可层面/g).length, 1)
  assert.equal(html.match(/运行执行/g).length, 1)
  assert.match(html, /<dt class="license-app-section-label"[^>]*>许可层面<\/dt>/)
  assert.match(html, /<dt class="license-app-section-label"[^>]*>运行执行<\/dt>/)
  assert.match(html, /结算管理/)
  assert.match(html, /正式授权 · 到期 01-01 08:00/)
  assert.match(html, /title="到期 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/)
  assert.match(html, /剩余 \d+ 天/)
  // 原因码整行保留在 DOM 里，完整文本进 title。
  assert.match(html, /原因：有效期已结束，需要供应商签发更高版本/)
  assert.match(html, /<code class="license-app-reason-code"[^>]*>EXPIRED<\/code>/)
  assert.match(html, /修订 7 · 部署 42/)
  assert.match(html, /准备 2\/2 · 确认 1\/2/)
  assert.match(html, /确认 10-26 09:02/)
  // 每张卡片只有一个动作按钮，accessible name 含系统名与动作名。
  assert.equal(html.match(/<button/g).length, 1)
  assert.match(html, /aria-label="结算管理 · 去激活"/)
})
test('license app card keeps runtime facts when counters are unavailable', async () => {
  const card = await loadLicenseAppCard()
  const unregistered = await renderCard(card, {
    code: 'project_management', name: '项目管理', tone: 'neutral',
    application: { kind: 'TRIAL', expires_at: 4102444800 },
    license: { key: 'IMPORTED', label: '已导入', tone: 'success' },
    enforcement: { key: 'UNREGISTERED', label: '未纳管', tone: 'neutral', note: '运行组件尚未登记，运行执行事实不存在' },
    summary: { available: false, revision: 0, deploymentRevision: 0, memberCount: 0, ready: 0, acknowledged: 0 },
    showEnforcementCounters: false,
    reasonCode: '',
    action: { key: 'ENROLL', label: '查看运行详情', target: 'runtime', hint: '' },
  })
  // showEnforcementCounters 只关掉计数，不能把整块运行执行（徽标+note）藏掉。
  assert.match(unregistered, /运行执行/)
  assert.match(unregistered, /未纳管/)
  assert.match(unregistered, /运行组件尚未登记，运行执行事实不存在/)
  assert.doesNotMatch(unregistered, /修订 0 · 部署 0/)
  assert.doesNotMatch(unregistered, /0\/0/)
  assert.match(unregistered, /试用授权 · 到期/)
  // 没有动作时只给文字提示，不渲染禁用按钮。
  const hintOnly = await renderCard(card, {
    code: 'contract_management', name: '合同管理', tone: 'danger',
    application: { kind: 'FULL', expires_at: 4102444800 },
    license: { key: 'CLOCK_ABNORMAL', label: '时钟异常', tone: 'danger' },
    enforcement: { key: 'UNKNOWN', label: '状态未知', tone: 'neutral', note: '概览读取失败，请刷新执行状态重试' },
    summary: null,
    showEnforcementCounters: false,
    reasonCode: 'CLOCK_ABNORMAL',
    action: { key: 'RECOVER', label: '联系授权管理员', target: 'none', hint: '检测到时间回拨，授权已按失败关闭处理；只有商业授权管理员可以提交恢复凭据' },
  })
  assert.doesNotMatch(hintOnly, /<button/)
  assert.match(hintOnly, /只有商业授权管理员可以提交恢复凭据/)
  assert.match(hintOnly, /原因：检测到时间回拨，授权已按失败关闭处理/)
})
test('valid license never claims business activation or disconnected implementation', () => {
  const source = readFileSync(new URL('./CommercialLicenseView.vue', import.meta.url), 'utf8')
  assert.match(source, /不代表业务系统已开放/)
  assert.match(source, /运行时登记与执行确认状态为准/)
  assert.doesNotMatch(source, /业务系统的运行时授权检查尚未接入/)
})
test('runtime overview stays mounted before license initialization instead of hiding facts', () => {
  const source = readFileSync(new URL('./CommercialLicenseView.vue', import.meta.url), 'utf8')
  assert.match(source, /<RuntimeEnforcementView[^>]*@toast=/)
  assert.doesNotMatch(source, /RuntimeEnforcementView[^\n>]*v-if=/)
})
test('statusRows 原样透传聚合 enforcement 与 reason_code，并保留 undefined/null 的区别', () => {
  const rows = statusRows({
    systems: [
      { code: 'settlement', status: 'VALID', kind: 'FULL', expires_at: 100, reason_code: 'EXPIRED', enforcement: { available: true, registration: 'REGISTERED', status: 'ENFORCED' } },
      { code: 'contract_management', status: 'CLOCK_ABNORMAL', kind: 'FULL', reason_code: 'CLOCK_ABNORMAL', enforcement: null },
      { code: 'project_management', status: 'VALID', kind: 'FULL' },
    ],
  })
  const settlement = rows.find(row => row.code === 'settlement')
  assert.equal(settlement.enforcement.status, 'ENFORCED')
  assert.equal(settlement.reasonCode, 'EXPIRED')
  const clock = rows.find(row => row.code === 'contract_management')
  assert.equal(clock.enforcement, null, '服务端明确没有聚合时必须是 null，不能变成 undefined')
  assert.equal(clock.reasonCode, 'CLOCK_ABNORMAL')
  // 旧后端没有这两个字段：undefined 才能触发逐应用概览回退。
  const legacy = rows.find(row => row.code === 'project_management')
  assert.equal(legacy.enforcement, undefined)
  assert.equal(legacy.reasonCode, '')
  // 未购买的系统不进入当前授权面板。
  assert.equal(licensedOnly(rows).some(row => row.code === 'data_analysis'), false)
})

// loadLicenseAppCard 用途：编译真实的 LicenseAppCard 单文件组件，供下方 SSR 断言直接渲染。
// 参数：无；入口固定为同目录的 LicenseAppCard.vue。
// 返回值：可交给 createSSRApp 的组件对象；parse/compile 有错时用例直接失败。
async function loadLicenseAppCard() {
  const filename = new URL('./LicenseAppCard.vue', import.meta.url)
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename: filename.pathname })
  assert.deepEqual(errors, [])
  assert.ok(descriptor.scriptSetup, 'LicenseAppCard.vue 必须使用 <script setup>')
  const script = compileScript(descriptor, { id: 'license-app-card' })
  const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'license-app-card', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const bindings = {}
  for (const node of script.scriptSetupAst.filter(item => item.type === 'ImportDeclaration')) {
    const specifier = node.source.value
    const dependency = specifier === 'vue' ? Vue : await import(new URL(specifier, filename))
    for (const spec of node.specifiers) {
      bindings[spec.local.name] = spec.type === 'ImportDefaultSpecifier' ? (dependency.default ?? dependency) : dependency[spec.imported.name]
    }
  }
  const component = new Function(...Object.keys(bindings), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(bindings))
  component.render = new Function('Vue', template.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

async function renderCard(component, row) {
  return renderToString(Vue.createSSRApp({ render: () => Vue.h(component, { row, busy: false, loading: false }) }))
}
