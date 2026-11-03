export function canRequestRedFlush(invoice) {
  return invoice?.status === "ISSUED" && (!invoice.red_flush_request || ["REJECTED", "ISSUE_FAILED"].includes(invoice.red_flush_request.status));
}

// 可作废（释放额度）的申请状态（SET-06）：只有"确定没开出去"的申请才能回收额度预留。
// 与服务端 cancellableInvoiceRequestStatuses 一致；ISSUE_UNKNOWN、ISSUED 等一律禁止作废。
export const CANCELLABLE_INVOICE_STATUSES = Object.freeze(["ISSUE_PENDING", "ISSUE_FAILED"]);

// 用途：判断某条开票申请是否显示"作废（释放额度）"入口。
// 参数：request 为服务端开票申请；currentUserID 为当前会话用户标识，未知时传空串。
// 返回值：状态允许且非本人申请时为 true；账号未知时交由服务端判定，不在前端误隐藏。
export function canCancelInvoiceRequest(request, currentUserID = "") {
  if (!request || !CANCELLABLE_INVOICE_STATUSES.includes(String(request.status || ""))) return false;
  const applicant = String(request.submitted_by || "").trim();
  const current = String(currentUserID || "").trim();
  if (!applicant || !current) return true;
  // 作废会释放额度，申请人不能作废本人申请：与服务端申请人回避规则保持一致。
  return applicant !== current;
}
