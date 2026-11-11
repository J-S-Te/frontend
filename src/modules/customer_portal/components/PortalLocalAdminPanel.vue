<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  createLocalContact, createLocalCustomer, createLocalInvitation, createLocalReport,
  disableLocalAccess, listLocalAccounts, listLocalContacts, listLocalCustomers,
  listLocalInvitations, listLocalOperations, listLocalProjectAccess, listLocalProjects,
  retryLocalOperation, retryLocalReportFile, revokeLocalInvitation, saveLocalProject,
  setLocalProjectAccess,
} from '../api/localIdentity.js'
import { createIdempotencyKey } from '../../shared/utils/idempotencyKey.js'

const props = defineProps({ session: { type: Object, required: true } })
const permissions = computed(() => new Set(Array.isArray(props.session.permissions) ? props.session.permissions : Object.keys(props.session.permissions || {})))
const isAdmin = computed(() => props.session.roles?.length === 1 && props.session.roles[0] === 'portal_super_admin')
const customers = ref([]), contacts = ref([]), accounts = ref([]), invitations = ref([])
const projects = ref([]), bindings = ref([]), operations = ref([])
const customerID = ref(''), busy = ref(false), loading = ref(false)
const error = ref(''), notice = ref(''), activationURL = ref(''), lastOperation = ref(null)
const pending = ref(null), selectedFile = ref(null), retryFiles = reactive({})
let generation = 0
const customerForm = reactive({ code: '', name: '' })
const contactForm = reactive({ display_name: '', phone: '' })
const projectForm = reactive({ project_id: '', name: '', status: 'PENDING', progress_pct: 0, stage: '已登记', expected_version: 0 })
const accessForm = reactive({ project_id: '', account_id: '' })
const reportForm = reactive({ project_id: '', account_id: '', report_type: '电子报告', reason: '' })
const disableReason = ref(''), revokeReason = ref('')
const activeAccounts = computed(() => accounts.value.filter((item) => item.status === 'ACTIVE'))
const selectedBinding = computed(() => bindings.value.find((item) => item.project_id === accessForm.project_id && item.account_id === accessForm.account_id))
const reportAccounts = computed(() => activeAccounts.value.filter((item) => bindings.value.some((grant) => grant.project_id === reportForm.project_id && grant.account_id === item.platform_user_id && grant.enabled)))

/** can 检查精确管理权限，客户角色不能进入此管理区。
 * 参数：permission为固定权限码。
 * 返回值：当前会话是否允许展示该管理能力。
 */
function can(permission) { return isAdmin.value && permissions.value.has(permission) }

/** id 转换安全的真实资源编号，拒绝浏览器精度损失。
 * 参数：value为服务器编号或选择器值。
 * 返回值：精确正整数；非法值抛错。
 */
function id(value) { const result = Number(value); if (!Number.isSafeInteger(result) || result <= 0) throw new Error('请选择有效的本地客户'); return result }

/** remember 保留真实操作号与一次性邀请链接，仅存当前组件内存。
 * 参数：value为严格校验后的真实回执。
 * 返回值：无。
 */
function remember(value) {
  if (value?.operation) lastOperation.value = value.operation
  activationURL.value = value?.activation_url || ''
  if (value?.report_request) notice.value = `报告申请 ${value.report_request.request_no}：${value.report_request.status === 'ISSUED' ? '已完成安全入库' : value.report_request.status === 'PROCESSING_FAILED' ? '安全摄取失败，请查看原申请' : '等待扫描和安全入库，尚未发放'}`
}

/** run 统一显示真实错误，未知写结果保留原幂等键。
 * 参数：action为已授权操作，message为操作完成后的业务说明。
 * 返回值：是否已确认成功。
 */
async function run(action, message = '') {
  if (busy.value) return false
  busy.value = true; error.value = ''; notice.value = ''; activationURL.value = ''
  try { const value = await action(); remember(value); if (!notice.value) notice.value = message; await loadCustomer(); return true }
  catch (failure) {
    if (failure.details?.operation) { lastOperation.value = failure.details.operation; pending.value = null }
    else if (failure.status >= 400 && failure.status < 500 && ![408, 429].includes(failure.status)) pending.value = null
    error.value = failure.message || '操作失败，请查询原操作记录'
    if (pending.value) error.value += '；结果尚未核实。请保持原内容重试，或查询操作记录后按原操作号继续。'
    return false
  } finally { busy.value = false }
}

/** operationKey 冻结尚未核实写请求，避免改载荷后重复开户或上传。
 * 参数：kind为业务种类，input为不含秘密的冻结业务坐标。
 * 返回值：当前原幂等键；未核实期间修改目标则失败。
 */
function operationKey(kind, input) {
  const fingerprint = JSON.stringify({ kind, input })
  if (pending.value && pending.value.fingerprint !== fingerprint) throw new Error('上一操作结果尚未核实，请保持原内容重试或先查看操作记录')
  if (!pending.value) pending.value = { fingerprint, key: createIdempotencyKey() }
  return pending.value.key
}

/** operationWrite 执行可按原操作号恢复的管理业务。
 * 参数：kind/input为冻结材料，action为接收原幂等键的API函数。
 * 返回值：严格确认的真实业务回执。
 */
async function operationWrite(kind, input, action) { const key = operationKey(kind, input); const value = await action(key); pending.value = null; return value }

/** loadCustomers 读取有界本地目录，不查询客户业务内容。
 * 参数：无。
 * 返回值：异步完成或真实接口错误。
 */
async function loadCustomers() { if (can('portal.customer.manage')) { const rows = await listLocalCustomers(); if (!Array.isArray(rows)) throw new Error('客户目录回执无效'); customers.value = rows } }

/** loadCustomer 按当前精确客户刷新有权限的管理元数据。
 * 参数：无。
 * 返回值：异步完成；过期请求不能覆盖另一客户页面。
 */
async function loadCustomer() {
  if (!customerID.value) return
  const token = ++generation, customer = id(customerID.value)
  loading.value = true
  const jobs = [
    [can('portal.customer.manage'), listLocalContacts, contacts],
    [can('portal.customer.manage'), listLocalAccounts, accounts],
    [can('portal.invite.manage'), listLocalInvitations, invitations],
    [can('portal.local_project.manage'), listLocalProjects, projects],
    [can('portal.local_project.manage'), listLocalProjectAccess, bindings],
    [can('portal.invite.manage') || can('portal.local_report.manage') || can('portal.access.disable'), listLocalOperations, operations],
  ]
  const results = await Promise.allSettled(jobs.map(async ([enabled, action, target]) => ({ target, rows: enabled ? await action(customer) : [] })))
  if (token !== generation) return
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value.rows)) result.value.target.value = result.value.rows
    else error.value = result.status === 'rejected' ? result.reason.message : '管理列表回执无效'
  }
  loading.value = false
}

/** addCustomer 登记客户并选择服务器返回的真实编号。
 * 参数：无。
 * 返回值：异步管理操作结果。
 */
async function addCustomer() { await run(async () => { const value = await createLocalCustomer({ ...customerForm }); if (!Number.isSafeInteger(value?.id) || value.id <= 0) throw new Error('客户创建结果尚未核实，请刷新目录'); await loadCustomers(); customerID.value = String(value.id); customerForm.code = ''; customerForm.name = ''; return value }, '客户已登记') }

/** addContact 登记真实联系资料，成功后清除当前手机输入。
 * 参数：无。
 * 返回值：异步管理操作结果。
 */
async function addContact() { await run(async () => { const result = await createLocalContact({ customer_id: id(customerID.value), ...contactForm }); if (!Number.isSafeInteger(result?.id) || result.id <= 0) throw new Error('联系人创建结果尚未核实，请刷新目录'); contactForm.display_name = ''; contactForm.phone = ''; return result }, '联系人已登记') }

/** inviteContact 以冻结联系人版本发起真实平台开户。
 * 参数：contact为当前客户的服务器联系人记录。
 * 返回值：异步操作回执。
 */
async function inviteContact(contact) { await run(() => { const input = { customer_id: id(customerID.value), contact_id: id(contact.id), expected_contact_version: contact.version }; return operationWrite('INVITE', input, (key) => createLocalInvitation(input, key)) }, '本地邀请已创建') }

/** disableAccount 先冻结账号会话并持久化真实平台撤权。
 * 参数：account为服务器返回的精确映射。
 * 返回值：异步操作回执。
 */
async function disableAccount(account) { await run(() => { if (!disableReason.value.trim()) throw new Error('请填写停用原因'); const input = { customer_id: id(customerID.value), platform_user_id: account.platform_user_id, expected_version: account.version, reason: disableReason.value.trim() }; return operationWrite('DISABLE', input, (key) => disableLocalAccess(input, key)) }, '账号访问已停用') }

/** revokeInvite 撤销未使用邀请，不能替代账号停用。
 * 参数：invite为服务器邀请及并发版本。
 * 返回值：异步操作回执。
 */
async function revokeInvite(invite) { await run(() => { if (!revokeReason.value.trim()) throw new Error('请填写撤销原因'); return revokeLocalInvitation(invite, revokeReason.value.trim()) }, '邀请已撤销') }

/** editProject 载入真实项目并保留乐观版本。
 * 参数：project为服务器登记项目，空值恢复新建表单。
 * 返回值：无。
 */
function editProject(project) { Object.assign(projectForm, project ? { project_id: project.project_id, name: project.name, status: project.status, progress_pct: project.progress_pct, stage: project.stage, expected_version: project.version } : { project_id: '', name: '', status: 'PENDING', progress_pct: 0, stage: '已登记', expected_version: 0 }) }

/** submitProject 登记或更新真实本地项目。
 * 参数：无。
 * 返回值：异步操作回执。
 */
async function submitProject() { await run(async () => { const result = await saveLocalProject({ customer_id: id(customerID.value), ...projectForm, progress_pct: Number(projectForm.progress_pct) }); if (!Number.isSafeInteger(result?.id) || result.id <= 0) throw new Error('项目保存结果尚未核实，请刷新列表'); editProject(result); return result }, '项目已保存') }

/** changeAccess 修改精确MANUAL授权并保留ISOLATED边界。
 * 参数：enabled表示授予或撤销。
 * 返回值：异步操作回执。
 */
async function changeAccess(enabled) { await run(() => setLocalProjectAccess({ customer_id: id(customerID.value), ...accessForm, enabled, expected_version: selectedBinding.value?.version || 0 }), enabled ? '项目授权已授予' : '项目授权已撤销') }

/** choosePDF 保留待上传原文件，仅存在当前组件内存。
 * 参数：event为文件选择事件。
 * 返回值：无。
 */
function choosePDF(event) { selectedFile.value = event.target.files?.[0] || null }

/** submitReport 创建真实待摄取申请，不展示占位签发成功。
 * 参数：无。
 * 返回值：异步真实操作回执。
 */
async function submitReport() { await run(() => { const file = selectedFile.value; const input = { customer_id: id(customerID.value), ...reportForm }; const frozen = { ...input, file_name: file?.name, size: file?.size, modified: file?.lastModified }; return operationWrite('REPORT', frozen, (key) => createLocalReport(input, file, key)) }) }

/** retryOperation 按原操作号恢复，不创建新补偿任务。
 * 参数：operation为服务器账本，file为可选原PDF。
 * 返回值：异步真实操作回执。
 */
async function retryOperation(operation) { await run(async () => { const value = operation.kind === 'REPORT' && operation.stage === 'FILE_PENDING' ? await retryLocalReportFile(operation.operation_no, retryFiles[operation.operation_no]) : await retryLocalOperation(operation.operation_no); pending.value = null; return value }, '原操作已核实完成') }

/** switchCustomer 清除上一客户的管理状态并精确加载新范围。
 * 参数：无。
 * 返回值：异步完成，不保留上一客户邀请链接。
 */
async function switchCustomer() { activationURL.value = ''; lastOperation.value = null; contacts.value = []; accounts.value = []; invitations.value = []; projects.value = []; bindings.value = []; operations.value = []; accessForm.project_id = ''; accessForm.account_id = ''; reportForm.project_id = ''; reportForm.account_id = ''; selectedFile.value = null; editProject(null); await loadCustomer() }

watch(customerID, switchCustomer)
watch(() => props.session, () => { loadCustomers().catch((failure) => { error.value = failure.message }) }, { immediate: true })
onBeforeUnmount(() => { generation++; activationURL.value = ''; selectedFile.value = null })
</script>

<template>
  <section v-if="isAdmin" class="portal-local-admin" aria-label="本地门户管理">
    <header><h2>本地门户管理</h2><p>本门户独立维护客户、项目和报告来源。账号由基础平台真实开户，报告须完成扫描和安全入库后才可下载。</p></header>
    <p v-if="error" role="alert" class="local-error">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="lastOperation">原操作号：<code>{{ lastOperation.operation_no }}</code> · {{ lastOperation.stage }} · {{ lastOperation.status }}</p>
    <p v-if="activationURL">一次性邀请链接：<a :href="activationURL" target="_blank" rel="noopener noreferrer">打开客户邀请</a>（仅向该联系人安全传递）</p>
    <form v-if="can('portal.customer.manage')" @submit.prevent="addCustomer" class="local-form"><h3>登记客户</h3><label>业务编号<input v-model.trim="customerForm.code" maxlength="64" required :disabled="busy" /></label><label>客户名称<input v-model.trim="customerForm.name" maxlength="200" required :disabled="busy" /></label><button :disabled="busy">登记客户</button></form>
    <label>管理客户<select v-model="customerID" :disabled="busy || loading || !!pending"><option value="">请选择</option><option v-for="customer in customers" :key="customer.id" :value="String(customer.id)">{{ customer.code }} · {{ customer.name }}</option></select></label>
    <button type="button" :disabled="busy || loading" @click="run(async () => { await loadCustomers(); await loadCustomer() })">刷新目录与原操作</button>
    <p v-if="loading" role="status">正在加载当前客户的管理资料…</p>
    <template v-if="customerID">
      <section v-if="can('portal.customer.manage')"><h3>联系人与真实账号</h3><form @submit.prevent="addContact" class="local-form"><label>姓名<input v-model.trim="contactForm.display_name" maxlength="128" required :disabled="busy" /></label><label>登记手机<input v-model.trim="contactForm.phone" type="tel" maxlength="32" required autocomplete="off" :disabled="busy" /></label><button :disabled="busy">登记联系人</button></form>
        <ul><li v-for="contact in contacts" :key="contact.id">{{ contact.display_name }} · {{ contact.phone_masked }} <button v-if="can('portal.invite.manage')" type="button" :disabled="busy" @click="inviteContact(contact)">开户并邀请</button></li></ul>
        <label v-if="can('portal.access.disable')">停用原因<input v-model.trim="disableReason" maxlength="500" :disabled="busy" /></label><ul><li v-for="account in accounts" :key="account.platform_user_id">{{ account.account_no }} · {{ account.status }} <button v-if="can('portal.access.disable') && account.status !== 'DISABLED'" type="button" :disabled="busy || !disableReason" @click="disableAccount(account)">停用此账号</button></li></ul>
      </section>
      <section v-if="can('portal.invite.manage')"><h3>邀请状态</h3><label>撤销原因<input v-model.trim="revokeReason" maxlength="500" :disabled="busy" /></label><ul><li v-for="invite in invitations" :key="invite.id">{{ invite.invite_no }} · {{ invite.status }} · 到期 {{ invite.expires_at }} <button v-if="invite.status === 'PENDING'" type="button" :disabled="busy || !revokeReason" @click="revokeInvite(invite)">撤销邀请</button></li></ul></section>
      <section v-if="can('portal.local_project.manage')"><h3>本地项目</h3><form @submit.prevent="submitProject" class="local-form"><label>项目编号<input v-model.trim="projectForm.project_id" maxlength="64" required :disabled="busy || projectForm.expected_version > 0" /></label><label>项目名称<input v-model.trim="projectForm.name" maxlength="200" required :disabled="busy" /></label><label>状态<select v-model="projectForm.status" :disabled="busy"><option value="PENDING">待开始</option><option value="IN_PROGRESS">进行中</option><option value="COMPLETED">已完成</option><option value="CANCELLED">已取消</option></select></label><label>进度%<input v-model="projectForm.progress_pct" type="number" min="0" max="100" required :disabled="busy" /></label><label>当前阶段<input v-model.trim="projectForm.stage" maxlength="64" required :disabled="busy" /></label><button :disabled="busy">保存项目</button><button type="button" :disabled="busy" @click="editProject(null)">登记新项目</button></form><ul><li v-for="project in projects" :key="project.id">{{ project.project_id }} · {{ project.name }} · {{ project.progress_pct }}% <button type="button" :disabled="busy" @click="editProject(project)">维护</button></li></ul>
        <h4>精确项目授权</h4><div class="local-form"><label>项目<select v-model="accessForm.project_id" :disabled="busy"><option value="">请选择</option><option v-for="project in projects" :key="project.id" :value="project.project_id">{{ project.name }}</option></select></label><label>已激活账号<select v-model="accessForm.account_id" :disabled="busy"><option value="">请选择</option><option v-for="account in activeAccounts" :key="account.platform_user_id" :value="account.platform_user_id">{{ account.account_no }}</option></select></label><button type="button" :disabled="busy || !accessForm.project_id || !accessForm.account_id" @click="changeAccess(true)">授予项目</button><button type="button" :disabled="busy || !selectedBinding?.enabled" @click="changeAccess(false)">撤销项目</button><span>{{ selectedBinding?.enabled ? '当前已授权' : '当前未授权' }}</span></div>
      </section>
      <section v-if="can('portal.local_report.manage')"><h3>登记本地 PDF 报告</h3><p>仅可指定已获得该项目授权的真实客户账号。原 PDF 不超过 20 MiB；受理后等待安全摄取。</p><form @submit.prevent="submitReport" class="local-form"><label>项目<select v-model="reportForm.project_id" required :disabled="busy || !!pending"><option value="">请选择</option><option v-for="project in projects" :key="project.id" :value="project.project_id">{{ project.name }}</option></select></label><label>精确客户账号<select v-model="reportForm.account_id" required :disabled="busy || !!pending"><option value="">请选择</option><option v-for="account in reportAccounts" :key="account.platform_user_id" :value="account.platform_user_id">{{ account.account_no }}</option></select></label><label>报告类型<input v-model.trim="reportForm.report_type" maxlength="64" required :disabled="busy || !!pending" /></label><label>登记说明<input v-model.trim="reportForm.reason" maxlength="2000" required :disabled="busy || !!pending" /></label><label>原 PDF<input type="file" accept=".pdf,application/pdf" required :disabled="busy || !!pending" @change="choosePDF" /></label><button :disabled="busy">上传并等待安全摄取</button></form></section>
      <section><h3>持久操作记录</h3><p>失败记录永久保留；使用原操作号精确重试。文件待上传时必须选择原 PDF，不会自动替换客户、项目或内容。</p><ul><li v-for="operation in operations" :key="operation.operation_no"><code>{{ operation.operation_no }}</code> · {{ operation.kind }} · {{ operation.stage }} · {{ operation.status }} <span v-if="operation.last_error">{{ operation.last_error }}</span><input v-if="operation.kind === 'REPORT' && operation.stage === 'FILE_PENDING'" type="file" accept=".pdf,application/pdf" :disabled="busy" :aria-label="`重传原文件 ${operation.operation_no}`" @change="retryFiles[operation.operation_no] = $event.target.files?.[0]" /><button type="button" :disabled="busy || (operation.kind === 'REPORT' && operation.stage === 'FILE_PENDING' && !retryFiles[operation.operation_no])" @click="retryOperation(operation)">{{ operation.status === 'COMPLETED' ? '查看当前结果' : '按原操作号重试' }}</button></li></ul></section>
    </template>
  </section>
</template>

<style scoped>
.portal-local-admin { display: grid; gap: 1rem; min-width: 0; }
.portal-local-admin section, .portal-local-admin header { padding: 1rem; border: 1px solid #d5dce6; border-radius: .7rem; }
.local-form { display: flex; gap: .75rem; align-items: end; flex-wrap: wrap; }
.local-form h3 { flex-basis: 100%; }
.portal-local-admin label { display: grid; gap: .3rem; min-width: 10rem; max-width: 100%; }
.portal-local-admin input, .portal-local-admin select { min-height: 2.2rem; max-width: 100%; padding: .35rem; }
.portal-local-admin button { min-height: 2.2rem; cursor: pointer; }
.portal-local-admin button:disabled { cursor: default; opacity: .55; }
.portal-local-admin li { padding: .4rem 0; overflow-wrap: anywhere; }
.portal-local-admin code { overflow-wrap: anywhere; }
.local-error { color: #9f2222; }
@media (max-width: 620px) { .local-form, .portal-local-admin label { display: grid; width: 100%; min-width: 0; } }
</style>
