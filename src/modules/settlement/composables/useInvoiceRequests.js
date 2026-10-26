import { computed, ref } from "vue";

/**
 * 开票申请域（治理批次 5 结算，自 SettlementView.vue 逐字迁移）。
 * 收编：开票区页签、申请编辑器 / 审核弹窗开关、关键字 + 状态筛选与重置、申请列表 / 已开发票两路可见派生、
 * 开票申请提交（按所选可开票应收组装买方 / 明细 / 余额锁定）、审核（批准 / 驳回须填原因）、
 * 人工登记发票（manualIssue 三次 window.prompt 逐字保留，行为修复另行授权）、
 * 开票失败复核弹窗（5–1000 字校验、弹窗内联 error、成功后刷新并说明尚未重新开票）。
 * 注入项与组件内同名标识一一对应：invoiceRequests/taxInvoices/invoiceEligibleReceivables/saving/notify/act/load/
 * formatSettlementError + createInvoiceRequest/approveInvoiceRequest/rejectInvoiceRequest/registerManualInvoice/
 * recoverInvoiceFailure；不直接导入 API 模块。
 */
export function useInvoiceRequests({
  invoiceRequests,
  taxInvoices,
  invoiceEligibleReceivables,
  saving,
  notify,
  act,
  load,
  formatSettlementError,
  createInvoiceRequest,
  approveInvoiceRequest,
  rejectInvoiceRequest,
  registerManualInvoice,
  recoverInvoiceFailure,
}) {
  const reviewFailureDialog = ref(null);
  const invoiceTab = ref("requests");
  const invoiceComposerOpen = ref(false);
  const invoiceReviewOpen = ref(false);
  const invoiceKeyword = ref("");
  const invoiceStatusFilter = ref("");
  const invoiceReview = ref({ id: "", version: 0, request_no: "", reason: "" });
  const invoiceForm = ref({
    receivable_id: "",
    invoice_type: "ELECTRONIC_NORMAL",
    buyer_tax_no: "",
    item_name: "服务费",
    tax_classification_code: "",
    amount_excl_tax: "",
    tax_rate: "0.06",
    tax_amount: "",
    amount_incl_tax: "",
  });

  const visibleInvoiceRequests = computed(() =>
    invoiceRequests.value.filter((item) => {
      const keyword = invoiceKeyword.value.trim().toLowerCase();
      return (
        (!keyword ||
          [item.request_no, item.contract_no, item.buyer_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(keyword)) &&
        (!invoiceStatusFilter.value || item.status === invoiceStatusFilter.value)
      );
    }),
  );
  const visibleTaxInvoices = computed(() =>
    taxInvoices.value.filter((item) => {
      const keyword = invoiceKeyword.value.trim().toLowerCase();
      return (
        (!keyword ||
          [item.invoice_no, item.invoice_code, item.contract_no, item.buyer_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(keyword)) &&
        (!invoiceStatusFilter.value || item.status === invoiceStatusFilter.value)
      );
    }),
  );
  function resetInvoiceFilters() {
    invoiceKeyword.value = "";
    invoiceStatusFilter.value = "";
  }

  function openReviewFailure(item) {
    if (!item || saving.value) return;
    reviewFailureDialog.value = { item, reason: "", error: "" };
  }
  function closeReviewFailure() {
    if (!saving.value) reviewFailureDialog.value = null;
  }
  async function submitReviewFailure(reason) {
    const dialog = reviewFailureDialog.value;
    if (!dialog || saving.value) return;
    const normalized = String(reason || "").trim();
    if (normalized.length < 5 || normalized.length > 1000) {
      dialog.error = "复核原因应为 5 到 1000 字。";
      return;
    }
    saving.value = true;
    dialog.error = "";
    try {
      await recoverInvoiceFailure(dialog.item.id, { version: dialog.item.version, reason: normalized });
      reviewFailureDialog.value = null;
      const refreshed = await load();
      notify(refreshed ? "失败已复核，申请已恢复待审核；尚未重新开票。" : "失败已复核，尚未重新开票；页面刷新失败，请刷新列表查看。无需重复复核。");
    } catch (value) {
      dialog.error = formatSettlementError(value, { fallback: "失败复核未完成。" });
    } finally {
      saving.value = false;
    }
  }

  function submitInvoice() {
    const receivable = invoiceEligibleReceivables.value.find(
      (item) => item.id === invoiceForm.value.receivable_id,
    );
    if (!receivable) {
      notify("请选择应收单。");
      return;
    }
    const form = invoiceForm.value;
    return act(async () => {
      await createInvoiceRequest({
        contract_snapshot_id: receivable.contract_snapshot_id,
        buyer_profile: {
          customer_id: receivable.customer_id,
          name: receivable.customer_name,
          tax_no: form.buyer_tax_no,
        },
        invoice_type: form.invoice_type,
        items: [
          {
            item_name: form.item_name,
            tax_classification_code: form.tax_classification_code,
            specification: "",
            unit: "项",
            quantity: "1",
            unit_price_excl_tax: form.amount_excl_tax,
            amount_excl_tax: form.amount_excl_tax,
            tax_rate: form.tax_rate,
            tax_amount: form.tax_amount,
            amount_incl_tax: form.amount_incl_tax,
          },
        ],
        allocations: [
          { receivable_id: receivable.id, reserved_amount: form.amount_incl_tax },
        ],
      });
      invoiceComposerOpen.value = false;
    }, "开票申请已提交并锁定可开票余额。");
  }
  function approveInvoice(item) {
    invoiceReview.value = {
      id: item.id,
      version: item.version,
      request_no: item.request_no,
      reason: "",
    };
    invoiceReviewOpen.value = true;
  }
  function submitInvoiceReview(decision) {
    if (decision === "reject" && !invoiceReview.value.reason.trim()) {
      notify("驳回开票申请时必须填写驳回原因。");
      return;
    }
    return act(
      async () => {
        if (decision === "approve") {
          await approveInvoiceRequest(
            invoiceReview.value.id,
            invoiceReview.value.version,
          );
        } else {
          await rejectInvoiceRequest(
            invoiceReview.value.id,
            invoiceReview.value.version,
            invoiceReview.value.reason.trim(),
          );
        }
        invoiceReviewOpen.value = false;
      },
      decision === "approve"
        ? "开票申请已批准，已进入配置的开具流程。"
        : "开票申请已驳回，锁定的可开票余额已释放。",
    );
  }
  function manualIssue(item) {
    const invoice_code = window.prompt("请输入发票代码");
    if (!invoice_code) return;
    const invoice_no = window.prompt("请输入发票号码");
    if (!invoice_no) return;
    const issue_date = window.prompt(
      "请输入开票日期（YYYY-MM-DD）",
      new Date().toISOString().slice(0, 10),
    );
    if (!issue_date) return;
    return act(
      () =>
        registerManualInvoice(item.id, {
          invoice_code,
          invoice_no,
          issue_date,
          seller_profile: {},
        }),
      "发票已登记，应收开票金额已同步更新。",
    );
  }

  return {
    reviewFailureDialog,
    invoiceTab,
    invoiceComposerOpen,
    invoiceReviewOpen,
    invoiceKeyword,
    invoiceStatusFilter,
    invoiceReview,
    invoiceForm,
    visibleInvoiceRequests,
    visibleTaxInvoices,
    resetInvoiceFilters,
    openReviewFailure,
    closeReviewFailure,
    submitReviewFailure,
    submitInvoice,
    approveInvoice,
    submitInvoiceReview,
    manualIssue,
  };
}
