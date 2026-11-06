import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { formatUserError, userErrorDiagnostics } from '../../../shared/utils/userError.js'
import { markApplicationScope } from '../utils/subsystemAccessFlow.mjs'
import { isManualRecoveryCandidate } from '../utils/subsystemAccessRecovery.mjs'
const source = readFileSync(new URL('./SubsystemAccessWizard.vue', import.meta.url), 'utf8')
function load(name, context) {
  const start = source.indexOf(`function ${name}(`)
  const asyncStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start
  const tail = source.slice(asyncStart)
  return vm.runInNewContext(`(${tail.slice(0, tail.indexOf('\n}\n') + 2)})`, context)
}
test('清单允许但尚未登记的应用仍能首次接入', () => {
  const result = markApplicationScope([{ code: 'old', name: '旧系统' }], ['new', 'NEW', 'old'])
  assert.equal(result.length, 2)
  assert.equal(result.find(item => item.code === 'new')?.inScope, true)
  assert.equal(result.find(item => item.code === 'old')?.name, '旧系统')
})
test('业务错误保留安全格式化后的具体原因', () => {
  const context = { errorText: { value: '' }, errorNextAction: { value: 'old' }, errorDiagnostics: { value: {} },
    formatUserError, userErrorDiagnostics }
  load('reportError', context)({ status: 409, code: 'CONFLICT', message: '清单已变更，请重新检查条件。' }, '通用错误')
  assert.equal(context.errorText.value, '清单已变更，请重新检查条件。')
  assert.equal(context.errorNextAction.value, '')
})
for (const name of ['resumeOperation', 'reconnectTarget']) {
  for (const status of ['SUCCEEDED', 'RUNNING', 'WAITING', 'FAILED']) {
    test(`${name} ${status} 仅成功时刷新父目录`, async () => {
      const events = []; let polls = 0
      const payload = { operation_id: 'op-1', status }
      const context = { operation: { value: payload }, busy: { value: false }, canPreviewNow: { value: true }, form: {},
        clearError() {}, applyOperationPayload() {}, resumeSubsystemAccessOperation: async () => payload,
        findSubsystemAccessOperation: async () => payload, watchOperation: async () => { polls++; return 'SUCCEEDED' },
        emit: event => events.push(event), reportError: error => { throw error }, isNotFoundError: () => false,
        isManualRecoveryCandidate, focusManualRecovery: async () => {} }
      await load(name, context)()
      assert.equal(events.filter(event => event === 'completed').length, ['SUCCEEDED', 'RUNNING'].includes(status) ? 1 : 0)
      assert.equal(polls, status === 'RUNNING' ? 1 : 0)
    })
  }
}

for (const finalStatus of ['FAILED', 'WAITING', 'TIMEOUT', 'ERROR']) {
  test(`恢复轮询返回 ${finalStatus} 不误报完成`, async () => {
    const events = []
    await load('resumeOperation', {
      operation: { value: { operation_id: 'op-1' } }, busy: { value: false }, clearError() {},
      resumeSubsystemAccessOperation: async () => ({ status: 'RUNNING' }), applyOperationPayload() {},
      watchOperation: async () => finalStatus, emit: event => events.push(event), reportError: error => { throw error },
      isManualRecoveryCandidate: () => false, focusManualRecovery: async () => {},
      errorText: { value: '' }, errorNextAction: { value: '' }, errorDiagnostics: { value: {} },
      userErrorDiagnostics,
    })()
    assert.equal(events.length, 0)
  })
}

// 未知派发是服务端的持久事实：再点「继续处理」只会 409，页面必须改道人工核验。
test('等待中的部署结果未知不会被「继续处理」再次提交', async () => {
  let resumed = 0, focused = 0, cleared = 0
  await load('resumeOperation', {
    operation: { value: { operation_id: 'op-1', status: 'WAITING', stage: 'DEPLOY', error_code: 'DEPLOYMENT_EFFECT_UNKNOWN' } },
    busy: { value: false }, clearError() { cleared++ }, isManualRecoveryCandidate,
    focusManualRecovery: async () => { focused++ },
    resumeSubsystemAccessOperation: async () => { resumed++; return { status: 'RUNNING' } },
    applyOperationPayload() {}, watchOperation: async () => 'SUCCEEDED', emit() {},
    reportError(error) { throw error },
  })()
  assert.equal(resumed, 0)
  assert.equal(focused, 1)
  assert.equal(cleared, 1)
})

test('服务端 409 未知派发给出人工核验指引，而不是可重试提示', async () => {
  const failure = Object.assign(new Error('部署已派发但结果未知，不能通过恢复重排；请先人工核验原代次'), {
    status: 409, code: 'SUBSYSTEM_ACCESS_DEPLOYMENT_EFFECT_UNKNOWN',
    nextAction: '先调用该操作的 recovery-preview 核对原代次后再人工恢复；不要重复部署',
  })
  const context = {
    operation: { value: { operation_id: 'op-1', status: 'FAILED' } }, busy: { value: false },
    clearError() {}, applyOperationPayload() {}, isManualRecoveryCandidate,
    focusManualRecovery: async () => {},
    resumeSubsystemAccessOperation: async () => { throw failure },
    watchOperation: async () => 'SUCCEEDED', emit() {}, reportError() { throw new Error('不应走通用错误提示') },
    errorText: { value: '' }, errorNextAction: { value: '' }, errorDiagnostics: { value: {} },
    userErrorDiagnostics, formatUserError,
  }
  await load('resumeOperation', context)()
  assert.match(context.errorText.value, /人工核验/)
  assert.match(context.errorText.value, /结果未知/)
  assert.equal(context.errorNextAction.value, failure.nextAction)
  assert.equal(context.errorDiagnostics.value.code, 'SUBSYSTEM_ACCESS_DEPLOYMENT_EFFECT_UNKNOWN')
  assert.equal(context.busy.value, false)
})

test('「前往人工核验」在没有面板句柄时给出可执行提示，而不是静默失败', async () => {
  const context = {
    manualRecoveryPanel: { value: null },
    reportError(error, fallback) { context.errorText = fallback; context.code = error.code },
    errorText: '', code: '',
  }
  await load('focusManualRecovery', context)()
  assert.match(context.errorText, /人工核验/)
  assert.equal(context.code, 'MANUAL_RECOVERY_PANEL_UNAVAILABLE')
})

// 有面板时把操作者送到面板，并只依赖面板自己的定位与读取逻辑。
test('「前往人工核验」委托面板定位并读取预检', async () => {
  let reviewed = 0
  await load('focusManualRecovery', {
    manualRecoveryPanel: { value: { startReview: async () => { reviewed++ } } },
    reportError() { throw new Error('不应报错') },
  })()
  assert.equal(reviewed, 1)
})
