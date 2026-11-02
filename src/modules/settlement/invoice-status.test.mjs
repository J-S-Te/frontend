import test from "node:test";
import assert from "node:assert/strict";
import { CANCELLABLE_INVOICE_STATUSES, canCancelInvoiceRequest, canRequestRedFlush } from "./utils/invoiceStatus.js";
test("red flush permits authoritative failure, but never pending or unknown issuance", () => {
  assert.equal(canRequestRedFlush({ status: "ISSUED" }), true);
  for (const status of ["REJECTED", "ISSUE_FAILED"]) assert.equal(canRequestRedFlush({ status: "ISSUED", red_flush_request: { status } }), true);
  for (const status of ["SUBMITTED", "ISSUE_PENDING", "ISSUE_UNKNOWN", "RED_FLUSHED", "FAILED"]) assert.equal(canRequestRedFlush({ status: "ISSUED", red_flush_request: { status } }), false);
  assert.equal(canRequestRedFlush({ status: "RED_FLUSHED" }), false);
});

// SET-06 作废（释放额度）：只有"确定没开出去"的状态可以回收额度预留，
// 结果未知 / 已开票 / 已驳回一律不显示入口，与服务端状态机保持一致。
test("作废入口只在待开具 / 开具失败且非本人申请时可用", () => {
  assert.deepEqual([...CANCELLABLE_INVOICE_STATUSES], ["ISSUE_PENDING", "ISSUE_FAILED"]);
  for (const status of ["ISSUE_PENDING", "ISSUE_FAILED"]) {
    assert.equal(canCancelInvoiceRequest({ status }), true, status);
  }
  // 结果未知代表税控可能已受理：放行作废就是放行重复开票，必须关闭。
  for (const status of ["ISSUE_UNKNOWN", "ISSUED", "SUBMITTED", "SPECIAL_REVIEW", "REJECTED", "CANCELLED", "", "APPROVED", undefined]) {
    assert.equal(canCancelInvoiceRequest({ status }), false, String(status));
  }
  assert.equal(canCancelInvoiceRequest(null), false);
  // 申请人不能作废本人申请（作废会释放额度）。
  assert.equal(canCancelInvoiceRequest({ status: "ISSUE_FAILED", submitted_by: "applicant" }, "applicant"), false);
  assert.equal(canCancelInvoiceRequest({ status: "ISSUE_FAILED", submitted_by: "applicant" }, "reviewer"), true);
  // 账号未知时不在此处误隐藏，交由服务端 403 / 400 判定。
  assert.equal(canCancelInvoiceRequest({ status: "ISSUE_FAILED", submitted_by: "applicant" }, ""), true);
  assert.equal(canCancelInvoiceRequest({ status: "ISSUE_FAILED" }, "reviewer"), true);
});
