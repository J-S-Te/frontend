import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { formatUserError } from './shared/utils/userError.js'
import { onboardEmployee as realOnboardEmployee, IamError as ApiIamError } from './platform/iam/api/iam.js'

const names = ['OnboardingPrerequisiteStep', 'EmployeeOnboardingModal', 'PositionAuthorizationTemplates', 'IamSettingsModule']
const passwordResetSource = await readFile(new URL('./platform/iam/composables/useIamPasswordReset.js', import.meta.url), 'utf8')
const sources = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(new URL(`./platform/iam/components/${name}.vue`, import.meta.url), 'utf8')])))
const ref = value => ({ value })
const computed = read => ({ get value() { return read() } })
class IamError extends Error {
  constructor(message, options = {}) { super(message); Object.assign(this, options); this.name = 'IamError' }
}
const failure = (message, fields = {}) => Object.assign(new Error(message), fields)

function prerequisites(api = {}) {
  const events = []
  const script = sources.OnboardingPrerequisiteStep.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  const state = new Function('formatUserError', 'computed', 'ref', 'reactive', 'onMounted', 'watch', 'defineProps', 'defineEmits', 'organizationSelectOptions', 'listPositionAuthorizationTargets', 'createOrgUnit', 'createPosition', 'createApplication', 'console',
    `${script}; return { orgForm, positionForm, applicationForm, formError, creatingKind, appCatalogError, appCatalogLoading, submitOrganization, submitPosition, submitApplication, loadAppCatalog };`)(
    formatUserError, computed, ref, value => value, () => {}, () => {}, () => ({ organizations: [], positions: [], applications: [] }), () => (...args) => events.push(args), () => [], api.catalog, api.organization, api.position, api.application, { error: () => {} })
  return { ...state, events }
}

test('IAM 前置检查的读取与创建异常均转换为中文，未知本地异常不暴露 HTML 或内部实现', async () => {
  const raw = failure('SQLSTATE HY000: SELECT * FROM local_accounts', { status: 500, code: 'INTERNAL_ERROR', requestID: 'prereq-1' })
  const state = prerequisites({ catalog: async () => { throw raw }, organization: async () => { throw raw }, position: async () => { throw new Error('<html>gateway failed</html>') }, application: async () => { throw new ReferenceError('createApplication is not defined') } })
  await state.loadAppCatalog()
  assert.match(state.appCatalogError.value, /服务|管理员/)
  assert.equal(state.appCatalogLoading.value, false)
  state.orgForm.name = '测试组织'
  await state.submitOrganization()
  assert.match(state.formError.value, /服务|管理员/)
  state.positionForm.orgUnitId = 'org-1'; state.positionForm.name = '测试岗位'
  await state.submitPosition()
  assert.equal(state.formError.value, '创建岗位失败。')
  state.applicationForm.code = 'test'; state.applicationForm.name = '测试应用'
  await state.submitApplication()
  assert.equal(state.formError.value, '注册应用失败。')
  assert.doesNotMatch([state.formError.value, state.appCatalogError.value].join(' '), /SQLSTATE|local_accounts|<html>|ReferenceError/)
  assert.equal(state.creatingKind.value, '')
  assert.equal(raw.requestID, 'prereq-1')
  assert.equal(state.events.some(([name]) => name === 'refresh'), false)
})

test('IAM 前置检查保留精确中文业务拒绝及结构化字段定位', async () => {
  const cause = failure('组织中仍有在职人员，不能停用。', { status: 409, code: 'ORG_IN_USE', details: { reason: 'in_use' } })
  const state = prerequisites({ organization: async () => { throw cause }, position: async () => { throw failure('validation failed', { status: 422, code: 'VALIDATION_ERROR', details: { fields: [{ field: 'name', rule: 'required' }] } }) } })
  state.orgForm.name = '测试'
  await state.submitOrganization()
  assert.equal(state.formError.value, cause.message)
  assert.deepEqual(cause.details, { reason: 'in_use' })
  state.positionForm.orgUnitId = 'org'; state.positionForm.name = '测试'
  await state.submitPosition()
  assert.match(state.formError.value, /填写名称/)
})

function onboarding(onboardEmployee) {
  const source = sources.EmployeeOnboardingModal
  const code = source.slice(source.indexOf('function onboardingFailureMessage('), source.indexOf('</script>'))
  const state = { saving: ref(false), form: { create_account: true }, events: [], onboardingFieldError: ref(null) }
  const run = new Function('formatUserError', 'form', 'saving', 'emit', 'validateUser', 'validateAccount', 'validateMembership', 'buildEmployeeOnboardingPayload', 'onboardEmployee', 'onboardingFieldError', 'nextTick', 'document', 'draftRecovery',
    `${code}; return submit;`)(formatUserError, state.form, state.saving, (...args) => state.events.push(args), () => ({ display_name: '测试员工' }), () => ({ account_name: 'test-account', initial_password: 'Test-fixture-only-1!' }), () => ({ org_unit_id: 'org-1', position_id: 'position-1', inherit_authorization: true }), (_form, { user, account }) => ({ user, account }), onboardEmployee, state.onboardingFieldError, (fn) => fn?.(), { querySelector: () => null }, { clear: () => {} })
  return { ...state, run }
}

test('新增员工遇到未知异常给出可读提示，正常成功结果与表单账号内容不被格式化逻辑改写', async () => {
  const failed = onboarding(async () => { throw new TypeError('Cannot read properties of undefined') })
  await failed.run()
  assert.equal(failed.events[0][0], 'toast')
  assert.equal(failed.events[0][1], '新增员工失败。')
  assert.equal(failed.events.some(([name]) => name === 'completed' || name === 'close'), false)
  let payload
  const result = { user: { display_name: '测试员工' }, onboarding_mode: 'ATOMIC' }
  const succeeded = onboarding(async value => { payload = value; return result })
  await succeeded.run()
  assert.equal(payload.account.initial_password, 'Test-fixture-only-1!')
  assert.deepEqual(succeeded.events.find(([name]) => name === 'completed'), ['completed', result])
  assert.equal(succeeded.events.some(([name]) => name === 'close'), true)
  assert.equal(succeeded.saving.value, false)
})

test('员工兼容入职显式消费部分成功元数据，网络和 504 不会抹去已创建阶段', async () => {
  for (const [accountCreated, createAccount, pending] of [[false, true, '本地账号'], [true, true, '任职关系'], [false, false, '任职关系']]) {
    const cause = failure('Failed to fetch', { code: 'NETWORK_ERROR', status: 0, request_method: 'POST', requestID: 'onboarding-1' })
    const wrapped = failure('untrusted internal implementation message', { code: 'NETWORK_ERROR', status: 0, cause, partialCompletion: { userCreated: true, accountCreated, membershipCreated: false } })
    const state = onboarding(async () => { throw wrapped })
    state.form.create_account = createAccount
    await state.run()
    const message = state.events.find(([name]) => name === 'toast')[1]
    assert.match(message, accountCreated ? /员工档案和本地账号已创建/ : /员工档案已创建/)
    assert.ok(message.includes(`${pending}创建尚未确认完成`))
    assert.match(formatUserError(message), /已创建.*勿重复新增员工/)
    assert.doesNotMatch(message, /untrusted|Failed to fetch/)
    assert.equal(cause.requestID, 'onboarding-1')
    assert.equal(state.events.some(([name]) => name === 'completed'), false)
  }
})

test('真实入职 API 的 404 降级链路在账号／任职超时或网络中断后保留阶段与诊断，UI 不重试', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const stage of ['accounts', 'memberships']) {
      for (const mode of ['timeout', 'network']) {
        const requests = []
        const transportCause = new TypeError('Failed to fetch')
        const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
        globalThis.fetch = async (url, options) => {
          requests.push({ url, method: options.method, body: JSON.parse(options.body) })
          if (url === '/api/v1/employees') return json(404, { code: 'NOT_FOUND', message: '原子入职接口未部署' })
          if (url === '/api/v1/users') return json(201, { data: { user_id: 'user-created-1' } })
          if (url === `/api/v1/${stage}`) {
            if (mode === 'network') throw transportCause
            return json(504, { code: 'IAM_SERVICE_TIMEOUT', message: 'SQLSTATE sensitive implementation', request_id: 'onboarding-timeout-1', details: { reason: 'service_timeout', fields: [{ field: 'user_id', rule: 'required' }] } })
          }
          if (url === '/api/v1/accounts') return json(201, { data: { account_id: 'account-created-1' } })
          assert.fail(`unexpected request ${url}`)
        }
        let observed
        const state = onboarding(async payload => {
          try { return await realOnboardEmployee(payload) }
          catch (error) { observed = error; throw error }
        })
        await state.run()
        const expectedPaths = ['/api/v1/employees', '/api/v1/users', '/api/v1/accounts', ...(stage === 'memberships' ? ['/api/v1/memberships'] : [])]
        assert.deepEqual(requests.map(request => request.url), expectedPaths)
        assert.ok(requests.every(request => request.method === 'POST'))
        assert.equal(requests[2].body.initial_password, 'Test-fixture-only-1!')
        assert.equal(requests[2].body.user_id, 'user-created-1')
        assert.ok(observed instanceof ApiIamError)
        assert.ok(observed.cause instanceof ApiIamError)
        assert.deepEqual(observed.partialCompletion, { userCreated: true, accountCreated: stage === 'memberships', membershipCreated: false })
        assert.equal(observed.code, mode === 'network' ? 'NETWORK_ERROR' : 'IAM_SERVICE_TIMEOUT')
        assert.equal(observed.status, mode === 'network' ? 0 : 504)
        assert.equal(observed.request_method, 'POST')
        assert.equal(observed.context.method, 'POST')
        assert.equal(observed.context.path, `/${stage}`)
        assert.equal(observed.cause.code, observed.code)
        if (mode === 'network') assert.equal(observed.cause.cause, transportCause)
        else {
          assert.equal(observed.requestID, 'onboarding-timeout-1')
          assert.deepEqual(observed.details, { reason: 'service_timeout', fields: [{ field: 'user_id', rule: 'required' }] })
          assert.equal(observed.cause.requestID, observed.requestID)
        }
        const toast = state.events.find(([event]) => event === 'toast')[1]
        assert.match(formatUserError(toast), stage === 'memberships' ? /员工档案和本地账号已创建/ : /员工档案已创建/)
        assert.match(toast, /尚未确认完成.*勿重复新增员工/)
        assert.doesNotMatch(toast, /未创建|创建失败|SQLSTATE|Failed to fetch|sensitive|Test-fixture/)
        assert.doesNotMatch(observed.message, /未创建|创建失败|SQLSTATE|sensitive/)
        assert.equal(state.events.some(([event]) => event === 'completed' || event === 'close'), false)
      }
    }
  } finally { globalThis.fetch = originalFetch }
})

function iamFunction(start, end, state, dependencies, { source = sources.IamSettingsModule } = {}) {
  const code = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
  return new Function(...Object.keys(state), ...Object.keys(dependencies), `${code}; return ${start.match(/function (\w+)/)[1]};`)(...Object.values(state), ...Object.values(dependencies))
}

function passwordResetFunction(start, end, state, dependencies) {
  return iamFunction(start, end, state, dependencies, { source: passwordResetSource })
}

const SCHEDULE_SENSITIVE_CLEAR_STUB = { scheduleSensitiveClipboardClear: () => ({ supported: false }) }

test('IAM 列表加载异常使用中文面板名，原错误诊断未被转换器改写', async () => {
  const state = { loading: { users: false }, errorMessage: ref(''), panels: [{ key: 'users', label: '用户' }] }
  const run = iamFunction('async function safeCall(', '\nfunction updatePage(', state, { formatUserError })
  const cause = failure('SQLSTATE HY000: SELECT secret', { status: 500, code: 'INTERNAL_ERROR', details: { field: 'test' }, traceId: 'iam-1' })
  assert.equal(await run('users', async () => { throw cause }), null)
  assert.doesNotMatch(state.errorMessage.value, /SQLSTATE|SELECT|users/)
  assert.equal(state.loading.users, false)
  assert.equal(cause.traceId, 'iam-1')
  assert.equal(cause.code, 'INTERNAL_ERROR')
})

test('账号密码重置后列表刷新失败明确保留成功事实与一次性凭据，不鼓励重复重置', async () => {
  const state = { selectedPasswordResetAccount: ref({ account_id: 'account-1', account_name: 'test-user', password_initialized: true, version: 1 }), resettingPassword: ref(false), passwordResetDialog: ref({}), temporaryPassword: ref(null), detail: ref(null), detailAuthorizationRequestSeq: ref(0) }
  const messages = []
  const run = passwordResetFunction('async function confirmPasswordReset(', '\nasync function copyTemporaryPassword(', state, { formatUserError, IamError, emitToast: message => messages.push(formatUserError(message)), resetAccountPassword: async () => ({ account_id: 'account-1', temporary_password: 'Test-fixture-only-2!' }), loadAccounts: async () => { throw new Error('SQLSTATE password=internal-only') }, loadAuthorizationOverview: async () => {}, copyText: async () => true, ...SCHEDULE_SENSITIVE_CLEAR_STUB })
  await run()
  assert.equal(state.temporaryPassword.value.value, 'Test-fixture-only-2!')
  assert.equal(state.passwordResetDialog.value, null)
  assert.equal(state.resettingPassword.value, false)
  assert.match(messages[0], /密码已重置.*账号列表未刷新.*勿重复重置/)
  assert.doesNotMatch(messages[0], /SQLSTATE|internal-only|Test-fixture/)
})

test('密码重置请求失败即使已有旧临时凭据，也不虚构本次已重置成功', async () => {
  const previous = { value: 'Test-fixture-old-only!' }
  const state = { selectedPasswordResetAccount: ref({ account_id: 'account-1', password_initialized: true }), resettingPassword: ref(false), passwordResetDialog: ref({}), temporaryPassword: ref(previous), detail: ref(null), detailAuthorizationRequestSeq: ref(0) }
  const messages = []
  const run = passwordResetFunction('async function confirmPasswordReset(', '\nasync function copyTemporaryPassword(', state, { formatUserError, IamError, emitToast: text => messages.push(text), resetAccountPassword: async () => { throw failure('当前账号不允许重置密码。', { status: 403 }) }, loadAccounts: async () => assert.fail('no refresh after refusal'), loadAuthorizationOverview: async () => {}, copyText: async () => true, ...SCHEDULE_SENSITIVE_CLEAR_STUB })
  await run()
  assert.equal(state.temporaryPassword.value, previous)
  assert.equal(messages[0], '当前账号不允许重置密码。')
  assert.doesNotMatch(messages[0], /密码已重置/)
})

test('IAM 本地用户先成功、账号失败时保留用户事实而不是泛化网络失败', async () => {
  const state = { editor: ref({ kind: 'user' }), saving: ref(false), form: { display_name: '测试', account_name: 'test', initial_password: 'Test-fixture-only-3!', validity_mode: 'PERMANENT' } }
  const calls = [], messages = []
  const cause = failure('Failed to fetch', { status: 0, code: 'NETWORK_ERROR', request_method: 'POST', requestID: 'local-account-1', details: { reason: 'unavailable' } })
  const run = iamFunction('async function saveEditor(', '\n// 全局 ESC', state, {
    formatUserError, IamError, AuthorizationError: class extends Error {},
    emitToast: message => messages.push(formatUserError(message)), validateUserInput: () => ({ displayName: '测试' }), validateLocalAccountInput: (_name, password) => ({ accountName: 'test', password }),
    createUser: async () => { calls.push('user'); return { user_id: 'user-1' } }, createLocalAccount: async payload => { calls.push('account'); assert.equal(payload.initialPassword, 'Test-fixture-only-3!'); throw cause },
    loadUsers: async () => { calls.push('users-refresh') }, loadAccounts: async () => { calls.push('accounts-refresh') }, closeEditor: () => assert.fail('partial failure must not close editor'),
  })
  await run()
  assert.deepEqual(calls, ['user', 'account', 'users-refresh', 'accounts-refresh'])
  assert.match(messages[0], /用户已创建.*登录账号创建尚未确认完成.*勿重复新增用户/)
  assert.doesNotMatch(messages[0], /Failed to fetch|Test-fixture/)
  assert.equal(cause.code, 'NETWORK_ERROR')
  assert.equal(cause.requestID, 'local-account-1')
  assert.equal(state.saving.value, false)
})

test('岗位授权模板配置的未知异常被过滤，精确中文拒绝仍可见', async () => {
  const source = sources.PositionAuthorizationTemplates
  const code = source.slice(source.indexOf('async function saveAssignments()'), source.indexOf('\nfunction runAssignmentDuplicateCheck('))
  for (const [cause, expected] of [[new TypeError('Cannot read properties of null'), /保存岗位授权配置失败/], [failure('当前岗位存在互斥授权，请先解除冲突。', { status: 409 }), /互斥授权/]]) {
    // assignmentsLoading / loadedAssignmentsPositionId 是保存前的岗位绑定加载闸门：
    // 夹具把它们置为"已加载完成当前岗位"，并提供日期保留所需的原始条目，
    // 以便真实执行到服务端写入及其错误边界。
    const state = { canManageAuthorization: ref(true), selectedPositionId: ref('position-1'), assignedTemplateIds: ref(['template-1']), assignedTemplateEntries: ref([{ template_id: 'template-1', status: 'ACTIVE', valid_from: null, valid_until: null }]), saving: ref(false), assignmentsLoading: ref(false), loadedAssignmentsPositionId: ref('position-1'), assignmentsRevision: ref('revision-1'), assignmentsNotice: ref(''), savingAssignments: ref(false), assignmentsRequestSeq: 1, isCurrentAssignmentsRequest: () => true }
    const messages = [], requests = []
    const run = new Function(...Object.keys(state), 'formatUserError', 'emit', 'replacePositionAuthorizationTemplateAssignments', 'loadPreview', 'loadEditorPreview', 'runAssignmentDuplicateCheck', `${code}; return saveAssignments;`)(...Object.values(state), formatUserError, (_event, message) => messages.push(message), async (positionId, assignments, expectedRevision) => { requests.push({ positionId, assignments, expectedRevision }); throw cause }, async () => {}, async () => {}, () => {})
    await run()
    assert.deepEqual(requests, [{ positionId: 'position-1', expectedRevision: 'revision-1', assignments: [{ template_id: 'template-1', status: 'ACTIVE', valid_from: null, valid_until: null }] }])
    assert.match(messages[0], expected)
    assert.doesNotMatch(messages[0], /TypeError|Cannot read/)
    assert.equal(state.saving.value, false)
  }
})

test('限定的 4 个 IAM 展示组件不存在原始 message 直通边界', () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /import \{ formatUserError \} from '\.\.\/\.\.\/\.\.\/shared\/utils\/userError\.js'/, name)
    assert.doesNotMatch(source, /(?:error|accountError)\??\.message\s*\|\||instanceof (?:IamError|AuthorizationError)\s*\?\s*error\.message/, name)
  }
})
