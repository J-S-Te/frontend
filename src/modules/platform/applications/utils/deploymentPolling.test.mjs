import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { formatUserError, safeUserMessage, userErrorDiagnostics } from '../../../shared/utils/userError.js'
import { ApplicationRegistryError } from '../api/applications.js'
import { pollDeployment } from './deploymentPolling.mjs'

test('deployment observer reports terminal states without more reads', async () => {
  for (const status of ['READY', 'PROVISION_FAILED', 'OFFBOARDED']) {
    let reads = 0
    assert.equal(await pollDeployment({ wait: async () => {}, readStatus: async () => {
      reads += 1
      return { status }
    } }), status)
    assert.equal(reads, 1)
  }
})
test('observer cancellation does not publish a late result', async () => {
  const controller = new AbortController()
  let published = false
  assert.equal(await pollDeployment({ signal: controller.signal, wait: async () => {},
    readStatus: async () => { controller.abort(); return { status: 'READY' } },
    onStatus: () => { published = true } }), 'CANCELLED')
  assert.equal(published, false)
})
test('unmount cancels a pending delay before any status request', async () => {
  const controller = new AbortController()
  const result = pollDeployment({ signal: controller.signal, intervalMs: 10000,
    readStatus: async () => { assert.fail('cancelled observer must not query') } })
  controller.abort()
  assert.equal(await result, 'CANCELLED')
})
test('status errors remain visible instead of being swallowed until timeout', async () => {
  await assert.rejects(pollDeployment({ wait: async () => {}, readStatus: async () => {
    throw new Error('permission denied')
  } }), /permission denied/)
})
test('timeout stops polling without reporting success', async () => {
  let clock = 0
  assert.equal(await pollDeployment({ now: () => clock, timeoutMs: 5, intervalMs: 1,
    wait: async (ms) => { clock += ms }, readStatus: async () => ({ status: 'UPDATING' }) }), 'TIMEOUT')
})

const filename = new URL('../components/SubsystemOnboardingModule.vue', import.meta.url)
const { descriptor, errors } = parse(await readFile(filename, 'utf8'), { filename: filename.pathname })
assert.deepEqual(errors, [])
const script = compileScript(descriptor, { id: 'deployment-failure-guidance' })
const methodNames = ['readableGuidance', 'setError', 'clearError', 'textValue', 'notify',
  'waitForDeploymentCompletion', 'setDeploymentFailure', 'setDeploymentTrackingError', 'reapplyEnvironment', 'confirmRuntimeAdoption']
const methods = script.scriptSetupAst.filter(node => node.type === 'FunctionDeclaration' && methodNames.includes(node.id.name))
assert.equal(methods.length, methodNames.length)
const source = methods.map(node => descriptor.scriptSetup.content.slice(node.start, node.end)).join('\n')
const ref = value => ({ value })

// 使用隔离的状态响应执行组件真实操作和观察逻辑。
function onboardingFlow({ states = [], switchApplication = false, observer = pollDeployment } = {}) {
  const application = { application_id: 'app-1', code: 'customer_and_opportunity' }
  const environment = { environment: 'prod' }
  const state = {
    selectedApplication: ref(application), selectedApplicationId: ref(application.application_id),
    canManageRuntime: ref(true), saving: ref(false), deploymentStates: ref({}),
    // 轮询回写的归属校验依赖组件 setup 中的环境列表（与真实作用域一致）。
    environments: ref([]),
    pendingRuntimeAdoption: ref(environment),
    ...Object.fromEntries(['errorMessage', 'errorNextAction', 'errorDetail', 'errorTraceId', 'errorCode', 'errorRecovery'].map(key => [key, ref('')])),
  }
  const notifications = []
  const writes = []
  let reads = 0
  let refreshes = 0
  const action = name => async () => { writes.push(name); return { status: 'PROVISIONING' } }
  const bindings = {
    ...state, formatUserError, safeUserMessage, userErrorDiagnostics, ApplicationRegistryError,
    pollDeployment: options => observer({ ...options, wait: async () => {} }),
    getSubsystemStatus: async query => {
      assert.deepEqual(query, { applicationCode: application.code, environment: environment.environment })
      assert.ok(reads < states.length, 'observer must stop at the final state')
      if (switchApplication) state.selectedApplicationId.value = 'another-application'
      return states[reads++]
    },
    updateSubsystemRuntime: action('update'), retrySubsystem: action('retry'), adoptSubsystemRuntime: action('adopt'),
    environmentStatus: () => 'UNMANAGED', isManagedRuntimeTarget: () => true,
    emit: (_name, message) => notifications.push(message),
    loadEnvironments: async () => { refreshes += 1; state.deploymentStates.value = {} },
  }
  const ui = new Function(...Object.keys(bindings), `let deploymentObserver = null; ${source}; return { ${methodNames.join(', ')} };`)(...Object.values(bindings))
  return { ...ui, state, environment, notifications, writes, reads: () => reads, refreshes: () => refreshes }
}

test('deployment failure guidance uses escaped Vue text bindings', () => {
  const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname,
    id: 'deployment-failure-guidance', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.match(descriptor.template.content, /\{\{ errorMessage \}\}/)
  assert.match(descriptor.template.content, /\{\{ errorNextAction \}\}/)
  assert.doesNotMatch(descriptor.template.content, /v-html/)
})

const flows = [
  ['update', ui => ui.reapplyEnvironment(ui.environment)],
  ['retry', ui => ui.reapplyEnvironment(ui.environment, true)],
  ['adopt', ui => ui.confirmRuntimeAdoption()],
]
for (const [name, run] of flows) {
  for (const switchApplication of [false, true]) {
    test(`${name}: final poll guidance survives refresh and application switch=${switchApplication}`, async () => {
      const failure = { status: 'PROVISION_FAILED', last_error: '部署清单与当前环境不一致。', next_action: '请联系管理员核对部署清单后重试。' }
      const ui = onboardingFlow({ switchApplication, states: [
        { status: 'UPDATING', last_error: '旧的失败原因。', next_action: '旧的处理建议。' }, failure,
      ] })
      await run(ui)
      assert.equal(ui.state.errorMessage.value, failure.last_error)
      assert.equal(ui.state.errorNextAction.value, failure.next_action)
      assert.equal(ui.state.errorDetail.value, '')
      assert.deepEqual(ui.state.deploymentStates.value, {})
      assert.equal(ui.state.saving.value, false)
      assert.deepEqual(ui.writes, [name])
      assert.equal(ui.reads(), 2)
      assert.equal(ui.refreshes(), 1)
      assert.equal(ui.notifications.length, 1, 'failure must not announce deployment success')
    })
  }

  test(`${name}: missing final details retain failure guidance`, async () => {
    const ui = onboardingFlow({ states: [{ status: 'PROVISION_FAILED' }] })
    await run(ui)
    assert.match(ui.state.errorMessage.value, /后台.*失败/)
    assert.match(ui.state.errorNextAction.value, /部署状态.*管理员/)
    assert.equal(ui.state.saving.value, false)
  })

  for (const status of ['READY', 'OFFBOARDED', 'CANCELLED', 'TIMEOUT']) {
    test(`${name}: ${status} keeps its existing result handling`, async () => {
      const ui = onboardingFlow({ observer: async () => status })
      await run(ui)
      assert.equal(ui.state.saving.value, false)
      assert.equal(ui.state.errorNextAction.value, '')
      assert.equal(ui.refreshes(), status === 'CANCELLED' ? 0 : 1)
      if (status === 'TIMEOUT') assert.match(ui.state.errorMessage.value, /仍在后台执行/)
      else assert.equal(ui.state.errorMessage.value, '')
    })
  }
}

test('deployment failure displays safe fields independently and rejects raw diagnostics', () => {
  const ui = onboardingFlow()
  const fallback = '后台部署失败，请查看部署状态。'
  const unsafe = [undefined, null, {}, 42, '', 'unknown error',
    '部署失败：<script>alert(1)</script>', '部署失败：panic: goroutine 1 [running]',
    '部署失败：SQLSTATE HY000 SELECT * FROM private_table',
    '请执行 docker compose restart api', '部署失败：client_secret=private', '错误'.repeat(250)]
  for (const value of unsafe) {
    ui.setDeploymentFailure({ last_error: value, next_action: '请联系管理员确认部署配置。' }, fallback)
    assert.equal(ui.state.errorMessage.value, fallback)
    assert.equal(ui.state.errorNextAction.value, '请联系管理员确认部署配置。')
    ui.setDeploymentFailure({ last_error: '部署配置校验未通过。', next_action: value }, fallback)
    assert.equal(ui.state.errorMessage.value, '部署配置校验未通过。')
    assert.match(ui.state.errorNextAction.value, /部署状态.*管理员/)
    assert.equal(ui.state.errorDetail.value, '')
  }
  for (const state of [null, undefined, {}]) {
    ui.setDeploymentFailure(state, fallback)
    assert.equal(ui.state.errorMessage.value, fallback)
    assert.match(ui.state.errorNextAction.value, /部署状态.*管理员/)
  }
})

// ---- 统一接入向导：按操作 ID 轮询（步骤 4）----------------------------------------
test('operation polling stops on the unified operation terminal states', async () => {
  for (const status of ['SUCCEEDED', 'FAILED', 'WAITING']) {
    let reads = 0
    assert.equal(await pollDeployment({
      immediate: true,
      terminalStatuses: ['SUCCEEDED', 'FAILED', 'WAITING'],
      wait: async () => {},
      readStatus: async () => { reads += 1; return { status } },
    }), status)
    assert.equal(reads, 1)
  }
})

test('operation polling reads immediately without waiting for the first interval', async () => {
  const order = []
  assert.equal(await pollDeployment({
    immediate: true, intervalMs: 1000, terminalStatuses: ['SUCCEEDED'],
    wait: async (ms) => { order.push('wait:' + ms) },
    readStatus: async () => { order.push('read'); return { status: 'SUCCEEDED' } },
  }), 'SUCCEEDED')
  assert.deepEqual(order, ['read'])
})

test('operation polling keeps waiting while the operation is running', async () => {
  const states = ['PENDING', 'RUNNING', 'SUCCEEDED']
  let index = 0
  assert.equal(await pollDeployment({
    immediate: true, terminalStatuses: ['SUCCEEDED', 'FAILED', 'WAITING'],
    wait: async () => {},
    readStatus: async () => ({ status: states[Math.min(index++, states.length - 1)] }),
  }), 'SUCCEEDED')
  assert.equal(index, 3)
})

test('legacy deployment polling does not treat operation states as terminal by default', async () => {
  // 默认终端状态仍是 READY/PROVISION_FAILED/OFFBOARDED：统一操作状态不会误终止遗留轮询。
  let clock = 0
  const result = await pollDeployment({
    now: () => clock, timeoutMs: 5, intervalMs: 1,
    wait: async (ms) => { clock += ms },
    readStatus: async () => ({ status: 'SUCCEEDED' }),
  })
  assert.equal(result, 'TIMEOUT')
})
