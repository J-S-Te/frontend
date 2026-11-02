// 补充协议关账（BIZ-PROJECT-04）的前端口径：可见性、候选合同、表单校验与确认文案
// 集中在这里，视图、弹窗和测试共用同一套判定，避免三处各写一遍后漂移。
//
// 后端 POST /projects/:id/supplement-closure 要求 project.decomposition.manage，
// 只受理 supplement_status=REQUIRED 的项目，且必须绑定同客户已审批的补充协议与原因；
// 关账后以当前范围指纹为新基准，不能再用「确认拆解」清除。

export const SUPPLEMENT_CLOSURE_PERMISSION = 'project.decomposition.manage'

export const SUPPLEMENT_CLOSURE_CONFIRM_TITLE = '确认关闭补充协议？'

export const SUPPLEMENT_CLOSURE_CONFIRM_NOTE = '关账后以该项目当前拆解范围指纹为新的基准，之后不能再通过「确认拆解」清除补充协议标记，也不会回退已推进的服务项。'

/**
 * supplementRequired 判断项目是否仍在补充协议分支。
 * 后端只落 NONE / REQUIRED；这里兼容大小写与空白，避免历史或代理转换后的数据漏判。
 * @param {object|null|undefined} project 项目行。
 * @returns {boolean} 是否需要补充协议关账。
 */
export function supplementRequired(project) {
  return String(project?.supplement_status || '').trim().toUpperCase() === 'REQUIRED'
}

/**
 * supplementClosureAvailability 计算关账入口的可见性与可用性。
 * 不在补充协议分支的项目完全不显示入口；处于该分支但缺少权限时保留入口并给出原因，
 * 避免用户以为系统遗漏了动作。
 * @param {object|null|undefined} project 项目行。
 * @param {Set<string>|null|undefined} permissionSet 当前会话权限集合。
 * @returns {{visible: boolean, allowed: boolean, reason: string}} 入口状态。
 */
export function supplementClosureAvailability(project, permissionSet) {
  if (!supplementRequired(project)) return { visible: false, allowed: false, reason: '' }
  const allowed = Boolean(permissionSet && typeof permissionSet.has === 'function' && permissionSet.has(SUPPLEMENT_CLOSURE_PERMISSION))
  return {
    visible: true,
    allowed,
    reason: allowed ? '' : '需要「项目拆解管理」权限（project.decomposition.manage）才能关闭补充协议。',
  }
}

/**
 * eligibleClosureContracts 复核补充协议候选。
 * 后端目录已按项目与客户过滤；前端仍检查审批状态和“不能选原合同”，防止迟到响应或
 * 跨项目缓存被当成可提交依据。客户标识缺失时退回合同名称比对，与拆解调整口径一致。
 * @param {object|null|undefined} project 目标项目。
 * @param {Array<object>} contracts 补充协议目录响应。
 * @returns {Array<object>} 可提交的候选合同。
 */
export function eligibleClosureContracts(project, contracts) {
  if (!project || !Array.isArray(contracts)) return []
  const originals = [project.contract_id, project.contract].map((value) => String(value || '').trim()).filter(Boolean)
  return contracts.filter((contract) => {
    if (!contract?.id || !contract.approval_passed) return false
    if (!['approved', 'active'].includes(String(contract.status || '').trim().toLowerCase())) return false
    if (originals.includes(String(contract.id).trim()) || originals.includes(String(contract.contract_number || '').trim())) return false
    if (project.customer_id) return String(contract.customer_id || '') === String(project.customer_id)
    return Boolean(project.customer && contract.customer_name && String(project.customer).trim().toLocaleLowerCase() === String(contract.customer_name).trim().toLocaleLowerCase())
  })
}

/**
 * emptyClosureForm 返回空白关账表单。
 * @returns {{supplementContractID: string, reason: string}} 空白表单。
 */
export function emptyClosureForm() {
  return { supplementContractID: '', reason: '' }
}

/**
 * validateSupplementClosure 校验关账表单，返回第一条可展示的原因。
 * 与服务端口径保持一致：合同必选、原因必填且不超过 1000 字。
 * @param {{supplementContractID?: string, reason?: string}|null|undefined} form 关账表单。
 * @returns {string} 校验失败原因；通过时为空字符串。
 */
export function validateSupplementClosure(form) {
  if (!String(form?.supplementContractID || '').trim()) return '请选择已审批的补充协议'
  const reason = String(form?.reason || '').trim()
  if (!reason) return '请填写关闭补充协议的原因'
  if (reason.length > 1000) return '关闭补充协议的原因不能超过 1000 字'
  return ''
}
