import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('旧审批入口和通知目的地通过统一页打开指定申请，无导航授权时给明确反馈', async () => {
  const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
  const functions = ['openApprovalTarget', 'openApprovalRequest'].map(name => {
    const body = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))?.[0]
    assert.ok(body, `应提供统一审批导航 ${name}`)
    return body
  })
  const pushes = [], notices = []
  const context = { URLSearchParams, navigation: { value: { sections: ['approvals'] } },
    router: { push: async target => pushes.push(target) }, mobileMenuOpen: { value: true },
    showToast: message => notices.push(message), formatUserError: error => error.message }
  const run = vm.runInNewContext(`${functions.join('\n')}\nopenApprovalRequest`, context)
  await run('req-1')
  assert.deepEqual(pushes, ['/project_management/approvals?request_id=req-1'])
  assert.equal(context.mobileMenuOpen.value, false)
  context.navigation.value.sections = []
  await run('req-2')
  assert.equal(pushes.length, 1)
  assert.match(notices[0], /无权/)
})


test('报告返工提交后明确提示等待技术总监审批', async () => {
  const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
  const body = source.match(/async function submitRollbackRequest\(kind\) \{[^]*?\n\}/)?.[0]
  assert.ok(body)
  const notices = [], writes = []
  const context = { canRequestRollback: { value: true }, saving: { value: false },
    promptDialog: { value: null }, selectedServiceItem: { value: {
      id: 'SI-1', status: '现场实施完成', report_status: 'COMPILING', version: 3,
    } }, captureReasonContext: items => ({ items }), askOperationReason: async () => '补测',
    requestRollback: async (...args) => writes.push(args), refreshAfterWrite: async () => {},
    showToast: message => notices.push(message), formatUserError: error => error.message }
  const run = vm.runInNewContext(`${body}\nsubmitRollbackRequest`, context)
  await run('REPORT_TO_FIELD')
  assert.equal(writes.length, 1)
  assert.match(notices[0], /等待技术总监审批/)
})
