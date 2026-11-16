import { nextTick, onScopeDispose, watch } from 'vue'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// 用途：把键盘焦点限制在当前长表单弹窗内，关闭时交还入口。
// 参数：active 为打开状态；container 为弹窗引用；initialFocus 为首个聚焦选择器。
// 返回值：无；Escape 仍由所属业务弹窗处理，作用域销毁时解除副作用。
export function useDialogFocusTrap({ active, container, initialFocus = '' }) {
  let previousFocus = null
  let listening = false

  // 用途：读取弹窗内当前可见且可操作的焦点顺序。
  // 参数：无。
  // 返回值：可聚焦元素列表。
  function items() {
    if (!container.value) return []
    return [...container.value.querySelectorAll(FOCUSABLE)].filter((element) => element.offsetParent !== null)
  }

  // 用途：将焦点移入当前弹窗的首选控件。
  // 参数：无。
  // 返回值：无；容器销毁后不聚焦。
  function focusFirst() {
    const requested = initialFocus ? container.value?.querySelector(initialFocus) : null
    const target = requested || items()[0]
    target?.focus?.()
  }

  // 用途：处理当前弹窗的 Tab 首尾循环，不干扰上层确认框。
  // 参数：event 为浏览器键盘事件。
  // 返回值：无。
  function onKeydown(event) {
    if (event.key !== 'Tab') return
    // Teleport 确认框自带焦点管理，下层表单不能处理同一次 Tab。
    if (document.body?.dataset?.confirmDialogOpen === 'true') return
    const list = items()
    if (!list.length) return
    const first = list[0]
    const last = list[list.length - 1]
    if (event.shiftKey && (document.activeElement === first || !container.value?.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // 用途：移除键盘监听并恢复仍在文档中的入口焦点。
  // 参数：无。
  // 返回值：无；多次调用不会重复聚焦。
  function releaseFocus() {
    if (listening && typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeydown, true)
      listening = false
    }
    if (previousFocus?.isConnected) previousFocus.focus?.()
    previousFocus = null
  }

  watch(active, async (open, _previous, onCleanup) => {
    if (typeof document === 'undefined') return
    let cancelled = false
    // 必须在 await 前登记；停止侦听不会自动取消已排队的 nextTick 回调。
    onCleanup(() => { cancelled = true })
    if (!open) { releaseFocus(); return }
    previousFocus = document.activeElement
    if (!listening) {
      document.addEventListener('keydown', onKeydown, true)
      listening = true
    }
    await nextTick()
    if (!cancelled && active.value && container.value) focusFirst()
  }, { immediate: true, flush: 'post' })

  onScopeDispose(releaseFocus)
}
