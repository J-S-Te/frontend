import { computed, ref } from "vue";
import { buildInvoiceTimelineEvents } from "../utils/settlementDisplay.js";
import { validateInvoiceDocumentFile } from "../utils/invoiceDocumentValidation.js";

/**
 * 发票详情域（治理批次 5 结算，自 SettlementView.vue 逐字迁移）。
 * 收编：详情路由标识（仅开票管理区读取 invoice_id）、详情数据与留痕时间线、电子发票上传 / 下载
 * （文件输入句柄与选择动作归 SettlementInvoiceDetailPanel 组件持有；上传前按 accept 白名单与后端 10 MiB
 * 上限做本地校验，不合规只提示不调用上传接口）、红冲申请表单与提交、红冲复核（通过 / 驳回）。
 * 仍属视图：loadTargets 按 invoiceDetailID 装载或清空 invoiceDetail、watch(invoiceDetailID, load)、
 * manualIssue（开票申请级动作）。reviewRedFlush 驳回原因由应用内表单收集。
 * 注入项与组件内同名标识一一对应：route/router/active/saving/notify/act/load/formatSettlementError +
 * uploadTaxInvoiceDocument/downloadTaxInvoiceDocument/requestTaxInvoiceRedFlush/approveInvoiceRedFlush/
 * rejectInvoiceRedFlush；不直接导入 API 模块，保持可独立测试。
 */
// 用途：组织发票详情、归档与红冲交互。
// 参数：依赖对象含当前路由、能力、保存状态、表单及业务接口。
// 返回值：详情状态与操作函数。
export function useInvoiceDetail({
  can = () => false,
  askPrompt,
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
  let reviewPromptPending = false;
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
    // 上传前本地校验扩展名/类型与 10 MiB 上限：不合规直接提示，不调用上传接口，
    // 因而不会触发 FormData 构造，字段顺序保持 API 层原样。
    const verdict = validateInvoiceDocumentFile(file);
    if (!verdict.ok) { notify(verdict.message); return; }
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
  // 用途：复核表单等待后的发票和红冲申请，避免对已变化的对象执行审核。
  // 参数：target 为打开表单时的详情路由、发票标识、红冲申请标识、版本与状态。
  // 返回值：当前对象仍可审核、具有权限且无保存任务时为 true。
  function canReviewRedFlush(target) {
    const current = invoiceDetail.value?.red_flush_request;
    return !saving.value && active.value === "invoices" && can("settlement.invoice.approve")
      && invoiceDetailID.value === target.routeID
      && invoiceDetail.value?.id === target.invoiceID && current?.id === target.id
      && current?.version === target.version && current?.status === target.status
      && current?.can_review === true;
  }

  // 用途：通过红冲复核，或填写理由后驳回原红冲申请。
  // 参数：approve 为 true 时通过，为 false 时打开驳回理由表单。
  // 返回值：审核完成的 Promise；取消、对象变化或无权限时不提交。
  async function reviewRedFlush(approve) {
    const request = invoiceDetail.value?.red_flush_request;
    if (!request || reviewPromptPending) return;
    const target = { invoiceID: invoiceDetail.value.id, routeID: invoiceDetailID.value,
      id: request.id,
      version: request.version, status: request.status };
    if (!canReviewRedFlush(target)) return;
    let reason = "";
    if (!approve) {
      reviewPromptPending = true;
      try {
        reason = await askPrompt({
          title: "驳回红冲申请", confirmText: "驳回红冲申请",
          label: "驳回原因", initialValue: "", minlength: 1, maxlength: 500, danger: true,
        });
      } finally {
        reviewPromptPending = false;
      }
      if (!reason?.trim() || !canReviewRedFlush(target)) return;
    }
    return act(async () => {
      if (approve) {
        await approveInvoiceRedFlush(target.id, target.version);
      } else {
        await rejectInvoiceRedFlush(target.id, target.version, reason.trim());
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
