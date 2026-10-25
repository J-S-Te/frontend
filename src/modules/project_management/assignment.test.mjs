import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assignServiceItemTeams } from './assignment.js'
import { formatUserError } from '../shared/utils/userError.js'

const viewSource = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')

function allocationPage(items, { assignTeam = async () => {}, assignExecutionTeam = async () => {}, listServiceItems = async () => items.map(row => ({ ...row, version: row.version + 5 })), refreshed = async () => {} } = {}) {
  const ref = value => ({ value })
  const state = {
    selectedServiceItemIDs: ref(items.map(row => row.id)), operationForm: ref({ teamLeadID: 'lead-1', projectManagerID: 'manager-1', engineerIDs: 'engineer-1' }),
    saving: ref(false), canExecutionAssign: ref(true), toastMessage: ref(''), toastType: ref(''),
  }
  const selectedServiceItems = { get value() { return items.filter(row => state.selectedServiceItemIDs.value.includes(row.id)) } }
  const selectedServiceItem = { get value() { return selectedServiceItems.value[0] || null } }
  const operation = viewSource.slice(viewSource.indexOf('async function runOperation(kind)'), viewSource.indexOf('\nasync function revokeSelectedAssignment('))
  const toast = viewSource.slice(viewSource.indexOf('function showToast(message'), viewSource.indexOf('\nfunction projectEvents('))
  let refreshCount = 0
  const run = new Function(...Object.keys(state), 'selectedServiceItems', 'selectedServiceItem', 'formatUserError', 'assignServiceItemTeams', 'assignTeam', 'assignExecutionTeam', 'listServiceItems', 'selectedIDs', 'loadWorkspace', 'refreshAfterWrite', 'window',
    `let toastTimer; ${toast}; ${operation}; return runOperation;`)(...Object.values(state), selectedServiceItems, selectedServiceItem, formatUserError, assignServiceItemTeams, assignTeam, assignExecutionTeam, listServiceItems, text => text.split(','), async () => { refreshCount++; await refreshed() }, async () => { refreshCount++; await refreshed() }, { clearTimeout: () => {}, setTimeout: () => 1 })
  return { ...state, run, refreshCount: () => refreshCount }
}

const item = { id: 'item-1', project_id: 'project-1', version: 12, status: '待分配', team_lead_id: '' }
function inputs(overrides = {}) {
  return { item: { ...item }, teamLeadID: 'lead-1', projectManagerID: 'manager-1', engineerIDs: ['engineer-1'], executionAllowed: true,
    assignTeam: async () => ({ status: 'TEAM_ASSIGNED' }), listServiceItems: async () => [{ ...item, team_lead_id: 'lead-1', version: 37 }], assignExecutionTeam: async () => ({}), ...overrides }
}

test('团队分配后重新读取真实版本再指派执行团队，不猜版本增量', async () => {
  const commands = []
  const result = await assignServiceItemTeams(inputs({
    assignTeam: async (id, payload) => { commands.push(['team', id, payload]); return { status: 'TEAM_ASSIGNED' } },
    listServiceItems: async projectID => { commands.push(['read', projectID]); return [{ ...item, team_lead_id: 'lead-1', version: 37 }] },
    assignExecutionTeam: async (id, payload) => commands.push(['execution', id, payload]),
  }))
  assert.deepEqual(commands, [
    ['team', 'item-1', { team_lead_id: 'lead-1', expected_version: 12 }],
    ['read', 'project-1'],
    ['execution', 'item-1', { project_manager_id: 'manager-1', engineer_ids: ['engineer-1'], expected_version: 37 }],
  ])
  assert.deepEqual(result, { teamAssigned: true, executionAssigned: true })
})

test('负责人被并发修改、阶段改变或响应缺少权威版本时禁止第二步', async () => {
  const invalid = [
    [], null, [{ ...item, team_lead_id: 'other-lead', version: 13 }],
    [{ ...item, team_lead_id: 'lead-1', version: 13, status: '待实施' }],
    [{ ...item, team_lead_id: 'lead-1', version: 12 }],
    [{ ...item, team_lead_id: 'lead-1', version: 'broken' }],
    [{ ...item, team_lead_id: 'lead-1', version: Number.MAX_SAFE_INTEGER + 1 }],
  ]
  for (const rows of invalid) {
    let executionCalls = 0
    await assert.rejects(assignServiceItemTeams(inputs({ listServiceItems: async () => rows, assignExecutionTeam: async () => { executionCalls++ } })), error => {
      assert.equal(error.status, 409)
      assert.equal(error.code, 'PM_STATE_CONFLICT')
      assert.equal(error.requiresReload, true)
      assert.deepEqual(error.partialCompletion, { teamAssigned: true, executionAssigned: false })
      assert.match(error.message, /团队负责人已分配.*刷新/)
      return true
    })
    assert.equal(executionCalls, 0)
  }
})

test('第一步失败或结果未知不虚构已完成，不自动重试和不执行下游', async () => {
  for (const cause of [Object.assign(new Error('无权分配'), { status: 403, code: 'PM_FORBIDDEN' }), Object.assign(new Error('尚未确认操作结果'), { code: 'NETWORK_ERROR', outcomeUnknown: true })]) {
    let writes = 0
    await assert.rejects(assignServiceItemTeams(inputs({
      assignTeam: async () => { writes++; throw cause },
      listServiceItems: async () => assert.fail('failed first write must not read-and-continue'),
      assignExecutionTeam: async () => assert.fail('must not execute'),
    })), error => error === cause && !error.partialCompletion)
    assert.equal(writes, 1)
  }
})

test('第二步失败保留部分完成和原始诊断，刷新后继续不会再次分配负责人', async () => {
  const selected = { ...item }
  const cause = Object.assign(new Error('人员资质目录不可用'), { status: 503, code: 'PM_PERSONNEL_UNAVAILABLE', requestID: 'assignment-1', details: { reason: 'unavailable' } })
  let teamCalls = 0, executionCalls = 0
  await assert.rejects(assignServiceItemTeams(inputs({ item: selected,
    assignTeam: async () => { teamCalls++ },
    onTeamAssigned: id => { selected.team_lead_id = id },
    assignExecutionTeam: async () => { executionCalls++; throw cause },
  })), error => {
    assert.equal(error.status, 503)
    assert.equal(error.code, cause.code)
    assert.equal(error.requestID, 'assignment-1')
    assert.deepEqual(error.details, cause.details)
    assert.match(error.message, /团队负责人已分配.*后续执行团队分配未确认完成/)
    return true
  })
  assert.equal(teamCalls, 1)
  assert.equal(executionCalls, 1)
  // 这是用户读取最新记录后显式继续操作，不是自动重试。
  await assignServiceItemTeams(inputs({ item: { ...selected, version: 40 }, assignTeam: async () => { teamCalls++ }, assignExecutionTeam: async (_id, payload) => { executionCalls++; assert.equal(payload.expected_version, 40) } }))
  assert.equal(teamCalls, 1)
  assert.equal(executionCalls, 2)
})

test('刷新失败时不丢失第一步成功事实，也不会继续下游指派', async () => {
  await assert.rejects(assignServiceItemTeams(inputs({ listServiceItems: async () => { throw Object.assign(new Error('SQLSTATE HY000'), { status: 500, code: 'PM_INTERNAL_ERROR' }) }, assignExecutionTeam: async () => assert.fail('cannot continue without authoritative row') })), error => {
    assert.match(error.message, /团队负责人已分配/)
    assert.equal(error.requiresReload, true)
    assert.doesNotMatch(error.message, /SQLSTATE/)
    return true
  })
})

test('仅有团队指派权限时只提交第一步，已有负责人不被该工具覆盖', async () => {
  const result = await assignServiceItemTeams(inputs({ executionAllowed: false, listServiceItems: () => assert.fail('no second step'), assignExecutionTeam: () => assert.fail('not authorized') }))
  assert.deepEqual(result, { teamAssigned: true, executionAssigned: false })
  await assignServiceItemTeams(inputs({ item: { ...item, team_lead_id: 'existing-lead' }, executionAllowed: false, assignTeam: () => assert.fail('do not overwrite existing lead') }))
})

test('操作台调用权威版本编排并在部分完成后刷新，不再复用分配前版本', async () => {
  const source = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
  const operation = source.slice(source.indexOf('async function runOperation(kind)'), source.indexOf('\nasync function revokeSelectedAssignment('))
  assert.match(operation, /await assignServiceItemTeams\(/)
  assert.match(operation, /onTeamAssigned: \(id\) => \{ selected\.team_lead_id = id \}/)
  assert.match(operation, /if \(error\?\.status === 409 \|\| error\?\.requiresReload \|\| partialAssignment\) \{\s*try \{ await loadWorkspace\(\{ reportError: false \}\)/)
  assert.doesNotMatch(operation, /await assignExecutionTeam\(selected.id/)
})

test('真实页面 catch 和 Toast 二次格式化仍保留首步成功事实，不被网络或超时分类覆盖', async () => {
  for (const [status, code] of [[0, 'NETWORK_ERROR'], [200, 'INVALID_PROJECT_RESPONSE'], [504, 'PM_SERVICE_TIMEOUT']]) {
    const cause = Object.assign(new Error('unknown operation result'), { status, code, request_method: 'POST', requestID: 'diagnostic-assignment-1' })
    const row = { ...item }
    let executionCalls = 0, teamCalls = 0
    const page = allocationPage([row], {
      assignTeam: async () => { teamCalls++ },
      assignExecutionTeam: async () => { executionCalls++; throw cause },
    })
    await page.run('allocation')
    assert.match(page.toastMessage.value, /当前服务项的团队负责人已分配；执行团队分配未确认完成/)
    assert.match(page.toastMessage.value, /核对|确认操作结果|确认.*结果/)
    assert.equal(page.toastType.value, 'warning')
    assert.equal(page.saving.value, false)
    assert.equal(row.team_lead_id, 'lead-1')
    assert.equal(page.refreshCount(), 1)
    assert.equal(teamCalls, 1)
    assert.equal(executionCalls, 1)
    assert.equal(cause.code, code)
    assert.equal(cause.status, status)
    assert.equal(cause.requestID, 'diagnostic-assignment-1')
  }
})

test('真实批量操作首项完成、次项 403 后显示完成数并刷新，继续时不重发首项', async () => {
  const rows = [{ ...item, id: 'first' }, { ...item, id: 'second' }]
  const calls = []
  let blockSecond = true
  const page = allocationPage(rows, {
    assignTeam: async id => { calls.push(['team', id]); if (id === 'second' && blockSecond) throw Object.assign(new Error('当前账号无权分配此服务项'), { status: 403, code: 'PM_FORBIDDEN' }) },
    assignExecutionTeam: async id => calls.push(['execution', id]),
  })
  await page.run('allocation')
  assert.deepEqual(calls, [['team', 'first'], ['execution', 'first'], ['team', 'second']])
  assert.match(page.toastMessage.value, /已确认完成 1 \/ 2 个服务项.*不会重复提交/)
  assert.match(page.toastMessage.value, /无权分配/)
  assert.deepEqual(page.selectedServiceItemIDs.value, ['second'])
  assert.equal(page.toastType.value, 'warning')
  assert.equal(page.refreshCount(), 1)
  // 权限问题解决后，由用户显式继续操作。
  blockSecond = false
  await page.run('allocation')
  assert.deepEqual(calls, [['team', 'first'], ['execution', 'first'], ['team', 'second'], ['team', 'second'], ['execution', 'second']])
  assert.equal(calls.filter(([, id]) => id === 'first').length, 2)
  assert.equal(page.refreshCount(), 2)
})

test('批次前项已成功而本项结果未知时不把未知结果说成未提交，也不重发前项', async () => {
  const rows = [{ ...item, id: 'first' }, { ...item, id: 'second' }]
  const page = allocationPage(rows, { assignTeam: async id => {
    if (id === 'second') throw Object.assign(new Error('Failed to fetch'), { status: 0, code: 'NETWORK_ERROR', request_method: 'POST', outcomeUnknown: true })
  } })
  await page.run('allocation')
  assert.match(page.toastMessage.value, /已确认完成 1 \/ 2 个服务项/)
  assert.match(page.toastMessage.value, /确认操作结果|避免重复提交/)
  assert.doesNotMatch(page.toastMessage.value, /所有操作失败|全部未提交/)
  assert.deepEqual(page.selectedServiceItemIDs.value, ['second'])
  assert.equal(page.refreshCount(), 1)
})

test('长业务原因或失败后的刷新中断不会让 Toast 抹掉已完成事实', async () => {
  const page = allocationPage([{ ...item }], {
    assignExecutionTeam: async () => { throw Object.assign(new Error('所选实施人员的资质已停用，请重新选择。'.repeat(12)), { status: 422, code: 'PM_VALIDATION_ERROR' }) },
    refreshed: async () => { throw new Error('Failed to fetch') },
  })
  await page.run('allocation')
  assert.match(page.toastMessage.value, /当前服务项的团队负责人已分配/)
  assert.match(page.toastMessage.value, /列表刷新未完成/)
  assert.match(page.toastMessage.value, /资质已停用.*…/)
  assert.doesNotMatch(page.toastMessage.value, /Failed to fetch/)
  assert.ok(page.toastMessage.value.length <= 400)
  assert.equal(page.saving.value, false)
})
