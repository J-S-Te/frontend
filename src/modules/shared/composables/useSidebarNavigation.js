import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDialogFocusTrap } from './useDialogFocusTrap.js'

// useSidebarNavigation 管理断点内侧栏的可聚焦性及抽屉焦点契约。
// 参数：open 为受控开合状态，container 为侧栏，trigger 为菜单按钮，
//   breakpoint 为窄屏上界，collapsed 为可选的桌面折叠状态。
// 返回值：hidden 表示侧栏应从交互和辅助技术树隐藏。
export function useSidebarNavigation({ open, container, trigger, breakpoint = 820, collapsed }) {
  const narrow = ref(false)
  let media
  const active = computed(() => narrow.value && open.value)
  const hidden = computed(() => narrow.value ? !open.value : Boolean(collapsed?.value))
  useDialogFocusTrap({ active, container })

  // syncBreakpoint 同步布局断点，避免隐藏侧栏仍可通过键盘进入。
  // 参数：无。
  // 返回值：无。
  function syncBreakpoint() { narrow.value = Boolean(media?.matches) }

  watch(active, (current, previous) => {
    if (previous && !current) trigger.value?.focus?.()
  }, { flush: 'post' })
  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    media = window.matchMedia(`(max-width: ${breakpoint}px)`)
    syncBreakpoint()
    media.addEventListener?.('change', syncBreakpoint)
  })
  onBeforeUnmount(() => { media?.removeEventListener?.('change', syncBreakpoint) })
  return { hidden }
}
