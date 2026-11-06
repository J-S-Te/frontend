<script setup>
// 全局兜底提示宿主：只显示"没人接住"的错误（未捕获的脚本错误、未处理的 Promise、路由失败）。
//
// 与业务视图自己的 showToast 是两条通道：业务侧接住的错误照旧走本地 OperationToast，
// 这里不复制、也不接管它们的本地状态，所以同一个错误不会出现两次。
//
// 视觉上沿用 OperationToast 的位置（右上角浮层）与结构（图标 + 文案 + 一行补充说明），
// 但底色用卡片表面 + 错误色描边：兜底提示是"页面上还有别的问题"的信息，会停留几秒，
// 深色浮条在浅色主题里过于抢眼；这样也只需 token 就能同时成立浅色与深色。
import { computed } from 'vue'
import { globalToastBus } from './toastBus.js'

// 默认用全应用的单例总线；测试与局部演示可以注入一条独立总线，避免共用全局状态。
const props = defineProps({
  bus: { type: Object, default: () => globalToastBus },
})

const items = computed(() => props.bus.items.value)

function dismiss(id) {
  props.bus.dismiss(id)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="items.length" class="global-error-toasts" role="region" aria-label="系统提示" aria-live="assertive">
      <TransitionGroup name="global-error-toast">
        <div v-for="item in items" :key="item.id" class="global-error-toast" :class="item.tone" role="alert" aria-atomic="true">
          <span class="global-error-toast__icon" aria-hidden="true">✕</span>
          <div class="global-error-toast__body">
            <span class="global-error-toast__message">{{ item.message }}</span>
            <p v-if="item.detail" class="global-error-toast__detail">{{ item.detail }}</p>
          </div>
          <button type="button" class="global-error-toast__close" aria-label="关闭提示" @click="dismiss(item.id)">关闭</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
/* 层级高于业务提示条（OperationToast 是 12000）：两条同时出现时，兜底提示不能被压住。 */
.global-error-toasts { position: fixed; top: var(--space-5); right: var(--space-6); z-index: var(--global-error-toast-z, 12100); display: grid; gap: var(--space-2); box-sizing: border-box; width: max-content; max-width: min(480px, calc(100vw - var(--space-8))); }
.global-error-toast { display: flex; align-items: flex-start; gap: var(--space-3); box-sizing: border-box; padding: var(--space-3) var(--space-4); border: 1px solid var(--danger-border, var(--border)); border-left: 3px solid var(--danger); border-radius: var(--radius-lg); background: var(--surface-card); color: var(--text); box-shadow: var(--shadow-popover); font-size: var(--fs-body); line-height: 1.6; overflow-wrap: anywhere; }
.global-error-toast.warning { border-left-color: var(--warning); }
.global-error-toast.success { border-left-color: var(--success); }
.global-error-toast.info { border-left-color: var(--primary); }
.global-error-toast__icon { flex: 0 0 auto; color: var(--danger-text); font-size: var(--fs-sm); }
.global-error-toast.warning .global-error-toast__icon { color: var(--warning-text); }
.global-error-toast.success .global-error-toast__icon { color: var(--success-text); }
.global-error-toast.info .global-error-toast__icon { color: var(--primary); }
.global-error-toast__body { display: grid; gap: var(--space-1); min-width: 0; }
.global-error-toast__message { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.global-error-toast__detail { margin: 0; color: var(--text-muted); font-size: var(--fs-xs); line-height: 1.6; }
.global-error-toast__close { flex: 0 0 auto; align-self: flex-start; padding: 2px var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); font-size: var(--fs-xs); line-height: 1.6; cursor: pointer; }
.global-error-toast__close:hover { border-color: var(--danger); color: var(--danger-text); }
.global-error-toast__close:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.global-error-toast-enter-active, .global-error-toast-leave-active { transition: opacity var(--duration-fast) ease, transform var(--duration-fast) ease; }
.global-error-toast-enter-from, .global-error-toast-leave-to { opacity: 0; transform: translateY(-6px); }
@media (max-width: 560px) { .global-error-toasts { top: var(--space-4); right: var(--space-4); } }
@media (prefers-reduced-motion: reduce) { .global-error-toast-enter-active, .global-error-toast-leave-active { transition: none; } }
</style>
