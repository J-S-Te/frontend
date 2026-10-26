import { computed, ref } from "vue";
import { buildInvoiceTimelineEvents } from "../utils/settlementDisplay.js";

/**
 * 发票详情域（治理批次 5 结算，自 SettlementView.vue 逐字迁移）。
 * 收编：详情路由标识（仅开票管理区读取 invoice_id）、详情数据与留痕时间线、电子发票上传 / 下载
 * （文件输入句柄与选择动作归 SettlementInvoiceDetailPanel 组件持有）、红冲申请表单与提交、红冲复核（通过 / 驳回）。
 * 仍属视图：loadTargets 按 invoiceDetailID 装载或清空 invoiceDetail、watch(invoiceDetailID, load)、
 * manualIssue（开票申请级动作）。reviewRedFlush 驳回原因沿用 window.prompt（逐字保留，行为修复另行授权）。
 * 注入项与组件内同名标识一一对应：route/router/active/saving/notify/act/load/formatSettlementError +
 * uploadTaxInvoiceDocument/downloadTaxInvoiceDocument/requestTaxInvoiceRedFlush/approveInvoiceRedFlush/
 * rejectInvoiceRedFlush；不直接导入 API 模块，保持可独立测试。
 */
export function useInvoiceDetail({
  route,
  router,
  active,
  saving,
  notify,
  act,
  load,
  formatSettlementError,
  uploadTaxInvoiceDocument,
  downloadTaxInvoiceDocument,
  requestTaxInvoiceRedFlush,
  approveInvoiceRedFlush,
  rejectInvoiceRedFlush,
}) {
  const invoiceDetailID = computed(() =>
    active.value === "invoices" ? String(route.query.invoice_id || "") : "",
  );
  const invoiceDetail = ref(null);
  const redFlushOpen = ref(false);
  const redFlushForm = ref({ reason_code: "INVOICE_ERROR", reason_detail: "" });
  const invoiceTimelineEvents = computed(() => buildInvoiceTimelineEvents(invoiceDetail.value));

  function openInvoiceDetail(item) {
    router.push({
      name: "settlement",
      params: { section: "invoices" },
      query: { invoice_id: item.id },
    });
  }
  function closeInvoiceDetail() {
    router.push({ name: "settlement", params: { section: "invoices" } });
  }
  async function uploadInvoiceDocument(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !invoiceDetail.value?.id) return;
    if (saving.value) return;
    saving.value = true;
    try {
      await uploadTaxInvoiceDocument(invoiceDetail.value.id, file);
      const refreshed = await load();
      notify(refreshed ? "电子发票已通过文件网关归档。" : "电子发票已归档，但页面刷新失败。请刷新列表查看，勿重复上传。");
    } catch (cause) {
      notify(formatSettlementError(cause, { fallback: "电子发票上传失败。" }));
    } finally {
      saving.value = false;
    }
  }
  async function downloadInvoiceDocument(document) {
    if (!invoiceDetail.value?.id || !document?.id) return;
    try { await downloadTaxInvoiceDocument(invoiceDetail.value.id, document.id); }
    catch (cause) { notify(formatSettlementError(cause, { fallback: "电子发票下载失败，请稍后重试。" })); }
  }
  function submitRedFlush() {
    if (!redFlushForm.value.reason_detail.trim()) {
      notify("发起红冲必须填写具体原因。");
      return;
    }
    return act(async () => {
      await requestTaxInvoiceRedFlush(invoiceDetail.value.id, {
        reason_code: redFlushForm.value.reason_code,
        reason_detail: redFlushForm.value.reason_detail.trim(),
      });
      redFlushOpen.value = false;
    }, "红冲申请已提交，等待财务复核；原发票仍保持已开具状态。");
  }
  function reviewRedFlush(approve) {
    const request = invoiceDetail.value?.red_flush_request;
    if (!request) return;
    let reason = "";
    if (!approve) {
      reason = window.prompt("请输入红冲驳回原因：", "");
      if (!reason?.trim()) return;
    }
    return act(async () => {
      if (approve) {
        await approveInvoiceRedFlush(request.id, request.version);
      } else {
        await rejectInvoiceRedFlush(request.id, request.version, reason.trim());
      }
    }, approve ? "红冲申请已通过复核，等待税控处理。" : "红冲申请已驳回。");
  }

  return {
    invoiceDetailID,
    invoiceDetail,
    redFlushOpen,
    redFlushForm,
    invoiceTimelineEvents,
    openInvoiceDetail,
    closeInvoiceDetail,
    uploadInvoiceDocument,
    downloadInvoiceDocument,
    submitRedFlush,
    reviewRedFlush,
  };
}
