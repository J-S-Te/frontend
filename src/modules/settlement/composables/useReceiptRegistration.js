import { computed, ref } from "vue";
import { todayBusinessDate } from "../../shared/utils/businessTime.js";

/**
 * 回款登记域（治理批次 5 结算，自 SettlementView.vue 逐字迁移）。
 * 收编：登记编辑器开关、回款表单、客户下拉（自正式应收去重并按中文排序）与名称联动、
 * 登记提交（成功即关编辑器并拉取可核销应收建议；建议查询失败或刷新失败都保留"已登记"事实并告诫勿重复登记，
 * 且每条提示都带同一次登记的回款号，用户不会在最需要时丢单据号）、
 * 匹配建议列表与所属回款 ID。
 * 仍属视图：selectReceiptMatch（读本域 receiptMatchFor、写核销域表单并跳转，跨域桥接经解构名直写）。
 * 注入项与组件内同名标识一一对应：receivables/saving/notify/load/formatSettlementError/createReceipt/listReceiptMatches；
 * 不直接导入 API 模块。
 */
// 用途：组织回款登记、客户选择与授权范围内的核销建议。
// 参数：依赖对象含当前能力、可见应收、写入与刷新方法。
// 返回值：回款状态和操作函数。
export function useReceiptRegistration({
  can = () => false,
  receivables,
  saving,
  notify,
  load,
  formatSettlementError,
  createReceipt,
  listReceiptMatches,
}) {
  const receiptComposerOpen = ref(false);
  const receiptMatches = ref([]);
  const receiptMatchFor = ref("");
  const receiptForm = ref({
    customer_id: "",
    customer_name: "",
    amount: "",
    currency: "CNY",
    receipt_date: todayBusinessDate(),
    payment_method: "TRANSFER",
    bank_transaction_reference: "",
  });
  const receiptCustomers = computed(() => {
    const values = new Map();
    receivables.value.forEach((item) => {
      if (item.customer_id && !values.has(item.customer_id)) {
        values.set(item.customer_id, {
          id: item.customer_id,
          name: item.customer_name || item.customer_id,
        });
      }
    });
    return [...values.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    );
  });

  // 用途：登记真实回款并仅在具备核销能力时读取匹配建议。
  // 参数：无；读取当前回款表单。
  // 返回值：提交及刷新完成的 Promise。
  async function submitReceipt() {
    if (!can("settlement.receipt.record") || saving.value) return;
    saving.value = true;
    let registered = false;
    // 回款号是这次登记的唯一凭据：写进提示，用户可以直接复制去核销或对账。
    // 关键点：一旦登记成功，后续每一步提示（刷新失败、匹配查询失败）都必须带着同一个编号，
    // 否则用户在最需要「不要再登记一次」的时候恰好看不到该抄走的单据号。
    let receiptReference = "";
    try {
      const result = await createReceipt(receiptForm.value);
      registered = true;
      receiptComposerOpen.value = false;
      receiptMatchFor.value = result.id;
      receiptMatches.value = [];
      receiptReference = result.receipt_no || result.receipt_id || "";
      if (!can("settlement.allocation.confirm")) {
        notify("回款已登记。", receiptReference);
        const refreshed = await load();
        if (!refreshed) notify("回款已登记，但页面刷新失败。请刷新列表核对结果，勿重复登记。", receiptReference);
        return;
      }
      receiptMatches.value = await listReceiptMatches(result.id);
      notify(
        receiptMatches.value.length
          ? `回款已登记，找到 ${receiptMatches.value.length} 条可核销应收。`
          : "回款已登记，暂未找到同客户、同币种的可核销应收。",
        receiptReference,
      );
      const refreshed = await load();
      if (!refreshed) notify("回款已登记，但页面刷新失败。请刷新回款列表核对结果，勿重复登记。", receiptReference);
    } catch (cause) {
      if (registered) {
        notify(`回款已登记，但可核销应收查询失败。请刷新回款列表继续核销，勿重复登记。${formatSettlementError(cause)}`, receiptReference);
        await load();
      } else notify(formatSettlementError(cause, { fallback: "回款登记失败，请稍后重试。" }));
    } finally {
      saving.value = false;
    }
  }
  function syncReceiptCustomer() {
    const customer = receiptCustomers.value.find(
      (item) => item.id === receiptForm.value.customer_id,
    );
    receiptForm.value.customer_name = customer?.name || "";
  }

  return {
    receiptComposerOpen,
    receiptMatches,
    receiptMatchFor,
    receiptForm,
    receiptCustomers,
    submitReceipt,
    syncReceiptCustomer,
  };
}
