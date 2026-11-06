import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { buildManualRecoveryDecision } from '../utils/subsystemAccessRecovery.mjs'

const panel = readFileSync(new URL('./SubsystemAccessRecoveryPanel.vue', import.meta.url), 'utf8')
const wizard = readFileSync(new URL('./SubsystemAccessWizard.vue', import.meta.url), 'utf8')

/** loadFunction 加载组件实际命令函数，不执行浏览器或真实网络。
 * 参数：source为组件源码，name为命令名，context为隔离Vue状态和用例替身。
 * 返回值：可执行命令；缺失绑定立即失败。
 */
function loadFunction(source, name, context) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `missing component action: ${name}`)
  const begin = source.slice(start - 6, start) === 'async ' ? start - 6 : start
  const tail = source.slice(begin)
  return vm.runInNewContext(`(${tail.slice(0, tail.indexOf('\n}\n') + 2)})`, context)
}

const baseline = { operation_id: 'operation-1', operation_version: 5, generation: 7,
  application_code: 'contract_management', environment: 'prod', manifest_checksum: 'sha256:manifest-receipt',
  error_code: 'DEPLOYMENT_EFFECT_UNKNOWN', evidence_digest: 'a'.repeat(64),
  runtime_files: [{ path: 'runtime/contract.env', present: true }], containers: [{ service_id: 'contract-api' }],
  mode: 'fenced', receipt_manifest_checksum: 'sha256:manifest-receipt',
  current_profile_checksum: 'sha256:manifest-receipt' }

// 原代次清单已被发布流程替换：后端显式返回空的运行事实，只下发两份清单校验和。
const superseded = { ...baseline, mode: 'superseded', evidence_digest: '',
  runtime_files: [], containers: [], current_profile_checksum: 'sha256:manifest-published-later' }

const reason = '已核对原始错误、运行文件及实际容器事实。'

function panelContext(overrides = {}) {
  return {
    props: { operationId: 'operation-1' }, generation: 0, disposed: false,
    canSubmit: { value: true }, busy: { value: false }, error: { value: '' }, resolved: { value: false },
    preview: { value: baseline }, confirmed: { value: true }, confirmedSuperseded: { value: false },
    reason: { value: reason },
    terminalErrorCode: { value: 'OPERATOR_ABANDONED' },
    root: { value: { scrollIntoView() {} } },
    buildManualRecoveryDecision, formatUserError: error => error.message,
    abandonSubsystemAccessRecovery: async () => ({ operation_id: 'operation-1', status: 'FAILED', error_code: 'OPERATOR_ABANDONED' }),
    emit: () => {},
    ...overrides,
  }
}

test('人工失败收口不会被父向导当成部署成功，两种收口码都被识别', () => {
  const events = [], applied = []
  const context = { operation: { value: { operation_id: 'operation-1' } },
    applyOperationPayload: value => applied.push(value), emit: (name) => events.push(name) }
  const accept = loadFunction(wizard, 'acceptManualRecovery', context)
  accept({ operation_id: 'operation-1', status: 'SUCCEEDED', error_code: '' })
  assert.equal(applied.length, 0)
  accept({ operation_id: 'operation-1', status: 'FAILED', error_code: 'OPERATOR_ABANDONED' })
  accept({ operation_id: 'operation-1', status: 'FAILED', error_code: 'DEPLOYMENT_SUPERSEDED_UNKNOWN' })
  assert.equal(applied.length, 2)
  // 其他失败原因（例如真正的部署失败）不在此处收口，避免覆盖真实事实。
  accept({ operation_id: 'operation-1', status: 'FAILED', error_code: 'RUNTIME_APPROVAL_MISSING' })
  assert.equal(applied.length, 2)
  assert.equal(events.includes('completed'), false)
})

test('旧操作预检迟到响应不能进入新操作的核对表单', async () => {
  let complete
  const context = { props: { operationId: 'operation-1' }, generation: 0, disposed: false,
    busy: { value: false }, error: { value: '' }, preview: { value: null },
    confirmed: { value: true }, confirmedSuperseded: { value: true },
    previewSubsystemAccessRecovery: () => new Promise(resolve => { complete = resolve }),
    formatUserError: error => error.message }
  const pending = loadFunction(panel, 'readPreview', context)()
  context.props.operationId = 'different-operation'
  complete(baseline)
  await pending
  assert.equal(context.preview.value, null)
})

test('终止响应只接受明确人工失败收口，绝不自动重试', async () => {
  for (const [payload, expectedResolved] of [
    [{ status: 'FAILED', error_code: 'OPERATOR_ABANDONED' }, true],
    [{ status: 'SUCCEEDED', error_code: 'OPERATOR_ABANDONED' }, false],
    // fenced 路径收到取代收口码：状态与模式不符，仍按"结果未明确"处理。
    [{ status: 'FAILED', error_code: 'DEPLOYMENT_SUPERSEDED_UNKNOWN' }, false],
  ]) {
    const events = []
    const context = panelContext({
      abandonSubsystemAccessRecovery: async () => ({ operation_id: 'operation-1', ...payload }),
      emit: name => events.push(name),
    })
    await loadFunction(panel, 'submitDecision', context)()
    assert.equal(context.resolved.value, expectedResolved, JSON.stringify(payload))
    assert.deepEqual(events, expectedResolved ? ['resolved'] : [])
  }
})

test('取代收口只提交两份清单校验和，并要求第二确认', async () => {
  const submitted = []
  const context = panelContext({
    preview: { value: superseded }, confirmedSuperseded: { value: true },
    terminalErrorCode: { value: 'DEPLOYMENT_SUPERSEDED_UNKNOWN' },
    abandonSubsystemAccessRecovery: async (id, body) => {
      submitted.push(body)
      return { operation_id: id, status: 'FAILED', error_code: 'DEPLOYMENT_SUPERSEDED_UNKNOWN' }
    },
  })
  await loadFunction(panel, 'submitDecision', context)()
  assert.equal(context.resolved.value, true)
  assert.deepEqual(submitted, [{
    expected_version: 5, generation: 7, mode: 'superseded',
    receipt_manifest_checksum: 'sha256:manifest-receipt',
    current_profile_checksum: 'sha256:manifest-published-later', reason,
  }])
  assert.equal('evidence_digest' in submitted[0], false)
})

test('未做第二确认时取代收口不会发出请求', async () => {
  let calls = 0
  const context = panelContext({
    preview: { value: superseded }, confirmedSuperseded: { value: false },
    terminalErrorCode: { value: 'DEPLOYMENT_SUPERSEDED_UNKNOWN' },
    abandonSubsystemAccessRecovery: async () => { calls++; return {} },
  })
  await loadFunction(panel, 'submitDecision', context)()
  assert.equal(calls, 0)
  assert.equal(context.resolved.value, false)
})

test('前往人工核验会定位面板并只读取一次预检', async () => {
  let positioned = 0, reads = 0
  const context = {
    bringIntoView() { positioned++ },
    nextTick: async () => {},
    preview: { value: null }, busy: { value: false }, resolved: { value: false },
    readPreview: async () => { reads++ },
  }
  await loadFunction(panel, 'startReview', context)()
  // 读取前先对齐一次，内容渲染后再对齐一次（否则慢加载会把面板留在视口外）。
  assert.equal(positioned, 2)
  assert.equal(reads, 1)
  // 已有核验时不重复请求：避免操作者点到按钮就覆盖已核对的表单。
  context.preview = { value: baseline }
  await loadFunction(panel, 'startReview', context)()
  assert.equal(reads, 1)
  assert.equal(positioned, 3)
})
