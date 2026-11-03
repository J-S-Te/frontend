// 结算页面的展示层纯函数与常量：由 SettlementView.vue 批次 3 第一步逐字迁移，
// 行为契约由 settlementDisplay.test.mjs 固化；页面通过 import 继续以原绑定名使用。

// 业务时间一律走共享的北京口径工具：收付款日是纯日期（日历日），到期判定按北京日历日比较。
import {
  currentBusinessMonthRange,
  formatBusinessDate,
  formatBusinessMonth,
  todayBusinessDate,
} from "../../shared/utils/businessTime.js";

export const amountOf = (value) => Number.parseFloat(value) || 0;

// 票面/税额精度：金额一律按币种最小单位展示固定小数位（CNY/USD=2、JPY=0、未登记币种默认 2）。
// 改前 maximumFractionDigits: 0 会把 0.06 的税额显示成“¥0”，逐行四舍五入后
// 红票明细行的显示合计与价税合计的显示值不再相等。固定 2 位后，明细行与合计
// 使用同一取整口径，行合计与价税合计在页面上自洽。
const CURRENCY_FRACTION_DIGITS = { CNY: 2, USD: 2, JPY: 0 };
export const currencyFractionDigits = (currency) =>
  CURRENCY_FRACTION_DIGITS[String(currency || "CNY").toUpperCase()] ?? 2;

export const money = (value, currency = "CNY") => {
  const code = currency || "CNY";
  const digits = currencyFractionDigits(code);
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountOf(value));
};

// KPI 简写：≥ 1 万用“万”，≥ 1 亿用“亿”，其余保留原值；万/亿保留 1 位小数。
// 不足 1 万的原始金额与票面金额同一口径（money 的币种小数位），避免 KPI 与明细精度不一致。
export const formatSettlementAmount = (value, currency = "CNY") => {
  const amount = amountOf(value);
  const code = currency || "CNY";
  if (Math.abs(amount) >= 1e8) {
    return `${code} ${(amount / 1e8).toFixed(1)}亿`;
  }
  if (Math.abs(amount) >= 1e4) {
    return `${code} ${(amount / 1e4).toFixed(1)}万`;
  }
  return money(amount, code);
};

// “本月回款”按北京自然月判定：纯日期（收付款日）本身就是日历日，原样比对不平移；
// 带时区的时间戳先折算成北京日历日再比，避免浏览器本地月份在月初/月末错位。
export const isCurrentMonth = (dateString) => {
  const month = formatBusinessMonth(dateString);
  const { from } = currentBusinessMonthRange();
  return month !== "" && from !== "" && month === from.slice(0, 7);
};

// 逾期按北京日历日判定：到期当天不算逾期，次日起才算。
// 不能直接比较 Date.parse(due_date) 与 Date.now()——纯日期会被解析成 UTC 零点，
// 北京用户在到期日 08:00 之后就被误判为逾期。
export const isBusinessOverdue = (dueDate) => {
  const due = formatBusinessDate(dueDate);
  const today = todayBusinessDate();
  return due !== "" && today !== "" && due < today;
};

export const dunningActionStatusLabel = (status) =>
  ({ PENDING: "待跟进", COMPLETED: "已完成", CANCELLED: "已取消" })[status] || status;

export const dunningCaseStatusLabel = (status) =>
  ({ ACTIVE: "跟进中", CLOSED: "已关闭" })[status] || status;

const CALENDAR_DAY_MS = 86400000;

/**
 * 'YYYY-MM-DD' → 该日历日的 UTC 零点毫秒值（纯日历运算，不做时区换算）。
 * 只用于把两个北京日历日相减得到日历日差，非法输入返回 NaN。
 */
function calendarDayIndex(isoDate) {
  if (typeof isoDate !== "string" || isoDate.length !== 10) return NaN;
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return NaN;
  return Date.UTC(year, month - 1, day);
}

// 到期状态与逾期统计（isBusinessOverdue）共用同一口径：按北京日历日判定与算天数。
// 改前：Date.parse(due_date || "") 把纯日期当成 UTC 零点，再与 Date.now() 相减后 ceil，
// 于是北京到期次日的 00:00–08:00 看板仍显示“未到期”，而逾期统计已算逾期——这就是矛盾来源。
// 改后：到期日 < 北京今天 → 逾期；到期日 == 北京今天 → 剩余 0 天；到期日 > 北京今天 →
// 剩余天数 = 到期日 - 今天（日历日差）。纯日期字段原样比较，不做任何时区平移。
// 标签沿用既有的 逾期 / 即将到期 / 未到期（面板筛选按标签字符串匹配，不新增文案）。
export function dueState(dueDate) {
  const due = formatBusinessDate(dueDate);
  const today = todayBusinessDate();
  if (due === "" || today === "") return { label: "待确认", tone: "gray" };
  const days = Math.round((calendarDayIndex(due) - calendarDayIndex(today)) / CALENDAR_DAY_MS);
  if (!Number.isFinite(days)) return { label: "待确认", tone: "gray" };
  if (days < 0) return { label: "逾期", tone: "danger" };
  if (days <= 7) return { label: "即将到期", tone: "warning" };
  return { label: "未到期", tone: "info" };
}

export function confirmationState(value) {
  return value === "CONFIRMED"
    ? { label: "已确认", tone: "success" }
    : { label: "待确认", tone: "warning" };
}

export const invoiceStatusMeta = (value) => {
  const known = {
    SPECIAL_REVIEW: { label: "待总监加签", tone: "warning" },
    SUBMITTED: { label: "待审核", tone: "warning" },
    // 历史数据仍可能带 UNDER_REVIEW（台账与汇总 SQL 均按它统计在途开票），按审核中展示。
    UNDER_REVIEW: { label: "审核中", tone: "warning" },
    ISSUE_PENDING: { label: "待开具", tone: "info" },
    ISSUE_UNKNOWN: { label: "结果待对账", tone: "warning" },
    ISSUE_FAILED: { label: "开具失败", tone: "danger" },
    ISSUED: { label: "已开票", tone: "success" },
    REJECTED: { label: "已驳回", tone: "danger" },
    // 已红冲是发票台账的真实终态，不能落到"未识别状态"的失败语义里。
    RED_FLUSHED: { label: "已红冲", tone: "gray" },
    // SET-06：作废只释放未开票的额度预留，是终态但非失败；ABANDONED 是税控尝试被放弃的结果。
    CANCELLED: { label: "已作废", tone: "gray" },
    ABANDONED: { label: "已放弃开具", tone: "danger" },
  }[value];
  if (known) return known;
  // 未知枚举（含后续版本新增状态）降级为失败语义：保留原始代码供排查，绝不显示空白或误判为正常。
  const raw = String(value ?? "").trim();
  return raw ? { label: `${raw} · 未识别状态`, tone: "danger" } : { label: "状态未知", tone: "danger" };
};

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
export function buildInvoiceTimelineEvents(detail) {
  if (!detail) return [];
  const events = [];
  if (detail.request_no) {
    events.push({
      tone: "info",
      title: "提交开票申请",
      detail: `申请号 ${detail.request_no} · 合同 ${detail.contract_no || "—"}`,
    });
  }
  if (detail.issue_date) {
    events.push({
      tone: "success",
      title: "开票完成",
      timestamp: detail.issue_date,
      detail:
        detail.issued_by_channel === "MANUAL"
          ? "人工登记发票并回填台账"
          : "税控回执已写入台账",
    });
  }
  const flush = detail.red_flush_request;
  if (flush) {
    const status = redFlushStatusLabel(flush.status);
    const reviewTone =
      flush.status === "REJECTED" || flush.status === "FAILED"
        ? "danger"
        : flush.status === "COMPLETED"
          ? "success"
          : "warning";
    events.push({
      tone: reviewTone,
      title: `红冲申请 · ${status}`,
      timestamp: flush.created_at || flush.updated_at || "",
      detail: flush.review_reason
        ? `复核意见：${flush.review_reason}`
        : `原因：${flush.reason_code}${flush.reason_detail ? ` · ${flush.reason_detail}` : ""}`,
    });
  }
  return events;
}

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
