import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ref } from 'vue'
import { formatUserError } from '../../../shared/utils/userError.js'
import { buildUserAuthorizationOverview } from '../utils/userAuthorizationOverview.js'

const source = readFileSync(new URL('./useIamUserAuthorizationPreview.js', import.meta.url), 'utf8')
const componentSource = readFileSync(new URL('../components/IamSettingsModule.vue', import.meta.url), 'utf8')
const templateRole = { code: 'template', name: '岗位角色', source_type: 'POSITION', grant_origin: 'TEMPLATE' }
const manualRole = { code: 'manual', name: '个人例外角色', source_type: 'USER', grant_origin: 'MANUAL' }
const granted = { authorization_state: 'GRANTED', roles: [templateRole, manualRole], conflicts: [] }

// 用途：执行真实总览组合函数，将网络请求保留为可控制返回顺序的边界。
// 参数：targets 为当前用户总览覆盖的应用集合。
// 返回值：组合函数状态、用户详情上下文及待完成请求。
function previewHarness(targets = [{ code: 'business' }]) {
  const pending = []
  const context = {
    detail: ref({ kind: 'user', item: { user_id: 'user' } }),
    detailAuthorizationRequestSeq: ref(1), applications: ref(targets),
    canReadApplicationAuthorization: ref(true),
  }
  const factory = new Function('ref', 'getApplicationAccess', 'formatUserError',
    'buildUserAuthorizationOverview', source
      .replace(/^import .*\n/gm, '')
      .replace('export function useIamUserAuthorizationPreview', 'function useIamUserAuthorizationPreview')
      + '\nreturn useIamUserAuthorizationPreview;')
  const controller = factory(ref, (userId, code) => new Promise((resolve, reject) => {
    pending.push({ userId, code, resolve, reject })
  }), formatUserError, buildUserAuthorizationOverview)(context)
  return { ...controller, context, pending }
}

test('有效总览同时展示模板与个人例外，管理集合中的未来例外不冒充有效角色', async () => {
  const h = previewHarness()
  const loading = h.loadUserAuthorizationPreview('user')
  h.pending[0].resolve({
    ...granted, inherited_roles: [templateRole],
    manual_roles: [manualRole, { code: 'future', valid_from: '2030-01-01T00:00:00Z' }],
  })
  await loading

  const row = h.userAuthorizationPreview.value.applications[0]
  assert.equal(row.effective_role_count, 2)
  assert.deepEqual(row.role_groups.map((role) => role.code), ['template', 'manual'])
  assert.deepEqual(row.role_groups.map((role) => role.sources[0].source_label), ['岗位模板', '个人例外'])
})

test('模板映射后同一用户的新刷新优先，迟到旧响应不能覆盖模板和个人例外', async () => {
  const h = previewHarness()
  const old = h.loadUserAuthorizationPreview('user')
  const fresh = h.loadUserAuthorizationPreview('user')
  h.pending[1].resolve(granted)
  await fresh
  h.pending[0].resolve({ ...granted, roles: [] })
  await old

  assert.deepEqual(h.userAuthorizationPreview.value.effective_roles.map((role) => role.code),
    ['template', 'manual'])
})

test('不同应用并行重试分别合并最新结果，后完成的请求不恢复其他应用旧快照', async () => {
  const h = previewHarness([{ code: 'a' }, { code: 'b' }])
  const loading = h.loadUserAuthorizationPreview('user')
  h.pending.slice(0, 2).forEach((request) => request.resolve({ ...granted, roles: [] }))
  await loading
  const a = h.retryUserAuthorizationPreview('a')
  const b = h.retryUserAuthorizationPreview('b')
  h.pending[2].resolve({ ...granted, roles: [templateRole] })
  await a
  h.pending[3].resolve({ ...granted, roles: [manualRole] })
  await b

  assert.deepEqual(h.userAuthorizationPreview.value.applications.map((row) =>
    [row.application_code, row.effective_role_count, row.read_status]),
  [['a', 1, 'SUCCESS'], ['b', 1, 'SUCCESS']])
})

test('个人例外保存遇到总览刷新时重新读取完整目标集合，保留平台与模板角色', async () => {
  const h = previewHarness([{ code: 'platform' }, { code: 'business' }])
  const old = h.loadUserAuthorizationPreview('user')
  const start = componentSource.indexOf('async function refreshPersonalExceptionOverview(')
  const body = componentSource.slice(start, componentSource.indexOf('\n}', start) + 2)
  const context = { ...h.context, ...h, applications: ref([{ code: 'business' }]) }
  const refresh = new Function(...Object.keys(context), `${body}\nreturn refreshPersonalExceptionOverview;`)(
    ...Object.values(context))
  const fresh = refresh('business')

  assert.deepEqual(h.pending.slice(2).map((request) => request.code), ['platform', 'business'])
  h.pending[2].resolve({ ...granted, roles: [] })
  h.pending[3].resolve(granted)
  await fresh
  h.pending.slice(0, 2).forEach((request) => request.resolve({ ...granted, roles: [] }))
  await old
  assert.deepEqual(h.userAuthorizationPreview.value.applications.map((row) => row.application_code),
    ['platform', 'business'])
  assert.equal(h.userAuthorizationPreview.value.applications[1].effective_role_count, 2)
})

test('重置总览后迟到请求不会重新填回同一用户的旧授权', async () => {
  const h = previewHarness()
  const loading = h.loadUserAuthorizationPreview('user')
  h.resetUserAuthorizationPreview()
  h.pending[0].resolve(granted)
  await loading

  assert.equal(h.userAuthorizationPreview.value, null)
  assert.deepEqual(h.userAuthorizationPreviewEntries.value, [])
})
