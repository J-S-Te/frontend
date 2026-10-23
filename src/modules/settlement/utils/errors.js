import { formatUserError } from "../../shared/utils/userError.js";

// 仅转换服务端已定义的校验语句，不能把数据库或税控内部异常直接展示给用户。
const validationMessages = {
  "amount must be a positive decimal with at most two fractional digits": "金额必须大于 0，且最多保留两位小数。",
  "invalid decimal": "金额格式不正确，请填写有效数字，最多保留两位小数。",
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
  "allocation total must equal invoice total": "应收分摊合计必须等于本次开票总金额，请核对后提交。",
  "applicant cannot approve own invoice": "申请人不能审核自己的开票申请，请由其他有权限的财务人员审核。",
  "applicant cannot review own invoice": "申请人不能复核自己的开票申请，请由其他有权限的财务人员处理。",
  "allocation confirmer cannot approve reversal": "核销确认人不能审批该笔冲销，请由其他有权限的财务人员审批。",
  "invalid match_mode": "核销匹配方式无效，请重新选择回款和应收记录。",
  "match_confidence must be between 1 and 100 for suggested matches": "推荐匹配信息已失效，请重新查询可核销应收后再提交。",
  "currency mismatch": "回款与应收的币种不同，不能进行核销，请重新选择。",
  "receipt and receivable customers differ": "回款与应收不属于同一客户，不能进行核销，请重新选择。",
};

const requiredFields = {
  customer_id: "客户", customer_name: "客户名称", contract_id: "合同", contract_no: "合同编号",
  receipt_id: "回款记录", receivable_id: "应收记录", buyer_name: "购方名称", buyer_tax_no: "购方税号",
  bank_account: "银行账号", bank_reference: "银行流水号", reason: "原因说明", reason_detail: "红冲原因说明", invoice_no: "发票号码",
};

export function formatSettlementError(input, options = {}) {
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
