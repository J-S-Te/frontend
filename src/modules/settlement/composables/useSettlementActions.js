import { ref } from "vue";

/**
 * 结算页的动作-提示主干（治理批次 3 结算第二步）。
 * 收编：message 提示与 3.2 秒自动清除、saving 互斥、notify 与 act 包装
 * （成功后刷新列表并提示；刷新失败保留成功事实并告诫勿重复提交；失败走格式化文案）。
 * 注入项与组件内同名标识一一对应：load/formatSettlementError；不直接导入 API 模块。
 */
export function useSettlementActions({ load, formatSettlementError }) {
  const message = ref("");
  const saving = ref(false);

function notify(value) {
  message.value = value;
  window.setTimeout(() => {
    message.value = "";
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

  return { message, saving, notify, act };
}
