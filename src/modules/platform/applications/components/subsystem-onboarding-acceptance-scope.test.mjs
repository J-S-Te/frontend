import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequestScope } from '../../shared/composables/requestScope.js'

// 行为级用例：从 SubsystemOnboardingModule.vue 提取真实实现（批次 1 风格），覆盖
// 1) 受理/进度查询分离：部署/接管受理成功后，进度轮询失败只提示状态查询暂时失败，
//    不误报“部署 Agent 操作失败”，也不重复发起部署请求（R01 同族）；
// 2) 环境读取链 requestScope 失效：切换应用后旧响应的数据/错误回写与 finally 清理
//    不得命中新页面（R04/R05）。

const ref = (value) => ({ value })
// VM 新领域创建的对象原型与本领域不同，先 JSON 归一再做 deepEqual（同批次 1 风格）。
const plain = (value) => JSON.parse(JSON.stringify(value))
const source = readFileSync(fileURLToPath(new URL('./SubsystemOnboardingModule.vue', import.meta.url)), 'utf8')

// 等待当前全部微任务排空，使被测函数推进到下一个挂起点。
const settle = () => new Promise((resolve) => setImmediate(resolve))

function functions(names, context) {
  const bodies = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    assert.ok(start >= 0, `missing ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  return vm.runInNewContext(`${bodies.join('\n')}\n;({${names.join(',')}})`, context)
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function deployHarness() {
  const submitted = []
  const toasts = []
  const errors = []
  const polls = []
  const reloads = []
  const actionPending = deferred()
  const pollPending = deferred()
  const context = {
    selectedApplication: ref({ application_id: 'app-1', code: 'app_a' }),
    canManageRuntime: ref(true),
    saving: ref(false),
    isManagedRuntimeTarget: () => true,
    clearError: () => errors.push({ type: 'clear' }),
    retrySubsystem: () => { submitted.push('retry'); return actionPending.promise },
    updateSubsystemRuntime: () => { submitted.push('update'); return actionPending.promise },
    notify: (message) => toasts.push(message),
    waitForDeploymentCompletion: () => { polls.push(1); return pollPending.promise },
    setDeploymentFailure: (state, fallback) => errors.push({ type: 'failure', fallback }),
    setError: (error, fallback) => errors.push({ type: 'error', message: error?.message || fallback, fallback }),
    loadEnvironments: () => { reloads.push(1) },
    errorNextAction: ref(''),
  }
  const extracted = functions(['reapplyEnvironment', 'setDeploymentTrackingError'], context)
  return { context, extracted, submitted, toasts, errors, polls, reloads, actionPending, pollPending }
}

function adoptionHarness() {
  const submitted = []
  const toasts = []
  const errors = []
  const polls = []
  const reloads = []
  const actionPending = deferred()
  const pollPending = deferred()
  const context = {
    selectedApplication: ref({ application_id: 'app-1', code: 'app_a' }),
    pendingRuntimeAdoption: ref({ environment: 'prod', base_url: '', upstream_url: '', path_prefix: '', issuer_alias: '' }),
    environmentStatus: () => 'UNMANAGED',
    canManageRuntime: ref(true),
    saving: ref(false),
    isManagedRuntimeTarget: () => true,
    clearError: () => errors.push({ type: 'clear' }),
    adoptSubsystemRuntime: () => { submitted.push('adopt'); return actionPending.promise },
    notify: (message) => toasts.push(message),
    waitForDeploymentCompletion: () => { polls.push(1); return pollPending.promise },
    setDeploymentFailure: (state, fallback) => errors.push({ type: 'failure', fallback }),
    setError: (error, fallback) => errors.push({ type: 'error', message: error?.message || fallback, fallback }),
    loadEnvironments: () => { reloads.push(1) },
    errorNextAction: ref(''),
  }
  const extracted = functions(['confirmRuntimeAdoption', 'setDeploymentTrackingError'], context)
  return { context, extracted, submitted, toasts, errors, polls, reloads, actionPending, pollPending }
}

function reportedError(errors) {
  return errors.filter((entry) => entry.type === 'error').pop()
}

test('部署受理成功后进度轮询失败：只提示状态查询暂时失败，不误报操作失败且不重复发起部署', async () => {
  const h = deployHarness()
  const running = h.extracted.reapplyEnvironment({ environment: 'prod' }, false)
  h.actionPending.resolve({ status: 'UPDATING' })
  await settle()
  assert.match(h.toasts[0], /部署已受理/)
  assert.equal(h.polls.length, 1)
  h.pollPending.reject(new Error('status endpoint down'))
  await settle()
  await running
  assert.equal(h.submitted.length, 1, '轮询失败不得重复发起部署请求')
  assert.equal(h.polls.length, 1, '轮询失败不得自动重试状态查询')
  const reported = reportedError(h.errors)
  assert.match(reported.message, /已受理/)
  assert.match(reported.message, /部署状态暂时查询失败/)
  assert.doesNotMatch(reported.message, /部署 Agent 操作失败/, '进度查询失败不得报成操作失败')
  assert.match(h.context.errorNextAction.value, /无需重复发起部署操作/)
  assert.equal(h.context.saving.value, false, 'finally 必须释放保存状态')
  assert.equal(h.reloads.length, 0, '受理后的查询失败路径不再刷新目录，保持准确提示')
})

test('重试部署受理成功后轮询失败：同样只提示查询失败，且重试请求本身只发出一次', async () => {
  const h = deployHarness()
  const running = h.extracted.reapplyEnvironment({ environment: 'prod' }, true)
  h.actionPending.resolve({ status: 'PROVISIONING' })
  await settle()
  h.pollPending.reject(new Error('status endpoint down'))
  await settle()
  await running
  assert.deepEqual(h.submitted, ['retry'])
  const reported = reportedError(h.errors)
  assert.match(reported.message, /已受理/)
  assert.doesNotMatch(reported.message, /部署 Agent 操作失败/)
})

test('受理本身被拒绝：仍按操作失败提示（受理/查询失败两侧语义分离）', async () => {
  const h = deployHarness()
  const running = h.extracted.reapplyEnvironment({ environment: 'prod' }, true)
  h.actionPending.reject(new Error('agent rejected the retry'))
  await settle()
  await running
  assert.equal(h.polls.length, 0, '受理失败不得进入进度轮询')
  assert.equal(reportedError(h.errors).fallback, '部署 Agent 操作失败。')
  assert.equal(h.context.saving.value, false)
})

test('运行时接管受理成功后轮询失败：提示接管已受理而非接管失败', async () => {
  const h = adoptionHarness()
  const running = h.extracted.confirmRuntimeAdoption()
  h.actionPending.resolve({ status: 'PROVISIONING' })
  await settle()
  h.pollPending.reject(new Error('status endpoint down'))
  await settle()
  await running
  assert.deepEqual(h.submitted, ['adopt'])
  const reported = reportedError(h.errors)
  assert.match(reported.message, /运行时接管已受理/)
  assert.doesNotMatch(reported.message, /接管运行时失败/, '进度查询失败不得报成接管操作失败')
})

test('受理后轮询到 READY：完成提示与刷新行为保持现状', async () => {
  const h = deployHarness()
  const running = h.extracted.reapplyEnvironment({ environment: 'prod' }, false)
  h.actionPending.resolve({ status: 'UPDATING' })
  await settle()
  h.pollPending.resolve({ status: 'READY', state: { status: 'READY' } })
  await settle()
  await running
  assert.match(h.toasts[1], /子系统部署完成/)
  assert.equal(h.reloads.length, 1, '终态后仍刷新环境状态')
})

function environmentChainHarness(statusForAppA) {
  const statusCalls = []
  const projectionCalls = []
  const errors = []
  const pendingA = deferred()
  const pendingB = deferred()
  const statusA = deferred()
  const context = {
    selectedApplication: ref({ application_id: 'A', code: 'app_a' }),
    environmentRequestScope: createRequestScope(),
    canReadEnvironments: ref(true),
    environments: ref([]),
    selectedEnvironmentId: ref(''),
    deploymentStates: ref({}),
    deploymentStatusErrors: ref({}),
    keycloakSwitchStates: ref({}),
    keycloakProjectionAlert: ref(null),
    keycloakProjectionFailures: ref([]),
    environmentsLoading: ref(false),
    listEnvironments: ({ applicationId }) => (applicationId === 'A' ? pendingA.promise : pendingB.promise),
    visibleSubsystemEnvironments: (items) => items || [],
    getSubsystemStatus: ({ applicationCode }) => {
      statusCalls.push(applicationCode)
      return applicationCode === 'app_a' ? statusA.promise : Promise.resolve({ status: 'READY' })
    },
    deploymentStatusError: (error) => ({ message: `状态读取失败：${error.message}` }),
    getKeycloakIntegrationStatus: () => Promise.resolve({ switch_ready: false }),
    loadKeycloakProjectionOperations: (applicationCode) => { projectionCalls.push(applicationCode) },
    setError: (error, fallback) => errors.push(error?.message || fallback),
  }
  const { loadEnvironments } = functions(['loadEnvironments'], context)
  return { context, loadEnvironments, pendingA, pendingB, statusA, statusCalls, projectionCalls, errors }
}

test('切换应用后旧环境响应不回写、旧 finally 不关闭新 loading（requestScope 失效，R04/R05）', async () => {
  const h = environmentChainHarness()

  const first = h.loadEnvironments()
  await settle()
  assert.equal(h.context.environmentsLoading.value, true)

  // 模拟切换应用：新的读取开启新票据，使在途的 A 请求整体失效。
  h.context.selectedApplication.value = { application_id: 'B', code: 'app_b' }
  const second = h.loadEnvironments()
  await settle()

  // A 的旧响应此时才返回：数据与 finally 都不得命中当前页面。
  h.pendingA.resolve({ items: [{ environment: 'dev', environment_id: 'dev-a' }] })
  await settle()
  await first
  assert.equal(h.context.environments.value.length, 0, '旧应用的环境列表不得写回')
  assert.equal(h.context.environmentsLoading.value, true, '旧请求的 finally 不得关闭新请求的 loading')
  assert.equal(h.statusCalls.filter((call) => call === 'app_a').length, 0, '失效链路不得继续查询部署状态')

  // B 正常完成：数据、状态与 finally 都正常回写。
  h.pendingB.resolve({ items: [{ environment: 'prod', environment_id: 'prod-b' }] })
  await settle()
  await second
  assert.equal(h.context.environments.value.length, 1)
  assert.equal(h.context.environmentsLoading.value, false)
  assert.deepEqual(plain(h.context.deploymentStates.value), { prod: { status: 'READY' } })
  assert.deepEqual(plain(h.context.keycloakSwitchStates.value), { 'prod-b': { switch_ready: false } })
  assert.deepEqual(h.projectionCalls, ['app_b'], '只有当前应用的投影告警链继续执行')
  assert.equal(h.errors.length, 0)
})

test('切换应用后旧链路挂起中的部署状态查询失败不得污染新页面', async () => {
  const h = environmentChainHarness()

  const first = h.loadEnvironments()
  await settle()
  // A 的环境列表先正常返回，链路停在部署状态查询上。
  h.pendingA.resolve({ items: [{ environment: 'dev', environment_id: 'dev-a' }] })
  await settle()
  assert.deepEqual(h.context.environments.value.map((item) => item.environment_id), ['dev-a'])

  // 切换应用后，A 挂起中的状态查询才失败。
  h.context.selectedApplication.value = { application_id: 'B', code: 'app_b' }
  const second = h.loadEnvironments()
  await settle()
  h.statusA.reject(new Error('agent down'))
  await settle()
  await first
  assert.deepEqual(plain(h.context.deploymentStatusErrors.value), {}, '旧链路的状态错误不得写回')
  assert.deepEqual(plain(h.context.deploymentStates.value), {}, '旧链路不得写回部署状态')
  assert.equal(h.context.environmentsLoading.value, true, '旧链路的 finally 不得关闭新 loading')

  h.pendingB.resolve({ items: [{ environment: 'prod', environment_id: 'prod-b' }] })
  await settle()
  await second
  assert.deepEqual(h.context.environments.value.map((item) => item.environment_id), ['prod-b'], '新应用的环境列表保持不变')
  assert.deepEqual(plain(h.context.deploymentStates.value), { prod: { status: 'READY' } })
  assert.deepEqual(plain(h.context.deploymentStatusErrors.value), {})
  assert.equal(h.context.environmentsLoading.value, false)
  assert.equal(h.errors.length, 0, '旧链路不得触发页面级错误')
})
