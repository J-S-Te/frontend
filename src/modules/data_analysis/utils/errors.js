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
  CALCULATION_BINDING_REQUIRED: "指标尚未绑定可用的统计计算能力，不能启用。请联系管理员完成计算绑定。",
}

const genericModuleMessage = /^(?:冲突|版本冲突|规则保存失败|预警规则保存失败|指标请求无效|指标定义格式无效)[。！!\s]*$/

export function formatDataAnalysisError(input, options = {}) {
  const code = String(options.code || input?.code || "")
  const details = options.details ?? input?.details
  if (details && typeof details === "object" && (details.reason || details.field || details.issues || details.fields || details.field_errors)) return formatUserError(input, options)
  const formatted = formatUserError(input, options)
  const safe = safeUserMessage(options.message ?? input?.message ?? input?.msg ?? (typeof input === "string" ? input : ""))
  // 模块码只能补足通用提示；后端精确中文与共享层的超时／未知写入判定优先。
  if (safe && formatted === safe && !genericModuleMessage.test(safe)) return formatted
  return messages[code] ? formatUserError(input, { ...options, message: messages[code] }) : formatted
}
