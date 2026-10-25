import { ref } from 'vue'

/**
 * 回调式危险操作确认弹窗状态。不使用 window.confirm，避免 WebView / 某些 PWA
 * 容器中 confirm 静默失败导致危险操作被误判为取消。同一时刻只有一个弹窗。
 *
 * onConfirm 返回 false 表示业务失败，保留弹窗让用户看到错误并可重试；
 * 抛出异常时同样保留弹窗，避免误判为成功。closeConfirm 在 busy 期间拒绝关闭，
 * 关闭时触发可选的 onCancel（未传入则无副作用）。
 */
export function useConfirmAction() {
  const dialog = ref(null) // { title, description, confirmText, cancelText, danger, busy, onConfirm, onCancel }

  function openConfirm({ title, description, confirmText = '确认', cancelText = '取消', danger = false, onConfirm, onCancel }) {
    dialog.value = { title, description, confirmText, cancelText, danger, busy: false, onConfirm, onCancel }
  }

  function closeConfirm() {
    const current = dialog.value
    if (current?.busy) return
    dialog.value = null
    current?.onCancel?.()
  }

  async function runConfirm() {
    const current = dialog.value
    if (!current || current.busy) return
    current.busy = true
    try {
      const completed = await current.onConfirm()
      if (completed !== false && dialog.value === current) dialog.value = null
    } catch {
      // 业务回调负责展示错误提示；异常时保留弹窗避免误判为成功。
    } finally {
      if (dialog.value === current) current.busy = false
    }
  }

  return { dialog, openConfirm, closeConfirm, runConfirm }
}
