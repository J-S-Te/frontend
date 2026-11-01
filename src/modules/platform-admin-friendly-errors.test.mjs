import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { formatUserError, safeUserMessage, userErrorDiagnostics } from './shared/utils/userError.js'
import { ApplicationRegistryError } from './platform/applications/api/applications.js'

const paths = {
  access: 'settings/components/PublicAccessSettingsModule.vue',
  onboarding: 'applications/components/SubsystemOnboardingModule.vue',
  dictionary: 'dictionaries/components/DictionaryManagementModule.vue',
  files: 'files/components/FileTaskOperationsModule.vue',
  security: 'security/components/LoginSecurityModule.vue',
  targets: 'login-targets/components/ApplicationLoginTargetModule.vue',
}
const components = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => {
  const filename = new URL(`./platform/${path}`, import.meta.url)
  const { descriptor, errors } = parse(await readFile(filename, 'utf8'), { filename: filename.pathname })
  assert.deepEqual(errors, [])
  return [key, { filename, descriptor, script: compileScript(descriptor, { id: `admin-errors-${key}` }) }]
})))
const ref = value => ({ value })

// 使用隔离的 API 失败执行组件真实函数；这些展示测试
// 不涉及浏览器、API 请求、业务数据或重试。
function methods(component, names, bindings = {}) {
  const { descriptor, script } = components[component]
  const selected = script.scriptSetupAst.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
  assert.equal(selected.length, names.length)
  const source = selected.map(node => descriptor.scriptSetup.content.slice(node.start, node.end)).join('\n')
  const scope = { formatUserError, safeUserMessage, userErrorDiagnostics, ApplicationRegistryError, ...bindings }
  return new Function(...Object.keys(scope), `${source}; return { ${names.join(', ')} };`)(...Object.values(scope))
}

for (const [name, { descriptor, filename, script }] of Object.entries(components)) {
  test(`${name}: Vue script and template compile with their real bindings`, () => {
    const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: `admin-errors-${name}`, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  })
}

test('public access does not append a server command and preserves precise business messages', () => {
  const { readError } = methods('access', ['readError'])
  const error = Object.assign(new Error('公开访问地址不符合公司域名要求，请重新填写。'), { status: 422, code: 'ACCESS_INVALID', nextAction: '请执行 docker compose restart api', details: { next_action: 'client_secret=private' } })
  const original = { ...error, message: error.message }
  assert.equal(readError(error), error.message)
  assert.doesNotMatch(readError(error), /docker|restart|private/)
  assert.deepEqual({ ...error, message: error.message }, original)
  assert.match(readError({ code: 'NETWORK_ERROR' }, '保存配置失败。', 'PUT'), /核对.*重复提交/)
  assert.match(readError({ code: 'NETWORK_ERROR' }), /读取|网络/)
})

test('public access save and apply failures retain uncertain-write guidance without success notifications', async () => {
  for (const operation of ['saveSettings', 'applySettings']) {
    const state = { canUpdate: ref(true), saving: ref(false), applying: ref(false), errorMessage: ref(''), savedSettings: ref(null), form: ref({ publicOrigin: '', version: 1, allowInsecureHTTPRedirect: false }), derivedInsecureHTTP: ref(false) }
    const writes = []
    const api = async () => { writes.push(operation); throw Object.assign(new Error('Failed to fetch'), { code: 'NETWORK_ERROR' }) }
    const run = methods('access', ['readError', 'normalizePublicOrigin', operation], { ...state, updateAccessSettings: api, applyAccessSettings: api, showToast: () => assert.fail('a failed write cannot announce success'), window: { confirm: () => true } })
    await run[operation]()
    assert.equal(writes.length, 1)
    assert.match(state.errorMessage.value, /核对.*重复提交/)
    assert.equal(state.saving.value, false)
    assert.equal(state.applying.value, false)
  }
})

function onboardingMethods() {
  const state = Object.fromEntries(['errorMessage', 'errorNextAction', 'errorDetail', 'errorTraceId', 'errorCode', 'errorRecovery'].map(key => [key, ref('')]))
  const notifications = []
  return { state, notifications, ...methods('onboarding', ['readableGuidance', 'deploymentStatusError', 'projectionFailureMessage', 'projectionFailureCode', 'setError', 'clearError', 'textValue', 'notify'], { ...state, emit: (_name, message) => notifications.push(message) }) }
}

test('onboarding filters raw diagnostics while keeping classification, trace and existing-environment recovery', () => {
  const ui = onboardingMethods()
  const details = { application_code: 'contract_management', environment: 'prod', next_action: '请执行 docker compose restart api', detail: '执行失败 SQLSTATE HY000 /opt/runtime/customer.env client_secret=private' }
  const error = new ApplicationRegistryError('当前环境已经接入，请查看已有环境。', { status: 409, code: 'IAM_SUBSYSTEM_ALREADY_ONBOARDED', traceId: 'safe-request-1', details })
  ui.setError(error, '接入失败。')
  assert.equal(ui.state.errorMessage.value, error.message)
  assert.match(ui.state.errorNextAction.value, /联系管理员/)
  assert.equal(ui.state.errorDetail.value, '')
  assert.equal(ui.state.errorTraceId.value, 'safe-request-1')
  assert.equal(ui.state.errorCode.value, 'IAM_SUBSYSTEM_ALREADY_ONBOARDED')
  assert.deepEqual(ui.state.errorRecovery.value, { type: 'existing-environment', applicationCode: 'contract_management', environment: 'prod', label: '查看已有环境' })
  assert.equal(error.status, 409)
  assert.equal(error.details, details)
  assert.equal(error.nextAction, details.next_action)
  ui.clearError()
  assert.equal(ui.state.errorCode.value, '')
  assert.equal(ui.state.errorRecovery.value, null)
})

test('onboarding state failures and projection summaries expose safe Chinese guidance, not SQL or commands', () => {
  const ui = onboardingMethods()
  const error = Object.assign(new Error('读取失败：Unknown column private_column in field list'), { status: 503, code: 'DEPLOYMENT_LOOKUP_FAILED', nextAction: '请重启服务后执行 docker compose up', traceId: 'req-status', details: { detail: 'internal diagnostics retained' } })
  const status = ui.deploymentStatusError(error)
  assert.doesNotMatch(status.message + status.nextAction, /Unknown column|private_column|docker|重启/)
  assert.match(status.nextAction, /管理员/)
  assert.equal(status.status, error.status)
  assert.equal(status.code, error.code)
  assert.equal(status.details, error.details)
  assert.equal(status.traceId, error.traceId)
  assert.doesNotMatch(ui.projectionFailureMessage({ error_code: 'SYNC_FAILED', error_message: '查询失败：Table db.private_table does not exist' }), /db|private_table|Table/)
  assert.equal(ui.projectionFailureCode({ error_code: 'KEYCLOAK_SYNC_FAILED' }), 'KEYCLOAK_SYNC_FAILED')
  assert.equal(ui.projectionFailureCode({ error_code: 'client_secret=private' }), 'KEYCLOAK_SYNC_FAILED')
  assert.equal(ui.readableGuidance('请重新同步授权目录后，再查询状态。'), '请重新同步授权目录后，再查询状态。')
  ui.notify('请执行 docker compose restart api')
  assert.deepEqual(ui.notifications, ['请刷新当前页面核对处理结果。'])
  ui.setError(null, '当前环境仍在部署中，请稍后查看。')
  assert.equal(ui.state.errorMessage.value, '当前环境仍在部署中，请稍后查看。')
})

test('dictionary messages preserve precise server rejections and distinguish hidden-field version errors', () => {
  const { userMessage } = methods('dictionary', ['userMessage'])
  assert.equal(userMessage({ status: 403, message: '内置字典仅允许查看，不能修改。' }, '保存失败。'), '内置字典仅允许查看，不能修改。')
  assert.equal(userMessage({ status: 422, message: '该字典项取值已经存在，请修改取值。' }, '保存失败。'), '该字典项取值已经存在，请修改取值。')
  assert.match(userMessage({ status: 422, details: { reason: 'invalid_type', field: 'version' } }, '保存失败。'), /格式与服务要求不一致/)
  assert.match(userMessage({ code: 'NETWORK_ERROR' }, '删除失败。', 'DELETE'), /核对.*重复提交/)
  assert.doesNotMatch(userMessage(new Error('查询失败：Duplicate entry private-value for key internal.index'), '查询失败。'), /private-value|internal/)
})

test('asynchronous task action and stored failure summaries use the same safe presentation boundary', async () => {
  const state = { actionJobId: ref(''), errorMessage: ref('') }
  const ui = methods('files', ['normalizeError', 'jobFailureMessage', 'operateJob'], { ...state, retryAsyncJob: async () => { throw Object.assign(new Error('Failed to fetch'), { code: 'NETWORK_ERROR' }) }, toast: () => assert.fail('failed retry must not appear successful'), loadJobs: () => assert.fail('failed retry must not automatically retry or refresh') })
  await ui.operateJob({ job_id: 'job-1' }, 'retry')
  assert.match(state.errorMessage.value, /核对.*重复提交/)
  assert.equal(state.actionJobId.value, '')
  assert.equal(ui.jobFailureMessage({}), '—')
  assert.equal(ui.jobFailureMessage({ last_error_message: '当前任务已取消，不能再次执行。' }), '当前任务已取消，不能再次执行。')
  assert.doesNotMatch(ui.jobFailureMessage({ last_error_code: 'SQL_FAILURE', last_error_message: '执行失败 SQLSTATE 42000 SELECT * FROM private_table' }), /SQLSTATE|SELECT|private_table/)
})

test('login security failures do not remove locked accounts or announce successful writes', async () => {
  const account = { account_id: 'account-1' }
  const messages = []
  const state = { canReadPolicy: ref(true), canUpdatePolicy: ref(true), canReadLockedAccounts: ref(true), canUnlockAccount: ref(true), policyLoading: ref(false), policySaving: ref(false), policyError: ref(''), lockedLoading: ref(false), lockedError: ref(''), lockedAccounts: ref([account]), loginPolicy: { version: 1, idleTimeoutSeconds: 1800 } }
  const ui = methods('security', ['loadLoginPolicy', 'saveLoginPolicy', 'loadLockedAccounts', 'handleUnlockAccount'], { ...state,
    getLoginPolicy: async () => { throw new Error('<html>private proxy page</html>') },
    updateLoginPolicy: async () => { throw Object.assign(new Error('Failed to fetch'), { code: 'NETWORK_ERROR' }) },
    listLockedAccounts: async () => { throw Object.assign(new Error('不能查看其他组织的锁定账号。'), { status: 403 }) },
    unlockAccount: async () => { throw Object.assign(new Error('执行失败 client_secret=private'), { status: 500 }) },
    emitToast: message => messages.push(message),
  })
  await ui.loadLoginPolicy()
  assert.doesNotMatch(state.policyError.value, /html|private/)
  await ui.saveLoginPolicy()
  assert.match(state.policyError.value, /核对.*重复提交/)
  await ui.handleUnlockAccount(account)
  assert.deepEqual(state.lockedAccounts.value, [account])
  assert.equal(messages.length, 1)
  assert.doesNotMatch(messages[0], /private|client_secret|已解锁/)
  await ui.loadLockedAccounts()
  assert.equal(state.lockedError.value, '不能查看其他组织的锁定账号。')
})

test('login target editor retains exact rejection and uncertain-write messages instead of generic instanceof fallbacks', async () => {
  for (const error of [Object.assign(new Error('系统内置登录目标不能修改。'), { status: 403 }), Object.assign(new Error('Failed to fetch'), { code: 'NETWORK_ERROR' })]) {
    const state = { hasBoundary: ref(true), submitting: ref(false), errorMessage: ref(''), targetUriError: ref(''), editingTarget: ref(null), form: { targetUri: '/portal', targetCode: 'portal', name: '门户', status: 'ACTIVE' }, props: { applicationId: 'app-1', environmentId: 'env-1' } }
    const ui = methods('targets', ['submitEditor'], { ...state, targetUriValidationMessage: () => '', createApplicationLoginTarget: async () => { throw error }, showToast: () => assert.fail('rejection must not announce success'), closeEditor: () => assert.fail('failed editor must remain open'), loadTargets: () => assert.fail('must not retry the command') })
    await ui.submitEditor()
    if (error.status === 403) assert.equal(state.errorMessage.value, error.message)
    else assert.match(state.errorMessage.value, /核对.*重复提交/)
    assert.equal(state.submitting.value, false)
  }
})


test('login policy keeps invalid idle values local and never submits them', async () => {
  for (const idle of [59, 1801, 3600, NaN, 60.5]) {
    let calls = 0
    const state = { canReadPolicy: ref(true), canUpdatePolicy: ref(true),
      policySaving: ref(false), policyError: ref(''), loginPolicy: { version: 1, idleTimeoutSeconds: idle } }
    const ui = methods('security', ['saveLoginPolicy'], { ...state,
      updateLoginPolicy: async () => { calls += 1 }, emitToast: () => { throw new Error('unexpected success') },
    })
    await ui.saveLoginPolicy()
    assert.equal(calls, 0)
    assert.equal(state.policySaving.value, false)
    assert.match(state.policyError.value, /60 至 1800 秒/)
    assert.ok(Object.is(state.loginPolicy.idleTimeoutSeconds, idle), 'invalid input must stay visible')
  }
})
