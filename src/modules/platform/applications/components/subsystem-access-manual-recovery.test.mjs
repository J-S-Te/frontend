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
  application_code: 'contract_management', environment: 'prod', manifest_checksum: 'manifest-1',
  error_code: 'DEPLOYMENT_EFFECT_UNKNOWN', evidence_digest: 'a'.repeat(64),
  runtime_files: [{ path: 'runtime/contract.env', present: true }], containers: [{ service_id: 'contract-api' }] }

test('人工失败收口不会被父向导当成部署成功', () => {
  const events = [], applied = []
  const context = { operation: { value: { operation_id: 'operation-1' } },
    applyOperationPayload: value => applied.push(value), emit: name => events.push(name) }
  const accept = loadFunction(wizard, 'acceptManualRecovery', context)
  accept({ operation_id: 'operation-1', status: 'SUCCEEDED', error_code: '' })
  assert.equal(applied.length, 0)
  accept({ operation_id: 'operation-1', status: 'FAILED', error_code: 'OPERATOR_ABANDONED' })
  assert.equal(applied.length, 1)
  assert.equal(events.includes('completed'), false)
})

test('旧操作预检迟到响应不能进入新操作的核对表单', async () => {
  let complete
  const context = { props: { operationId: 'operation-1' }, generation: 0, disposed: false,
    busy: { value: false }, error: { value: '' }, preview: { value: null }, confirmed: { value: false },
    previewSubsystemAccessRecovery: () => new Promise(resolve => { complete = resolve }),
    formatUserError: error => error.message }
  const pending = loadFunction(panel, 'readPreview', context)()
  context.props.operationId = 'different-operation'
  complete(baseline)
  await pending
  assert.equal(context.preview.value, null)
})

for (const status of ['FAILED', 'SUCCEEDED']) {
  test(`终止响应${status}只接受明确人工失败，绝不自动重试`, async () => {
    const events = []
    const context = { props: { operationId: 'operation-1' }, generation: 0, disposed: false,
      canSubmit: { value: true }, busy: { value: false }, error: { value: '' }, resolved: { value: false },
      preview: { value: baseline }, confirmed: { value: true }, reason: { value: '已核对原始错误、运行文件及实际容器事实。' },
      buildManualRecoveryDecision, formatUserError: error => error.message,
      abandonSubsystemAccessRecovery: async () => ({ operation_id: 'operation-1', status, error_code: 'OPERATOR_ABANDONED' }),
      emit: name => events.push(name) }
    await loadFunction(panel, 'submitDecision', context)()
    assert.equal(context.resolved.value, status === 'FAILED')
    assert.deepEqual(events, status === 'FAILED' ? ['resolved'] : [])
  })
}
