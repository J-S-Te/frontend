import { formatUserError, safeUserMessage } from "../../shared/utils/userError.js"

const messages = {
  SOURCE_NOT_FOUND: "该数据源已不存在，请刷新数据源列表。",
  SOURCE_DISABLED: "该数据源已停用，请联系管理员启用后再发起同步。",
  SYNC_ALREADY_QUEUED: "该数据源已有等待或执行中的同步任务，无需重复触发，请稍后刷新查看结果。",
  SOURCE_LOOKUP_FAILED: "暂时无法读取该数据源，请稍后刷新；仍失败时请联系管理员。",
  SOURCE_LIST_FAILED: "数据源列表暂时无法加载，请稍后刷新。",
  SYNC_JOB_CREATE_FAILED: "同步任务提交结果暂未确认，请先查看任务状态或稍后刷新数据源列表，勿重复触发；仍有问题请联系管理员。",
  RULE_LIST_FAILED: "预警规则暂时无法加载，请稍后刷新。",
  RULE_PAYLOAD_INVALID: "规则内容不符合要求，请检查规则名称、预警类型、严重度和提前天数；若填写无误，请刷新页面后重试。",
  RULE_SAVE_FAILED: "预警规则保存失败，请稍后刷新列表确认保存结果。",
  RULE_VERSION_CONFLICT: "规则已被其他用户修改，请刷新规则后重新编辑。",
  METRIC_VERSION_CONFLICT: "指标已被其他用户修改，请刷新指标字典后重新编辑。",
  METRIC_PAYLOAD_INVALID: "指标内容不符合要求，请检查必填项、字段长度和编码格式；若填写无误，请刷新页面后重试。",
  METRIC_VALIDATION_FAILED: "指标字段未通过校验，请检查必填项、字段长度和编码格式；若填写无误，请刷新页面后重试。",
  METRIC_LIMIT_EXCEEDED: "当前租户已达到500条指标定义记录上限，本次未创建；已删除记录仍保留，请联系管理员核对指标容量。",
  CALCULATION_BINDING_REQUIRED: "指标尚未绑定可用的统计计算能力，不能启用。请联系管理员完成计算绑定。",
  SOURCE_CREDENTIAL_INCOMPLETE: "数据源接入凭据不完整，请联系管理员核对应用接入和机器访问配置后再同步。",
  SOURCE_NOT_CONFIGURED: "数据源接入配置尚未完成，请联系管理员核对来源配置后再同步。",
  SOURCE_AUTHORIZATION_FAILED: "数据源访问授权未通过，请联系管理员核对机器身份、授权范围和接入状态。",
  SOURCE_UNAVAILABLE: "数据源或同步依赖暂时不可用，请稍后查看同步状态；仍失败时联系管理员。",
}

const genericModuleMessage = /^(?:冲突|版本冲突|规则保存失败|预警规则保存失败|指标请求无效|指标定义格式无效)[。！!\s]*$/

// 用途：补齐数析业务提示，优先保留结果未知和后端确认的部分完成事实。
// 参数：input 为请求错误或公开原因，options 为状态、请求方法和展示兜底。
// 返回值：安全中文提示，不重发请求或改变业务状态。
export function formatDataAnalysisError(input, options = {}) {
  const code = String(options.code || input?.code || "")
  const details = options.details ?? input?.details
  const formatted = formatUserError(input, options)
  const status = Number(options.status ?? input?.status ?? 0)
  if (input?.outcomeUnknown === true || options.outcomeUnknown === true
    || [408, 504].includes(status) || /(?:TIMEOUT|TIMED_OUT|NETWORK_ERROR)$/.test(code)
    || input?.name === 'AbortError') return formatted
  if (code === 'SYNC_ALL_FAILED' && details?.partial_completion === true
    && Number.isSafeInteger(details.queued) && details.queued > 0
    && Number.isSafeInteger(details.skipped) && details.skipped >= 0) {
    return `已有 ${details.queued} 个来源入队、${details.skipped} 个跳过；后续入队结果尚未确认，请先刷新查看任务，勿重复触发。`
  }
  if (code === 'RULE_SAVED_REFRESH_FAILED' && details?.saved === true
    && details?.refresh_failed === true) {
    return '规则已保存，但最新列表读取失败，请先刷新核对，无需再次保存。'
  }
  if (details && typeof details === "object" && (details.reason || details.field || details.issues || details.fields || details.field_errors)) return formatUserError(input, options)
  const safe = safeUserMessage(options.message ?? input?.message ?? input?.msg ?? (typeof input === "string" ? input : ""))
  // 模块码只能补足通用提示；后端精确中文与共享层的超时／未知写入判定优先。
  if (safe && formatted === safe && !genericModuleMessage.test(safe)) return formatted
  return messages[code] ? formatUserError(input, { ...options, message: messages[code] }) : formatted
}
