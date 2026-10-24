import { formatUserError, safeUserMessage } from '../../shared/utils/userError.js'

const messages = Object.freeze({
  PORTAL_REPORT_INVALID_REQUEST: '报告申请不符合要求，请检查项目、报告类型、申请原因和接收邮箱后重新提交。',
  PORTAL_REPORT_PROJECT_FORBIDDEN: '该项目不在当前账号可访问范围内，请刷新项目列表并重新选择。',
  PORTAL_REPORT_INVALID_TRANSITION: '报告申请状态已变化，当前不能执行此操作；请刷新详情。',
  PORTAL_REPORT_NOT_ISSUED: '报告尚未发放，暂时不能下载，请在发放后重试。',
  PORTAL_REPORT_VOIDED: '该报告版本已作废，旧下载授权已撤销，请下载最新版本。',
  PORTAL_REPORT_LINK_EXPIRED: '下载授权已过期，请重新点击下载获取新授权。',
  PORTAL_REPORT_GRANT_REVOKED: '下载授权已撤销，请重新点击下载；仍不可用时请联系服务人员。',
  PORTAL_REPORT_GRANT_FROZEN: '下载授权因风险检查被冻结，请联系服务人员复核。',
  PORTAL_REPORT_GRANT_REPLAY: '该次下载授权不能重复使用，请重新点击下载。',
  PORTAL_REPORT_DOWNLOAD_INTEGRITY_FAILED: '报告完整性校验未通过，已停止下载，请联系服务人员。',
  PORTAL_REPORT_FILE_UNAVAILABLE: '报告文件暂不可用，请稍后重试或联系服务人员。',
  PORTAL_REPORT_DOWNLOAD_UNAVAILABLE: '安全下载服务暂不可用，请稍后重试或联系服务人员。',
  PORTAL_FILING_VALIDATION_ERROR: '备案资料不符合要求，请检查当前分区的必填项及预检问题后再保存。',
  PORTAL_FILING_VERSION_CONFLICT: '备案资料已被其他操作修改，请先重新读取最新内容，核对后再保存。',
  PORTAL_FILING_LOCKED: '备案资料已提交并锁定，不能直接修改；如需调整请联系服务人员。',
  PORTAL_FILING_INVALID_STATE: '备案状态已变化，当前不能执行此操作；请刷新详情核对。',
  PORTAL_FILING_MATERIAL_NOT_READY: '备案材料尚未通过安全校验，请等待校验完成并刷新后再提交。',
  PORTAL_FILING_MATERIAL_CONTENT_INVALID: '材料实际内容与文件信息不一致，请重新选择符合要求的 PDF 或图片后上传。',
  PORTAL_FEEDBACK_VALIDATION_ERROR: '反馈内容不符合要求，请检查类型、标题、说明和联系方式后重新提交。',
  PORTAL_FEEDBACK_INVALID_TRANSITION: '反馈状态已变化，当前不能执行此操作；请刷新处理记录。',
  PORTAL_FEEDBACK_PROJECT_FORBIDDEN: '所选项目不可访问，请从当前账号的项目列表重新选择。',
  PORTAL_EVALUATION_VALIDATION_ERROR: '服务评价不符合要求，请为四个维度选择 1 至 5 分，并检查评语长度。',
  PORTAL_EVALUATION_PROJECT_NOT_ELIGIBLE: '项目尚不满足评价条件，请在项目完成后再评价。',
  PORTAL_EVALUATION_ALREADY_SUBMITTED: '该项目已提交评价，不能重复提交；请刷新查看结果。',
})

export function formatPortalError(input, options = {}) {
  const code = options.code ?? input?.code
  const rawMessage = options.message ?? (typeof input === 'string' ? input : input?.message)
  const safe = safeUserMessage(rawMessage)
  const generic = /^(?:请求参数不合法|请求内容不合法|参数错误|参数无效|请求失败|操作失败|保存失败|提交失败|校验失败|服务暂时不可用|依赖服务暂时不可用)[。！!\s]*$/
  const contractDiagnostic = typeof rawMessage === 'string' && /unknown field|cannot unmarshal|unexpected end of json|invalid character|Field validation for/i.test(rawMessage)
  const message = !contractDiagnostic && !(safe && !generic.test(safe)) ? messages[code] : undefined
  return formatUserError(input, { ...options, ...(message ? { message } : {}) })
}
