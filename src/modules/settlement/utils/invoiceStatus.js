export function canRequestRedFlush(invoice) {
  return invoice?.status === "ISSUED" && (!invoice.red_flush_request || ["REJECTED", "ISSUE_FAILED"].includes(invoice.red_flush_request.status));
}
