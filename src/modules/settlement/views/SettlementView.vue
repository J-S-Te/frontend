<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AuthError, logoutCurrentSession } from "@/modules/platform/auth/api/auth";
import ConsoleIcon from "@/modules/platform/shared/components/ConsoleIcon.vue";
import { closeSubsystemTabOrFallback } from "@/modules/shared/utils/returnToPortal";
import {
  approveInvoiceRequest,
  confirmReceivablePlan,
  createDunningPolicy,
  createInvoicedReceivablesExport,
  createInvoiceRequest,
  createReceipt,
  createReceiptAllocation,
  getDashboard,
  getInvoicedReceivablesTop10,
  getReportExport,
  listDunningCases,
  listDunningActions,
  listDunningPolicies,
  listDunningRecipients,
  listInvoiceRequests,
  getTaxInvoice,
  listReceivablePlans,
  listReceipts,
  listReceivables,
  listInvoiceEligibleReceivables,
  listReceiptAllocations,
  listTaxInvoices,
  downloadReportExport,
  reverseReceiptAllocation,
  registerManualInvoice,
} from "@/modules/settlement/api/settlement";
import "@/modules/platform/styles/console.css";
import "@/modules/settlement/styles/settlement.css";

const route = useRoute(),
  router = useRouter();
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
const invoiceDetailID = computed(() =>
  active.value === "invoices" ? String(route.query.invoice_id || "") : "",
);
const amountOf = (value) => Number.parseFloat(value) || 0;
const money = (value, currency = "CNY") =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 0,
  }).format(amountOf(value));
const dashboardKpis = computed(() => [
  {
    label: "应收总额（未结清）",
    value: money(
      receivables.value.reduce(
        (total, item) => total + amountOf(item.open_amount),
        0,
      ),
    ),
    note: `${dashboard.value.receivable_count || 0} 笔正式应收`,
    tone: "blue",
  },
  {
    label: "本月已回款",
    value: money(
      receipts.value.reduce((total, item) => total + amountOf(item.amount), 0),
    ),
    note: `${receipts.value.length} 笔回款记录`,
    tone: "green",
  },
  {
    label: "待开票金额",
    value: money(
      invoiceRequests.value
        .filter((item) => item.status !== "ISSUED")
        .reduce((total, item) => total + amountOf(item.amount_incl_tax), 0),
    ),
    note: `${dashboard.value.pending_invoice_count || 0} 笔待处理`,
    tone: "orange",
  },
  {
    label: "逾期应收",
    value: money(
      dunningCases.value.reduce(
        (total, item) => total + amountOf(item.open_amount),
        0,
      ),
    ),
    note: `${dashboard.value.overdue_count || 0} 笔需要催收`,
    tone: "purple",
  },
]);
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
const agingBuckets = computed(() => {
  const buckets = [
    { label: "0–30 天", tone: "green", amount: 0, count: 0 },
    { label: "31–60 天", tone: "blue", amount: 0, count: 0 },
    { label: "61–90 天", tone: "orange", amount: 0, count: 0 },
    { label: "90 天以上", tone: "red", amount: 0, count: 0 },
  ];
  const now = Date.now();
  receivables.value.forEach((item) => {
    const due = Date.parse(item.due_date || "");
    const days = Number.isFinite(due)
      ? Math.max(0, Math.floor((now - due) / 86400000))
      : 0;
    const index = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
    if (amountOf(item.open_amount) > 0) {
      buckets[index].amount += amountOf(item.open_amount);
      buckets[index].count += 1;
    }
  });
  const total = buckets.reduce((sum, item) => sum + item.amount, 0);
  return buckets.map((item) => ({
    ...item,
    percent: total ? Math.round((item.amount / total) * 100) : 0,
  }));
});
const dunningKpis = computed(() => {
  const overdue = receivables.value.filter(
    (item) =>
      Date.parse(item.due_date || "") < Date.now() &&
      amountOf(item.open_amount) > 0,
  );
  return [
    {
      label: "应收总额",
      value: money(
        receivables.value.reduce(
          (total, item) => total + amountOf(item.open_amount),
          0,
        ),
      ),
      note: "当前已加载应收",
      tone: "blue",
    },
    {
      label: "逾期笔数",
      value: `${overdue.length} 笔`,
      note:
        agingBuckets.value[3]?.amount > 0
          ? "含 90 天以上逾期"
          : "无 90 天以上逾期",
      tone: "orange",
    },
    {
      label: "已产生提醒",
      value: `${dunningActions.value.length} 次`,
      note: "按真实催收动作统计",
      tone: "green",
    },
    {
      label: "已升级案件",
      value: `${dunningCases.value.filter((item) => Number(item.level) > 0).length} 笔`,
      note: "按当前催收案件升级级别",
      tone: "purple",
    },
  ];
});
const loading = ref(true),
  error = ref(""),
  saving = ref(false),
  message = ref(""),
  isLoggingOut = ref(false);
const dashboard = ref({}),
  plans = ref([]),
  receivables = ref([]),
  invoiceEligibleReceivables = ref([]),
  receipts = ref([]),
  allocations = ref([]),
  invoiceRequests = ref([]),
  taxInvoices = ref([]),
  invoiceDetail = ref(null),
  invoicedReceivableTop10 = ref({ items: [] }),
  dunningPolicies = ref([]),
  dunningRecipients = ref([]),
  dunningCases = ref([]),
  dunningActions = ref([]);
const dunningRecipientsLoading = ref(false);
const dunningRecipientsError = ref("");
const exportJob = ref(null);
let loadGeneration = 0;
const invoiceTab = ref("requests"),
  invoiceComposerOpen = ref(false),
  invoiceKeyword = ref(""),
  invoiceStatusFilter = ref("");
const allocationTab = ref("receipts"),
  receiptComposerOpen = ref(false),
  allocationComposerOpen = ref(false),
  reversalComposerOpen = ref(false);
const planKeyword = ref(""),
  planConfirmationFilter = ref(""),
  planMaturityFilter = ref("");
const receiptForm = ref({
  customer_id: "",
  customer_name: "",
  amount: "",
  currency: "CNY",
  receipt_date: new Date().toISOString().slice(0, 10),
  payment_method: "TRANSFER",
  bank_transaction_reference: "",
});
const allocationForm = ref({
  receipt_id: "",
  receivable_id: "",
  amount: "",
  match_mode: "MANUAL",
});
const reversalForm = ref({
  allocation_id: "",
  amount: "",
  reason_code: "MATCH_ERROR",
  reason_detail: "",
});
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
const policyForm = ref({
  name: "逾期升级提醒",
  aging_from_days: 1,
  aging_to_days: 30,
  action_type: "REMIND",
  recipient_rule: "USER:",
  channel: "LOCAL",
  repeat_interval_days: 7,
  priority: "NORMAL",
});
const policyRecipientAccount = computed({
  get: () => policyForm.value.recipient_rule.replace(/^USER:/, ""),
  set: (value) => {
    policyForm.value.recipient_rule = `USER:${String(value || "").trim()}`;
  },
});
function go(section) {
  router.push({ name: "settlement", params: { section } });
}
function dueState(dueDate) {
  const due = Date.parse(dueDate || "");
  if (!Number.isFinite(due)) return { label: "待确认", tone: "gray" };
  const days = Math.ceil((due - Date.now()) / 86400000);
  if (days < 0) return { label: "逾期", tone: "danger" };
  if (days <= 7) return { label: "即将到期", tone: "warning" };
  return { label: "未到期", tone: "info" };
}
function confirmationState(value) {
  return value === "CONFIRMED"
    ? { label: "已确认", tone: "success" }
    : { label: "待确认", tone: "warning" };
}
const visiblePlans = computed(() =>
  plans.value.filter((item) => {
    const keyword = planKeyword.value.trim().toLowerCase();
    const confirmation = confirmationState(item.status);
    const maturity = dueState(item.due_date);
    return (
      (!keyword ||
        [item.contract_no, item.customer_name, item.id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(keyword)) &&
      (!planConfirmationFilter.value ||
        confirmation.label === planConfirmationFilter.value) &&
      (!planMaturityFilter.value || maturity.label === planMaturityFilter.value)
    );
  }),
);
function resetPlanFilters() {
  planKeyword.value = "";
  planConfirmationFilter.value = "";
  planMaturityFilter.value = "";
}
const invoiceStatusMeta = (value) =>
  ({
    SUBMITTED: { label: "待审核", tone: "warning" },
    ISSUE_PENDING: { label: "待开具", tone: "info" },
    ISSUED: { label: "已开票", tone: "success" },
  })[value] || { label: value || "未知", tone: "gray" };
const receiptStatusMeta = (item) =>
  ({
    AVAILABLE: { label: "待核销", tone: "purple" },
    PARTIALLY_ALLOCATED: { label: "部分核销", tone: "info" },
    FULLY_ALLOCATED: { label: "已核销", tone: "success" },
  })[item.status] || { label: item.status || "未知", tone: "gray" };
const allocationStatusMeta = (value) =>
  value === "CONFIRMED"
    ? { label: "已核销", tone: "success" }
    : value === "PARTIALLY_REVERSED"
      ? { label: "部分冲销", tone: "warning" }
      : value === "REVERSED"
        ? { label: "已冲销", tone: "danger" }
        : { label: "状态待确认", tone: "gray" };
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
    error.value = value?.message || "退出系统失败，请稍后重试。";
  } finally {
    isLoggingOut.value = false;
  }
}
function notify(value) {
  message.value = value;
  window.setTimeout(() => {
    message.value = "";
  }, 3200);
}
function loadTargets(section) {
  const target = (loader, state, fallback) => [loader, state, fallback];
  const targets = [];
  const add = (...items) => targets.push(...items);

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
  const generation = ++loadGeneration;
  loading.value = true;
  error.value = "";
  const targets = loadTargets(active.value);
  if (active.value === "dunning") {
    dunningRecipientsLoading.value = true;
    dunningRecipientsError.value = "";
  }
  const results = await Promise.allSettled(targets.map(([loader]) => loader()));
  // 菜单快速切换时，旧页面请求可能晚于新页面返回。旧请求只能结束自身，
  // 不得覆盖当前页面的数据、错误和 loading 状态。
  if (generation !== loadGeneration) {
    if (active.value === "dunning") dunningRecipientsLoading.value = false;
    return;
  }
  const failures = [];
  results.forEach((result, index) => {
    const [, target, fallback] = targets[index];
    if (result.status === "fulfilled") target.value = result.value ?? fallback;
    else {
      const message = result.reason?.message || "部分数据加载失败";
      failures.push(message);
      // 人员候选项加载失败时单独提示，避免用户误以为可以手动填写任意账号。
      if (active.value === "dunning" && targets[index]?.[0] === listDunningRecipients) {
        dunningRecipientsError.value = message;
      }
    }
  });
  if (active.value === "dunning") dunningRecipientsLoading.value = false;
  if (failures.length === targets.length) error.value = failures[0];
  loading.value = false;
}
async function exportInvoicedReceivables() {
  saving.value = true;
  try {
    exportJob.value = await createInvoicedReceivablesExport();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (exportJob.value.status === "READY") {
        notify("CSV 已生成，可下载。");
        return;
      }
      if (exportJob.value.status === "FAILED") {
        notify(exportJob.value.error_message || "报表生成失败，请重新发起。");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      exportJob.value = await getReportExport(exportJob.value.id);
    }
    notify("导出仍在后台生成，可稍后刷新本页继续下载。");
  } catch (cause) {
    notify(cause.message || "导出任务提交失败");
  } finally {
    saving.value = false;
  }
}
async function act(callback, success) {
  saving.value = true;
  try {
    await callback();
    notify(success);
    await load();
  } catch (cause) {
    notify(cause.message || "操作失败。");
  } finally {
    saving.value = false;
  }
}
function confirmPlan(plan) {
  return act(
    () => confirmReceivablePlan(plan.id, plan.version),
    "应收计划已确认，并已生成正式应收。",
  );
}
function submitReceipt() {
  return act(async () => {
    await createReceipt(receiptForm.value);
    receiptComposerOpen.value = false;
  }, "回款已登记。");
}
function submitAllocation() {
  return act(async () => {
    await createReceiptAllocation(allocationForm.value);
    allocationComposerOpen.value = false;
    allocationTab.value = "allocations";
  }, "核销分配已确认。");
}
function submitReversal() {
  return act(async () => {
    await reverseReceiptAllocation(reversalForm.value.allocation_id, {
      amount: reversalForm.value.amount,
      reason_code: reversalForm.value.reason_code,
      reason_detail: reversalForm.value.reason_detail,
    });
    reversalComposerOpen.value = false;
  }, "核销冲销已完成，余额投影已恢复。");
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
  return act(
    () => approveInvoiceRequest(item.id, item.version),
    "开票申请已批准，税控任务已进入 Outbox。",
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
function submitPolicy() {
  return act(() => createDunningPolicy(policyForm.value), "催收策略已创建。");
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
      <div class="settlement-sidebar-footer">
        <span class="settlement-sidebar-avatar" aria-hidden="true">平</span>
        <span class="settlement-sidebar-user-copy">
          <strong>平台管理员</strong><small>超级管理员</small>
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
            title="结算财务"
            aria-label="结算财务"
            @click="go('tasks')"
          >
            财
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
            <span class="settlement-environment">已接入 · dev</span
            ><template v-if="active === 'dashboard'"
              ><button
                class="console-button secondary"
                :disabled="saving"
                @click="
                  exportJob?.status === 'READY'
                    ? downloadReportExport(exportJob.id)
                    : exportInvoicedReceivables()
                "
              >
                {{
                  exportJob?.status === "READY"
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
        <p v-if="message" class="settlement-message">{{ message }}</p>
        <p v-if="error" class="settlement-error">{{ error }}</p>
        <p v-if="loading" class="settlement-loading">正在读取结算数据…</p>
        <template v-else>
          <section v-if="active === 'dashboard'" class="settlement-dashboard">
            <section class="settlement-cards">
              <article
                v-for="item in dashboardKpis"
                :key="item.label"
                :class="`tone-${item.tone}`"
              >
                <span>{{ item.label }}</span
                ><b>{{ item.value }}</b
                ><small>{{ item.note }}</small>
              </article>
            </section>
            <section class="settlement-dashboard-grid">
              <div>
                <article class="settlement-panel settlement-workbench">
                  <div class="settlement-panel-head">
                    <div>
                      <h2>待办事项 <small>需我处理</small></h2>
                      <p>
                        收款计划、开票审核和核销任务按真实业务状态自动汇总。
                      </p>
                    </div>
                    <button class="console-text-button" @click="go('tasks')">
                      查看全部
                    </button>
                  </div>
                  <div v-if="workItems.length" class="settlement-todo-list">
                    <div
                      v-for="item in workItems"
                      :key="item.section"
                      class="settlement-todo"
                    >
                      <span
                        class="settlement-todo-icon"
                        :class="`tone-${item.tone}`"
                        ><ConsoleIcon :name="item.icon"
                      /></span>
                      <div>
                        <strong>{{ item.title }}</strong>
                        <p>{{ item.description }}</p>
                      </div>
                      <button
                        class="console-text-button"
                        @click="go(item.section)"
                      >
                        {{ item.action }}
                      </button>
                    </div>
                  </div>
                  <div v-else class="settlement-empty">
                    <ConsoleIcon name="organization" /><strong
                      >当前没有待处理事项</strong
                    ><span>应收确认、开票审批和催收任务将自动汇总。</span>
                  </div>
                </article>
                <article class="settlement-panel settlement-aging">
                  <div class="settlement-panel-head">
                    <div>
                      <h2>
                        应收账款账龄分布 <small>按当前已加载应收估算</small>
                      </h2>
                      <p>
                        按应收单到期日计算，用于辅助识别逾期风险；权威催收状态以催收中心为准。
                      </p>
                    </div>
                    <button class="console-text-button" @click="go('dunning')">
                      查看催收
                    </button>
                  </div>
                  <div class="settlement-aging-list">
                    <div
                      v-for="item in agingBuckets"
                      :key="item.label"
                      class="settlement-aging-row"
                    >
                      <span>{{ item.label }}</span
                      ><i
                        ><b
                          :class="`tone-${item.tone}`"
                          :style="{ width: `${item.percent}%` }" /></i
                      ><strong>{{ money(item.amount) }}</strong
                      ><em>{{ item.percent }}%</em>
                    </div>
                  </div>
                </article>
              </div>
              <article class="settlement-panel settlement-top10">
                <div class="settlement-panel-head">
                  <div>
                    <h2>
                      已开票未回款应收 TOP10 <small>服务端权威排序</small>
                    </h2>
                    <p>按剩余未回款金额排序，仅展示已进入开票流程的应收单。</p>
                  </div>
                  <button
                    class="console-text-button"
                    @click="go('receivables')"
                  >
                    查看应收
                  </button>
                </div>
                <div
                  v-if="invoicedReceivableTop10.items?.length"
                  class="settlement-table-scroll"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>客户</th>
                        <th>合同</th>
                        <th>应收单</th>
                        <th>未回款金额</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(item, index) in invoicedReceivableTop10.items"
                        :key="item.id"
                      >
                        <td>
                          <span
                            class="settlement-rank"
                            :class="{ top: index < 3 }"
                            >{{ index + 1 }}</span
                          >
                        </td>
                        <td>{{ item.customer_name }}</td>
                        <td>{{ item.contract_no || "—" }}</td>
                        <td>{{ item.receivable_no }}</td>
                        <td class="settlement-money">
                          {{ money(item.open_amount) }}
                        </td>
                        <td>{{ item.invoice_status }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-else class="settlement-empty">
                  <ConsoleIcon name="account" /><strong
                    >暂无开票未回款应收</strong
                  ><span>开票申请进入流程后，将按未回款金额自动排序展示。</span>
                </div>
              </article>
              <article class="settlement-panel settlement-guide">
                <h2>业务快捷入口</h2>
                <p>从应收、回款、核销到开票，形成完整且可追溯的资金闭环。</p>
                <div>
                  <button class="console-button" @click="go('receivables')">
                    查看应收</button
                  ><button
                    class="console-button secondary"
                    @click="go('invoices')"
                  >
                    发起开票</button
                  ><button
                    class="console-button secondary"
                    @click="go('receipts')"
                  >
                    登记回款
                  </button>
                </div>
              </article>
            </section>
          </section>
          <section
            v-else-if="active === 'receivables'"
            class="settlement-receivables"
          >
            <div class="settlement-section-head">
              <div>
                <p>
                  合同生效后按付款节点自动生成应收计划，确认后纳入应收与催收口径。
                </p>
              </div>
              <div>
                <button class="console-button secondary" @click="load">
                  <ConsoleIcon name="reset" />刷新
                </button>
              </div>
            </div>
            <div class="settlement-filter-bar">
              <label
                ><ConsoleIcon name="search" /><input
                  v-model.trim="planKeyword"
                  placeholder="搜索合同号 / 客户 / 应收单号" /></label
              ><select v-model="planConfirmationFilter">
                <option value="">全部确认状态</option>
                <option>待确认</option>
                <option>已确认</option></select
              ><select v-model="planMaturityFilter">
                <option value="">全部状态</option>
                <option>未到期</option>
                <option>即将到期</option>
                <option>逾期</option></select
              ><button
                class="console-button secondary"
                @click="resetPlanFilters"
              >
                重置
              </button>
            </div>
            <article class="settlement-panel settlement-plan-table">
              <div class="settlement-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>合同编号</th>
                      <th>客户</th>
                      <th>期次</th>
                      <th>计划收款日</th>
                      <th>计划金额</th>
                      <th>确认状态</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="plan in visiblePlans" :key="plan.id">
                      <td class="settlement-contract-cell">
                        {{ plan.contract_no || "—" }}
                      </td>
                      <td>{{ plan.customer_name || "—" }}</td>
                      <td>第 {{ plan.installment_no || "—" }} 期</td>
                      <td>{{ plan.due_date }}</td>
                      <td class="settlement-money">
                        {{ money(plan.planned_amount) }}
                      </td>
                      <td>
                        <span
                          class="settlement-badge"
                          :class="`tone-${confirmationState(plan.status).tone}`"
                          >{{ confirmationState(plan.status).label }}</span
                        >
                      </td>
                      <td>
                        <span
                          class="settlement-badge"
                          :class="`tone-${dueState(plan.due_date).tone}`"
                          >{{ dueState(plan.due_date).label }}</span
                        >
                      </td>
                      <td>
                        <button
                          v-if="plan.status === 'PENDING_CONFIRMATION'"
                          class="console-button secondary small"
                          :disabled="saving"
                          @click="confirmPlan(plan)"
                        >
                          确认</button
                        ><span v-else class="settlement-muted">—</span>
                      </td>
                    </tr>
                    <tr v-if="!visiblePlans.length">
                      <td colspan="8" class="settlement-table-empty">
                        暂无匹配的应收计划
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
            <article class="settlement-panel settlement-formal-receivables">
              <div class="settlement-panel-head">
                <div>
                  <h2>正式应收 <small>已确认计划自动生成</small></h2>
                  <p>确认后的应收单可用于开票、回款、核销与账龄催收。</p>
                </div>
              </div>
              <div class="settlement-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>应收单号</th>
                      <th>合同编号</th>
                      <th>客户</th>
                      <th>到期日</th>
                      <th>应收金额</th>
                      <th>未收余额</th>
                      <th>收款状态</th>
                      <th>开票状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in receivables" :key="item.id">
                      <td class="settlement-contract-cell">
                        {{ item.receivable_no }}
                      </td>
                      <td>{{ item.contract_no || "—" }}</td>
                      <td>{{ item.customer_name }}</td>
                      <td>{{ item.due_date }}</td>
                      <td class="settlement-money">
                        {{ money(item.original_amount) }}
                      </td>
                      <td class="settlement-money">
                        {{ money(item.open_amount) }}
                      </td>
                      <td>{{ item.collection_status }}</td>
                      <td>{{ item.invoice_status }}</td>
                    </tr>
                    <tr v-if="!receivables.length">
                      <td colspan="8" class="settlement-table-empty">
                        暂无正式应收，确认收款计划后将在此展示。
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </section>
          <section
            v-else-if="active === 'receipts'"
            class="settlement-allocations"
          >
            <div class="settlement-section-head">
              <div>
                <p>
                  会计录入回款，系统按客户、合同与金额匹配生成核销单，确认后生效。
                </p>
              </div>
              <div>
                <button class="console-button secondary" @click="load">
                  <ConsoleIcon name="reset" />刷新</button
                ><button
                  class="console-button"
                  @click="receiptComposerOpen = true"
                >
                  <ConsoleIcon name="save" />登记回款
                </button>
              </div>
            </div>
            <article
              v-if="receiptComposerOpen"
              class="settlement-panel settlement-invoice-composer"
            >
              <div class="settlement-panel-head">
                <div>
                  <h2>登记回款</h2>
                  <p>银行凭证号用于回款去重与后续审计追溯。</p>
                </div>
                <button
                  class="console-text-button"
                  @click="receiptComposerOpen = false"
                >
                  收起
                </button>
              </div>
              <form class="settlement-form" @submit.prevent="submitReceipt">
                <input
                  v-model.trim="receiptForm.customer_id"
                  placeholder="客户 ID"
                  required
                /><input
                  v-model.trim="receiptForm.customer_name"
                  placeholder="客户名称"
                  required
                /><input
                  v-model.trim="receiptForm.amount"
                  placeholder="金额"
                  required
                /><input
                  v-model="receiptForm.receipt_date"
                  type="date"
                  required
                /><select v-model="receiptForm.payment_method">
                  <option value="TRANSFER">电汇</option>
                  <option value="CHEQUE">承兑</option>
                  <option value="CASH">现金</option></select
                ><input
                  v-model.trim="receiptForm.bank_transaction_reference"
                  placeholder="银行凭证号"
                  required
                /><button :disabled="saving">确认登记</button>
              </form>
            </article>
            <article class="settlement-panel settlement-invoice-table">
              <div class="settlement-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>回款号</th>
                      <th>客户</th>
                      <th>金额</th>
                      <th>回款日期</th>
                      <th>方式</th>
                      <th>银行凭证号</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in receipts" :key="item.id">
                      <td class="settlement-contract-cell">
                        {{ item.receipt_no }}
                      </td>
                      <td>{{ item.customer_name }}</td>
                      <td class="settlement-money">
                        {{ money(item.amount, item.currency) }}
                      </td>
                      <td>{{ item.receipt_date }}</td>
                      <td>
                        {{
                          item.payment_method === "TRANSFER"
                            ? "电汇"
                            : item.payment_method === "CHEQUE"
                              ? "承兑"
                              : item.payment_method
                        }}
                      </td>
                      <td>{{ item.bank_transaction_reference }}</td>
                      <td>
                        <span
                          class="settlement-badge"
                          :class="`tone-${receiptStatusMeta(item).tone}`"
                          >{{ receiptStatusMeta(item).label }}</span
                        >
                      </td>
                      <td>
                        <button
                          v-if="amountOf(item.unallocated_amount) > 0"
                          class="console-text-button"
                          @click="go('allocations')"
                        >
                          发起核销</button
                        ><button
                          v-else
                          class="console-text-button"
                          @click="go('allocations')"
                        >
                          查看核销结果
                        </button>
                      </td>
                    </tr>
                    <tr v-if="!receipts.length">
                      <td colspan="8" class="settlement-table-empty">
                        暂无回款记录
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </section>
          <section
            v-else-if="active === 'allocations'"
            class="settlement-allocations"
          >
            <div class="settlement-section-head">
              <div>
                <p>
                  管理回款与应收的核销关系；如发现匹配错误，可按原核销单发起冲销并恢复余额。
                </p>
              </div>
              <div>
                <button class="console-button secondary" @click="load">
                  <ConsoleIcon name="reset" />刷新</button
                ><button
                  class="console-button"
                  @click="allocationComposerOpen = true"
                >
                  <ConsoleIcon name="save" />发起核销
                </button>
              </div>
            </div>
            <div class="settlement-tabs">
              <button
                :class="{ active: allocationTab === 'allocations' }"
                @click="allocationTab = 'allocations'"
              >
                全部核销单
              </button>
              <button
                :class="{ active: allocationTab === 'reversals' }"
                @click="allocationTab = 'reversals'"
              >
                已冲销核销单
              </button>
            </div>
            <article class="settlement-panel settlement-invoice-table">
              <div class="settlement-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>核销单号</th>
                      <th>回款号</th>
                      <th>应收单号</th>
                      <th>金额</th>
                      <th>币种</th>
                      <th>确认时间</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="item in allocations.filter((row) =>
                        allocationTab === 'reversals'
                          ? row.status === 'REVERSED'
                          : row.status !== 'REVERSED',
                      )"
                      :key="item.id"
                    >
                      <td class="settlement-contract-cell">
                        {{ item.allocation_no }}
                      </td>
                      <td>{{ item.receipt_no }}</td>
                      <td>{{ item.receivable_no }}</td>
                      <td class="settlement-money">
                        {{ money(item.amount, item.currency) }}
                      </td>
                      <td>{{ item.currency }}</td>
                      <td>{{ item.confirmed_at }}</td>
                      <td>
                        <span
                          class="settlement-badge"
                          :class="`tone-${allocationStatusMeta(item.status).tone}`"
                          >{{ allocationStatusMeta(item.status).label }}</span
                        >
                      </td>
                      <td>
                        <button
                          v-if="
                            allocationTab === 'allocations' &&
                            ['CONFIRMED', 'PARTIALLY_REVERSED'].includes(
                              item.status,
                            )
                          "
                          class="console-text-button"
                          @click="
                            reversalForm.allocation_id = item.id;
                            reversalComposerOpen = true;
                          "
                        >
                          冲销
                        </button>
                        <span v-else class="settlement-muted">
                          {{
                            item.status === "REVERSED" ? "余额已全部恢复" : "—"
                          }}
                        </span>
                      </td>
                    </tr>
                    <tr
                      v-if="
                        !allocations.some((row) =>
                          allocationTab === 'reversals'
                            ? row.status === 'REVERSED'
                            : row.status !== 'REVERSED',
                        )
                      "
                    >
                      <td colspan="8" class="settlement-table-empty">
                        {{
                          allocationTab === "reversals"
                            ? "暂无已冲销核销单"
                            : "暂无已确认的核销单"
                        }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
            <article
              v-if="allocationComposerOpen"
              class="settlement-panel settlement-invoice-composer"
            >
              <div class="settlement-panel-head">
                <div>
                  <h2>发起核销</h2>
                  <p>
                    请选择一笔尚有余额的回款和应收，系统将校验客户、币种与金额。
                  </p>
                </div>
                <button
                  class="console-text-button"
                  @click="allocationComposerOpen = false"
                >
                  收起
                </button>
              </div>
              <form class="settlement-form" @submit.prevent="submitAllocation">
                <select v-model="allocationForm.receipt_id" required>
                  <option value="">选择待核销回款</option>
                  <option
                    v-for="item in receipts.filter(
                      (row) => amountOf(row.unallocated_amount) > 0,
                    )"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.receipt_no }} · {{ item.customer_name }} ·
                    {{ money(item.unallocated_amount, item.currency) }}
                  </option></select
                ><select v-model="allocationForm.receivable_id" required>
                  <option value="">选择待核销应收</option>
                  <option
                    v-for="item in receivables.filter(
                      (row) => amountOf(row.open_amount) > 0,
                    )"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.receivable_no }} · {{ item.customer_name }} ·
                    {{ money(item.open_amount, item.currency) }}
                  </option></select
                ><input
                  v-model.trim="allocationForm.amount"
                  placeholder="本次核销金额"
                  required
                /><button :disabled="saving">确认核销</button>
              </form>
            </article>
            <article
              v-if="reversalComposerOpen"
              class="settlement-panel settlement-invoice-composer"
            >
              <div class="settlement-panel-head">
                <div>
                  <h2>确认冲销</h2>
                  <p>
                    冲销后会恢复原回款的未分配余额和应收未收余额，请确认后提交。
                  </p>
                </div>
                <button
                  class="console-text-button"
                  @click="reversalComposerOpen = false"
                >
                  收起
                </button>
              </div>
              <form class="settlement-form" @submit.prevent="submitReversal">
                <select v-model="reversalForm.allocation_id" required>
                  <option value="">选择需要冲销的核销单</option>
                  <option
                    v-for="item in allocations.filter((row) =>
                      ['CONFIRMED', 'PARTIALLY_REVERSED'].includes(row.status),
                    )"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.allocation_no }} ·
                    {{ money(item.amount, item.currency) }}
                  </option></select
                ><input
                  v-model.trim="reversalForm.amount"
                  placeholder="冲销金额"
                  required
                /><select v-model="reversalForm.reason_code" required>
                  <option value="MATCH_ERROR">回款匹配错误</option>
                  <option value="CUSTOMER_CORRECTION">客户归属修正</option>
                  <option value="AMOUNT_ERROR">金额录入错误</option>
                  <option value="DUPLICATE_ALLOCATION">重复核销</option>
                  <option value="OTHER">其他原因</option>
                </select>
                <input
                  v-model.trim="reversalForm.reason_detail"
                  placeholder="补充说明冲销原因"
                  required
                /><button :disabled="saving">确认冲销</button>
              </form>
            </article>
          </section>
          <section
            v-else-if="active === 'invoices' && invoiceDetailID"
            class="settlement-invoices"
          >
            <div v-if="invoiceDetail" class="settlement-invoice-detail">
              <button
                class="console-text-button settlement-back-link"
                @click="closeInvoiceDetail"
              >
                ‹ 返回发票台账
              </button>
              <div class="settlement-section-head">
                <div>
                  <h2>发票详情</h2>
                  <p>电子发票交付与红冲管理</p>
                </div>
                <div>
                  <button class="console-button secondary" disabled>
                    上传电子发票</button
                  ><button class="console-button secondary" disabled>
                    红冲</button
                  ><button class="console-button" disabled>下载电子发票</button>
                </div>
              </div>
              <p class="settlement-detail-notice">
                电子票上传、下载及红冲待接入受控文件存储与税控回执后启用；当前展示真实已登记发票数据。
              </p>
              <div class="settlement-detail-kpis">
                <article class="tone-blue">
                  <span>发票号码</span><b>{{ invoiceDetail.invoice_no }}</b>
                </article>
                <article class="tone-green">
                  <span>价税合计</span
                  ><b>{{ money(invoiceDetail.amount_incl_tax) }}</b>
                </article>
                <article class="tone-purple">
                  <span>状态</span
                  ><b>{{ invoiceStatusMeta(invoiceDetail.status).label }}</b>
                </article>
              </div>
              <div class="settlement-detail-grid">
                <article class="settlement-panel">
                  <h2>发票信息</h2>
                  <dl class="settlement-detail-list">
                    <div>
                      <dt>发票类型</dt>
                      <dd>{{ invoiceDetail.invoice_type }}</dd>
                    </div>
                    <div>
                      <dt>开票日期</dt>
                      <dd>{{ invoiceDetail.issue_date }}</dd>
                    </div>
                    <div>
                      <dt>发票代码</dt>
                      <dd>{{ invoiceDetail.invoice_code }}</dd>
                    </div>
                    <div>
                      <dt>不含税金额</dt>
                      <dd>{{ money(invoiceDetail.amount_excl_tax) }}</dd>
                    </div>
                    <div>
                      <dt>税额</dt>
                      <dd>{{ money(invoiceDetail.tax_amount) }}</dd>
                    </div>
                    <div>
                      <dt>开具渠道</dt>
                      <dd>{{ invoiceDetail.issued_by_channel }}</dd>
                    </div>
                  </dl>
                </article>
                <article class="settlement-panel">
                  <h2>购方信息</h2>
                  <dl class="settlement-detail-list">
                    <div>
                      <dt>购方名称</dt>
                      <dd>{{ invoiceDetail.buyer_name || "—" }}</dd>
                    </div>
                    <div>
                      <dt>纳税人识别号</dt>
                      <dd>{{ invoiceDetail.buyer_tax_no_masked || "—" }}</dd>
                    </div>
                    <div>
                      <dt>关联合同</dt>
                      <dd>{{ invoiceDetail.contract_no || "—" }}</dd>
                    </div>
                    <div>
                      <dt>关联申请</dt>
                      <dd>{{ invoiceDetail.request_no || "—" }}</dd>
                    </div>
                    <div>
                      <dt>电子票附件</dt>
                      <dd>
                        {{
                          invoiceDetail.document_count ? "已归档" : "尚未归档"
                        }}
                      </dd>
                    </div>
                  </dl>
                </article>
                <article class="settlement-panel settlement-detail-items">
                  <h2>开票明细</h2>
                  <div class="settlement-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>项目</th>
                          <th>税收分类编码</th>
                          <th>不含税金额</th>
                          <th>税率</th>
                          <th>税额</th>
                          <th>价税合计</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="item in invoiceDetail.items"
                          :key="item.line_no"
                        >
                          <td>{{ item.item_name }}</td>
                          <td>{{ item.tax_classification_code }}</td>
                          <td>{{ money(item.amount_excl_tax) }}</td>
                          <td>{{ item.tax_rate_display }}</td>
                          <td>{{ money(item.tax_amount) }}</td>
                          <td>{{ money(item.amount_incl_tax) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </article>
                <article class="settlement-panel">
                  <h2>开票记录</h2>
                  <div class="settlement-timeline">
                    <div>
                      <strong>开票完成</strong>
                      <p>
                        {{ invoiceDetail.issue_date }} ·
                        {{
                          invoiceDetail.issued_by_channel === "MANUAL"
                            ? "人工登记发票并回填台账"
                            : "税控回执已写入台账"
                        }}
                      </p>
                    </div>
                    <div>
                      <strong>提交申请</strong>
                      <p>
                        关联申请 {{ invoiceDetail.request_no }}，合同
                        {{ invoiceDetail.contract_no || "—" }}。
                      </p>
                    </div>
                  </div>
                </article>
              </div>
            </div>
            <div v-else class="settlement-empty">
              <ConsoleIcon name="account" /><strong>未找到发票详情</strong
              ><span>该发票可能不存在，或当前账号无权访问。</span
              ><button
                class="console-button secondary"
                @click="closeInvoiceDetail"
              >
                返回发票台账
              </button>
            </div>
          </section>
          <section
            v-else-if="active === 'invoices'"
            class="settlement-invoices"
          >
            <div class="settlement-section-head">
              <div>
                <p>关联合同发起开票申请，财务审核通过后驱动税控开票并回填。</p>
              </div>
              <div>
                <button class="console-button secondary" @click="load">
                  <ConsoleIcon name="reset" />刷新</button
                ><button
                  class="console-button"
                  @click="invoiceComposerOpen = true"
                >
                  <ConsoleIcon name="account" />发起开票申请
                </button>
              </div>
            </div>
            <article
              v-if="invoiceComposerOpen"
              class="settlement-panel settlement-invoice-composer"
            >
              <div class="settlement-panel-head">
                <div>
                  <h2>发起开票申请</h2>
                  <p>
                    申请提交后将锁定对应应收的可开票余额，提交人不能审批本人申请。
                  </p>
                </div>
                <button
                  class="console-text-button"
                  type="button"
                  @click="invoiceComposerOpen = false"
                >
                  收起
                </button>
              </div>
              <form class="settlement-form" @submit.prevent="submitInvoice">
                <select v-model="invoiceForm.receivable_id" required>
                  <option value="" disabled>
                    {{
                      invoiceEligibleReceivables.length
                        ? "选择可开票应收"
                        : "暂无可开票应收，请先确认应收计划"
                    }}
                  </option>
                  <option
                    v-for="item in invoiceEligibleReceivables"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.receivable_no }} ·
                    {{ item.contract_no || "未关联合同" }} ·
                    {{ item.customer_name }} ·
                    {{ money(item.invoiceable_amount, item.currency) }}
                  </option></select
                ><input
                  v-model.trim="invoiceForm.buyer_tax_no"
                  placeholder="购方税号"
                  required
                /><input
                  v-model.trim="invoiceForm.item_name"
                  placeholder="项目名称"
                  required
                /><input
                  v-model.trim="invoiceForm.tax_classification_code"
                  placeholder="税收分类编码"
                  required
                /><input
                  v-model.trim="invoiceForm.amount_excl_tax"
                  placeholder="不含税金额"
                  required
                /><input
                  v-model.trim="invoiceForm.tax_rate"
                  placeholder="税率，如 0.06"
                  required
                /><input
                  v-model.trim="invoiceForm.tax_amount"
                  placeholder="税额"
                  required
                /><input
                  v-model.trim="invoiceForm.amount_incl_tax"
                  placeholder="价税合计"
                  required
                /><button :disabled="saving">提交申请</button>
              </form>
            </article>
            <div class="settlement-tabs" role="tablist" aria-label="开票数据">
              <button
                :class="{ active: invoiceTab === 'requests' }"
                @click="invoiceTab = 'requests'"
              >
                开票申请</button
              ><button
                :class="{ active: invoiceTab === 'ledger' }"
                @click="invoiceTab = 'ledger'"
              >
                发票台账
              </button>
            </div>
            <div class="settlement-filter-bar settlement-invoice-filters">
              <label
                ><ConsoleIcon name="search" /><input
                  v-model.trim="invoiceKeyword"
                  :placeholder="
                    invoiceTab === 'requests'
                      ? '搜索申请号 / 合同号 / 购方'
                      : '搜索发票号码 / 合同号 / 购方'
                  " /></label
              ><select v-model="invoiceStatusFilter">
                <option value="">全部状态</option>
                <option v-if="invoiceTab === 'requests'" value="SUBMITTED">
                  待审核
                </option>
                <option v-if="invoiceTab === 'requests'" value="ISSUE_PENDING">
                  待开具
                </option>
                <option value="ISSUED">已开票</option></select
              ><button
                class="console-button secondary"
                @click="resetInvoiceFilters"
              >
                重置
              </button>
            </div>
            <article
              v-if="invoiceTab === 'requests'"
              class="settlement-panel settlement-invoice-table"
            >
              <div class="settlement-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>申请号</th>
                      <th>合同号</th>
                      <th>购方名称</th>
                      <th>税号</th>
                      <th>金额</th>
                      <th>税率</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in visibleInvoiceRequests" :key="item.id">
                      <td class="settlement-contract-cell">
                        {{ item.request_no }}
                      </td>
                      <td>{{ item.contract_no || "—" }}</td>
                      <td>{{ item.buyer_name || "—" }}</td>
                      <td>{{ item.buyer_tax_no_masked || "—" }}</td>
                      <td class="settlement-money">
                        {{ money(item.amount_incl_tax) }}
                      </td>
                      <td>{{ item.tax_rate_display || "—" }}</td>
                      <td>
                        <span
                          class="settlement-badge"
                          :class="`tone-${invoiceStatusMeta(item.status).tone}`"
                          >{{ invoiceStatusMeta(item.status).label }}</span
                        >
                      </td>
                      <td>
                        <button
                          v-if="item.status === 'SUBMITTED'"
                          class="console-button small"
                          :disabled="saving"
                          @click="approveInvoice(item)"
                        >
                          审核</button
                        ><button
                          v-else-if="item.status === 'ISSUE_PENDING'"
                          class="console-button secondary small"
                          :disabled="saving"
                          @click="manualIssue(item)"
                        >
                          登记发票</button
                        ><span v-else class="settlement-muted">—</span>
                      </td>
                    </tr>
                    <tr v-if="!visibleInvoiceRequests.length">
                      <td colspan="8" class="settlement-table-empty">
                        暂无匹配的开票申请
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
            <article v-else class="settlement-panel settlement-invoice-table">
              <div class="settlement-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>发票号码</th>
                      <th>发票代码</th>
                      <th>合同号</th>
                      <th>购方名称</th>
                      <th>开票日期</th>
                      <th>价税合计</th>
                      <th>类型</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in visibleTaxInvoices" :key="item.id">
                      <td class="settlement-contract-cell">
                        {{ item.invoice_no }}
                      </td>
                      <td>{{ item.invoice_code }}</td>
                      <td>{{ item.contract_no || "—" }}</td>
                      <td>{{ item.buyer_name || "—" }}</td>
                      <td>{{ item.issue_date }}</td>
                      <td class="settlement-money">
                        {{ money(item.amount_incl_tax) }}
                      </td>
                      <td>{{ item.invoice_type }}</td>
                      <td>
                        <span
                          class="settlement-badge"
                          :class="`tone-${invoiceStatusMeta(item.status).tone}`"
                          >{{ invoiceStatusMeta(item.status).label }}</span
                        >
                      </td>
                      <td>
                        <button
                          class="console-text-button"
                          @click="openInvoiceDetail(item)"
                        >
                          查看
                        </button>
                      </td>
                    </tr>
                    <tr v-if="!visibleTaxInvoices.length">
                      <td colspan="9" class="settlement-table-empty">
                        暂无匹配的发票台账记录
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </section>
          <section v-else-if="active === 'dunning'" class="settlement-dunning">
            <div class="settlement-section-head">
              <div>
                <p>
                  按账龄区间识别未结清应收；逾期提醒和升级状态以催收案件与动作记录为准。
                </p>
              </div>
              <div>
                <button class="console-button secondary" disabled>
                  导出账龄表</button
                ><button class="console-button secondary" @click="load">
                  <ConsoleIcon name="reset" />刷新
                </button>
              </div>
            </div>
            <p class="settlement-detail-notice">
              当前账龄金额与笔数仅基于已加载应收的辅助统计；正式账龄报表与受控导出需接入服务端汇总任务后启用。
            </p>
            <section class="settlement-cards settlement-dunning-cards">
              <article
                v-for="item in dunningKpis"
                :key="item.label"
                :class="`tone-${item.tone}`"
              >
                <span>{{ item.label }}</span
                ><b>{{ item.value }}</b
                ><small>{{ item.note }}</small>
              </article>
            </section>
            <article class="settlement-panel settlement-aging-report">
              <div class="settlement-panel-head">
                <div>
                  <h2>账龄区间报表</h2>
                  <p>当前已加载未结清应收的账龄辅助统计。</p>
                </div>
                <span class="settlement-muted">单位：元</span>
              </div>
              <div class="settlement-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>账龄区间</th>
                      <th>金额</th>
                      <th>占比</th>
                      <th>笔数</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(item, index) in agingBuckets" :key="item.label">
                      <td>{{ item.label }}</td>
                      <td class="settlement-money">{{ money(item.amount) }}</td>
                      <td>{{ item.percent }}%</td>
                      <td>{{ item.count }}</td>
                      <td>
                        <span
                          class="settlement-badge"
                          :class="`tone-${index === 0 ? 'info' : index === 1 ? 'info' : index === 2 ? 'warning' : 'danger'}`"
                          >{{
                            index === 0
                              ? "正常"
                              : index === 1
                                ? "关注"
                                : index === 2
                                  ? "预警"
                                  : "逾期"
                          }}</span
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
            <article class="settlement-panel settlement-aging-report">
              <div class="settlement-panel-head">
                <div>
                  <h2>催收动作记录</h2>
                  <p>
                    仅展示已生成的真实催收动作；普通提醒留在本系统，高优先级事件由
                    Outbox 异步投递基础平台。
                  </p>
                </div>
              </div>
              <div class="settlement-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>记录 ID</th>
                      <th>应收单号</th>
                      <th>渠道</th>
                      <th>创建时间</th>
                      <th>接收人</th>
                      <th>升级标记</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in dunningActions" :key="item.id">
                      <td class="settlement-contract-cell">{{ item.id }}</td>
                      <td>{{ item.receivable_no }}</td>
                      <td>{{ item.channel }}</td>
                      <td>{{ item.created_at }}</td>
                      <td>{{ item.recipient_user_id }}</td>
                      <td>
                        <span
                          v-if="Number(item.escalation_level) > 0"
                          class="settlement-badge tone-warning"
                          >已升级</span
                        ><span v-else class="settlement-muted">—</span>
                      </td>
                    </tr>
                    <tr v-if="!dunningActions.length">
                      <td colspan="6" class="settlement-table-empty">
                        暂无已生成的催收动作记录
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
            <details class="settlement-panel settlement-policy-settings">
              <summary>
                <span>逾期提醒规则</span
                ><small>仅催收专员和管理员可新建或查看策略</small>
              </summary>
              <div class="settlement-policy-intro">
                <ConsoleIcon name="bell" />
                <p>
                  系统每天检查未结清应收；逾期进入指定范围后，将创建内部跟进提醒并通知指定业务人员，不会向客户直接发送消息。
                </p>
              </div>
              <form
                class="settlement-policy-form"
                @submit.prevent="submitPolicy"
              >
                <label
                  class="settlement-policy-field settlement-policy-field-wide"
                >
                  <span>策略名称</span>
                  <input
                    v-model.trim="policyForm.name"
                    placeholder="例如：逾期 1–30 天销售跟进"
                    required
                  />
                  <small>方便团队识别这条提醒的适用场景。</small>
                </label>
                <div class="settlement-policy-field">
                  <span>逾期多久开始提醒</span>
                  <div class="settlement-policy-range">
                    <input
                      v-model.number="policyForm.aging_from_days"
                      type="number"
                      min="1"
                      required
                    />
                    <b>至</b>
                    <input
                      v-model.number="policyForm.aging_to_days"
                      type="number"
                      min="1"
                      required
                    />
                    <em>天</em>
                  </div>
                  <small>例如 1 至 30 天，表示从逾期第 1 天起提醒。</small>
                </div>
                <label class="settlement-policy-field">
                  <span>提醒哪位业务人员</span>
                  <select
                    v-model="policyRecipientAccount"
                    :disabled="dunningRecipientsLoading || !dunningRecipients.length"
                    required
                  >
                    <option value="">
                      {{ dunningRecipientsLoading ? "正在读取催收人员…" : "请选择催收业务人员" }}
                    </option>
                    <option
                      v-for="item in dunningRecipients"
                      :key="item.user_id || item.id"
                      :value="item.user_id || item.id"
                    >
                      {{ item.display_name || item.username || item.user_id || item.id }}
                      <template v-if="item.username || item.account">
                        · {{ item.username || item.account }}
                      </template>
                    </option>
                  </select>
                  <small v-if="dunningRecipientsError" class="settlement-field-error">
                    {{ dunningRecipientsError }}
                    <button type="button" class="console-text-button" @click="load">重新加载</button>
                  </small>
                  <small v-else-if="!dunningRecipientsLoading && !dunningRecipients.length">
                    当前没有同时具备本系统权限和催收角色的有效人员，请先在基础平台配置。
                  </small>
                  <small v-else>仅展示当前租户内拥有结算权限且属于催收角色的有效人员。</small>
                </label>
                <label class="settlement-policy-field">
                  <span>下次跟进提醒间隔</span>
                  <select v-model.number="policyForm.repeat_interval_days">
                    <option :value="1">每天提醒一次</option>
                    <option :value="3">每 3 天提醒一次</option>
                    <option :value="7">每周提醒一次</option>
                    <option :value="14">每两周提醒一次</option>
                  </select>
                  <small
                    >用于安排后续跟进时间，避免同一笔应收被过度打扰。</small
                  >
                </label>
                <label class="settlement-policy-field">
                  <span>提醒级别</span>
                  <select v-model="policyForm.priority">
                    <option value="NORMAL">普通提醒</option>
                    <option value="HIGH">重点关注</option>
                    <option value="CRITICAL">紧急升级</option>
                  </select>
                  <small>重点和紧急提醒会自动同步基础平台通知中心。</small>
                </label>
                <label class="settlement-policy-field">
                  <span>提醒范围</span>
                  <select v-model="policyForm.channel">
                    <option value="LOCAL">仅在结算系统内提醒</option>
                    <option value="PLATFORM">同步到基础平台通知中心</option>
                  </select>
                  <small
                    >普通跟进建议仅在系统内提醒；重点和紧急提醒仍会同步基础平台。</small
                  >
                </label>
                <div class="settlement-policy-submit">
                  <span>保存后立即启用，并保留操作审计记录。</span>
                  <button :disabled="saving">
                    <ConsoleIcon name="save" />保存并启用规则
                  </button>
                </div>
              </form>
            </details>
          </section>
          <section v-else class="settlement-panel">
            <h2>我的待办</h2>
            <p>
              待确认应收
              {{
                plans.filter((item) => item.status === "PENDING_CONFIRMATION")
                  .length
              }}
              项，待审批开票
              {{
                invoiceRequests.filter((item) => item.status === "SUBMITTED")
                  .length
              }}
              项，活跃催收
              {{
                dunningCases.filter((item) => item.status === "ACTIVE").length
              }}
              项。
            </p>
          </section>
        </template>
      </div>
    </section>
  </main>
</template>
