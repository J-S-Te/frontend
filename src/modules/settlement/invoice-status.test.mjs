import test from "node:test";
import assert from "node:assert/strict";
import { canRequestRedFlush } from "./utils/invoiceStatus.js";
test("red flush permits authoritative failure, but never pending or unknown issuance", () => {
  assert.equal(canRequestRedFlush({ status: "ISSUED" }), true);
  for (const status of ["REJECTED", "ISSUE_FAILED"]) assert.equal(canRequestRedFlush({ status: "ISSUED", red_flush_request: { status } }), true);
  for (const status of ["SUBMITTED", "ISSUE_PENDING", "ISSUE_UNKNOWN", "RED_FLUSHED", "FAILED"]) assert.equal(canRequestRedFlush({ status: "ISSUED", red_flush_request: { status } }), false);
  assert.equal(canRequestRedFlush({ status: "RED_FLUSHED" }), false);
});
