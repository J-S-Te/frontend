import { request, PortalAPIError } from './portal.js'

const BASE = '/local-admin'
export const LOCAL_NAMESPACE = 'portal-local'

/** localPath 编码真实管理资源坐标，防止路径片段扩大请求范围。
 * 参数：value 为服务器返回的资源编号。
 * 返回值：安全URL片段。
 */
function localPath(value) { return encodeURIComponent(String(value)) }

/** localJSON 发送既有CSRF和会话保护下的严格JSON。
 * 参数：path为固定端点，body为业务DTO，key为可选原幂等键，method为写方法。
 * 返回值：真实后端数据；非成功或损坏回执抛错。
 */
function localJSON(path, body, key = '', method = 'POST') {
  return request(`${BASE}${path}`, { method, body: JSON.stringify(body), headers: key ? { 'Idempotency-Key': key } : {} })
}

/** listLocalCustomers 查询有界本地客户目录。
 * 参数：after为上一页真实编号，缺省从首页读取。
 * 返回值：最多一百条真实客户。
 */
export function listLocalCustomers(after = 0) { return request(`${BASE}/customers?after=${localPath(after)}`) }

/** createLocalCustomer 登记门户自己的客户。
 * 参数：input为业务编号和名称。
 * 返回值：真实客户记录。
 */
export function createLocalCustomer(input) { return localJSON('/customers', input) }

/** localCustomerResource 查询精确客户的管理元数据。
 * 参数：id为本地客户，resource为模块固定资源名。
 * 返回值：有界资源列表。
 */
function localCustomerResource(id, resource) { return request(`${BASE}/customers/${localPath(id)}/${resource}`) }

/** listLocalContacts 查询脱敏联系人目录。
 * 参数：id为真实本地客户。
 * 返回值：联系人列表。
 */
export function listLocalContacts(id) { return localCustomerResource(id, 'contacts') }

/** listLocalAccounts 查询真实平台映射元数据。
 * 参数：id为本地客户。
 * 返回值：账号及乐观并发版本。
 */
export function listLocalAccounts(id) { return localCustomerResource(id, 'accounts') }

/** listLocalInvitations 查询真实本地邀请状态。
 * 参数：id为本地客户。
 * 返回值：不含秘密的邀请列表。
 */
export function listLocalInvitations(id) { return localCustomerResource(id, 'invitations') }

/** listLocalProjects 查询自己的真实项目来源。
 * 参数：id为本地客户。
 * 返回值：最多一百项项目。
 */
export function listLocalProjects(id) { return localCustomerResource(id, 'projects') }

/** createLocalContact 登记加密保存的开户联系人。
 * 参数：input为本地客户和登记手机等资料。
 * 返回值：脱敏联系人记录。
 */
export function createLocalContact(input) { return localJSON('/contacts', input) }

/** createLocalInvitation 根据稳定幂等键发起真实开户操作。
 * 参数：input为客户及联系人版本，key为原幂等键。
 * 返回值：真实操作阶段与可用邀请链接；依赖失败保留原操作号。
 */
export async function createLocalInvitation(input, key) { return localOperationResponse(await localJSON('/invitations', input, key), 'INVITE') }

/** revokeLocalInvitation 撤销尚未消费的邀请。
 * 参数：invite为服务器记录，reason为真实管理员原因。
 * 返回值：真实撤销回执。
 */
export async function revokeLocalInvitation(invite, reason) { const result = await localJSON(`/invitations/${localPath(invite.id)}/revoke`, { expected_version: invite.version, reason }); if (result?.revoked !== true) throw invalidLocalReceipt(); return result }

/** listLocalOperations 查询保留失败状态的操作账本。
 * 参数：id为可选客户过滤。
 * 返回值：最近一百项操作。
 */
export function listLocalOperations(id = '') { return request(`${BASE}/operations${id ? `?customer_id=${localPath(id)}` : ''}`) }

/** retryLocalOperation 按原操作号精确续跑，不重建开户材料。
 * 参数：number为持久原操作号。
 * 返回值：真实当前操作回执。
 */
export async function retryLocalOperation(number) { const result = localOperationResponse(await localJSON(`/operations/${localPath(number)}/retry`, {})); if (result.operation.operation_no !== number) throw invalidLocalReceipt(); return result }

/** disableLocalAccess 先冻结客户访问再记录平台撤权操作。
 * 参数：input为精确客户、主体及并发版本，key为原幂等键。
 * 返回值：真实操作回执。
 */
export async function disableLocalAccess(input, key) { return localOperationResponse(await localJSON('/access/disable', input, key), 'DISABLE') }

/** saveLocalProject 登记或版本化维护本地项目来源。
 * 参数：input为显式来源、客户及业务项目内容。
 * 返回值：真实持久项目。
 */
export function saveLocalProject(input) { return localJSON('/projects', { ...input, namespace: LOCAL_NAMESPACE }) }

/** setLocalProjectAccess 为真实账号维护精确项目授权。
 * 参数：input为客户、项目、账号及乐观版本。
 * 返回值：真实MANUAL授权记录。
 */
export async function setLocalProjectAccess(input) { const result = await localJSON('/project-access', { ...input, namespace: LOCAL_NAMESPACE }, '', 'PUT'); if (result?.project_id !== input.project_id || result?.account_id !== input.account_id || result?.enabled !== input.enabled || !Number.isSafeInteger(result?.version) || result.version <= 0) throw invalidLocalReceipt(); return result }

/** localPDF 限定本地上传为有界PDF文件。
 * 参数：file为管理员选择的原文件。
 * 返回值：合法文件；不合法时抛出用户可见错误。
 */
export function localPDF(file) {
  if (!file || !/\.pdf$/i.test(file.name || '') || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MiB 的 PDF 文件')
  return file
}

/** createLocalReport 注册真实PDF来源并等待既有安全摄取。
 * 参数：input为精确项目和客户账号，file为原PDF，key为稳定幂等键。
 * 返回值：真实待摄取申请；HTTP受理不代表报告已发放。
 */
export async function createLocalReport(input, file, key) {
  const form = new FormData()
  form.set('metadata', JSON.stringify({ ...input, namespace: LOCAL_NAMESPACE }))
  form.set('file', localPDF(file))
  return localOperationResponse(await request(`${BASE}/reports`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form }), 'REPORT')
}

/** retryLocalReportFile 向原操作精确重传同一PDF。
 * 参数：number为原操作号，file为原文件。
 * 返回值：真实上传与待摄取回执；替换内容将被拒绝。
 */
export async function retryLocalReportFile(number, file) {
  const form = new FormData()
  form.set('file', localPDF(file))
  const result = localOperationResponse(await request(`${BASE}/operations/${localPath(number)}/report-file`, { method: 'POST', body: form }), 'REPORT')
  if (result.operation.operation_no !== number) throw invalidLocalReceipt()
  return result
}

/** listLocalProjectAccess 查询精确授权和乐观版本。
 * 参数：id为本地客户。
 * 返回值：最多一百条MANUAL授权元数据。
 */
export function listLocalProjectAccess(id) { return localCustomerResource(id, 'project-access') }

/** invalidLocalReceipt 保留未知写回执为错误，禁止当作已完成解锁新操作。
 * 参数：无。
 * 返回值：标准门户未知回执错误。
 */
function invalidLocalReceipt() { return new PortalAPIError('操作结果尚未核实，请查询原操作记录', { status: 200, code: 'PORTAL_RESPONSE_INVALID', method: 'POST' }) }

/** localOperationResponse 校验真实操作、来源和异步报告状态，避免200占位成功。
 * 参数：value为后端回执，kind为固定业务种类。
 * 返回值：严格核实结果；未知状态、来源或缺字段时抛错。
 */
export function localOperationResponse(value, kind = '') {
  const op = value?.operation
  const stages = { INVITE: 'INVITE_READY', DISABLE: 'DISABLED', REPORT: 'INGEST_QUEUED' }
  if (!op || !/^[a-f0-9]{32}$/.test(op.operation_no || '') || !Object.hasOwn(stages, op.kind) || (kind && op.kind !== kind) || op.status !== 'COMPLETED' || op.stage !== stages[op.kind] || !Number.isSafeInteger(op.customer_id) || op.customer_id <= 0) throw invalidLocalReceipt()
  if (value.activation_url) { let link; try { link = new URL(value.activation_url) } catch { throw invalidLocalReceipt() }; if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password || !link.pathname.endsWith('/activate') || !/^[a-f0-9]{64}$/.test(link.searchParams.get('token') || '')) throw invalidLocalReceipt() }
  if (op.kind === 'INVITE' && (!value.invitation || value.invitation.customer_id !== op.customer_id || !['PENDING', 'CONSUMED', 'REVOKED'].includes(value.invitation.status))) throw invalidLocalReceipt()
  if (op.kind === 'REPORT' && (!value.report_source || value.report_source.namespace !== LOCAL_NAMESPACE || value.report_source.customer_id !== op.customer_id || value.report_source.operation_no !== op.operation_no || value.report_request?.request_id !== value.report_source.request_id || !Number.isSafeInteger(value.report_source.request_id) || value.report_source.request_id <= 0 || !['INGEST_PENDING', 'ISSUED', 'PROCESSING_FAILED'].includes(value.report_request?.status))) throw invalidLocalReceipt()
  return value
}
