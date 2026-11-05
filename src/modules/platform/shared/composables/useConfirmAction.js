import { ref } from 'vue'
import { requireActionLabel } from '../../../shared/utils/actionLabel.js'

// useConfirmAction 管理明确动作确认、执行锁及失败保留。
// 参数：无。
// 返回值：弹窗状态及打开、取消、执行方法；回调失败时保留弹窗。
export function useConfirmAction() {
  const dialog = ref(null) // { title, description, confirmText, cancelText, danger, busy, onConfirm, onCancel }

  // openConfirm 安装待执行操作并要求明确的动作按钮。
  // 参数：配置包含标题、业务回调、动作文字与可选取消回调。
  // 返回值：无；模糊动作文字会抛出参数错误。
  function openConfirm({ title, description, confirmText, cancelText = '取消', danger = false, onConfirm, onCancel }) {
    confirmText = requireActionLabel(confirmText)
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
