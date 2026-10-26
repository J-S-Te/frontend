import { computed, ref } from "vue";

/**
 * 回款登记域（治理批次 5 结算，自 SettlementView.vue 逐字迁移）。
 * 收编：登记编辑器开关、回款表单、客户下拉（自正式应收去重并按中文排序）与名称联动、
 * 登记提交（成功即关编辑器并拉取可核销应收建议；建议查询失败或刷新失败都保留"已登记"事实并告诫勿重复登记）、
 * 匹配建议列表与所属回款 ID。
 * 仍属视图：selectReceiptMatch（读本域 receiptMatchFor、写核销域表单并跳转，跨域桥接经解构名直写）。
 * 注入项与组件内同名标识一一对应：receivables/saving/notify/load/formatSettlementError/createReceipt/listReceiptMatches；
 * 不直接导入 API 模块。
 */
export function useReceiptRegistration({
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
    receipt_date: new Date().toISOString().slice(0, 10),
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

  async function submitReceipt() {
    if (saving.value) return;
    saving.value = true;
    let registered = false;
    try {
      const result = await createReceipt(receiptForm.value);
      registered = true;
      receiptComposerOpen.value = false;
      receiptMatchFor.value = result.id;
      receiptMatches.value = [];
      receiptMatches.value = await listReceiptMatches(result.id);
      notify(
        receiptMatches.value.length
          ? `回款已登记，找到 ${receiptMatches.value.length} 条可核销应收。`
          : "回款已登记，暂未找到同客户、同币种的可核销应收。",
      );
      const refreshed = await load();
      if (!refreshed) notify("回款已登记，但页面刷新失败。请刷新回款列表核对结果，勿重复登记。");
    } catch (cause) {
      if (registered) {
        notify(`回款已登记，但可核销应收查询失败。请刷新回款列表继续核销，勿重复登记。${formatSettlementError(cause)}`);
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
