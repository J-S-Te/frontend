// canManageContractRecords 用途：管理入口要求管理员与精确读、删权限，不使用 all 通配。
// 参数：session 为后端签发的当前会话。
// 返回值：是否具备展示记录管理入口的明确授权，资源范围仍由后端执行。
export function canManageContractRecords(session) {
  const roles = Array.isArray(session?.roles) ? session.roles : []
  const permissions = Array.isArray(session?.permissions) ? session.permissions : []
  return (roles.includes('admin') || session?.role?.code === 'admin')
    && permissions.includes('contract.read') && permissions.includes('contract.delete')
}

// isContractRecordSummary 用途：拒绝错误管理摘要以及意外混入正文的旧协议。
// 参数：value 为服务端数据，state 为可选的预期记录状态。
// 返回值：安全摘要是否满足当前记录管理协议。
export function isContractRecordSummary(value, state) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.title === 'string' && typeof value.contract_number === 'string'
    && typeof value.status === 'string' && Number.isSafeInteger(value.version) && value.version > 0
    && ['active', 'deleted'].includes(value.record_state) && (!state || value.record_state === state)
    && !['content', 'document', 'rendered_document', 'template_values'].some((key) => Object.hasOwn(value, key))
    && (value.record_state !== 'deleted' || (typeof value.deleted_at === 'string'
      && Number.isFinite(Date.parse(value.deleted_at)) && typeof value.delete_reason === 'string'))
}

// isContractRecordPreview 用途：核对资格响应的身份、状态与阻断原因保持一致。
// 参数：value 为预检响应，id 为请求的稳定合同身份。
// 返回值：是否可以安全地据此展示操作资格。
export function isContractRecordPreview(value, id) {
  if (!isContractRecordSummary(value) || value.id !== String(id) || !Array.isArray(value.blockers)) return false
  if (!value.blockers.every((item) => typeof item?.code === 'string' && item.code
    && typeof item?.message === 'string' && item.message)) return false
  return value.can_delete === (value.record_state === 'active' && value.blockers.length === 0)
    && value.can_restore === (value.record_state === 'deleted' && value.blockers.length === 0)
}

// isContractRecordMutation 用途：核对真实变更与同目标幂等回执，避免误判版本。
// 参数：value 为写入回执，id/expected 为本次身份及基线，target 为目标记录状态。
// 返回值：变更必须升一版；幂等回执只证明当前状态，不声称原请求已执行。
export function isContractRecordMutation(value, id, expected, target) {
  return value && value.id === String(id) && value.record_state === target
    && typeof value.changed === 'boolean' && Number.isSafeInteger(value.version) && value.version > 0
    && (!value.changed || value.version === expected + 1)
}

// isDeletedContractPage 用途：拒绝普通台账降级响应被当作回收站。
// 参数：value 为独立回收站分页信封。
// 返回值：分页与所有摘要均明确属于已删除集合时为真。
export function isDeletedContractPage(value) {
  return value && Array.isArray(value.items) && value.items.every((row) => isContractRecordSummary(row, 'deleted'))
    && Number.isSafeInteger(value.total) && value.total >= value.items.length
    && Number.isSafeInteger(value.page) && value.page >= 1
    && Number.isSafeInteger(value.page_size) && value.page_size >= 1 && value.page_size <= 200
}
