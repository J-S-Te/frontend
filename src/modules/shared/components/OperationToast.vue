<script setup>
defineProps({
  message: { type: String, default: '' },
  tone: { type: String, default: 'info' },
})
</script>

<template>
  <Teleport to="body">
    <Transition name="operation-toast">
      <div v-if="message" class="shared-operation-toast" :class="tone" :role="tone === 'error' ? 'alert' : 'status'" aria-atomic="true">
        <span class="shared-operation-toast-icon" aria-hidden="true">{{ tone === 'error' ? '✕' : tone === 'success' ? '✓' : tone === 'warning' ? '⚠' : 'ℹ' }}</span>
        <span class="shared-operation-toast-copy">{{ message }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Own these tokens: Teleport deliberately leaves each subsystem's theme scope. */
.shared-operation-toast { position: fixed; z-index: 12000; top: 80px; right: 24px; display: flex; align-items: flex-start; gap: 10px; box-sizing: border-box; width: max-content; max-width: min(480px, calc(100vw - 32px)); max-height: min(40vh, 320px); overflow-y: auto; padding: 14px 18px; border-radius: 10px; background: #0f172a; color: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, .25); font: 14px/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
.shared-operation-toast-icon { flex: 0 0 auto; }
.shared-operation-toast-copy { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.shared-operation-toast.error .shared-operation-toast-icon { color: #fca5a5; }
.shared-operation-toast.warning .shared-operation-toast-icon { color: #fde68a; }
.shared-operation-toast.success .shared-operation-toast-icon { color: #86efac; }
.operation-toast-enter-active, .operation-toast-leave-active { transition: opacity .15s ease, transform .15s ease; }
.operation-toast-enter-from, .operation-toast-leave-to { opacity: 0; transform: translateY(-8px); }
@media (max-width: 560px) { .shared-operation-toast { top: 68px; right: 16px; } }
@media (prefers-reduced-motion: reduce) { .operation-toast-enter-active, .operation-toast-leave-active { transition: none; } }
</style>
