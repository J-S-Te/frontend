import { formatUserError } from "../../shared/utils/userError.js";

// 仅转换服务端已定义的校验语句，不能把数据库或税控内部异常直接展示给用户。
const validationMessages = {
  "amount must be a positive decimal with at most two fractional digits": "金额必须大于 0，且最多保留两位小数。",
  "invalid decimal": "数值格式不正确，请核对开票明细中的数量、单价或税率及对应精度。",
  "currency must be a three-letter code": "币种格式不正确，请选择三位字母币种，例如 CNY。",
  "invalid payment_method": "请选择有效的回款方式。",
  "receipt_date must be YYYY-MM-DD": "回款日期格式不正确，请重新选择日期。",
  "due_date must be YYYY-MM-DD": "计划收款日期格式不正确，请重新选择日期。",
  "reason is required when plan values change": "调整计划收款日期或金额时，必须填写调整原因。",
  "reason is too long": "原因说明过长，请缩短内容（中文建议不超过 160 字）后再提交。",
  "reason_detail is too long": "红冲原因过长，请缩短内容（中文建议不超过 160 字）后再提交。",
  "invalid reason_code": "请选择有效的红冲原因。",
  "version is required": "记录版本缺失，请刷新页面后重新操作。",
  "version must be positive": "记录版本无效，请刷新页面后重新操作。",
  "rejection reason is required": "驳回时必须填写原因。",
  "items and allocations are required": "请添加发票明细，并选择关联应收及分摊金额。",
  "invoice line total mismatch": "发票明细的金额合计不一致，请核对数量、单价和税额。",
  "invoice line does not match quantity, unit price, tax rate and totals": "发票明细的金额关系不一致，请核对数量、单价、税率、税额及价税合计。",
  "receipt_date must not be later than the Beijing business day": "回款日期不能晚于当前北京业务日，请核对真实回款日期。",
  "allocation total must equal invoice total": "应收分摊合计必须等于本次开票总金额，请核对后提交。",
  "applicant cannot approve own invoice": "申请人不能审核自己的开票申请，请由其他有权限的财务人员审核。",
  "applicant cannot review own invoice": "申请人不能复核自己的开票申请，请由其他有权限的财务人员处理。",
  "allocation confirmer cannot approve reversal": "核销确认人不能审批该笔冲销，请由其他有权限的财务人员审批。",
  "invalid match_mode": "核销匹配方式无效，请重新选择回款和应收记录。",
  "match_confidence must be between 1 and 100 for suggested matches": "推荐匹配信息已失效，请重新查询可核销应收后再提交。",
  "currency mismatch": "回款与应收的币种不同，不能进行核销，请重新选择。",
  "receipt and receivable customers differ": "回款与应收不属于同一客户，不能进行核销，请重新选择。",
  // SET-06 作废（释放额度）：服务端 compose 的中文校验原因，按原文翻译成可执行提示。
  "作废原因应为 5 到 1000 字，且必须提供当前版本与幂等键": "作废原因应为 5 到 1000 字，且需携带当前版本；请刷新页面后重新提交。",
  "申请人不能作废自己的开票申请": "申请人不能作废自己的开票申请，请由其他具备开票开具权限的财务人员执行。",
};

const requiredFields = {
  customer_id: "客户", customer_name: "客户名称", contract_id: "合同", contract_no: "合同编号",
  receipt_id: "回款记录", receivable_id: "应收记录", buyer_name: "购方名称", buyer_tax_no: "购方税号",
  bank_account: "银行账号", bank_reference: "银行流水号", reason: "原因说明", reason_detail: "红冲原因说明", invoice_no: "发票号码",
};

// 用途：复用共享安全展示，保留业务原因及明确的差额审批指引。
// 参数：input 为真实错误，options 为请求路径、方法、状态与未知结果选项。
// 返回值：可执行中文提示；未知结果优先且不重复追加说明。
export function formatSettlementError(input, options = {}) {
  if (options.outcomeUnknown || input?.outcomeUnknown) return formatUserError(input, options);
  const message = settlementMessage(input, options);
  const hint = planAdjustConflictHint(input, options);
  return hint && !message.includes(hint) ? `${message}${hint}` : message;
}

// 用途：翻译仍在使用的既有英文拒绝，优先保留受控中文和字段详情。
// 参数：input 为服务端错误，options 为请求展示上下文。
// 返回值：共享formatter处理后的安全文案。
function settlementMessage(input, options = {}) {
  const code = String(options.code || input?.code || "");
  const raw = String(options.message || input?.message || (typeof input === "string" ? input : ""));
  const details = options.details ?? input?.details;
  if (["unknown_field", "invalid_type", "invalid_json", "malformed_json"].includes(details?.reason)) return formatUserError(input, options);
  if (code === "SETTLEMENT_INVALID_REQUEST") {
    const reason = raw.replace(/^invalid input:\s*/i, "");
    if (validationMessages[reason]) return formatUserError(input, { ...options, message: validationMessages[reason] });
    const required = /^([a-z_]+) is required$/.exec(reason);
    if (required && requiredFields[required[1]]) return formatUserError(input, { ...options, message: `请填写或选择${requiredFields[required[1]]}。` });
  }
  if (code === "SETTLEMENT_CONFLICT" && raw === "记录已变化、重复或余额不足") {
    return formatUserError(input, { ...options, message: "当前记录可能已被处理、版本已更新或可用余额不足。请刷新列表，核对状态和余额后再操作。" });
  }
  return formatUserError(input, options);
}

// 用途：仅对服务端明确的计划覆盖阈值拒绝补充既有财务处理路径。
// 参数：input 为错误，options 为请求路径、状态及安全详情。
// 返回值：覆盖阈值处理说明；版本、金额下限、合同上限及未知结果不追加。
function planAdjustConflictHint(input, options = {}) {
  const path = String(options.path || "");
  if (!/^\/receivable-plans(?:[/?]|$)/.test(path)) return "";
  const status = Number(options.status || input?.status || 0);
  const code = String(options.code || input?.code || "");
  const details = options.details ?? input?.details;
  if (status !== 409 || code !== "SETTLEMENT_CONFLICT" ||
    details?.reason_code !== "PLAN_COVERAGE_THRESHOLD") return "";
  return "请先在“计划差额（合同金额对计划合计）”核对本次改动，再由具备差额放行权限的结算财务负责人处理。页面不会自动重试保存。";
}
