import { ref } from "vue";

/**
 * 结算页的动作-提示主干（治理批次 3 结算第二步）。
 * 收编：message 提示与 3.2 秒自动清除、saving 互斥、notify 与 act 包装
 * （成功后刷新列表并提示；刷新失败保留成功事实并告诫勿重复提交；失败走格式化文案）。
 * 注入项与组件内同名标识一一对应：load/formatSettlementError；不直接导入 API 模块。
 */
export function useSettlementActions({ load, formatSettlementError }) {
  const message = ref("");
  // 写操作返回的**业务编号**（回款号、开票申请号等）。提示必须是短暂的，
  // 但编号不能跟着 3.2 秒一起消失——OperationToast 会把它渲染成可复制的一行。
  const messageReference = ref("");
  const saving = ref(false);

// 用途：展示一条操作提示，并在有业务编号时一起展示。
// 参数：value 为提示文案；reference 为业务编号（可省略）。
// 返回值：无。
function notify(value, reference = "") {
  message.value = value;
  messageReference.value = reference ? String(reference) : "";
  window.setTimeout(() => {
    message.value = "";
    messageReference.value = "";
  }, 3200);
}

async function act(callback, success) {
  if (saving.value) return;
  saving.value = true;
  try {
    await callback();
    const refreshed = await load();
    notify(refreshed ? success : `${success}页面刷新失败，请刷新列表核对结果，勿重复提交。`);
  } catch (cause) {
    notify(formatSettlementError(cause, { fallback: "操作失败，请稍后重试。" }));
  } finally {
    saving.value = false;
  }
}

  return { message, messageReference, saving, notify, act };
}
