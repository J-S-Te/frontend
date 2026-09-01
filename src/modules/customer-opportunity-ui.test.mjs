import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('./customer_opportunity/views/CustomerOpportunityView.vue', import.meta.url), 'utf8')
const apiSource = await readFile(new URL('./customer_opportunity/api/presale.js', import.meta.url), 'utf8')
const style = await readFile(new URL('./customer_opportunity/styles/customer-opportunity.css', import.meta.url), 'utf8')
const approvalPanel = await readFile(new URL('./customer_opportunity/components/PresaleApprovalRulesPanel.vue', import.meta.url), 'utf8')
const ownerSelector = await readFile(new URL('./customer_opportunity/components/OwnerSelector.vue', import.meta.url), 'utf8')
const api = await import('./customer_opportunity/api/presale.js')
const customer = await import('./customer_opportunity/api/customer.js')
const client = await import('./customer_opportunity/api/client.js')
const opportunity = await import('./customer_opportunity/api/opportunity.js')
const notification = await import('./customer_opportunity/api/notification.js')
const ownerDirectory = await import('./customer_opportunity/api/ownerDirectory.js')
const { parseNotificationTarget } = await import('./customer_opportunity/navigation.js')
const { presaleAPIParams, presaleStateFromQuery, presaleStateToQuery } = await import('./customer_opportunity/presaleQuery.js')
const { createPresaleMutationRetryState, normalizePresaleMutationPayload } = await import('./customer_opportunity/presaleMutationRetry.js')
const { createCreateMutationRetryState, normalizeCreateMutationPayload } = await import('./customer_opportunity/createMutationRetry.js')
const { createContractTransferRetryState } = await import('./customer_opportunity/contractTransferRetry.js')
const { createAttachmentUploadRetryState } = await import('./customer_opportunity/attachmentUploadRetry.js')
const { createMemberTermLoadState } = await import('./customer_opportunity/memberTermLoadState.js')
const { createPortalInviteRetryState } = await import('./customer_opportunity/portalInviteRetry.js')
const { createPortalAccessDisableRetryState } = await import('./customer_opportunity/portalAccessDisableRetry.js')
const { formatSignedContractCount } = await import('./customer_opportunity/signedContractCount.js')

test('售前审批规则支持规则列表和编辑区折叠', () => {
  assert.match(approvalPanel, /const rulesExpanded = ref\(true\)/)
  assert.match(approvalPanel, /const editorExpanded = ref\(true\)/)
  assert.match(approvalPanel, /aria-expanded="rulesExpanded"/)
  assert.match(approvalPanel, /收起列表/)
  assert.match(approvalPanel, /展开列表/)
  assert.match(approvalPanel, /crm-approval-editor-body/)
  assert.match(style, /\.crm-approval-collapse-button/)
})

test('技术总监可作为人员指派节点负责人，完成审批后展示指派入口', () => {
  assert.match(approvalPanel, /type: 'PERSON_ASSIGNMENT', role_code: 'technical_director'/)
  assert.match(view, /\['APPROVED_PENDING_ASSIGNMENT', 'EXECUTING'\]\.includes\(request\?\.status\)/)
  assert.match(view, /technical_director: \['technical_director', 'technical_lead'\]/)
  assert.match(view, /request\?\.assignment_action !== action/)
})

test('客户与商机管理复用基础平台壳层、图标导航和响应式规范', () => {
  assert.match(view, /import ConsoleIcon from '@\/modules\/platform\/shared\/components\/ConsoleIcon\.vue'/)
  assert.match(view, /import '@\/modules\/platform\/styles\/console\.css'/)
  for (const className of ['console-page', 'console-sidebar', 'console-nav-item', 'console-main', 'console-topbar', 'console-content', 'console-page-head']) {
    assert.match(view, new RegExp(className))
  }
  for (const section of ['客户管理', '商机管理', '售前技术支持', '个人通知']) {
    assert.match(view, new RegExp(section))
  }
  assert.match(view, /v-if="canReadNotifications"/)
  assert.match(view, /mobileMenuOpen/)
  assert.match(style, /@media \(max-width: 820px\)/)
  assert.match(style, /@media \(max-width: 620px\)/)
})

test('商机列表、七阶段看板和详情统一展示已签约合同数量', () => {
  assert.equal(formatSignedContractCount(2), '2 份')
  assert.equal(formatSignedContractCount(0), '0 份')
  assert.equal(formatSignedContractCount(null), '合同服务未接入')
  assert.equal(formatSignedContractCount(undefined), '合同服务未接入')
  assert.match(view, /<th>已签约合同<\/th>/)
  assert.match(view, /<td>\{\{ formatSignedContractCount\(item\.signed_contract_count\) \}\}<\/td>/)
  assert.match(view, /已签约合同 \{\{ formatSignedContractCount\(item\.signed_contract_count\) \}\}/)
  assert.match(view, /<dt>累计已签约合同<\/dt><dd>\{\{ formatSignedContractCount\(selectedOpportunity\.signed_contract_count\) \}\}<\/dd>/)
  assert.match(view, /selectedOpportunityOwnerOrgID/)
  assert.match(view, /selectedOpportunity\.value = \{ \.\.\.detail, owner_org_id: '基础平台组织' \}/)
})

test('商机详情空响应时清空旧数据并提示错误', () => {
  assert.match(view, /const opportunityDetailLoadSequence = ref\(0\)/)
  assert.match(view, /const loadSequence = \+\+opportunityDetailLoadSequence\.value/)
  assert.match(view, /selectedOpportunity\.value = null/)
  assert.match(view, /const message = '商机详情返回异常，请返回列表重试。'/)
  assert.match(view, /if \(!detail \|\| typeof detail !== 'object' \|\| Array\.isArray\(detail\)\)/)
  assert.match(view, /error\.value = message/)
  assert.match(view, /if \(loadSequence !== opportunityDetailLoadSequence\.value\) return/)
})

test('商机和售前核心表单统一使用大系统 console 弹窗规范', () => {
  assert.match(view, /v-if="opportunityDialog" class="console-modal-backdrop"[\s\S]*class="console-detail-modal crm-opportunity-dialog"[\s\S]*class="console-form-grid crm-opportunity-dialog__body"/)
  assert.match(view, /v-if="showReport" class="console-modal-backdrop"[\s\S]*class="console-detail-modal crm-report-dialog"[\s\S]*class="console-form-grid crm-report-filters"/)
  assert.match(view, /v-if="showAlertConfig" class="console-modal-backdrop"[\s\S]*class="console-detail-modal crm-alert-rules-dialog"[\s\S]*class="console-setting-list"/)
  assert.match(view, /v-if="selectedPresale" class="console-modal-backdrop"[\s\S]*class="console-detail-modal crm-presale-console-detail"[\s\S]*class="console-detail-grid crm-presale-summary"/)
  for (const className of ['crm-opportunity-dialog', 'crm-report-dialog', 'crm-alert-rules-dialog', 'crm-presale-console-detail']) {
    assert.match(style, new RegExp(`\\.${className}`))
  }
  assert.match(view, /class="console-modal-close"[^>]*aria-label="关闭商机表单"/)
  assert.match(view, /class="console-button primary" type="submit"[^>]*>\{\{ actionLoading/)
  assert.match(view, /class="console-data-table crm-report-table"/)
  assert.match(view, /class="console-switch"|\['console-switch', \{ on: rule\.enabled \}\]/)
  assert.doesNotMatch(view, /v-if="opportunityDialog" class="crm-modal"/)
  assert.doesNotMatch(view, /v-if="showReport" class="crm-modal"/)
  assert.doesNotMatch(view, /v-if="showAlertConfig" class="crm-modal"/)
})

test('负责人通过基础平台授权目录选择用户及其有效组织', async (t) => {
  assert.match(view, /import OwnerSelector from '\.\.\/components\/OwnerSelector\.vue'/)
  assert.equal((view.match(/<OwnerSelector/g) || []).length, 2)
  assert.match(view, /v-if="customerEditMode" class="console-form-item full"><OwnerSelector v-model:user-id="customerForm\.owner_user_id"/)
  assert.doesNotMatch(view, /v-if="!opportunityEditMode"[^>]*><OwnerSelector/)
  assert.doesNotMatch(view, /负责人用户 ID<input/)
  assert.doesNotMatch(view, /真实人员目录校验尚待稳定契约/)
  assert.match(ownerSelector, /基础平台 OIDC sub/)
  assert.match(ownerSelector, /user\.organizations/)
  assert.match(ownerSelector, /organization\.is_primary/)
  assert.match(ownerSelector, /CRM_OWNER_DIRECTORY_UNAVAILABLE/)
  assert.match(ownerSelector, /required/)
  assert.match(ownerSelector, /platformUserName\(user\)/)
  assert.doesNotMatch(ownerSelector, /display_name \}\}（\{\{ user\.user_id \}\}）/)
  assert.match(style, /\.crm-owner-selector/)

  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ items: [], page: 1, page_size: 50, total: 0 })
  }
  await ownerDirectory.listOwnerDirectory({ keyword: '张三', page: 1, page_size: 50 })
  assert.equal(requests[0].url, '/customer-opportunity/api/v1/owner-directory?keyword=%E5%BC%A0%E4%B8%89&page=1&page_size=50')
  assert.equal(requests[0].options.credentials, 'include')
})

test('商机团队从基础平台真实人员目录选择并展示姓名与组织', () => {
  assert.match(view, /const teamForm = reactive\(\{ members: \[\], reason: '' \}\)/)
  assert.match(view, /await listOwnerDirectory\(\{ keyword: teamDirectoryKeyword\.value\.trim\(\), page: 1, page_size: 50 \}\)/)
  assert.match(view, /不会退回为手填账号 ID/)
  assert.match(view, /platformUserName\(user\) \}\} · \{\{ teamMemberOrganizations\(user\) \}\}/)
  assert.match(view, /platformUserName\(member\)/)
  assert.match(view, /team\.directory_available !== false/)
  assert.match(view, /提交时服务端会再次校验人员状态/)
  assert.doesNotMatch(view, /teamForm\.members_text|platform-sub,TECHNICAL_SUPPORT/)
  assert.match(style, /\.crm-team-summary/)
})

test('商机补充信息使用统一滚动轨道，避免团队任期、附件和外部状态浮层重叠', () => {
  assert.match(view, /class="crm-opportunity-side-rail"/)
  assert.match(style, /\.crm-opportunity-side-rail\s*\{/)
  assert.match(style, /\.crm-opportunity-attachment-panel,[\s\S]*\.crm-opportunity-external-panel\s*\{[\s\S]*position:\s*static/)
  assert.match(style, /\.crm-opportunity-detail\s*\{[\s\S]*max-height:\s*calc\(100vh - 48px\)[\s\S]*overflow:\s*hidden/)
  assert.match(style, /\.crm-opportunity-main\s*\{[\s\S]*min-height:\s*0[\s\S]*overflow:\s*auto/)
  assert.match(style, /\.crm-opportunity-actions\s*\{[\s\S]*justify-content:\s*flex-start/)
  assert.match(style, /\.crm-opportunity-actions > button\s*\{[\s\S]*max-width:\s*100%[\s\S]*flex:\s*0 1 auto/)
})

test('售前预警仅使用当前基础平台用户身份', () => {
  assert.match(view, /个人预警仅合并当前登录用户的内部人员身份/)
  assert.match(view, /不随 SELF\/ORG\/ALL 数据范围扩大/)
})

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ code: 'OK', message: 'success', data }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('CRM 通用客户端保留 multipart boundary 并安全解析授权下载文件名', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (options.method === 'POST') return jsonResponse({ accepted: true })
    return new Response('row,column,code\n2,name,INVALID', {
      status: 200,
      headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="../../bad.csv"' },
    })
  }
  const form = new FormData()
  form.set('reason', '批量维护')
  form.set('file', new Blob(['xlsx']), 'customers.xlsx')
  await client.request('/customers/imports/preview', { method: 'POST', body: form })
  const downloaded = await client.requestBlob('/customers/imports/JOB-1/errors')
  assert.equal(requests[0].options.headers['Content-Type'], undefined)
  assert.equal(requests[0].options.headers['X-CSRF-Token'], '1')
  assert.equal(requests[1].options.credentials, 'include')
  assert.equal(downloaded.filename, 'customer-import-errors.csv')
  assert.equal(await downloaded.blob.text(), 'row,column,code\n2,name,INVALID')
})

test('CM-004 Portal 邀请调用真实路由、CSRF 与显式稳定幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (options.method === 'POST' && url.endsWith('/portal-invites')) return jsonResponse({ invite_no: 'PI-1', activation_url: 'https://portal.example/activate?token=once', status: 'PENDING' }, 201)
    if (options.method === 'POST') return jsonResponse({ invite_no: 'PI-1', status: 'REVOKED', version: 2 })
    return jsonResponse({ invite_no: 'PI-1', status: 'PENDING', version: 1 })
  }
  await customer.createPortalInvite(8, 'portal-invite-stable-key')
  await customer.getCurrentPortalInvite(8)
  await customer.getPortalAccessStatus(8)
  await customer.revokePortalInvite('PI-1', { reason: '联系人离职', version: 1 })
  await customer.disablePortalAccess(8, { reason: '终止客户访问' }, 'portal-disable-stable-key')
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/customers/8/portal-invites',
    '/customer-opportunity/api/v1/customers/8/portal-invites/current',
    '/customer-opportunity/api/v1/customers/8/portal-access',
    '/customer-opportunity/api/v1/portal-invites/PI-1/revoke',
    '/customer-opportunity/api/v1/customers/8/portal-access/disable',
  ])
  assert.equal(requests[0].options.headers['Idempotency-Key'], 'portal-invite-stable-key')
  assert.equal(requests[0].options.headers['X-CSRF-Token'], '1')
  assert.equal(requests[0].options.body, undefined)
  assert.equal(requests[1].options.method, undefined)
  assert.equal(requests[2].options.method, undefined)
  assert.deepEqual(JSON.parse(requests[3].options.body), { reason: '联系人离职', version: 1 })
  assert.equal(requests[3].options.headers['X-CSRF-Token'], '1')
  assert.equal(requests[4].options.headers['Idempotency-Key'], 'portal-disable-stable-key')
  assert.deepEqual(JSON.parse(requests[4].options.body), { reason: '终止客户访问' })
})

test('CM-004 门户禁用模糊失败按规范原因复用稳定幂等键', () => {
  let sequence = 0
  const state = createPortalAccessDisableRetryState(() => `disable-key-${++sequence}`)
  const first = state.keyFor(8, '  联系人离职  ')
  assert.equal(state.keyFor('8', '联系人离职').key, first.key)
  assert.notEqual(state.keyFor(8, '合同终止').key, first.key)
  state.confirmSuccess(first.signature, 'wrong-key')
  assert.equal(state.keyFor(8, '联系人离职').key, first.key)
  state.confirmSuccess(first.signature, first.key)
  assert.notEqual(state.keyFor(8, '联系人离职').key, first.key)
})

test('CM-004 模糊失败按客户和规范联系人复用键且仅确认成功后清理', () => {
  let sequence = 0
  const state = createPortalInviteRetryState(() => `portal-key-${++sequence}`)
  const contact = { id: 3, name: ' 张三 ', phone: ' 138****0000 ', email: ' USER@EXAMPLE.COM ', is_registration: true }
  const first = state.keyFor(8, contact)
  assert.equal(state.keyFor('8', { ...contact }).key, first.key)
  assert.notEqual(state.keyFor(8, { ...contact, id: 4 }).key, first.key)
  state.confirmSuccess(first.signature, 'wrong-key')
  assert.equal(state.keyFor(8, contact).key, first.key)
  state.confirmSuccess(first.signature, first.key)
  assert.notEqual(state.keyFor(8, contact).key, first.key)
  assert.deepEqual(first.command, { customer_id: 8, contact: { id: 3, name: '张三', phone: '138****0000', email: 'user@example.com', is_registration: true } })
})

test('CM-004 门户访问页签失败关闭且不展示本地密码', () => {
  assert.match(view, /portal_account\.provision/)
  assert.match(view, /portal_account\.revoke/)
  assert.match(view, /portal_account\.disable/)
  assert.match(view, /canReadPortalInvite = computed\(\(\) => canProvisionPortalAccount\.value \|\| canRevokePortalAccount\.value\)/)
  assert.match(view, /canReadPortalAccessStatus = computed\(\(\) => canProvisionPortalAccount\.value \|\| canDisablePortalAccount\.value\)/)
  assert.match(view, /canViewPortalAccess = computed\(\(\) => canReadPortalInvite\.value \|\| canReadPortalAccessStatus\.value\)/)
  assert.match(view, /portalModuleAvailable = computed\(\(\) => runtimeCapability\('portal_account_provision'\)\.available \|\| runtimeCapability\('portal_access_disable'\)\.available\)/)
  assert.match(view, /const inviteRequest = canReadPortalInvite\.value \? getCurrentPortalInvite\(customerID\) : Promise\.resolve\(null\)/)
  assert.match(view, /const accessRequest = canReadPortalAccessStatus\.value \? getPortalAccessStatus\(customerID\) : Promise\.resolve\(null\)/)
  assert.match(view, /v-if="canViewPortalAccess"/)
  assert.match(view, /历史状态仍可查看/)
  assert.match(view, /:disabled="!portalProvisionAvailable \|\| portalInviteLoading/)
  assert.match(view, /:disabled="!portalDisableAvailable \|\| portalAccessDisableLoading/)
  assert.match(view, /v-if="canProvisionPortalAccount && selectedCustomer\.status === 'ACTIVE' && canGeneratePortalInvite"/)
  assert.match(view, /openCustomerTab\('portal'\)/)
  assert.match(view, /portalInviteRetries\.keyFor\(selectedCustomer\.value\.id, contact\)/)
  assert.match(view, /portalInviteRetries\.confirmSuccess\(retry\.signature, retry\.key\)/)
  assert.match(view, /Provider 当前不可用（503）/)
  assert.match(view, /未展示虚假邀请/)
  assert.match(view, /链接只在本页面生命周期内显示/)
  assert.match(view, /CRM 不创建、展示或传递固定密码/)
  assert.match(view, /这不是“撤销邀请”/)
  assert.match(view, /window\.confirm\('确认禁用该客户的门户访问/)
  assert.match(view, /portalAccessDisableRetries\.keyFor\(customerID, reason\)/)
  assert.match(view, /自动恢复已达到上限/)
  assert.doesNotMatch(view, /11223344|portal-jwt|Portal JWT|初始密码/)
})

test('可选外部集成按服务端运行能力提前关闭且失败不影响核心查询', () => {
  assert.equal(typeof client.getCRMRuntimeCapabilities, 'function')
  assert.match(view, /runtimeCapabilities\.value = value\?\.capabilities \|\| \{\}/)
  assert.match(view, /相关操作已安全关闭，核心查询不受影响/)
  assert.match(view, /:disabled="!customerImportScanAvailable"/)
  assert.match(view, /:disabled="!customerExportAvailable"/)
  assert.match(view, /presaleRequestSubmissionAvailable = computed\(\(\) => runtimeCapability\('presale_request_submission'\)\.available\)/)
  assert.match(view, /售前内部流程当前不可用/)
  assert.match(view, /!opportunityAttachmentCapabilities\.value\?\.download_available/)
  assert.match(view, /!opportunityAttachmentCapabilities\?\.download_available/)
  assert.match(view, /qbActiveQueryMode === 'CALLBACK_ONLY'/)
  assert.match(view, /:disabled="!qbLaunchQuotationAvailable/)
  assert.match(view, /:disabled="!qbLaunchBidAvailable/)
})

test('客户与商机创建失败重试复用规范载荷键且仅成功后清理', async (t) => {
  let sequence = 0
  const state = createCreateMutationRetryState(() => `create-key-${++sequence}`)
  const customerPayload = {
    name: ' 客户甲 ', customer_type: ' 企业 ', industry: ' 软件 ', region: ' 华东 ',
    owner_user_id: ' owner-1 ', owner_org_id: '', contacts: [{ name: ' 张三 ', phone: ' 13800000000 ', email: '', is_registration: true }],
    duplicate_override: false, duplicate_override_reason: '', reason: ' 首次录入 ',
  }
  const firstCustomer = state.keyFor('customer', customerPayload)
  const retriedCustomer = state.keyFor('customer', structuredClone(customerPayload))
  assert.equal(retriedCustomer.key, firstCustomer.key)
  assert.equal(retriedCustomer.attempted, false)
  assert.deepEqual(firstCustomer.payload, normalizeCreateMutationPayload('customer', customerPayload))
  assert.equal('owner_user_id' in firstCustomer.payload, false)
  assert.equal('owner_org_id' in firstCustomer.payload, false)
  assert.equal(state.markAttempted('customer', firstCustomer.key), true)
  assert.equal(state.keyFor('customer', customerPayload).attempted, true)
  state.confirmSuccess('customer', firstCustomer.key)
  assert.notEqual(state.keyFor('customer', customerPayload).key, firstCustomer.key)

  const opportunityPayload = { name: ' 商机甲 ', customer_id: '7', type: ' 新建 ', source: ' 转介绍 ', expected_amount: '100.00', expected_sign_date: '2026-09-01', requirement_summary: ' 建设需求 ', system_count: '2', pain_points: '', competitor_info: '', owner_user_id: 'owner-1', owner_org_id: '' }
  const firstOpportunity = state.keyFor('opportunity', opportunityPayload)
  assert.equal(state.keyFor('opportunity', { ...opportunityPayload }).key, firstOpportunity.key)
  assert.notEqual(state.keyFor('opportunity', { ...opportunityPayload, expected_amount: '101.00' }).key, firstOpportunity.key)
  assert.equal('owner_user_id' in firstOpportunity.payload, false)
  assert.equal('owner_org_id' in firstOpportunity.payload, false)

  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return jsonResponse({ id: 1 }) }
  await customer.createCustomer(firstCustomer.payload, firstCustomer.key)
  await opportunity.createOpportunity(firstOpportunity.payload, firstOpportunity.key)
  assert.deepEqual(requests.map(({ options }) => options.headers['Idempotency-Key']), [firstCustomer.key, firstOpportunity.key])
  assert.match(view, /createMutationRetries\.keyFor\('customer', createPayload\)/)
  assert.match(view, /customerEditMode\.value \|\| !createRetry\.attempted/)
  assert.match(view, /createMutationRetries\.markAttempted\('customer', createRetry\.key\)/)
  assert.match(view, /createMutationRetries\.confirmSuccess\('customer', createRetry\.key\)/)
  assert.match(view, /createMutationRetries\.keyFor\('opportunity'/)
  assert.match(view, /createMutationRetries\.confirmSuccess\('opportunity', retry\.key\)/)
})

test('商机阶段使用后端真实中文枚举且明确无需审批', () => {
  for (const stage of ['初步接触', '需求沟通', '方案制定', '报价', '投标', '已签约', '失败']) {
    assert.match(view, new RegExp(`value="${stage}"`))
  }
  assert.match(view, /提交后立即生效，不发起审批/)
})

test('转合同仅确认 outbox 受理并在模糊失败时复用显式键', async (t) => {
  let sequence = 0
  const state = createContractTransferRetryState(() => `transfer-key-${++sequence}`)
  const first = state.keyFor(7, { version: 3, reason: ' 转合同 ' })
  assert.equal(state.keyFor(7, { version: 3, reason: '转合同' }).key, first.key)
  assert.notEqual(state.keyFor(7, { version: 4, reason: '转合同' }).key, first.key)

  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return jsonResponse({ event_id: 'event-1', delivery_status: 'PENDING' }) }
  await opportunity.transferOpportunityToContract(7, first.payload, first.key)
  assert.equal(requests[0].url, '/customer-opportunity/api/v1/opportunities/7/contract-transfer')
  assert.equal(requests[0].options.headers['Idempotency-Key'], first.key)
  assert.match(view, /opportunity\.contract\.transfer/)
  assert.match(view, /不代表合同已创建/)
})

test('商机外部状态只读取可信后端快照', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return jsonResponse({ opportunity_id: 7, latest: null }) }
  await opportunity.getOpportunityExternalStatus(7)
  assert.equal(requests[0].url, '/customer-opportunity/api/v1/opportunities/7/external-status')
  assert.match(view, /getOpportunityExternalStatus/)
  assert.doesNotMatch(view, /localStorage\['crm_opp_qb_status'\]/)
})

test('最新已通过报价金额不一致仅展示非阻断提示', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => jsonResponse({
    opportunity_id: 7,
    latest: { type: '报价', source_id: 'BJ-1', status: '报价已通过', source_amount: '101.00', changed_at: '2026-08-01T08:00:00Z' },
    quote_amount_check: { status: 'MISMATCH', warning: true, opportunity_version: 3, expected_amount: '100.00', approved_quote_amount: '101.00', approved_quote_source_id: 'BJ-1' },
  })
  const result = await opportunity.getOpportunityExternalStatus(7)
  assert.equal(result.quote_amount_check.status, 'MISMATCH')
  assert.match(view, /opportunityQuoteAmountCheck\.value = result\?\.quote_amount_check \|\| null/)
  assert.match(view, /opportunityQuoteAmountCheck\?\.status === 'MISMATCH'/)
  assert.match(view, /opportunityQuoteAmountCheck\.opportunity_version === selectedOpportunity\.version/)
  assert.match(view, /本提示不阻断保存、签单或转合同/)
  assert.match(view, /签单前金额提示/)
  assert.match(view, /仍可继续签单/)
  assert.match(view, /opportunity_version === selectedOpportunity\?\.version/)
  assert.match(view, /APPROVED_QUOTE_AMOUNT_MISSING/)
})

test('报价和投标调起只使用服务端签发 context 与固定 API', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return jsonResponse({ type: '报价', launch_url: 'https://qb.example/quotation', context: 'v1.payload.signature', expires_at: '2026-08-01T00:02:00Z' }) }
  await opportunity.createQuotationLaunch(7)
  await opportunity.createBidLaunch(7)
  assert.deepEqual(requests.map(({ url }) => url), [
    '/customer-opportunity/api/v1/opportunities/7/launch/quotation',
    '/customer-opportunity/api/v1/opportunities/7/launch/bid',
  ])
  assert.equal(requests.every(({ options }) => options.method === 'POST'), true)
  assert.match(view, /window\.open\(target\.toString\(\), '_blank', 'noopener,noreferrer'\)/)
  assert.doesNotMatch(view, /launchOpportunityExternal\([^)]*,\s*url/)
})

test('商机附件只展示后端扫描状态并在能力未配置时失败关闭', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return jsonResponse(url.endsWith('/attachment-capabilities') ? { upload_available:false, download_available:false, scanner_available:false, max_size_bytes:20971520, allowed_mime_types:[] } : []) }
  await opportunity.getOpportunityAttachmentCapabilities(7)
  await opportunity.listOpportunityAttachments(7)
  assert.deepEqual(requests.map(({ url }) => url), ['/customer-opportunity/api/v1/opportunities/7/attachment-capabilities', '/customer-opportunity/api/v1/opportunities/7/attachments'])
  assert.match(view, /opportunity\.attachment\.read/)
  assert.match(view, /upload_available/)
  assert.match(view, /扫描通过前不能下载/)
  assert.match(view, /item\.scan_status !== 'CLEAN'/)
	assert.match(view, /flow\.session\.upload_mode === 'INTERNAL'/)
	assert.match(view, /uploadOpportunityAttachmentContent\(opportunityID, flow\.session\.attachment\.id, file\)/)
  assert.doesNotMatch(view, /FileReader/)
})

test('商机附件模糊失败在页面内保留 create 与 complete 键', () => {
  let sequence = 0
  const state = createAttachmentUploadRetryState(() => `attachment-key-${++sequence}`)
  const payload = { file_name: ' proof.PDF ', size_bytes: '4', mime_type: 'APPLICATION/PDF', sha256: 'AA' }
  const first = state.flowFor(7, payload)
  assert.equal(state.flowFor(7, { file_name: 'proof.PDF', size_bytes: 4, mime_type: 'application/pdf', sha256: 'aa' }).createKey, first.createKey)
  assert.notEqual(state.flowFor(7, { ...payload, size_bytes: 5 }).createKey, first.createKey)
  state.confirmCreate(first, { attachment: { id: 'A-1', version: 1 }, upload_url: 'https://objects.example/upload' })
  const completeKey = first.completeKey
  state.markUploaded(first)
  assert.equal(state.flowFor(7, payload).completeKey, completeKey)
  assert.equal(state.flowFor(7, payload).uploaded, true)
  state.confirmComplete(first)
  assert.notEqual(state.flowFor(7, payload).createKey, first.createKey)
  assert.match(view, /attachmentUploadRetries\.flowFor\(opportunityID, payload\)/)
  assert.match(view, /flow\.completeKey/)
  assert.doesNotMatch(view, /localStorage.*attachment/i)
})

test('商机团队任期使用独立受控分页且不伪造迁移前历史', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return jsonResponse({ items: [], page: 2, page_size: 10, total: 11 }) }
  await opportunity.listOpportunityMemberTerms(7, { page: 2, page_size: 10, active_only: false, user_id: 'sub/a' })
  assert.equal(requests[0].url, '/customer-opportunity/api/v1/opportunities/7/member-terms?page=2&page_size=10&active_only=false&user_id=sub%2Fa')
  assert.match(view, /listOpportunityMemberTerms/)
  assert.match(view, /LEGACY_SNAPSHOT/)
  assert.match(view, /不推测更早历史/)
  assert.match(view, /opportunityMemberTermsPage\.total/)
  assert.match(view, /加入和移出时间未知/)
  assert.match(view, /active_at_snapshot/)
})

test('商机团队任期切换时新请求不被旧 loading 锁住且旧响应不可覆盖', () => {
  const state = createMemberTermLoadState()
  const requestA = state.begin(7)
  const requestB = state.begin(8)
  assert.equal(state.isCurrent(requestA, 7), false)
  assert.equal(state.isCurrent(requestA, 8), false)
  assert.equal(state.isCurrent(requestB, 8), true)
  assert.match(view, /const loadToken = opportunityMemberTermLoads\.begin\(opportunityID\)/)
  assert.doesNotMatch(view, /if \(!opportunityID \|\| opportunityMemberTermsLoading\.value\) return/)
})

test('售前多人指派使用内部人员目录，工时支持 PERSON_DAY', () => {
  assert.match(view, /const person = byID\.get\(personID\) \|\| current\.get\(personID\)/)
  assert.doesNotMatch(view, /department_id: item\.organizations\?\.find\(\(org\) => org\.is_primary\)\?\.organization_id/)
  assert.doesNotMatch(view, /targets\.some\(\(target\) => !target\.department_id\)/)
  assert.match(view, /person_name: person\?\.person_name \|\| '未命名用户'/)
  assert.match(view, /department: person\?\.department \|\| ''/)
  assert.match(view, /value="PERSON_DAY">人天（1 人天 = 8 小时）/)
  assert.match(view, /所有当前执行人各有至少一笔有效工时后自动完成/)
})

test('界面已接入客户生命周期、商机看板/跟进/历史/终态待办和售前查询', () => {
  assert.match(view, /updateCustomer/)
  assert.match(view, /voidCustomer/)
  assert.match(view, /restoreCustomer/)
  assert.match(view, /createCustomerFollowup/)
  assert.match(view, /getOpportunityBoard/)
  assert.match(view, /getOpportunityStageHistory/)
  assert.match(view, /createOpportunityFollowup/)
  assert.match(view, /completeOpportunityTerminalTodo/)
  assert.match(view, /updateOpportunity/)
  assert.match(view, /voidOpportunity/)
  assert.match(view, /restoreOpportunity/)
  assert.match(view, /listPresaleRequests/)
  assert.match(view, /getPresaleRequest/)
  assert.match(view, /listWorklogs/)
	assert.match(view, /submitApprovalAction/)
	assert.match(view, /审批操作在客户与商机系统内/)
  assert.match(view, /cancelPresaleRequest/)
  assert.doesNotMatch(view, /后端暂未提供申请列表与详情/)
})

test('商机阶段看板按推进程度设置独立背景色且不影响售前看板', () => {
  assert.match(view, /class="crm-board crm-opportunity-board"/)
  assert.match(view, /:data-stage="column\.stage"/)
  for (const stage of ['初步接触', '需求沟通', '方案制定', '报价', '投标', '已签约', '失败']) {
    assert.match(style, new RegExp(`\\.crm-opportunity-board \\.crm-board-column\\[data-stage='${stage}'\\]`))
  }
  assert.match(style, /\.crm-opportunity-board \.crm-board-column\s*\{[\s\S]*background:\s*linear-gradient/)
})

test('售前状态看板按流程状态设置独立背景色', () => {
  assert.match(view, /class="crm-board crm-presale-board"/)
  assert.match(view, /:data-status="column\.status"/)
  for (const status of ['APPROVAL_STARTING', 'PENDING_APPROVAL', 'APPROVED_PENDING_ASSIGNMENT', 'EXECUTING', 'COMPLETED', 'REJECTED', 'CANCELLED']) {
    assert.match(style, new RegExp(`\\.crm-presale-board \\.crm-board-column\\[data-status='${status}'\\]`))
  }
  assert.match(style, /\.crm-presale-board \.crm-board-column\s*\{[\s\S]*background:\s*linear-gradient/)
})

test('客户卡片视图按客户状态设置独立背景色', () => {
  assert.match(view, /class="crm-customer-cards"/)
  assert.match(view, /:data-status="item\.status"/)
  for (const status of ['ACTIVE', 'VOID', 'MERGED']) {
    assert.match(style, new RegExp(`\\.crm-customer-cards > button\\[data-status='${status}'\\]`))
  }
  assert.match(style, /\.crm-customer-cards > button\s*\{[\s\S]*background:\s*linear-gradient/)
})

test('客户成交与待跟进快捷筛选使用不同卡片背景色', () => {
  assert.match(view, /:data-quick-filter="customerFilters\.quick_filter"/)
  assert.match(style, /\.crm-customer-cards\[data-quick-filter='WON'\] > button\[data-status='ACTIVE'\]/)
  assert.match(style, /\.crm-customer-cards\[data-quick-filter='FOLLOWUP_DUE'\] > button\[data-status='ACTIVE'\]/)
  assert.match(style, /data-quick-filter='WON'[\s\S]*--crm-customer-card-surface:\s*#ecfdf5/)
  assert.match(style, /data-quick-filter='FOLLOWUP_DUE'[\s\S]*--crm-customer-card-surface:\s*#fef3c7/)
})

test('客户表单支持删除联系人且始终至少保留一个登记联系人', () => {
  assert.match(view, /@click="removeCustomerContact\(index\)">删除联系人<\/button>/)
  assert.match(view, /:disabled="customerForm\.contacts\.length <= 1"/)
  assert.match(view, /function removeCustomerContact\(index\)[\s\S]*customerForm\.contacts\.splice\(index, 1\)/)
  assert.match(view, /removed\?\.is_registration[\s\S]*customerForm\.contacts\[0\]\.is_registration = true/)
  assert.match(style, /\.crm-customer-contact-heading/)
})

test('客户新建表单的行业使用受控下拉菜单并兼容历史值', () => {
  for (const industry of ['金融', '政府', '医疗', '教育', '能源', '制造', '软件', '互联网', '通信', '物流', '交通', '建筑', '房地产', '零售', '服务', '其他']) {
    assert.match(view, new RegExp(`'${industry}'`))
  }
  assert.match(view, /<span>行业 \*<\/span><select v-model="customerForm\.industry" required>/)
  assert.match(view, /<option value="" disabled>请选择行业<\/option>/)
  assert.match(view, /!customerIndustryOptions\.includes\(customerForm\.industry\)[^>]*>\{\{ customerForm\.industry \}\}（历史值）/)
  assert.doesNotMatch(view, /<span>行业 \*<\/span><input v-model="customerForm\.industry"/)
})

test('新建商机从客户管理加载可见有效客户且不允许手填客户 ID', async (t) => {
  assert.match(view, /await listCustomers\(\{[\s\S]*status: 'ACTIVE',[\s\S]*page_size: 100/)
  assert.match(view, /v-model="opportunityForm\.customer_id" required[^>]*><option value="" disabled>/)
  assert.match(view, /v-for="customer in opportunityCustomerOptions"[^>]*:value="String\(customer\.id\)"/)
  assert.match(view, /请先在客户管理中创建客户/)
  assert.doesNotMatch(view, /<span>客户 ID \*<\/span><input v-model="opportunityForm\.customer_id"/)

  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return jsonResponse({ items: [], total: 0 }) }
  await customer.listCustomers({ keyword: '示例客户', status: 'ACTIVE', page: 1, page_size: 100, sort_by: 'name', sort_order: 'asc' })
  assert.equal(requests[0].url, '/customer-opportunity/api/v1/customers?keyword=%E7%A4%BA%E4%BE%8B%E5%AE%A2%E6%88%B7&status=ACTIVE&page=1&page_size=100&sort_by=name&sort_order=asc')
})

test('新建商机类型和来源使用受控勾选多选', () => {
  assert.match(view, /const opportunityTypeOptions = Object\.freeze\(/)
  assert.match(view, /const opportunitySourceOptions = Object\.freeze\(/)
  assert.match(view, /v-model="opportunityTypeSelections" type="checkbox"/)
  assert.match(view, /v-model="opportunitySourceSelections" type="checkbox"/)
  assert.match(view, /crm-opportunity-check-list/)
  assert.match(view, /请至少选择一个商机类型和一个来源。/)
  for (const value of ['等保审查', '密码应用安全性评估', '网络安全攻防演内容', '安全运维', '客户主动咨询', '公开招标', '内部转介']) {
    assert.match(view, new RegExp(value))
  }
})

test('客户沟通与商机维护调用实际生命周期路由并携带 CSRF', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ id: 23, version: 8 })
  }

  await customer.createCustomerFollowup(23, { type: 'PHONE', content: '沟通', followed_at: '2026-08-01T00:00:00Z' })
  await opportunity.updateOpportunity(23, { name: '商机', expected_amount: '10', expected_sign_date: '2026-08-02', version: 7, reason: '更新' })
  await opportunity.voidOpportunity(23, { version: 8, reason: '作废' })

  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/customers/23/followups',
    '/customer-opportunity/api/v1/opportunities/23',
    '/customer-opportunity/api/v1/opportunities/23/void',
  ])
  assert.deepEqual(requests.map((item) => item.options.method), ['POST', 'PUT', 'POST'])
  assert.ok(requests.every((item) => item.options.headers['X-CSRF-Token'] === '1'))
})

test('客户作废与商机终态待办使用实际路由和版本载荷', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ id: 12, version: 4 })
  }

  await customer.voidCustomer(12, { version: 3, reason: '测试' })
  await opportunity.completeOpportunityTerminalTodo(12, { version: 3, reason: '补全', lost_reason: '其他' })
  assert.equal(requests[0].url, '/customer-opportunity/api/v1/customers/12/void')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.headers['X-CSRF-Token'], '1')
  assert.equal(JSON.parse(requests[0].options.body).version, 3)
  assert.equal(requests[1].url, '/customer-opportunity/api/v1/opportunities/12/terminal-todo')
  assert.equal(requests[1].options.method, 'PUT')
  assert.equal(requests[1].options.headers['X-CSRF-Token'], '1')
})

test('客户合并向导公开不可逆和跨库安全阻断边界', () => {
  assert.match(view, /openCustomerMerge/)
  assert.match(view, /目标客户作为存续主档/)
  assert.match(view, /存在 Portal 身份映射、待补偿的外部开通任务或已关联合同商机时会安全阻断/)
  assert.match(view, /本期不支持反合并/)
})

test('CM-002 组合筛选、URL 状态、卡片视图和按需页签已接入真实接口', () => {
  assert.match(view, /customerFiltersFromQuery\(route\.query\)/)
  assert.match(view, /customerFiltersToQuery\(customerFilters/)
  assert.match(view, /customerAPIParams\(customerFilters/)
  assert.match(view, /新增客户（近 30 天）/)
  assert.doesNotMatch(view, /重点客户（待配置）/)
  assert.doesNotMatch(view, /高价值客户/)
  assert.match(view, /customerFilters\.view === 'table'/)
  for (const tab of ['contacts', 'opportunities', 'projects', 'followups', 'audit']) assert.match(view, new RegExp(`openCustomerTab\\('${tab}'\\)`))
  assert.match(view, /customer\.audit\.read/)
  assert.match(view, /canCreateCustomer/)
  assert.match(view, /canExportCustomers/)
  assert.match(view, /item\.operation/)
  assert.match(view, /item\.actor_id/)
  assert.doesNotMatch(view, /暂无字段变更日志/)
})

test('CM-002 项目历史明确展示 Portal 同步快照及新鲜度边界', () => {
  assert.match(view, /不代表项目上游实时状态/)
  for (const field of ['project_name', 'contract_no', 'current_stage', 'progress_pct', 'expected_end_date', 'delayed', 'source_updated_at', 'synced_at', 'stale']) {
    assert.match(view, new RegExp(`item\\.${field}`))
  }
  assert.match(view, /同步链路可能已过期/)
  assert.match(view, /同步链路有效期内/)
  assert.match(view, /item\.sync_last_success_at/)
  assert.match(view, /loadCustomerProjectPage\(customerProjectsPage\.number \+ 1\)/)
  assert.match(view, /customerProjectsPage\.total/)
  assert.match(view, /customerProjectLoadSequence/)
})

test('CM-002 Tab 和失败关闭导出调用真实路由', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/customer-exports')) return new Response('客户编号,客户名称\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="customers.csv"' } })
    return jsonResponse({ items: [] })
  }
  await customer.listCustomerContacts(8)
  await customer.listCustomerOpportunities(8, { page: 1, page_size: 50 })
  await customer.listCustomerProjects(8, { page: 2, page_size: 20 })
  await customer.listCustomerAuditLogs(8, { page: 1 })
  await customer.requestCustomerExport({ filters: { status: 'ACTIVE' } })
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/customers/8/contacts',
    '/customer-opportunity/api/v1/customers/8/opportunities?page=1&page_size=50',
    '/customer-opportunity/api/v1/customers/8/projects?page=2&page_size=20',
    '/customer-opportunity/api/v1/customers/8/audit-logs?page=1',
    '/customer-opportunity/api/v1/customer-exports',
  ])
  assert.equal(requests[4].options.method, 'POST')
  assert.equal(requests[4].options.headers['X-CSRF-Token'], '1')
})

test('CM-001 关键干系人和信息系统按需页签、权限门禁且不混淆等保与信用评级', () => {
  assert.match(view, /openCustomerTab\('stakeholders'\)/)
  assert.match(view, /openCustomerTab\('systems'\)/)
  assert.match(view, /listCustomerStakeholders/)
  assert.match(view, /listCustomerSystems/)
  assert.match(view, /canUpdateCustomer && selectedCustomer\.status === 'ACTIVE'/)
  assert.match(view, /保护等级指网络安全等级保护定级，与客户信用评级无关/)
  assert.match(view, /等保等级/)
  // 客户信用等级现已由独立 CM-003 面板提供；此处只保护“信息系统等保等级”文案不被误用。
  assert.match(view, /CustomerCreditPanel/)
  assert.doesNotMatch(view, /v-html/)
})

test('CM-001 干系人和信息系统调用真实全量路由并携带版本、CSRF 与幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse({ customer_version: 9, items: [] })
  }
  await customer.listCustomerStakeholders(8)
  await customer.replaceCustomerStakeholders(8, { version: 7, reason: '调整干系人', items: [{ id: 4, name: '张三', role_title: '负责人', influence: 'HIGH', relationship_summary: '决策人' }] })
  await customer.listCustomerSystems(8)
  await customer.replaceCustomerSystems(8, { version: 8, reason: '调整系统', items: [{ name: '生产系统', protection_level: 'LEVEL_3', application_scenario: '交易', filing_no: '', grading_date: null, filing_status: 'NOT_FILED' }] })
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/customers/8/stakeholders',
    '/customer-opportunity/api/v1/customers/8/stakeholders',
    '/customer-opportunity/api/v1/customers/8/systems',
    '/customer-opportunity/api/v1/customers/8/systems',
  ])
  assert.deepEqual(requests.map((item) => item.options.method || 'GET'), ['GET', 'PUT', 'GET', 'PUT'])
  assert.ok(requests[1].options.headers['X-CSRF-Token'])
  assert.ok(requests[1].options.headers['Idempotency-Key'])
  assert.ok(requests[3].options.headers['X-CSRF-Token'])
  assert.ok(requests[3].options.headers['Idempotency-Key'])
})

test('CM-001 敏感联系方式不回填脱敏值且集合更新刷新客户版本', () => {
  assert.match(view, /phone: '', email: '', replace_phone: false, replace_email: false/)
  assert.match(view, /if \(!item\.id \|\| item\.replace_phone\) payload\.phone = item\.phone/)
  assert.match(view, /if \(!item\.id \|\| item\.replace_email\) payload\.email = item\.email/)
  assert.match(view, /version: Number\(selectedCustomer\.value\.version\)/)
  assert.match(view, /version: result\.customer_version/)
  assert.match(view, /grading_date: item\.grading_date \|\| null/)
  assert.match(view, /数据状态或版本已变化，请刷新详情后重试/)
})

test('CM-001 Excel 导入权限、三阶段和失败关闭语义已接入', () => {
  assert.match(view, /customer\.import/)
  assert.match(view, /v-if="canImportCustomers"[^>]*@click="openCustomerImport"/)
  assert.match(view, /服务端先执行病毒扫描/)
  assert.match(view, /浏览器不会读取 Excel 内容，也不会保存文件或敏感字段/)
  for (const field of ['total_rows', 'importable_rows', 'warning_rows', 'error_rows', 'succeeded_rows', 'failed_rows', 'skipped_rows']) assert.match(view, new RegExp(field))
  assert.match(view, /Number\(customerImportPreview\.importable_rows\) === 0/)
  assert.match(view, /CRM_CUSTOMER_IMPORT_SCANNER_UNAVAILABLE/)
  assert.match(view, /预检已过期或状态发生变化，请重新上传文件预检/)
  assert.match(view, /URL\.createObjectURL\(blob\)/)
  assert.match(view, /URL\.revokeObjectURL\(objectURL\)/)
  assert.doesNotMatch(view, /FileReader|readAsArrayBuffer|xlsx\.read|localStorage|sessionStorage|v-html/)
})

test('CM-001 Excel 导入 API 严格使用真实 multipart、版本提交和 CSV 路由', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/errors')) return new Response('row,status\n2,ERROR', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="customer-import-JOB-1-errors.csv"' } })
    return jsonResponse(url.endsWith('/commit') ? { job_no: 'JOB-1', status: 'COMPLETED', version: 2, rows: [] } : { job_no: 'JOB-1', status: 'PREVIEWED', version: 1, rows: [] }, url.endsWith('/preview') ? 201 : 200)
  }
  const file = new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await customer.previewCustomerImport({ file, reason: '批量录入' })
  await customer.commitCustomerImport('JOB-1', { version: 1 })
  const errors = await customer.downloadCustomerImportErrors('JOB-1')
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/customers/imports/preview',
    '/customer-opportunity/api/v1/customers/imports/JOB-1/commit',
    '/customer-opportunity/api/v1/customers/imports/JOB-1/errors',
  ])
  assert.ok(requests[0].options.body instanceof FormData)
  assert.equal(requests[0].options.body.get('reason'), '批量录入')
  assert.equal(requests[0].options.headers['Content-Type'], undefined)
  assert.equal(requests[0].options.headers['X-CSRF-Token'], '1')
  assert.deepEqual(JSON.parse(requests[1].options.body), { version: 1 })
  assert.ok(requests[1].options.headers['Idempotency-Key'])
  assert.equal(errors.filename, 'customer-import-JOB-1-errors.csv')
})

test('客户合并调用真实路由并携带版本、原因和幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return jsonResponse({ source_customer_id: 1, target_customer_id: 2, source_status: 'MERGED' })
  }
  await customer.mergeCustomers({ source_customer_id: 1, target_customer_id: 2, source_version: 3, target_version: 5, reason: '重复主档' })
  assert.equal(request.url, '/customer-opportunity/api/v1/customers/merge')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.headers['X-CSRF-Token'], '1')
  assert.ok(request.options.headers['Idempotency-Key'])
  assert.deepEqual(JSON.parse(request.options.body), { source_customer_id: 1, target_customer_id: 2, source_version: 3, target_version: 5, reason: '重复主档' })
})

test('售前列表、详情与工时查询不再依赖手工 ID 操作台', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const urls = []
  globalThis.fetch = async (url) => { urls.push(url); return jsonResponse({ items: [] }) }
  await api.listPresaleRequests({ status: 'EXECUTING', page: 1 })
  await api.getPresaleRequest(7)
  await api.listWorklogs(7)
  assert.deepEqual(urls, [
    '/customer-opportunity/api/v1/presale/requests?status=EXECUTING&page=1',
    '/customer-opportunity/api/v1/presale/requests/7',
    '/customer-opportunity/api/v1/presale/requests/7/worklogs',
  ])
})

test('售前列表与状态看板展示商机名称并保留商机编号', () => {
  assert.match(view, /function presaleOpportunityLabel\(item\)[\s\S]*opportunity_name/)
  assert.match(view, /function presaleRequestID\(item\)[\s\S]*request_id/)
  assert.match(view, /<td>\{\{ presaleOpportunityLabel\(item\) \}\}<\/td>/)
  assert.match(view, /<span>\{\{ presaleOpportunityLabel\(item\) \}\}<\/span>/)
  assert.match(view, /class="crm-board-card"[^>]*@click="openPresale\(presaleRequestID\(item\)\)"/)
})

test('TS-001 售前列表通过受控按钮进入独立创建视图并在取消或成功后返回列表', () => {
  assert.match(view, /const presaleCreatePage = ref\(false\)/)
  assert.match(view, /v-if="canCreatePresale && presaleRequestSubmissionAvailable"[^>]*@click="openPresaleCreatePage"[^>]*>新建申请<\/button>/)
  assert.match(view, /v-if="activeSection === 'presale' && !presaleCreatePage"/)
  assert.match(view, /v-if="activeSection === 'presale' && presaleCreatePage"[\s\S]*@submit\.prevent="submitPresaleFromList"/)
  assert.match(view, /v-if="activeSection === 'presale' && presaleCreatePage"[\s\S]*@click="closePresaleCreatePage">取消<\/button>/)
  assert.doesNotMatch(view, /<section v-if="activeSection === 'presale'" class="crm-grid"><form class="crm-panel" @submit\.prevent="submitPresale">/)
  assert.match(view, /function openPresaleCreatePage\(\)[\s\S]*presaleCreatePage\.value = true/)
  assert.match(view, /function closePresaleCreatePage\(\)[\s\S]*presaleCreatePage\.value = false/)
  assert.match(view, /async function submitPresaleFromList\(\)[\s\S]*await submitPresale\([\s\S]*closePresaleCreatePage\(\)[\s\S]*await loadCurrent\(\)/)
})

test('驳回或取消的售前重新审批后刷新列表和状态看板', () => {
	assert.match(view, /reopenPresaleRequest\(presaleReopenRequest\.value\.id, presaleReopenRequest\.value\.version, \{/)
	assert.match(view, /presaleReopenRequest\.value = \{ id: request\.id, version: request\.version/)
	assert.match(view, /const reopened = await reopenPresaleRequest\([\s\S]*contact_phone: presaleForm\.contact_phone[\s\S]*expected_start: expectedStart\.toISOString\(\)[\s\S]*await loadCurrent\(\)[\s\S]*await openPresale\(reopened\.id\)/)
})

test('客户最近跟进明确包含商机记录且商机历史可进入详情', () => {
  assert.match(view, /最近跟进（含商机）/)
  assert.match(view, /v-for="item in customerOpportunities"[^>]*role="button"[^>]*@click="openOpportunity\(item\.id\)"/)
  assert.match(view, /@keydown\.enter\.prevent="openOpportunity\(item\.id\)"/)
  assert.doesNotMatch(view, /负责人 ID<input/)
  assert.doesNotMatch(view, /回退为手动输入用户 ID/)
})

test('TS-007 列表、只读状态看板和服务端可见筛选项调用真实路由', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(url)
    if (url.includes('/board')) return jsonResponse({ columns: [], column_limit: 20 })
    return jsonResponse({ statuses: [], applicants: [], assignees: [] })
  }
  await api.getPresaleBoard({ status: 'EXECUTING', overdue: true, column_limit: 20 })
  await api.getPresaleFilterOptions({ opportunity_id: 9, venue: 'REMOTE' })
  assert.deepEqual(urls, [
    '/customer-opportunity/api/v1/presale/board?status=EXECUTING&overdue=true&column_limit=20',
    '/customer-opportunity/api/v1/presale/filter-options?opportunity_id=9&venue=REMOTE',
  ])
})

test('TS-007 URL 状态可复现且不会向后端发送授权 scope', () => {
  const restored = presaleStateFromQuery({
    request_no: 'TS-1', status: 'EXECUTING', venue: 'REMOTE', urgency: 'URGENT', overdue: 'true',
    push_status: 'RETRY_WAIT', presale_view: 'board', page: '3', page_size: '50', column_limit: '40', scope: 'all',
  })
  assert.equal(restored.view, 'board')
  assert.equal(restored.page, 3)
  assert.equal(restored.columnLimit, 40)
  assert.equal(restored.filters.status, 'EXECUTING')
  const query = presaleStateToQuery(restored.filters, restored.view, restored.page, restored.pageSize, restored.columnLimit)
  assert.equal(query.scope, undefined)
  assert.equal(query.presale_view, 'board')
  assert.equal(query.column_limit, '40')
  const params = presaleAPIParams({ ...restored.filters, created_from: '2026-08-01T08:00' })
  assert.match(params.created_from, /^2026-08-01T/)
  assert.equal(params.scope, undefined)
})

test('TS-007 前端仅消费服务端筛选选项并展示看板 total 与截断语义', () => {
  assert.match(view, /getPresaleFilterOptions\(params\)/)
  assert.match(view, /presaleFilterOptions\.opportunities/)
  assert.match(view, /已清空选项且不会展示未授权人员或商机/)
  assert.match(view, /column\.total/)
  assert.match(view, /另有 \{\{ Number\(column\.total\) - \(column\.items\?\.length \|\| 0\) \}\} 条未在本列展示/)
  assert.match(view, /只读看板，不支持拖拽改状态/)
  assert.doesNotMatch(view, /draggable|@drop|scope=all/)
})

test('TS-007 列表与看板请求使用序列号阻止过期响应覆盖新视图', () => {
  assert.match(view, /const currentLoadSequence = ref\(0\)/)
  assert.match(view, /const sequence = \+\+currentLoadSequence\.value/)
  assert.match(view, /sequence !== currentLoadSequence\.value \|\| activeSection\.value !== section/)
  assert.match(view, /if \(sequence === currentLoadSequence\.value\) loading\.value = false/)
})

test('售前 API 使用真实路由并允许创建重试复用幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return jsonResponse({ id: 21, version: 1 })
  }

  const result = await api.createPresaleRequest({ opportunity_id: 9 }, 'presale-create-key')
  assert.equal(result.id, 21)
  assert.equal(request.url, '/customer-opportunity/api/v1/presale/requests')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.headers['Idempotency-Key'], 'presale-create-key')
})

test('TS-002/003/004 写 API 允许调用方显式复用幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse({ accepted: true })
  }

  await api.submitApprovalAction(7, { action: 'PASS', comment: '', version: 3 }, 'approval-retry-key')
  await api.replaceAssignments(7, { assignees: [{ person_id: 'p-1', role: 'project_manager' }], change_reason: '调整', version: 3 }, 'assignment-retry-key')
  await api.cancelPresaleRequest(7, { reason: '需求取消', version: 3 }, 'cancel-retry-key')

  assert.deepEqual(requests.map((item) => item.options.headers['Idempotency-Key']), [
    'approval-retry-key',
    'assignment-retry-key',
    'cancel-retry-key',
  ])
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/presale/requests/7/approval-actions',
    '/customer-opportunity/api/v1/presale/requests/7/assignments',
    '/customer-opportunity/api/v1/presale/requests/7/cancel',
  ])
})

test('TS-005 工时 API 使用调用方显式幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let request
  globalThis.fetch = async (url, options = {}) => {
    request = { url, options }
    return jsonResponse({ id: 27, worklog_no: 'WL202608010001' })
  }

  await api.addWorklog(7, { raw_value: '1.00' }, 'worklog-retry-key')
  assert.equal(request.url, '/customer-opportunity/api/v1/presale/requests/7/worklogs')
  assert.equal(request.options.headers['Idempotency-Key'], 'worklog-retry-key')
})

test('TS-002/003/004 失败重试键绑定任务与规范化载荷且仅成功后清理', () => {
  let keySequence = 0
  const retries = createPresaleMutationRetryState(() => `retry-${++keySequence}`)
  const first = retries.keyFor('assignment', 8, {
    assignees: [{ person_id: ' p-2 ', role: 'project_manager' }, { person_id: 'p-1', role: 'implementation_engineer' }],
    change_reason: ' 轮换 ',
    version: 4,
  })
  const same = retries.keyFor('assignment', 8, {
    assignees: [{ person_id: 'p-1', role: 'implementation_engineer' }, { person_id: 'p-2', role: 'project_manager' }],
    change_reason: '轮换',
    version: 4,
  })
  assert.equal(same.key, first.key)
  assert.deepEqual(same.payload.assignees.map((item) => item.person_id), ['p-1', 'p-2'])

  const changedPayload = retries.keyFor('assignment', 8, { ...same.payload, change_reason: '新增人员' })
  const changedTask = retries.keyFor('assignment', 9, same.payload)
  assert.notEqual(changedPayload.key, first.key)
  assert.notEqual(changedTask.key, changedPayload.key)
  assert.equal(retries.keyFor('assignment', 8, same.payload).key, first.key)
  assert.equal(retries.keyFor('assignment', 8, { ...same.payload, change_reason: '新增人员' }).key, changedPayload.key)

  retries.confirmSuccess('assignment', 8, changedTask.key)
  assert.equal(retries.keyFor('assignment', 9, same.payload).key, changedTask.key)
  retries.confirmSuccess('assignment', 9, changedTask.key)
  assert.notEqual(retries.keyFor('assignment', 9, same.payload).key, changedTask.key)

  const approval = retries.keyFor('approval', 9, { action: ' pass ', comment: ' 同意 ', version: 5 })
  const cancellation = retries.keyFor('cancel', 9, { reason: ' 取消 ', version: 5 })
  assert.deepEqual(approval.payload, { action: 'PASS', comment: '同意', version: 5 })
  assert.deepEqual(cancellation.payload, { reason: '取消', version: 5 })
  assert.notEqual(approval.key, cancellation.key)

  retries.confirmSuccess('approval', 9, approval.key)
  assert.notEqual(retries.keyFor('approval', 9, approval.payload).key, approval.key)
})

test('TS-001 创建申请对同一规范载荷复用键且仅成功后清理', () => {
  let keySequence = 0
  const retries = createPresaleMutationRetryState(() => `create-${++keySequence}`)
  const payload = {
    opportunity_id: '9', venue: ' remote ', service_address: ' ', contact_name: ' 张三 ',
    contact_phone: ' 13800138000 ', description: ' 售前需求说明 ',
    expected_start: '2026-08-01T08:00', expected_end: '2026-08-01T09:00', urgency: ' normal ',
  }
  const first = retries.keyFor('create', payload.opportunity_id, payload)
  const same = retries.keyFor('create', 9, { ...payload, opportunity_id: 9, contact_name: '张三' })
  assert.equal(same.key, first.key)
  assert.equal(first.payload.expected_start, new Date(payload.expected_start).toISOString())
  const changed = retries.keyFor('create', 9, { ...payload, description: '另一项售前需求' })
  assert.notEqual(changed.key, first.key)
  assert.equal(retries.keyFor('create', 9, payload).key, first.key)
  retries.confirmSuccess('create', 9, first.key)
  assert.notEqual(retries.keyFor('create', 9, payload).key, first.key)
})

test('TS-001 联系电话仅通过显式无缓存调用按需查看', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let sent
  globalThis.fetch = async (url, options = {}) => {
    sent = { url, options }
    return jsonResponse({ request_id: 7, contact_phone: '13800138000' })
  }
  const result = await api.getPresaleContactPhone(7)
  assert.equal(result.contact_phone, '13800138000')
  assert.equal(sent.url, '/customer-opportunity/api/v1/presale/requests/7/contact-phone')
  assert.equal(sent.options.cache, 'no-store')
  assert.equal(sent.options.headers['Cache-Control'], 'no-store')
  assert.equal(sent.options.credentials, 'include')
})

test('TS-001 联系电话页面同时校验独立权限和服务端业务关系且只保存在内存', () => {
  assert.match(view, /includes\('presale\.contact_phone\.read'\) && selectedPresale\.value\?\.can_view_contact_phone === true/)
  assert.match(view, /@click="viewPresaleContactPhone"/)
  assert.match(view, /getPresaleContactPhone\(id\)/)
  assert.match(view, /presaleContactPhone\.value = value\?\.contact_phone \|\| ''/)
  assert.match(view, /presaleContactPhone\.value = ''; presaleContactPhoneError\.value = ''/)
  assert.match(view, /查看明文会写入敏感信息访问审计，关闭详情后立即清除/)
  assert.doesNotMatch(view, /localStorage.*presaleContactPhone|sessionStorage.*presaleContactPhone/)
})

test('TS-005 工时模糊失败复用服务端规范载荷键且仅成功后清理', () => {
  let keySequence = 0
  const retries = createPresaleMutationRetryState(() => `worklog-${++keySequence}`)
  const input = {
    work_start: '2026-08-01T08:00:00+08:00', work_end: '2026-08-01T09:00:00+08:00',
    raw_unit: 'HOUR', raw_value: '1', work_site_address: ' 远程 ', work_content: 'TECH_QA',
    remark: ' 完成答疑 ', version: 7,
  }
  const first = retries.keyFor('worklog', 9, input)
  assert.equal(first.attempted, false)
  assert.deepEqual(first.payload, {
    work_start: '2026-08-01T00:00:00.000Z', work_end: '2026-08-01T01:00:00.000Z',
    raw_unit: 'HOUR', raw_value: '1.00', work_site_address: '远程', work_content: 'TECH_QA',
    remark: '完成答疑', version: 7,
  })
  assert.equal(retries.markAttempted('worklog', 9, first.key), true)
  const same = retries.keyFor('worklog', 9, { ...input, raw_value: '1.00', work_start: first.payload.work_start, work_end: first.payload.work_end })
  assert.equal(same.key, first.key)
  assert.equal(same.attempted, true)
  assert.notEqual(retries.keyFor('worklog', 10, input).key, first.key)
  assert.notEqual(retries.keyFor('worklog', 9, { ...input, remark: '另一项工作' }).key, first.key)
  retries.confirmSuccess('worklog', 9, first.key)
  assert.notEqual(retries.keyFor('worklog', 9, input).key, first.key)
})

test('TS 写操作页面只在 prompt 与业务校验后分配内存重试键', () => {
	assert.doesNotMatch(view, /请输入审批引擎任务 ID/)
	assert.match(view, /submitApprovalAction/)
	assert.match(view, /presaleMutationRetries\.keyFor\('approval', id/)
	assert.match(view, /authoritativePresaleActions\.includes\('APPROVE'\)/)
	assert.match(view, /authoritativePresaleActions\.includes\('REJECT'\)/)
  assert.match(view, /presaleDecisionSpec\(action\)/)
  assert.match(view, /runPresaleDecision\('cancel'\)/)
  assert.match(view, /submitPresaleDecision\(action, id, version, comment\)/)
  assert.doesNotMatch(view, /改派原因必填/)
  assert.match(view, /const opportunityID = Number\(presaleForm\.opportunity_id\)/)
  assert.match(view, /presaleMutationRetries\.keyFor\('create', opportunityID/)
  assert.match(view, /presaleMutationRetries\.keyFor\('assignment', id/)
  assert.match(view, /presaleMutationRetries\.keyFor\('cancel', id/)
  assert.match(view, /presaleMutationRetries\.keyFor\('worklog', id/)
  assert.match(view, /presaleMutationRetries\.markAttempted\('worklog', id, retry\.key\)/)
  assert.match(view, /addWorklog\(id, retry\.payload, retry\.key\)/)
  assert.match(view, /presaleMutationRetries\.confirmSuccess\('assignment', id, retry\.key\)/)
  assert.match(view, /presaleMutationRetries\.confirmSuccess\('cancel', id, retry\.key\)/)
  assert.match(view, /presaleMutationRetries\.confirmSuccess\('create', opportunityID, retry\.key\)/)
  assert.match(view, /presaleMutationRetries\.confirmSuccess\('worklog', id, retry\.key\)/)
  assert.match(view, /if \(presaleCreateLoading\.value\) return null/)
  assert.match(view, /finally \{ presaleCreateLoading\.value = false \}/)
  assert.match(view, /if \(mutationActions\.has\(action\) && presaleMutationLoading\.value\) return/)
  assert.match(view, /mutationContext === presaleMutationContextSequence\.value/)
  assert.match(view, /if \(!mutationToken \|\| isCurrentMutation\(\)\) showError\(value\)/)
  assert.doesNotMatch(view, /presaleMutationRetries\.clear\(\)/)
  assert.doesNotMatch(view, /localStorage|sessionStorage/)
  assert.match(view, /@submit\.prevent="runPresale\('worklog'\)"[\s\S]*:disabled="presaleMutationLoading"/)
})

test('售前创建遇到商机不可见时展示明确中文提示', () => {
  assert.match(view, /CRM_OPPORTUNITY_NOT_FOUND/)
  assert.match(view, /关联商机不存在、已作废或不再属于当前账号的数据范围/)
})

test('TS-004 时间线与权威操作区调用后端真实只读路由', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse(url.includes('available-actions')
      ? { status: 'EXECUTING', version: 7, actions: ['ADD_PROGRESS'] }
      : { items: [], next_cursor: 'signed.cursor' })
  }
  await api.getPresaleTimeline(7, { cursor: 'signed.cursor', limit: 20 })
  await api.getPresaleAvailableActions(7)
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/presale/requests/7/timeline?cursor=signed.cursor&limit=20',
    '/customer-opportunity/api/v1/presale/requests/7/available-actions',
  ])
  assert.ok(requests.every((item) => (item.options.method || 'GET') === 'GET'))
})

test('TS-004 详情以权威操作接口和稳定游标驱动且安全展示时间线', () => {
  assert.match(view, /const authoritativePresaleActions = computed\(\(\) => presaleAvailableActions\.value\?\.actions \|\| \[\]\)/)
  assert.match(view, /detail\.available_actions is intentionally not used as a fallback/)
  assert.match(view, /getPresaleTimeline\(id, \{ cursor, limit: 20 \}\)/)
  assert.match(view, /presaleTimelineLoadSequence/)
  assert.match(view, /known = new Set\(presaleTimeline\.value\.map\(\(item\) => item\.event_id\)\)/)
  assert.match(view, /服务端未授权该操作或操作状态已变化/)
  assert.match(view, /await Promise\.all\(\[refreshPresaleActions\(id\), refreshPresaleTimeline\(id\)\]\)/)
  for (const label of ['售前申请已创建', '任务状态已变更', '审批已处理', '已加入执行人', '已移出执行人', '已登记进度', '已登记工时']) assert.match(view, new RegExp(label))
  assert.match(view, /parsed\.protocol === 'https:'/)
  assert.match(view, /target="_blank" rel="noopener noreferrer"/)
	assert.match(view, /function usableOperationName\(snapshot, userId\)/)
	assert.match(view, /value !== String\(userId \|\| ''\)\.trim\(\)/)
	assert.match(view, /operationUserLabel\(item\).*usableOperationName\(item\?\.actor_name, item\?\.actor_id\).*ownerLabel\(item\?\.actor_id\)/)
	assert.doesNotMatch(view, /v-html/)
	assert.match(view, /progressSubmissionSignature\.value !== progressSignature/)
	assert.match(view, /const submissionKey = progressSubmissionKey\.value/)
	assert.match(view, /addProgress\(id, progressPayload, submissionKey\)/)
	assert.match(view, /progressSubmissionKey\.value = ''/)
})

test('TS-010 商机详情使用独立分页查询且仅可查看的任务进入详情', () => {
  assert.match(view, /listOpportunityPresaleRequests\(opportunityID, \{ page: targetPage, page_size: opportunityPresalePage\.size \}\)/)
  assert.match(view, /void loadOpportunityPresales\(\)/)
  assert.match(view, /关联售前任务暂时无法加载，商机详情不受影响/)
  for (const field of ['request_no', 'created_at', 'status', 'urgency', 'venue', 'current_assignees', 'latest_progress', 'total_work_hours', 'expected_end', 'overdue']) {
    assert.match(view, new RegExp(`item\\.${field}`))
  }
  assert.match(view, /v-if="item\.can_view_detail"/)
  assert.match(view, /if \(!item\?\.can_view_detail\) return/)
  assert.match(view, /暂无关联售前任务/)
  assert.match(view, /opportunityPresalePage\.number \* opportunityPresalePage\.size >= opportunityPresalePage\.total/)
})

test('TS-010 关联查询调用真实路由和分页参数', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let request
  globalThis.fetch = async (url, options = {}) => { request = { url, options }; return jsonResponse({ items: [], page: 2, page_size: 10, total: 0 }) }
  await opportunity.listOpportunityPresaleRequests(19, { page: 2, page_size: 10 })
  assert.equal(request.url, '/customer-opportunity/api/v1/opportunities/19/presale-requests?page=2&page_size=10')
  assert.equal(request.options.credentials, 'include')
})

test('TS-010 从商机发起申请锁定机会且提交后只刷新面板不改阶段', () => {
  assert.match(view, /presale\.create/)
  assert.match(view, /v-if="canCreatePresale && selectedOpportunity\.opp_status !== 'VOID'"/)
  assert.match(view, /aria-haspopup="dialog"[\s\S]*@click="openOpportunityPresaleCreate"/)
  assert.match(view, /opportunity_id: String\(selectedOpportunity\.value\.id\)/)
  assert.match(view, /class="console-modal-backdrop crm-opportunity-presale-create-backdrop"/)
  assert.match(view, /class="console-detail-modal crm-opportunity-presale-create-dialog"/)
  assert.match(view, /id="opportunity-presale-create-form" class="console-form-grid crm-opportunity-presale-create-body"/)
  assert.match(style, /\.crm-opportunity-presale-create-backdrop\s*\{[^}]*z-index:\s*90/)
  assert.match(style, /\.crm-opportunity-presale-create-dialog/)
  assert.match(view, /\{\{ selectedOpportunity\.opportunity_no \}\}[\s\S]*\{\{ selectedOpportunity\.name \}\}/)
  assert.match(view, /售前内部流程暂时不可用/)
  assert.match(view, /@click="refreshPresaleSubmissionCapability"/)
  assert.match(view, /:disabled="presaleCreateLoading \|\| !presaleRequestSubmissionAvailable"/)
  assert.match(view, /expectedEnd <= expectedStart/)
  assert.match(view, /submitPresale\(\{ openDetail: false, refreshList: false \}\)/)
  assert.match(view, /await loadOpportunityPresales\(1\)/)
  assert.match(view, /售前申请已提交；商机阶段保持不变/)
  assert.doesNotMatch(view, /submitOpportunityPresale[\s\S]{0,1000}changeOpportunityStage/)
})

test('客户导入提交可显式复用同一内存幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => { requests.push({ url, options }); return jsonResponse({ job_no: 'JOB-9', status: 'COMMITTING', version: 2 }) }
  await customer.commitCustomerImport('JOB-9', { version: 1 }, 'import-key-1')
  await customer.commitCustomerImport('JOB-9', { version: 1 }, 'import-key-1')
  await customer.commitCustomerImport('JOB-10', { version: 1 }, 'import-key-2')
  assert.deepEqual(requests.map((item) => item.options.headers['Idempotency-Key']), ['import-key-1', 'import-key-1', 'import-key-2'])
  assert.match(view, /customerImportCommitKey\.value = createIdempotencyKey\(\)/)
  assert.match(view, /commitCustomerImport\(preview\.job_no, \{ version: Number\(preview\.version\) \}, customerImportCommitKey\.value\)/)
  assert.match(view, /resetCustomerImportPreview/)
  assert.doesNotMatch(view, /localStorage|sessionStorage/)
})

test('已废弃的 PMS 人员接口不再暴露，售前人员统一来自基础平台目录', () => {
  assert.doesNotMatch(view, /listPresaleEngineers|syncPresaleEngineers/)
  assert.doesNotMatch(apiSource, /listPresaleEngineers|syncPresaleEngineers/)
  assert.match(view, /listOwnerDirectory/)
})

test('内部人员选择器使用基础平台授权目录并展示替换差异', () => {
  assert.match(view, /listOwnerDirectory/)
  assert.match(view, /从基础平台选择执行人员/)
  assert.match(view, />从基础平台选择执行人<\/button>/)
  assert.match(view, /人员来自基础平台当前有效且已获得本应用授权的用户目录/)
  assert.match(view, /assignmentDiff\.added/)
  assert.match(view, /assignmentDiff\.retained/)
  assert.match(view, /assignmentDiff\.removed/)
  assert.match(view, /unavailableCurrentAssignees/)
  assert.match(view, /当前指派人员不在本次查询结果中/)
  assert.doesNotMatch(view, /手动同步 PMS/)
})

test('售前超时预警接入规则、未读、已读和聚合标记界面', () => {
  assert.match(view, /listPresaleAlerts/)
  assert.match(view, /markPresaleAlertRead/)
  assert.match(view, /listPresaleAlertRules/)
  assert.match(view, /updatePresaleAlertRule/)
  assert.match(view, /未读预警/)
  assert.match(view, /起算/)
})

test('售前投入报表提供筛选、KPI、图形和等价数值表', () => {
  assert.match(view, /getPresaleReportSummary/)
  assert.match(view, /function reportDateParam\(value\)/)
  assert.match(view, /function normalizeReportSummary\(value\)/)
  assert.match(view, /function normalizeReportRows\(value\)/)
  assert.match(view, /reportDistribution\.value = normalizeReportRows\(distribution\)/)
  assert.match(view, /投入小时/)
  assert.match(view, /商机覆盖率/)
  assert.match(view, /自动完成任务/)
  assert.doesNotMatch(view, /PMS 最终成功率/)
  assert.match(view, /趋势数值表（UTC 日）/)
  assert.match(view, /分布数值表/)
  assert.match(view, /异步导出尚未接通对象存储与导出 Worker/)
})

test('售前投入报表按归属组织刷新参与人员和商机选项', () => {
  assert.match(view, /function onReportOrganizationChange\(\)/)
  assert.match(view, /reportFilters\.organization_id"[^>]*@change="onReportOrganizationChange"/)
  assert.match(view, /reportFilters\.person_id = ''[\s\S]*reportFilters\.opportunity_id = ''[\s\S]*loadReportFilterOptions\(\)/)
})

test('售前投入报表调用真实三类查询和失败关闭的导出路由', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse([])
  }
  const params = { from: '2026-08-01T00:00:00Z', to: '2026-09-01T00:00:00Z', dimension: 'PERSON' }
  await api.getPresaleReportSummary(params)
  await api.getPresaleReportTrend(params)
  await api.getPresaleReportDistribution(params)
  await api.requestPresaleReportExport(params)
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/presale/reports/summary?from=2026-08-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z&dimension=PERSON',
    '/customer-opportunity/api/v1/presale/reports/trend?from=2026-08-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z&dimension=PERSON',
    '/customer-opportunity/api/v1/presale/reports/distribution?from=2026-08-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z&dimension=PERSON',
    '/customer-opportunity/api/v1/presale/reports/exports',
  ])
  assert.equal(requests[3].options.method, 'POST')
  assert.equal(requests[3].options.headers['X-CSRF-Token'], '1')
})

test('商机负责人和团队维护均使用基础平台人员目录', () => {
  assert.match(view, /changeOpportunityOwner/)
  assert.match(view, /getOpportunityMembers/)
  assert.match(view, /replaceOpportunityMembers/)
  assert.match(view, /listOwnerDirectory/)
  assert.match(view, /loadTeamDirectory/)
  assert.match(view, /变更负责人/)
  assert.match(view, /维护团队/)
  assert.match(view, /人员用户名与有效组织实时取自基础平台权威目录/)
  assert.match(view, /directory_status === 'NOT_AVAILABLE'/)
  assert.match(view, /服务端会再次校验人员状态/)
  assert.doesNotMatch(view, /members_text/)
  assert.doesNotMatch(view, /platform-sub,TECHNICAL_SUPPORT/)
  assert.doesNotMatch(view, /平台人员目录选择器与停用校验尚待稳定接口/)
})

test('客户与商机关联操作使用业务选择器而不是手填 ID', () => {
  assert.match(view, /<label v-if="!customerOwnerOptionsError">负责人<select v-model="customerFilters\.owner_id"/)
  assert.match(view, /<label>目标客户<select v-model="customerMergeForm\.target_customer_id"/)
  assert.match(view, /<label>关联商机 \*<select v-model="presaleForm\.opportunity_id"/)
  assert.match(view, /<span>归属组织<\/span><select v-model="reportFilters\.organization_id"/)
  assert.match(view, /<span>参与人员<\/span><select v-model="reportFilters\.person_id"/)
  assert.match(view, /<span>关联商机<\/span><select v-model="reportFilters\.opportunity_id"/)
  // 人员目录不可用时失败关闭，不允许退回手填任何内部 ID。
  assert.match(view, /基础平台负责人目录暂不可用，当前不能按负责人筛选/)
  assert.match(view, /请在基础平台人员目录恢复后重试负责人筛选/)
  assert.doesNotMatch(view, /目标客户 ID<input/)
  assert.doesNotMatch(view, /关联商机 ID<input/)
  assert.doesNotMatch(view, /<span>组织 ID<\/span><input/)
  assert.doesNotMatch(view, /<span>人员 ID<\/span><input/)
  assert.doesNotMatch(view, /<span>商机 ID<\/span><input/)
})

test('新建售前申请需求说明只要求有内容且必填项显示星标', () => {
  assert.match(view, /if \(!presaleForm\.description\.trim\(\)\) \{ error\.value = '需求说明不能为空/)
  assert.match(view, /<label>需求说明 \*<textarea v-model\.trim="presaleForm\.description"[^>]*required/)
  assert.match(view, /<span>需求说明 \*<\/span><textarea v-model\.trim="presaleForm\.description"[^>]*required/)
  assert.doesNotMatch(view, /presaleForm\.description" minlength=/)
  assert.doesNotMatch(view, /presaleForm\.description"[^>]*maxlength=/)
  for (const label of ['关联商机 *', '支持方式 *', '紧急程度 *', '联系人 *', '联系电话 *', '预计开始 *', '预计结束 *']) {
    assert.match(view, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('负责人列表与详情会按需补全人员目录名字', () => {
  assert.match(view, /async function resolveOwnerNames\(userIDs\)/)
  assert.match(view, /void resolveOwnerNames\(customers\.value\.map\(\(item\) => item\.owner_user_id\)\)/)
  assert.match(view, /void resolveOwnerNames\(opportunities\.value\.map\(\(item\) => item\.owner_user_id\)\)/)
  assert.match(view, /void resolveOwnerNames\(\[detail\?\.owner_user_id\]\)/)
})

test('商机负责人和团队 API 使用独立权限路由及幂等键', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse({ opportunity_id: 31, version: 5, members: [] })
  }
  await opportunity.changeOpportunityOwner(31, { owner_user_id: 'sub-new', version: 4, reason: '交接' })
  await opportunity.getOpportunityMembers(31)
  await opportunity.replaceOpportunityMembers(31, { members: [{ user_id: 'sub-a', role: 'TECHNICAL_SUPPORT' }], version: 5, reason: '补充技术' })
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/opportunities/31/owner',
    '/customer-opportunity/api/v1/opportunities/31/members',
    '/customer-opportunity/api/v1/opportunities/31/members',
  ])
  assert.deepEqual(requests.map((item) => item.options.method || 'GET'), ['PUT', 'GET', 'PUT'])
  assert.ok(requests[0].options.headers['Idempotency-Key'])
  assert.ok(requests[2].options.headers['Idempotency-Key'])
})

test('个人通知 API 仅调用后端个人收件箱与已读路由', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse(url.endsWith('/unread-count') ? { count: 2 } : { items: [] })
  }
  await notification.listNotifications({ unread_only: true, page: 1, page_size: 20 })
  await notification.getNotificationUnreadCount()
  await notification.markNotificationRead(19)
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/notifications?unread_only=true&page=1&page_size=20',
    '/customer-opportunity/api/v1/notifications/unread-count',
    '/customer-opportunity/api/v1/notifications/19/read',
  ])
  assert.equal(requests[2].options.method, 'POST')
  assert.equal(requests[2].options.headers['X-CSRF-Token'], '1')
  assert.ok(requests.every((item) => !item.url.includes('owner_id') && !item.url.includes('scope')))
})

test('通知目标只接受当前源的现有 CRM 商机或售前入口', () => {
  assert.deepEqual(
    parseNotificationTarget('/customer-opportunity/opportunities?opportunity_id=31', 'https://crm.example'),
    { name: 'customer_opportunity', params: { section: 'opportunities' }, query: { opportunity_id: '31' } },
  )
  assert.deepEqual(
    parseNotificationTarget('/customer-opportunity/presale?request_id=17', 'https://crm.example'),
    { name: 'customer_opportunity', params: { section: 'presale' }, query: { request_id: '17' } },
  )
  assert.deepEqual(
    parseNotificationTarget('/customer-opportunity/customers?customer_id=31&tab=credit', 'https://crm.example'),
    { name: 'customer_opportunity', params: { section: 'customers' }, query: { customer_id: '31', tab: 'credit' } },
  )
  for (const target of [
    'https://evil.example/customer-opportunity/opportunities?opportunity_id=31',
    '/customer-opportunity/opportunities?opportunity_id=0',
    '/customer-opportunity/opportunities?opportunity_id=abc',
    '/customer-opportunity/notifications?opportunity_id=31',
    '/customer-opportunity/presale?request_id=0',
    '/customer-opportunity/presale?request_id=17&scope=ALL',
    '/customer-opportunity/customers?customer_id=31',
    '/customer-opportunity/customers?customer_id=31&tab=basic',
    '/customer-opportunity/customers?customer_id=31&tab=credit&scope=ALL',
  ]) assert.equal(parseNotificationTarget(target, 'https://crm.example'), null)
})

test('个人通知界面明确个人边界并通过路由查询打开真实详情', () => {
  assert.match(view, /通知收件人固定为当前登录用户，不受 SELF \/ ORG \/ ALL 数据范围扩展/)
  assert.match(view, /parseNotificationTarget\(item\.target_path/)
  assert.match(view, /route\.query\.opportunity_id/)
  assert.match(view, /await openOpportunity\(id\)/)
  assert.match(view, /target\.params\.section === 'presale'/)
  assert.match(view, /await openPresale\(Number\(target\.query\.request_id\)\)/)
  assert.match(view, /requestedTab === 'credit'/)
  assert.match(view, /await openCustomerTab\('credit'\)/)
  assert.match(view, /canReadNotifications/)
  assert.match(view, /只包含发给当前用户的商机负责人和售前执行人通知/)
  assert.match(view, /ASSIGNEE_ADDED/)
  assert.match(view, /ASSIGNEE_REMOVED/)
})

test('阶段告警 API 对接真实列表、已读和规则路由及数据版本', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return jsonResponse([])
  }
  await opportunity.listOpportunityStageAlerts({ unread_only: false, page: 1, page_size: 50 })
  await opportunity.markOpportunityStageAlertRead(7)
  await opportunity.listOpportunityStageAlertRules()
  await opportunity.updateOpportunityStageAlertRule('方案制定', { threshold_hours: 48, enabled: true, version: 3 })
  assert.deepEqual(requests.map((item) => item.url), [
    '/customer-opportunity/api/v1/opportunity-stage-alerts?unread_only=false&page=1&page_size=50',
    '/customer-opportunity/api/v1/opportunity-stage-alerts/7/read',
    '/customer-opportunity/api/v1/opportunity-stage-alert-rules',
    '/customer-opportunity/api/v1/opportunity-stage-alert-rules/%E6%96%B9%E6%A1%88%E5%88%B6%E5%AE%9A',
  ])
  assert.equal(requests[1].options.method, 'POST')
  assert.equal(requests[3].options.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[3].options.body), { threshold_hours: 48, enabled: true, version: 3 })
})

test('阶段告警界面展示详情、状态语义和权限关闭行为', () => {
  for (const label of ['待处理', '已触发（未读）', '已触发（已读）', '已取消']) assert.match(view, new RegExp(label.replace(/[（）]/g, '.')))
  assert.match(view, /服务端个人列表当前返回已触发的未读\/已读告警/)
  assert.match(view, /canConfigureStageAlerts/)
  assert.match(view, /value\?\.status === 403/)
  assert.match(view, /version: Number\(rule\.version\)/)
  assert.match(view, /阶段起算/)
  assert.match(view, /阈值版本/)
})

test('从详情打开的编辑弹窗叠在详情之上，不被遮住', () => {
  assert.match(view, /console-modal-backdrop" :class="\{ nested: !!selectedCustomer \}"/)
  assert.match(view, /console-modal-backdrop" :class="\{ nested: !!selectedOpportunity \}"/)
  assert.match(style, /console-modal-backdrop\.nested \{ z-index: 80; \}/)
})
