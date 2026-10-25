// 结算页面的展示层纯函数与常量：由 SettlementView.vue 批次 3 第一步逐字迁移，
// 行为契约由 settlementDisplay.test.mjs 固化；页面通过 import 继续以原绑定名使用。

export const amountOf = (value) => Number.parseFloat(value) || 0;

export const money = (value, currency = "CNY") =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 0,
  }).format(amountOf(value));
// KPI 简写：≥ 1 万用"万"，≥ 1 亿用"亿"，其余保留原值；保留 1 位小数。

// KPI 简写：≥ 1 万用"万"，≥ 1 亿用"亿"，其余保留原值；保留 1 位小数。
export const formatSettlementAmount = (value, currency = "CNY") => {
  const amount = amountOf(value);
  const code = currency || "CNY";
  if (Math.abs(amount) >= 1e8) {
    return `${code} ${(amount / 1e8).toFixed(1)}亿`;
  }
  if (Math.abs(amount) >= 1e4) {
    return `${code} ${(amount / 1e4).toFixed(1)}万`;
  }
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const isCurrentMonth = (dateString) => {
  const date = new Date(dateString || "");
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
};

export const dunningActionStatusLabel = (status) =>
  ({ PENDING: "待跟进", COMPLETED: "已完成", CANCELLED: "已取消" })[status] || status;

export const dunningCaseStatusLabel = (status) =>
  ({ ACTIVE: "跟进中", CLOSED: "已关闭" })[status] || status;

export function dueState(dueDate) {
  const due = Date.parse(dueDate || "");
  if (!Number.isFinite(due)) return { label: "待确认", tone: "gray" };
  const days = Math.ceil((due - Date.now()) / 86400000);
  if (days < 0) return { label: "逾期", tone: "danger" };
  if (days <= 7) return { label: "即将到期", tone: "warning" };
  return { label: "未到期", tone: "info" };
}

export function confirmationState(value) {
  return value === "CONFIRMED"
    ? { label: "已确认", tone: "success" }
    : { label: "待确认", tone: "warning" };
}

export const invoiceStatusMeta = (value) =>
  ({
    SUBMITTED: { label: "待审核", tone: "warning" },
    ISSUE_PENDING: { label: "待开具", tone: "info" },
    ISSUE_UNKNOWN: { label: "结果待对账", tone: "warning" },
    ISSUE_FAILED: { label: "开具失败", tone: "danger" },
    ISSUED: { label: "已开票", tone: "success" },
    REJECTED: { label: "已驳回", tone: "danger" },
  })[value] || { label: value || "未知", tone: "gray" };

export const collectionStatusLabel = (value) =>
  ({ UNPAID: "未回款", PARTIALLY_SETTLED: "部分回款", SETTLED: "已结清" })[
    value
  ] || "未知";

export const receivableInvoiceStatusLabel = (value) =>
  ({
    NOT_INVOICED: "未开票",
    PARTIALLY_INVOICED: "部分开票",
    FULLY_INVOICED: "已全部开票",
  })[value] || "未知";

export const invoiceTypeLabel = (value) =>
  ({
    ELECTRONIC_NORMAL: "电子普通发票",
    ELECTRONIC_SPECIAL: "电子专用发票",
    PAPER_NORMAL: "纸质普通发票",
    PAPER_SPECIAL: "纸质专用发票",
  })[value] || "其他发票";

export const issueChannelLabel = (value) =>
  ({ MANUAL: "人工登记", TAX_ADAPTER: "税控直连" })[value] || "其他渠道";

export const redFlushStatusLabel = (value) =>
  ({ SUBMITTED: "待财务复核", ISSUE_PENDING: "待税控开具", ISSUE_UNKNOWN: "结果待对账", RED_FLUSHED: "已红冲", REJECTED: "已驳回", ISSUE_FAILED: "红冲失败" })[
    value
  ] || "未知";
// 发票详情 · 留痕时间线事件：仅基于当前发票已暴露的字段拼装，不引入额外后端接口。

export const receiptStatusMeta = (item) =>
  ({
    AVAILABLE: { label: "待核销", tone: "purple" },
    PARTIALLY_ALLOCATED: { label: "部分核销", tone: "info" },
    FULLY_ALLOCATED: { label: "已核销", tone: "success" },
  })[item.status] || { label: item.status || "未知", tone: "gray" };

export const allocationStatusMeta = (value) =>
  value === "CONFIRMED"
    ? { label: "已核销", tone: "success" }
    : value === "PARTIALLY_REVERSED"
      ? { label: "部分冲销", tone: "warning" }
      : value === "REVERSED"
        ? { label: "已冲销", tone: "danger" }
        : { label: "状态待确认", tone: "gray" };
