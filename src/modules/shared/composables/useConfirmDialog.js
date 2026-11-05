import { onScopeDispose, ref } from 'vue'
import { requireActionLabel } from '../utils/actionLabel.js'

// useConfirmDialog 管理重要操作的异步确认及取消生命周期。
// 参数：无。
// 返回值：弹窗状态及打开、接受、取消方法；销毁时取消未决请求。
export function useConfirmDialog() {
  const dialog = ref(null)
  let resolver = null

  function settle(value) {
    const resolve = resolver
    resolver = null
    dialog.value = null
    if (resolve) resolve(value)
  }

  onScopeDispose(() => {
    if (resolver) settle(false)
  })

  // askConfirm 显示具有明确操作结果的确认框。
  // 参数：配置包含标题、说明、动作按钮和危险状态。
  // 返回值：确认时为 true，取消、替换或销毁时为 false 的 Promise。
  function askConfirm({
    title,
    description = '',
    confirmText,
    cancelText = '取消',
    danger = false,
  } = {}) {
    confirmText = requireActionLabel(confirmText)
    if (resolver) settle(false)
    dialog.value = { title, description, confirmText, cancelText, danger }
    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  function accept() {
    settle(true)
  }

  function cancel() {
    settle(false)
  }

  return { dialog, askConfirm, accept, cancel }
}
