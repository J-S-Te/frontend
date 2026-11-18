import { formatUserError } from '../shared/utils/userError.js'

// 用途：按权威版本依次分配责任链，保留能力校验回执及部分成功事实。
// 参数：item/人员编号为目标及人员；executionAllowed 决定是否分配执行团队；
//   assignTeam/assignExecutionTeam 提交分配，listServiceItemsSnapshot 回读版本，
//   onTeamAssigned 同步已确认的团队负责人。
// 返回值：已保存步骤及可选能力校验结果；失败携带真实部分完成事实或未知标记。
export async function assignServiceItemTeams({ item, teamLeadID, projectManagerID, engineerIDs, executionAllowed, assignTeam, assignExecutionTeam, listServiceItemsSnapshot, onTeamAssigned = () => {} }) {
  let current = item
  let teamAssigned = false
  let capabilityCheck
  try {
    if (!item.team_lead_id) {
      await assignTeam(item.id, { team_lead_id: teamLeadID, expected_version: Number(item.version) || 0 })
      teamAssigned = true
      onTeamAssigned(teamLeadID)
      if (executionAllowed) {
        // 第一个端点仅返回 TEAM_ASSIGNED，不返回新版本。
        // 读取权威记录，不猜测版本加一，也不禁用乐观锁。
        // 服务项列表默认只回 20 行，按项目读取必须走 all=1 快照，否则可能读不到目标行。
        const snapshot = await listServiceItemsSnapshot(item.project_id)
        const rows = Array.isArray(snapshot) ? snapshot : snapshot?.items
        current = Array.isArray(rows) ? rows.find(row => row.id === item.id) : null
        const version = Number(current?.version)
        if (!current || current.team_lead_id !== teamLeadID || current.status !== '待分配'
          || !Number.isSafeInteger(version) || version <= Number(item.version || 0)) {
          throw Object.assign(new Error('服务项已发生变化或最新状态不完整，请刷新后核对团队负责人及当前阶段，再继续分配。'), { status: 409, code: 'PM_STATE_CONFLICT' })
        }
      }
    }
    if (executionAllowed) {
      capabilityCheck = await assignExecutionTeam(item.id, { project_manager_id: projectManagerID, engineer_ids: engineerIDs, expected_version: Number(current.version) || 0 })
      if (typeof capabilityCheck?.passed !== 'boolean') {
        throw Object.assign(new Error('执行团队分配结果不完整，请刷新核对操作结果，勿重复提交。'), {
          code: 'PM_INVALID_ASSIGNMENT_RESULT', requiresReload: true, outcomeUnknown: true,
        })
      }
    }
    const result = { teamAssigned, executionAssigned: Boolean(executionAllowed) }
    if (capabilityCheck) result.capabilityCheck = capabilityCheck
    return result
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
