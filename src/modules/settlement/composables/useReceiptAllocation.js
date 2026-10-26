import { ref } from "vue";

/**
 * 回款核销与冲销域（治理批次 5 结算，自 SettlementView.vue 逐字迁移）。
 * 收编：核销区页签、核销/冲销编辑器开关、核销分配与冲销两份表单、两个提交动作
 * （经 act 主干：成功后刷新并提示、刷新失败保留成功事实；失败时状态变更不会执行，编辑器保持打开）。
 * 仍属视图：receiptComposerOpen（回款登记域）、selectReceiptMatch（回款匹配预填核销表单并跳转，
 * 经解构名直写本域状态）、watch(active) 中的页签与编辑器重置。
 * 注入项与组件内同名标识一一对应：act/createReceiptAllocation/reverseReceiptAllocation；不直接导入 API 模块。
 */
export function useReceiptAllocation({ act, createReceiptAllocation, reverseReceiptAllocation }) {
  const allocationTab = ref("receipts");
  const allocationComposerOpen = ref(false);
  const reversalComposerOpen = ref(false);
  const allocationForm = ref({
    receipt_id: "",
    receivable_id: "",
    amount: "",
    match_mode: "MANUAL",
    match_confidence: 0,
  });
  const reversalForm = ref({
    allocation_id: "",
    amount: "",
    reason_code: "MATCH_ERROR",
    reason_detail: "",
  });

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

  return {
    allocationTab,
    allocationComposerOpen,
    reversalComposerOpen,
    allocationForm,
    reversalForm,
    submitAllocation,
    submitReversal,
  };
}
