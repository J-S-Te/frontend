import { computed, ref } from "vue";
import {
  completeDunningAction as completeDunningActionAPI,
  createDunningPolicy,
} from "../api/settlement";

/**
 * 账龄与催收域（结算页深层域拆分）。
 * 收编：催收案件/动作/策略/人员/总览/覆盖六份列表状态、策略表单与收件人加载态、
 * 完成跟进与新建策略两个动作。
 * 行为修复（2026-10-26，经授权）：完成跟进的备注输入由阻塞式 window.prompt 改为共享
 * PromptDialog——completeDunningAction(item) 现在只打开 dunningActionDialog，确认后走
 * confirmDunningAction。写路径逐字保留原语义（版本乐观锁、成功后强制刷新、刷新失败保留
 * 成功事实、失败格式化文案）；差异仅两处：超长校验与接口失败提示从页面级 error 改为
 * 弹窗内联 error（对齐本视图 reviewFailureDialog 既有模式），取消即关闭不再有阻塞弹窗。
 * 注入项与组件内同名标识一一对应：saving/notify/load/act/formatSettlementError/
 * settlementSession/sessionPermissions；act 仅用于 submitPolicy（与原视图一致），
 * 完成跟进的写路径保留独立主干以把失败提示留在弹窗内联 error，不并入 act。
 */
export function useDunningCenter({
  saving,
  notify,
  load,
  act,
  formatSettlementError,
  settlementSession,
  sessionPermissions,
}) {
  const dunningPolicies = ref([]);
  const dunningRecipients = ref([]);
  const dunningCases = ref([]);
  const dunningActions = ref([]);
  const dunningOverview = ref({});
  const dunningCoverage = ref({ policies: [], gaps: [] });
  const dunningRecipientsLoading = ref(false);
  const dunningRecipientsError = ref("");
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
  const dunningActionDialog = ref(null);
  const canCompleteDunningAction = (item) =>
    item.status === "PENDING" &&
    (item.recipient_user_id === settlementSession.value?.user_id ||
      sessionPermissions.value.has("settlement.admin"));
  function completeDunningAction(item) {
    if (saving.value) return;
    dunningActionDialog.value = { item, error: "" };
  }
  function cancelDunningAction() {
    if (!saving.value) dunningActionDialog.value = null;
  }
  async function confirmDunningAction(note) {
    const dialog = dunningActionDialog.value;
    if (!dialog || saving.value) return;
    const normalized = String(note ?? "").trim();
    if (normalized.length > 500) {
      dialog.error = "催收跟进结果不能超过 500 字。";
      return;
    }
    saving.value = true;
    dialog.error = "";
    try {
      await completeDunningActionAPI(dialog.item.id, {
        version: Number(dialog.item.version),
        note: normalized,
      });
      dunningActionDialog.value = null;
      const refreshed = await load();
      notify(refreshed ? "催收动作已完成。" : "催收动作已完成；页面刷新失败，请手动刷新确认。");
    } catch (value) {
      dialog.error = formatSettlementError(value, { fallback: "催收动作完成失败。" });
    } finally {
      saving.value = false;
    }
  }
  function submitPolicy() {
    return act(() => createDunningPolicy(policyForm.value), "催收策略已创建。");
  }
  return {
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
  };
}
