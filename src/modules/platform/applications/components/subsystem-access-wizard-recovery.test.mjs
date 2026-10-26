import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { formatUserError, userErrorDiagnostics } from '../../../shared/utils/userError.js'
import { markApplicationScope } from '../utils/subsystemAccessFlow.mjs'
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
        emit: event => events.push(event), reportError: error => { throw error }, isNotFoundError: () => false }
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
    })()
    assert.equal(events.length, 0)
  })
}
