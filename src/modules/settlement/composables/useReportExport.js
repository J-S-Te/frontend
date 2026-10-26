import { ref } from "vue";

/**
 * 报表导出域（治理批次 5 结算，自 SettlementView.vue 逐字迁移）。
 * 收编：导出任务状态、已开票应收 / 账龄两类导出入口、提交后最多 30 次每秒轮询（READY 提示可下载、
 * FAILED 带服务端原因、超时提示后台继续）、提交失败与"已提交但查询失败"的区分提示、导出文件下载。
 * 注入项与组件内同名标识一一对应：saving/notify/formatSettlementError +
 * createInvoicedReceivablesExport/createAgingReceivablesExport/getReportExport/downloadReportExport；不直接导入 API 模块。
 */
export function useReportExport({
  saving,
  notify,
  formatSettlementError,
  createInvoicedReceivablesExport,
  createAgingReceivablesExport,
  getReportExport,
  downloadReportExport,
}) {
  const exportJob = ref(null);

  async function exportInvoicedReceivables() {
    return runReportExport(createInvoicedReceivablesExport, "CSV 已生成，可下载。");
  }
  async function exportAgingReceivables() {
    return runReportExport(createAgingReceivablesExport, "账龄表已生成，可下载。");
  }
  async function runReportExport(createExport, successMessage) {
    if (saving.value) return;
    saving.value = true;
    let submitted = false;
    try {
      exportJob.value = await createExport();
      submitted = true;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (exportJob.value.status === "READY") {
          notify(successMessage);
          return;
        }
        if (exportJob.value.status === "FAILED") {
          notify(formatSettlementError(exportJob.value.error_message, { fallback: "报表生成失败，请稍后重新发起；仍失败时请联系管理员。" }));
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        exportJob.value = await getReportExport(exportJob.value.id);
      }
      notify("导出仍在后台生成，可稍后继续查询并下载。");
    } catch (cause) {
      notify(submitted
        ? `导出任务已提交，但状态查询失败。请稍后查询当前任务，勿重复提交。${formatSettlementError(cause)}`
        : formatSettlementError(cause, { fallback: "导出任务提交失败，请稍后重试。" }));
    } finally {
      saving.value = false;
    }
  }
  async function downloadExport(id) {
    try { await downloadReportExport(id); }
    catch (cause) { notify(formatSettlementError(cause, { fallback: "报表下载失败，请稍后重试。" })); }
  }

  return { exportJob, exportInvoicedReceivables, exportAgingReceivables, downloadExport };
}
