// 用途：构造有原因且绑定当前对象版本的固定恢复命令。
// 参数：kind 为操作区，row 为服务器对象，reason 为处置原因，target 为接管目标主体。
// 返回值：固定API路径与载荷；不完整或未知动作抛出校验错误。
export function recoveryCommand(kind, row, reason, target = '') {
  const explanation = String(reason || '').trim()
  if (!explanation || explanation.length > 1000) throw new Error('请填写不超过1000字的恢复原因')
  if (!row?.id || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new Error('请重新读取对象当前版本')
  }
  if (kind === 'approvals') {
    if (!target.trim() || !Number.isSafeInteger(row.claim_version) || !row.round) {
      throw new Error('请填写目标主体并重新读取当前审批版本')
    }
    return { path: `/approval-tasks/${encodeURIComponent(row.id)}/recover`, payload: {
      expected_version: row.claim_version, task_version: row.version, round: row.round,
      target_subject_id: target.trim(), reason: explanation, action: 'RECOVER',
    } }
  }
  const operation = { outboxes: 'outbox', jobs: 'job', reconciliation: 'rebuild' }[kind]
  if (!operation) throw new Error('不支持此恢复动作')
  return { path: `/operations/${operation}/${encodeURIComponent(row.id)}/retry`,
    payload: { expected_version: row.version, reason: explanation } }
}
