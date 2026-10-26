import { computed, ref } from "vue";
import { confirmationState, dueState } from "../utils/settlementDisplay.js";

/**
 * 收款计划域（治理批次 5 结算，自 SettlementView.vue 逐字迁移）。
 * 收编：关键字 / 确认状态 / 到期状态三路筛选与重置、可见计划派生、确认编辑器（带原值快照）、
 * 确认提交（调整收款日或金额必须填写原因，经 act 主干刷新并提示）。
 * 注入项与组件内同名标识一一对应：plans/notify/act/confirmReceivablePlan；不直接导入 API 模块。
 */
export function useReceivablePlans({ plans, notify, act, confirmReceivablePlan }) {
  const planKeyword = ref("");
  const planEditorOpen = ref(false);
  const planConfirmationFilter = ref("");
  const planMaturityFilter = ref("");
  const planEditor = ref({
    id: "",
    version: 0,
    contract_no: "",
    customer_name: "",
    due_date: "",
    planned_amount: "",
    original_due_date: "",
    original_planned_amount: "",
    reason: "",
  });

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
  function confirmPlan(plan) {
    planEditor.value = {
      id: plan.id,
      version: plan.version,
      contract_no: plan.contract_no || "",
      customer_name: plan.customer_name || "",
      due_date: plan.due_date || "",
      planned_amount: plan.planned_amount || "",
      original_due_date: plan.due_date || "",
      original_planned_amount: plan.planned_amount || "",
      reason: "",
    };
    planEditorOpen.value = true;
  }
  function submitPlanConfirmation() {
    const changed =
      planEditor.value.due_date !== planEditor.value.original_due_date ||
      String(planEditor.value.planned_amount) !==
        String(planEditor.value.original_planned_amount);
    if (changed && !planEditor.value.reason.trim()) {
      notify("调整计划收款日或金额时必须填写调整原因。");
      return;
    }
    return act(async () => {
      await confirmReceivablePlan(planEditor.value.id, {
        version: planEditor.value.version,
        due_date: planEditor.value.due_date,
        planned_amount: planEditor.value.planned_amount,
        reason: planEditor.value.reason.trim(),
      });
      planEditorOpen.value = false;
    }, "应收计划已确认，并已生成正式应收。");
  }

  return {
    planKeyword,
    planEditorOpen,
    planConfirmationFilter,
    planMaturityFilter,
    planEditor,
    visiblePlans,
    resetPlanFilters,
    confirmPlan,
    submitPlanConfirmation,
  };
}
