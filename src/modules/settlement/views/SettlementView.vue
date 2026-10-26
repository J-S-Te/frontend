<script setup>
import { loginUsername } from "@/modules/shared/loginUsername.mjs"
import OperationToast from '@/modules/shared/components/OperationToast.vue'
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AuthError, logoutCurrentSession } from "@/modules/platform/auth/api/auth";
import { createRequestScope } from "@/modules/platform/shared/composables/requestScope.js";
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue";
import SettlementInvoiceDetailPanel from "@/modules/settlement/components/SettlementInvoiceDetailPanel.vue";
import SettlementAllocationsPanel from "@/modules/settlement/components/SettlementAllocationsPanel.vue";
import SettlementReceiptsPanel from "@/modules/settlement/components/SettlementReceiptsPanel.vue";
import SettlementReceivablesPanel from "@/modules/settlement/components/SettlementReceivablesPanel.vue";
import SettlementDashboardPanel from "@/modules/settlement/components/SettlementDashboardPanel.vue";
import SettlementTasksPanel from "@/modules/settlement/components/SettlementTasksPanel.vue";
import DunningCenterPanel from "@/modules/settlement/components/DunningCenterPanel.vue";
import SettlementInvoiceListPanel from "@/modules/settlement/components/SettlementInvoiceListPanel.vue";
import {
  amountOf,
  formatSettlementAmount,
  isCurrentMonth,
} from "@/modules/settlement/utils/settlementDisplay";
import { useSettlementActions } from "@/modules/settlement/composables/useSettlementActions";
import { useDunningCenter } from "@/modules/settlement/composables/useDunningCenter";
import { useReceiptAllocation } from "@/modules/settlement/composables/useReceiptAllocation";
import { useInvoiceDetail } from "@/modules/settlement/composables/useInvoiceDetail";
import { useReportExport } from "@/modules/settlement/composables/useReportExport";
import { useReceivablePlans } from "@/modules/settlement/composables/useReceivablePlans";
import { useReceiptRegistration } from "@/modules/settlement/composables/useReceiptRegistration";
import { useInvoiceRequests } from "@/modules/settlement/composables/useInvoiceRequests";
import { canRequestRedFlush } from "@/modules/settlement/utils/invoiceStatus";
import { formatSettlementError } from "../utils/errors.js";
import { closeSubsystemTabOrFallback } from "@/modules/shared/utils/returnToPortal";
import { useConfirmDialog } from "@/modules/shared/composables/useConfirmDialog.js";
import ConfirmDialog from "@/modules/shared/components/ConfirmDialog.vue";
import PromptDialog from "@/modules/shared/components/PromptDialog.vue";
import {
  approveInvoiceRequest,
  recoverInvoiceFailure,
  approveInvoiceRedFlush,
  confirmReceivablePlan,
  createAgingReceivablesExport,
  createInvoicedReceivablesExport,
  createInvoiceRequest,
  createReceipt,
  createReceiptAllocation,
  downloadTaxInvoiceDocument,
  getDashboard,
  getAgingSummary,
  getDunningCoverage,
  getDunningOverview,
  getSettlementSession,
  getInvoicedReceivablesTop10,
  getReportExport,
  listDunningCases,
  listDunningActions,
  listDunningPolicies,
  listDunningRecipients,
  listInvoiceRequests,
  getTaxInvoice,
  listReceivablePlans,
  listReceiptMatches,
  listReceipts,
  listReceivables,
  listInvoiceEligibleReceivables,
  listReceiptAllocations,
  listTaxInvoices,
  downloadReportExport,
  reverseReceiptAllocation,
  rejectInvoiceRequest,
  rejectInvoiceRedFlush,
  registerManualInvoice,
  requestTaxInvoiceRedFlush,
  uploadTaxInvoiceDocument,
} from "@/modules/settlement/api/settlement";
import "@/modules/platform/styles/console.css";
import "@/modules/settlement/styles/settlement.css";

const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog();
const route = useRoute(),
  router = useRouter();
const settlementSession = ref({});
const sessionDisplayName = computed(() => loginUsername(settlementSession.value));
const sessionAccount = computed(() => "当前登录账号");
const sessionAvatar = computed(() => sessionDisplayName.value.slice(0, 1).toUpperCase() || "结");
const sessionPermissions = computed(
  () => new Set(settlementSession.value?.permissions || []),
);
const can = (permission) =>
  sessionPermissions.value.has("settlement.admin") ||
  sessionPermissions.value.has(permission);
const sections = [
  ["dashboard", "结算总览", "dashboard"],
  ["receivables", "应收计划与应收单", "audit"],
  ["invoices", "开票管理", "account"],
  ["receipts", "回款核销", "save"],
  ["allocations", "核销与冲销", "reset"],
  ["dunning", "账龄与催收", "bell"],
  ["tasks", "我的待办", "organization"],
];
const navigationGroups = [
  { label: "工作台", keys: ["dashboard", "tasks"] },
  {
    label: "结算管理",
    keys: ["receivables", "invoices", "receipts", "allocations", "dunning"],
  },
];
const navigationSections = computed(() =>
  navigationGroups.map((group) => ({
    ...group,
    items: group.keys
      .map((key) => sections.find((item) => item[0] === key))
      .filter(Boolean),
  })),
);
const active = computed(() =>
  sections.some(([key]) => key === route.params.section)
    ? route.params.section
    : "dashboard",
);
const title = computed(
  () => sections.find(([key]) => key === active.value)?.[1] || "结算总览",
);
const dashboardCurrencyTotals = (field, fallback) => {
  const totals = Array.isArray(dashboard.value.currency_totals)
    ? dashboard.value.currency_totals.filter((item) => item && item.currency)
    : [];
  if (!totals.length) return formatSettlementAmount(fallback);
  return totals
    .map((item) => `${item.currency} ${formatSettlementAmount(item[field], item.currency)}`)
    .join(" · ");
};
const dashboardKpis = computed(() => {
  const currentMonthReceipts = receipts.value.filter((item) =>
    isCurrentMonth(item.receipt_date),
  );
  return [
    {
      label: "应收总额（未结清）",
      value: dashboardCurrencyTotals(
        "open_receivable",
        receivables.value.reduce(
          (total, item) => total + amountOf(item.open_amount),
          0,
        ),
      ),
      note: `${dashboard.value.receivable_count || 0} 笔正式应收 · 按币种汇总`,
      tone: "blue",
    },
    {
      label: "本月已回款",
      value: dashboardCurrencyTotals(
        "current_month_receipts",
        currentMonthReceipts.reduce(
          (total, item) => total + amountOf(item.amount),
          0,
        ),
      ),
      note: "本月回款 · 服务端按币种汇总",
      tone: "green",
    },
    {
      label: "待开票金额",
      value: dashboardCurrencyTotals(
        "pending_invoice",
        invoiceRequests.value
          .filter((item) => ["SUBMITTED", "UNDER_REVIEW", "ISSUE_PENDING"].includes(item.status))
          .reduce(
            (total, item) => total + amountOf(item.amount_incl_tax),
            0,
          ),
      ),
      note: `${dashboard.value.pending_invoice_count || 0} 笔待处理 · 按币种汇总`,
      tone: "orange",
    },
    {
      label: "逾期应收",
      value: dashboardCurrencyTotals(
        "overdue",
        dunningCases.value.reduce(
          (total, item) => total + amountOf(item.open_amount),
          0,
        ),
      ),
      note: `${dunningOverview.value.overdue_count ?? dashboard.value.overdue_count ?? 0} 笔需要催收 · 按币种汇总`,
      tone: "purple",
    },
  ];
});
const workItems = computed(() =>
  [
    {
      icon: "audit",
      tone: "orange",
      title: `${plans.value.filter((item) => item.status === "PENDING_CONFIRMATION").length} 笔收款计划待确认`,
      description: "确认后将生成正式应收并进入催收统计口径。",
      section: "receivables",
      action: "去确认",
    },
    {
      icon: "account",
      tone: "blue",
      title: `${invoiceRequests.value.filter((item) => item.status === "SUBMITTED").length} 笔开票申请待审核`,
      description: "请核验购方税号、金额与可开票余额。",
      section: "invoices",
      action: "去审核",
    },
    {
      icon: "save",
      tone: "purple",
      title: `${allocations.value.filter((item) => item.status !== "REVERSED").length} 笔核销分配待关注`,
      description: "回款分配与冲销结果均以业务单据为准。",
      section: "allocations",
      action: "去核销",
    },
  ].filter((item) => !item.title.startsWith("0 笔")),
);
// 我的待办 section · 按业务单据分组聚合，每组提供可点击任务项。
const taskGroups = computed(() => [
  {
    key: "plans",
    label: "待确认收款计划",
    description: "确认后将自动生成正式应收并进入催收统计口径。",
    section: "receivables",
    action: "应收计划与应收单",
    doneHint: "暂无待确认计划。",
    items: plans.value
      .filter((item) => item.status === "PENDING_CONFIRMATION")
      .map((item) => ({
        key: `plan-${item.id}`,
        label: `${item.contract_no || "未关联合同"} · 第 ${item.installment_no || "—"} 期`,
        meta: `计划收款日 ${item.due_date || "—"} · 金额 ${formatSettlementAmount(item.planned_amount)}`,
      })),
  },
  {
    key: "invoices",
    label: "待审批开票申请",
    description: "请核验购方税号、金额与可开票余额。",
    section: "invoices",
    action: "开票管理",
    doneHint: "当前没有待审批的开票申请。",
    items: invoiceRequests.value
      .filter((item) => item.status === "SUBMITTED")
      .map((item) => ({
        key: `inv-${item.id}`,
        label: item.request_no,
        meta: `${item.buyer_name || "未填写购方"} · ${formatSettlementAmount(item.amount_incl_tax)}`,
      })),
  },
  {
    key: "allocations",
    label: "待确认核销分配",
    description: "回款分配需经会计复核后方可生效。",
    section: "allocations",
    action: "核销与冲销",
    doneHint: "没有待确认的核销单。",
    items: allocations.value
      .filter((item) => item.status !== "REVERSED" && item.status !== "CONFIRMED")
      .map((item) => ({
        key: `alloc-${item.id}`,
        label: item.allocation_no,
        meta: `${item.receivable_no || "未关联应收"} · ${formatSettlementAmount(item.amount, item.currency)}`,
      })),
  },
  {
    key: "dunning",
    label: "活跃催收案件",
    description: "到期未结清的应收案件，需持续跟进。",
    section: "dunning",
    action: "账龄与催收",
    doneHint: "当前没有活跃催收案件。",
    items: dunningCases.value
      .filter((item) => item.status === "ACTIVE")
      .map((item) => ({
        key: `case-${item.id}`,
        label: item.receivable_no || `案件 ${item.id}`,
        meta: `剩余 ${formatSettlementAmount(item.open_amount)} · 逾期 ${item.level || 0} 级`,
      })),
  },
]);
const agingRows = computed(() => {
  const labels = { "0-30": "0–30 天", "31-60": "31–60 天", "61-90": "61–90 天", "90+": "90 天以上" };
  const tones = { "0-30": "green", "31-60": "blue", "61-90": "orange", "90+": "red" };
  const items = Array.isArray(agingSummary.value.items) ? agingSummary.value.items : [];
  const totals = new Map();
  items.forEach((item) => totals.set(item.currency, (totals.get(item.currency) || 0) + amountOf(item.amount)));
  return items.map((item) => ({
    key: `${item.currency}-${item.bucket}`,
    label: `${labels[item.bucket] || item.bucket} · ${item.currency}`,
    tone: tones[item.bucket] || "blue",
    currency: item.currency,
    bucket: item.bucket,
    amount: item.amount,
    count: item.count,
    percent: totals.get(item.currency) ? Math.round((amountOf(item.amount) / totals.get(item.currency)) * 100) : 0,
  }));
});
const dunningKpis = computed(() => {
  const overview = dunningOverview.value || {};
  const overdue = receivables.value.filter(
    (item) =>
      Date.parse(item.due_date || "") < Date.now() &&
      amountOf(item.open_amount) > 0,
  );
  return [
    {
      label: "逾期金额",
      value: Array.isArray(overview.currency_totals) && overview.currency_totals.length
        ? overview.currency_totals
            .map((item) => `${item.currency} ${formatSettlementAmount(item.overdue, item.currency)}`)
            .join(" · ")
        : formatSettlementAmount(
            overview.overdue_amount ??
              receivables.value.reduce(
                (total, item) => total + amountOf(item.open_amount),
                0,
              ),
          ),
      note: "服务端全量逾期金额",
      tone: "blue",
    },
    {
      label: "逾期笔数",
      value: `${overview.overdue_count ?? overdue.length} 笔`,
      note:
        agingRows.value.some((item) => item.bucket === "90+" && Number(item.amount) > 0)
          ? "含 90 天以上逾期"
          : "无 90 天以上逾期",
      tone: "orange",
    },
    {
      label: "已产生提醒",
      value: `${overview.action_count ?? dunningActions.value.length} 次`,
      note: `${overview.pending_action_count ?? 0} 条待跟进`,
      tone: "green",
    },
    {
      label: "活跃案件",
      value: `${overview.active_case_count ?? dunningCases.value.filter((item) => item.status === "ACTIVE").length} 笔`,
      note: `${overview.escalated_case_count ?? 0} 笔已升级`,
      tone: "purple",
    },
  ];
});
const loading = ref(true),
  error = ref(""),
  isLoggingOut = ref(false);

const { message, saving, notify, act } = useSettlementActions({ load, formatSettlementError });
const {
  dunningPolicies,
  dunningRecipients,
  dunningCases,
  dunningActions,
  dunningOverview,
  dunningCoverage,
  dunningRecipientsLoading,
  dunningRecipientsError,
  policyForm,
  dunningActionDialog,
  canCompleteDunningAction,
  completeDunningAction,
  cancelDunningAction,
  confirmDunningAction,
  submitPolicy,
} = useDunningCenter({
  saving,
  notify,
  load,
  act,
  formatSettlementError,
  settlementSession,
  sessionPermissions,
});
const dashboard = ref({}),
  plans = ref([]),
  receivables = ref([]),
  invoiceEligibleReceivables = ref([]),
  receipts = ref([]),
  allocations = ref([]),
  invoiceRequests = ref([]),
  taxInvoices = ref([]),
  invoicedReceivableTop10 = ref({ items: [] }),
  agingSummary = ref({ items: [] });
const { exportJob, exportInvoicedReceivables, exportAgingReceivables, downloadExport } = useReportExport({
  saving,
  notify,
  formatSettlementError,
  createInvoicedReceivablesExport,
  createAgingReceivablesExport,
  getReportExport,
  downloadReportExport,
});
const {
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
} = useInvoiceDetail({
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
});
// 读取作用域：每次 load() 开启新票据并整体失效旧请求，菜单快速切换时旧页面响应
// 只能结束自身；组件卸载经 onScopeDispose 自动作废，迟到响应不再回写（任务 C）。
const settlementScope = createRequestScope();
const {
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
} = useInvoiceRequests({
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
});
const {
  receiptComposerOpen,
  receiptMatches,
  receiptMatchFor,
  receiptForm,
  receiptCustomers,
  submitReceipt,
  syncReceiptCustomer,
} = useReceiptRegistration({
  receivables,
  saving,
  notify,
  load,
  formatSettlementError,
  createReceipt,
  listReceiptMatches,
});
const {
  allocationTab,
  allocationComposerOpen,
  reversalComposerOpen,
  allocationForm,
  reversalForm,
  submitAllocation,
  submitReversal,
} = useReceiptAllocation({ act, createReceiptAllocation, reverseReceiptAllocation });
const {
  planKeyword,
  planEditorOpen,
  planConfirmationFilter,
  planMaturityFilter,
  planEditor,
  visiblePlans,
  resetPlanFilters,
  confirmPlan,
  submitPlanConfirmation,
} = useReceivablePlans({ plans, notify, act, confirmReceivablePlan });
function go(section) {
  router.push({ name: "settlement", params: { section } });
}
function back() {
  closeSubsystemTabOrFallback(window, () => router.replace({ name: "portal" }));
}
async function logoutSystem() {
  if (isLoggingOut.value) return;
  isLoggingOut.value = true;
  try {
    await logoutCurrentSession();
    await router.replace({ name: "login", query: { reason: "session-ended" } });
  } catch (value) {
    if (value instanceof AuthError && value.status === 401) {
      await router.replace({ name: "login", query: { reason: "session-ended" } });
      return;
    }
    error.value = formatSettlementError(value, { fallback: "退出系统失败，请稍后重试。" });
  } finally {
    isLoggingOut.value = false;
  }
}
const listPages = ref({});
const pagedLists = [
  [listReceivablePlans, plans, "应收计划"], [listReceivables, receivables, "正式应收"],
  [listReceipts, receipts, "回款"], [listReceiptAllocations, allocations, "核销记录"],
  [listInvoiceRequests, invoiceRequests, "开票申请"], [listTaxInvoices, taxInvoices, "已开发票"],
  [listInvoiceEligibleReceivables, invoiceEligibleReceivables, "开票可用应收"],
  [listDunningCases, dunningCases, "催收案件"], [listDunningActions, dunningActions, "催收动作"],
  [listDunningPolicies, dunningPolicies, "催收策略"],
];
const sectionLists = {
  receivables: [0, 1], receipts: [2, 1], allocations: [2, 1, 3],
  invoices: [6, 4, 5], dunning: [1, 7, 8, 9], tasks: [0, 3, 4, 7],
};
const visibleListPages = computed(() => (sectionLists[active.value] || []).map((index) => ({
  index, label: pagedLists[index][2], page: listPages.value[index] || 0, count: pagedLists[index][1].value.length,
})));
async function changeListPage(index, direction) {
  listPages.value[index] = Math.max(0, (listPages.value[index] || 0) + direction);
  await load();
}
function loadTargets(section) {
  const target = (loader, state, fallback) => [loader, state, fallback];
  const targets = [];
  const add = (...items) => targets.push(...items);
  add(target(getSettlementSession, settlementSession, {}));

  switch (section) {
    case "dashboard":
      add(
        target(getDashboard, dashboard, {}),
        target(getInvoicedReceivablesTop10, invoicedReceivableTop10, {
          items: [],
        }),
        target(listReceivablePlans, plans, []),
        target(listReceivables, receivables, []),
        target(listReceipts, receipts, []),
        target(listReceiptAllocations, allocations, []),
        target(listInvoiceRequests, invoiceRequests, []),
        target(listDunningCases, dunningCases, []),
      );
      if (can("settlement.dunning.manage")) {
        add(target(getDunningOverview, dunningOverview, {}));
      }
      break;
    case "receivables":
      add(target(listReceivablePlans, plans, []), target(listReceivables, receivables, []));
      break;
    case "receipts":
      add(target(listReceipts, receipts, []), target(listReceivables, receivables, []));
      break;
    case "allocations":
      add(
        target(listReceipts, receipts, []),
        target(listReceivables, receivables, []),
        target(listReceiptAllocations, allocations, []),
      );
      break;
    case "invoices":
      add(
        target(listInvoiceEligibleReceivables, invoiceEligibleReceivables, []),
        target(listInvoiceRequests, invoiceRequests, []),
        target(listTaxInvoices, taxInvoices, []),
      );
      break;
    case "dunning":
      add(
        target(listReceivables, receivables, []),
        target(listDunningPolicies, dunningPolicies, []),
        target(listDunningRecipients, dunningRecipients, []),
        target(getDunningOverview, dunningOverview, {}),
        target(getAgingSummary, agingSummary, { items: [] }),
        target(getDunningCoverage, dunningCoverage, { policies: [], gaps: [] }),
        target(listDunningCases, dunningCases, []),
        target(listDunningActions, dunningActions, []),
      );
      break;
    case "tasks":
      add(
        target(listReceivablePlans, plans, []),
        target(listReceiptAllocations, allocations, []),
        target(listInvoiceRequests, invoiceRequests, []),
        target(listDunningCases, dunningCases, []),
      );
      break;
    default:
      break;
  }

  if (section === "invoices" && invoiceDetailID.value) {
    targets.push(target(() => getTaxInvoice(invoiceDetailID.value), invoiceDetail, null));
  } else {
    invoiceDetail.value = null;
  }
  return targets;
}
async function load() {
  const ticket = settlementScope.begin(`SETTLEMENT_SECTION:${active.value}`);
  const isCurrent = () => settlementScope.isCurrent(ticket);
  loading.value = true;
  error.value = "";
  const targets = loadTargets(active.value);
  if (active.value === "dunning") {
    dunningRecipientsLoading.value = true;
    dunningRecipientsError.value = "";
  }
  const results = await Promise.allSettled(targets.map(([loader]) => {
    const index = pagedLists.findIndex(([candidate]) => candidate === loader);
    const offset = active.value === "dunning" ? 0 : (listPages.value[index] || 0) * 50;
    return index < 0 ? loader() : loader({ limit: 50, offset });
  }));
  // 菜单快速切换时，旧页面请求可能晚于新页面返回。旧请求只能结束自身，
  // 不得覆盖当前页面的数据、错误和 loading 状态；组件卸载后同样丢弃。
  if (!isCurrent()) {
    if (active.value === "dunning") dunningRecipientsLoading.value = false;
    return false;
  }
  const failures = [];
  results.forEach((result, index) => {
    const [, target, fallback] = targets[index];
    if (result.status === "fulfilled") target.value = result.value ?? fallback;
    else {
      const message = formatSettlementError(result.reason, { fallback: "部分数据加载失败，请稍后刷新。" });
      failures.push(message);
      // 分页请求失败时，不得把上一页记录重新标记为新数据。
      if (pagedLists.some(([, state]) => state === target)) target.value = fallback;
      // 人员候选项加载失败时单独提示，避免用户误以为可以手动填写任意账号。
      if (active.value === "dunning" && targets[index]?.[0] === listDunningRecipients) {
        dunningRecipientsError.value = message;
      }
    }
  });
  if (active.value === "dunning") dunningRecipientsLoading.value = false;
  if (failures.length) error.value = [...new Set(failures)].join("；");
  loading.value = false;
  return failures.length === 0;
}
async function selectReceiptMatch(match) {
  allocationForm.value = {
    receipt_id: receiptMatchFor.value,
    receivable_id: match.receivable_id,
    amount: match.suggested_amount,
    match_mode: "SUGGESTED",
    match_confidence: match.score,
  };
  await router.push({ name: "settlement", params: { section: "allocations" } });
  allocationComposerOpen.value = true;
}

watch(
  active,
  (section) => {
    if (section === "receipts") allocationTab.value = "receipts";
    if (section === "allocations") allocationTab.value = "allocations";
    allocationComposerOpen.value = false;
    reversalComposerOpen.value = false;
    load();
  },
  { immediate: true },
);
watch(invoiceDetailID, load);
</script>

<template>
  <main class="console-page settlement-shell">
    <aside class="console-sidebar settlement-sidebar">
      <div class="console-brand settlement-brand">
        <span class="console-brand-mark"><ConsoleIcon name="account" /></span
        ><span class="console-brand-copy"
          ><strong>结算与开票</strong><small>FINANCE OPERATIONS</small></span
        >
      </div>
      <nav class="console-nav" aria-label="结算模块导航">
        <template v-for="group in navigationSections" :key="group.label"
          ><p class="console-nav-label">{{ group.label }}</p>
          <button
            v-for="item in group.items"
            :key="item[0]"
            class="console-nav-item"
            :class="{ active: active === item[0] }"
            @click="go(item[0])"
          >
            <ConsoleIcon :name="item[2]" /><span>{{ item[1] }}</span>
          </button></template
        >
        <p class="console-nav-label">平台能力</p>
        <button class="console-nav-item" type="button" @click="back">
          <ConsoleIcon name="dashboard" /><span>返回子系统门户</span>
        </button>
      </nav>
      <div class="settlement-sidebar-footer subsystem-sidebar-user">
        <span class="settlement-sidebar-avatar" aria-hidden="true">{{ sessionAvatar }}</span>
        <span class="settlement-sidebar-user-copy">
          <strong :title="sessionDisplayName">{{ sessionDisplayName }}</strong><small :title="sessionAccount">{{ sessionAccount }}</small>
        </span>
        <button
          class="settlement-sidebar-logout"
          type="button"
          :disabled="isLoggingOut"
          title="退出登录"
          aria-label="退出登录"
          @click="logoutSystem"
        >
          <ConsoleIcon name="logout" />
        </button>
      </div>
    </aside>
    <section class="console-main settlement-main">
      <header class="console-topbar settlement-topbar">
        <div class="console-crumb">
          <span>应用门户</span><b>/</b><strong>结算与开票管理</strong>
        </div>
        <div class="settlement-topbar-actions">
          <button
            class="settlement-topbar-icon"
            type="button"
            title="我的待办"
            aria-label="我的待办"
            @click="go('tasks')"
          >
            <ConsoleIcon name="bell" /><i class="settlement-notification-dot" />
          </button>
          <button
            class="settlement-topbar-icon"
            type="button"
            title="刷新数据"
            aria-label="刷新数据"
            :disabled="loading"
            @click="load"
          >
            <ConsoleIcon name="reset" />
          </button>
          <button
            class="settlement-topbar-avatar"
            type="button"
            :title="sessionDisplayName"
            :aria-label="sessionDisplayName"
            @click="go('tasks')"
          >
            {{ sessionAvatar }}
          </button>
        </div>
      </header>
      <div class="console-content settlement-content">
        <div class="console-page-head">
          <div>
            <p>结算与开票管理系统</p>
            <h1>{{ title }}</h1>
          </div>
          <div class="settlement-head-actions">
            <span class="settlement-environment">统一认证已接入</span
            ><template v-if="active === 'dashboard'"
              ><button
                class="console-button secondary"
                :disabled="saving"
                @click="
                  exportJob?.status === 'READY' &&
                  exportJob?.report_type === 'INVOICED_RECEIVABLES_CSV'
                    ? downloadExport(exportJob.id)
                    : exportInvoicedReceivables()
                "
              >
                {{
                  exportJob?.status === "READY" &&
                  exportJob?.report_type === "INVOICED_RECEIVABLES_CSV"
                    ? "下载报表"
                    : saving
                      ? "生成报表中…"
                      : "导出报表"
                }}</button
              ><button class="console-button" @click="go('invoices')">
                <ConsoleIcon name="account" />发起开票
              </button></template
            >
          </div>
        </div>
        <OperationToast :message="message" />
        <p v-if="error" class="settlement-error">{{ error }}</p>
        <p v-if="loading" class="settlement-loading">正在读取结算数据…</p>
        <template v-else>
          <div v-if="visibleListPages.length" class="settlement-panel" aria-label="列表分页">
            <p class="settlement-muted">以下筛选仅作用于当前页，每页最多 50 条；可按列表翻页查看历史记录。</p>
            <div v-for="entry in visibleListPages" :key="entry.index" class="settlement-head-actions">
              <span>{{ entry.label }} · 第 {{ entry.page + 1 }} 页 · {{ entry.count }} 条</span>
              <button class="console-button secondary small" :disabled="loading || saving || entry.page === 0" @click="changeListPage(entry.index, -1)">上一页</button>
              <button class="console-button secondary small" :disabled="loading || saving || entry.count < 50 || entry.page >= 2000" @click="changeListPage(entry.index, 1)">下一页</button>
            </div>
          </div>
          <SettlementDashboardPanel
            v-if="active === 'dashboard'"
            :dashboard-kpis="dashboardKpis"
            :work-items="workItems"
            :aging-rows="agingRows"
            :invoiced-receivable-top10="invoicedReceivableTop10"
            @navigate="go"
          />
          <SettlementReceivablesPanel
            v-else-if="active === 'receivables'"
            :visible-plans="visiblePlans"
            :receivables="receivables"
            :saving="saving"
            :plan-editor="planEditor"
            v-model:plan-editor-open="planEditorOpen"
            v-model:plan-keyword="planKeyword"
            v-model:plan-confirmation-filter="planConfirmationFilter"
            v-model:plan-maturity-filter="planMaturityFilter"
            @reload="load"
            @submit-plan="submitPlanConfirmation"
            @reset-filters="resetPlanFilters"
            @confirm-plan="confirmPlan"
          />
          <SettlementReceiptsPanel
            v-else-if="active === 'receipts'"
            :receipts="receipts"
            :receipt-customers="receiptCustomers"
            :saving="saving"
            :receipt-form="receiptForm"
            :can="can"
            v-model:receipt-composer-open="receiptComposerOpen"
            v-model:receipt-match-for="receiptMatchFor"
            v-model:receipt-matches="receiptMatches"
            @reload="load"
            @submit-receipt="submitReceipt"
            @sync-customer="syncReceiptCustomer"
            @select-match="selectReceiptMatch"
            @navigate="go"
          />
          <SettlementAllocationsPanel
            v-else-if="active === 'allocations'"
            :allocations="allocations"
            :receipts="receipts"
            :receivables="receivables"
            :saving="saving"
            :allocation-form="allocationForm"
            :reversal-form="reversalForm"
            v-model:allocation-tab="allocationTab"
            v-model:allocation-composer-open="allocationComposerOpen"
            v-model:reversal-composer-open="reversalComposerOpen"
            @reload="load"
            @submit-allocation="submitAllocation"
            @submit-reversal="submitReversal"
          />
          <SettlementInvoiceDetailPanel
            v-else-if="active === 'invoices' && invoiceDetailID"
            :invoice-detail="invoiceDetail"
            :saving="saving"
            :red-flush-form="redFlushForm"
            :invoice-timeline-events="invoiceTimelineEvents"
            v-model:red-flush-open="redFlushOpen"
            @close-detail="closeInvoiceDetail"
            @upload-document="uploadInvoiceDocument"
            @download-document="downloadInvoiceDocument"
            @review-red-flush="reviewRedFlush"
            @submit-red-flush="submitRedFlush"
          />
          <SettlementInvoiceListPanel
            v-else-if="active === 'invoices'"
            :visible-invoice-requests="visibleInvoiceRequests"
            :visible-tax-invoices="visibleTaxInvoices"
            :invoice-eligible-receivables="invoiceEligibleReceivables"
            :saving="saving"
            :invoice-form="invoiceForm"
            :invoice-review="invoiceReview"
            :can="can"
            v-model:invoice-tab="invoiceTab"
            v-model:invoice-composer-open="invoiceComposerOpen"
            v-model:invoice-review-open="invoiceReviewOpen"
            v-model:invoice-keyword="invoiceKeyword"
            v-model:invoice-status-filter="invoiceStatusFilter"
            @reload="load"
            @submit-invoice="submitInvoice"
            @submit-review="submitInvoiceReview"
            @reset-filters="resetInvoiceFilters"
            @approve="approveInvoice"
            @manual-issue="manualIssue"
            @review-failure="openReviewFailure"
            @open-detail="openInvoiceDetail"
          />
          <DunningCenterPanel
            v-else-if="active === 'dunning'"
            :saving="saving"
            :export-job="exportJob"
            :dunning-overview="dunningOverview"
            :dunning-coverage="dunningCoverage"
            :dunning-kpis="dunningKpis"
            :aging-rows="agingRows"
            :dunning-cases="dunningCases"
            :dunning-actions="dunningActions"
            :dunning-recipients="dunningRecipients"
            :dunning-recipients-loading="dunningRecipientsLoading"
            :dunning-recipients-error="dunningRecipientsError"
            :policy-form="policyForm"
            :can-complete-dunning-action="canCompleteDunningAction"
            @export-aging="exportAgingReceivables"
            @download-export="downloadExport"
            @reload="load"
            @complete-action="completeDunningAction"
            @submit-policy="submitPolicy"
          />
          <SettlementTasksPanel
            v-else
            :task-groups="taskGroups"
            @navigate="go"
            @reload="load"
          />
        </template>
      </div>
    </section>
      <PromptDialog
      v-if="reviewFailureDialog"
      title="复核税控失败结果"
      description="仅对税控已明确失败的申请恢复审批；结果未知不能重试，复核不会立即开票。恢复后仍需重新审核，旧开票尝试和失败记录会保留。"
      label="复核原因（5 至 1000 字）"
      placeholder="请写明已核对的原税控失败结果和恢复依据"
      confirm-text="确认复核"
      cancel-text="取消"
      :minlength="5"
      :maxlength="1000"
      :busy="saving"
      :error="reviewFailureDialog.error"
      @confirm="submitReviewFailure"
      @cancel="closeReviewFailure"
    />

    <PromptDialog
      v-if="dunningActionDialog"
      title="完成催收跟进"
      description="填写本次催收跟进结果。完成后该动作不再计入待办。"
      label="跟进结果（最多 500 字）"
      placeholder="例如：已电话提醒客户承诺本周付款"
      confirm-text="完成跟进"
      cancel-text="取消"
      :maxlength="500"
      :busy="saving"
      :error="dunningActionDialog.error"
      @confirm="confirmDunningAction"
      @cancel="cancelDunningAction"
    />

    <ConfirmDialog
      v-if="confirmDialog"
      :title="confirmDialog.title"
      :description="confirmDialog.description"
      :confirm-text="confirmDialog.confirmText"
      :cancel-text="confirmDialog.cancelText"
      :danger="confirmDialog.danger"
      @confirm="acceptConfirm"
      @cancel="cancelConfirm"
    />
  </main>
</template>
