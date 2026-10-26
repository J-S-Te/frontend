import { onScopeDispose, ref } from 'vue'

/**
 * Promise-based confirmation controller for destructive or irreversible actions.
 * One dialog is active at a time; a newer request resolves the previous one as
 * cancelled instead of silently replacing its callback.
 *
 * 宿主组件销毁时（路由离开/容器弹窗关闭），未决的 askConfirm 以取消收场，
 * 避免 await 永挂与 resolver 泄漏；非组件作用域调用时不注册清理。
 */
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

  function askConfirm({
    title,
    description = '',
    confirmText = '确认',
    cancelText = '取消',
    danger = false,
  } = {}) {
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
