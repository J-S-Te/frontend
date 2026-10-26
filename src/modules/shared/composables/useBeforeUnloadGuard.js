import { onBeforeUnmount, onMounted } from 'vue'

// Browsers only show their own generic leave-site prompt; this guard exists to
// prevent silent loss when a long form is dirty and the tab is refreshed/closed.
export function useBeforeUnloadGuard(isDirty) {
  function handler(event) {
    if (!isDirty?.value) return
    event.preventDefault()
    event.returnValue = ''
  }
  onMounted(() => {
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', handler)
  })
  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', handler)
  })
}
