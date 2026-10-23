import { formatUserError } from '../shared/utils/userError.js'

/** 两个分别提交的命令绝不能复用指派前的版本。 */
export async function assignServiceItemTeams({ item, teamLeadID, projectManagerID, engineerIDs, executionAllowed, assignTeam, assignExecutionTeam, listServiceItems, onTeamAssigned = () => {} }) {
  let current = item
  let teamAssigned = false
  try {
    if (!item.team_lead_id) {
      await assignTeam(item.id, { team_lead_id: teamLeadID, expected_version: Number(item.version) || 0 })
      teamAssigned = true
      onTeamAssigned(teamLeadID)
      if (executionAllowed) {
        // 第一个端点仅返回 TEAM_ASSIGNED，不返回新版本。
        // 读取权威记录，不猜测版本加一，也不禁用乐观锁。
        const rows = await listServiceItems(item.project_id)
        current = Array.isArray(rows) ? rows.find(row => row.id === item.id) : null
        const version = Number(current?.version)
        if (!current || current.team_lead_id !== teamLeadID || current.status !== '待分配'
          || !Number.isSafeInteger(version) || version <= Number(item.version || 0)) {
          throw Object.assign(new Error('服务项已发生变化或最新状态不完整，请刷新后核对团队负责人及当前阶段，再继续分配。'), { status: 409, code: 'PM_STATE_CONFLICT' })
        }
      }
    }
    if (executionAllowed) {
      await assignExecutionTeam(item.id, { project_manager_id: projectManagerID, engineer_ids: engineerIDs, expected_version: Number(current.version) || 0 })
    }
    return { teamAssigned, executionAssigned: Boolean(executionAllowed) }
  } catch (cause) {
    if (!teamAssigned) throw cause
    const message = `团队负责人已分配；后续执行团队分配未确认完成。${formatUserError(cause, { fallback: '请刷新后核对当前状态，再继续未完成的步骤。' })}`
    const error = Object.assign(new Error(message, { cause }), cause)
    error.message = message
    error.cause = cause
    error.requiresReload = true
    error.assignmentItemID = item.id
    error.partialCompletion = { teamAssigned: true, executionAssigned: false }
    throw error
  }
}
