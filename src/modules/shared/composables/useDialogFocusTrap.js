import { nextTick, onBeforeUnmount, watch } from 'vue'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keep keyboard focus inside a long-lived dialog and return it to the opener.
 * Escape handling stays with each dialog because some modules intentionally
 * close a different layer first.
 */
export function useDialogFocusTrap({ active, container, initialFocus = '' }) {
  let previousFocus = null
  let listening = false

  function items() {
    if (!container.value) return []
    return [...container.value.querySelectorAll(FOCUSABLE)].filter((element) => element.offsetParent !== null)
  }

  function focusFirst() {
    const requested = initialFocus ? container.value?.querySelector(initialFocus) : null
    const target = requested || items()[0]
    target?.focus?.()
  }

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

  watch(active, async (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      previousFocus = document.activeElement
      if (!listening) {
        document.addEventListener('keydown', onKeydown, true)
        listening = true
      }
      await nextTick()
      focusFirst()
    } else {
      if (listening) {
        document.removeEventListener('keydown', onKeydown, true)
        listening = false
      }
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus()
      previousFocus = null
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    if (listening && typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown, true)
  })
}
