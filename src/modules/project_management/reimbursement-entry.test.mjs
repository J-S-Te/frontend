import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('项目仅费用参与者先取会话，无project.read不请求工作区快照或人员目录', async () => {
  const source = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('async function loadWorkspace('), source.indexOf('async function loadWorkspace(') + 5000)
  assert.ok(body.indexOf('await getProjectSession') < body.indexOf('listProjectsSnapshot()'))
  assert.match(body, /if \(!sessionData\.permissions\?\.includes\('project.read'\)\)/)
  assert.doesNotMatch(source, /onMounted\(loadPersonnel\)/)
})

test('项目费用摘要精确权限门禁及跳转不能传递令牌', async () => {
  const source = await readFile(new URL('./components/ReimbursementSpendPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /project\.reimbursement_spend\.read/)
  assert.match(source, /frontendModules/)
  assert.match(source, /project_id/)
  assert.doesNotMatch(source, /access_token|id_token/)
})

test('项目参与资格命令绑定当前版本和明确有效期，移除不伪造日期', async () => {
  const vm = await import('node:vm')
  const source = await readFile(new URL('./api/projectManagement.js', import.meta.url), 'utf8')
  const calls = []
  const api = vm.runInNewContext(`${source.slice(source.indexOf('export function expenseParticipantPayload')).replaceAll('export function', 'function')}\n({expenseParticipantPayload,putProjectExpenseParticipant})`, { URLSearchParams, request: (...args) => calls.push(args) })
  assert.throws(() => api.expenseParticipantPayload({ subject_id: 'u', reason: '协作', valid_from: '2026-11-10', valid_until: '2026-11-09' }), /有效起止/)
  api.putProjectExpenseParticipant('p/1', { subject_id: 'u', reason: '离开项目', version: 4 }, true)
  assert.equal(calls[0][0], '/projects/p%2F1/expense-participants')
  assert.deepEqual(JSON.parse(calls[0][1].body), { subject_id: 'u', reason: '离开项目', expected_version: 4, status: 'REVOKED' })
})

test('项目费用参与资格从人员目录选择主体，不再只靠手输未知用户ID', async () => {
  const source = await readFile(new URL('./components/ReimbursementSpendPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /listPersonnel\(\{ page: 1, page_size: 50/)
  assert.match(source, /personnelSelectOptions/)
  assert.match(source, /手动输入主体 ID/)
  assert.match(source, /personnelLabel\(person\.subject_id\)/)
})
