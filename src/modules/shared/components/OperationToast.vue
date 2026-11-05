<script setup>
// 顶层操作反馈条（Teleport 到 body，脱离各模块的层叠上下文）。
//
// 业务编号（reference）是这里的关键契约：登记回款、创建客户这类写操作会返回单据号，
// 用户需要把它抄走或贴到别处。所以编号必须以「可见、可选中（user-select: all）、
// 可一键复制」的形式留在提示里，而不是只出现在刷新后可能翻不到的那一行表格里。
// detail 用于放一行补充说明（下一步 / 影响范围），语气与既有提示保持一致。
import { ref, watch } from 'vue'
import { copyTextToClipboard } from '../utils/clipboard.js'

const props = defineProps({
  message: { type: String, default: '' },
  tone: { type: String, default: 'info' },
  // 业务编号 / 单据号；为空时不渲染编号行。
  reference: { type: String, default: '' },
  referenceLabel: { type: String, default: '业务编号' },
  // 可选补充说明行。
  detail: { type: String, default: '' },
})

// '' | 'copied' | 'failed'：复制失败时按钮文案改为「请手动选择复制」，
// 编号本身仍带 user-select: all，用户可以直接选中。
const copyState = ref('')

async function copyReference() {
  if (!props.reference) return
  try {
    await copyTextToClipboard(props.reference)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
}

// 复制状态跟随「当前这条提示」，不跨提示存活：换了下一次操作的编号或换了文案，
// 必须退回初始「复制」。否则上一条点过复制的「已复制」会挂在新的单据号旁边，
// 让用户以为这次也复制成功了。失败态的降级文案同样随提示重置。
watch(
  () => [props.reference, props.message],
  () => { copyState.value = '' },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="operation-toast">
      <div v-if="message" class="shared-operation-toast" :class="tone" :role="tone === 'error' ? 'alert' : 'status'" aria-atomic="true">
        <span class="shared-operation-toast-icon" aria-hidden="true">{{ tone === 'error' ? '✕' : tone === 'success' ? '✓' : tone === 'warning' ? '⚠' : 'ℹ' }}</span>
        <div class="shared-operation-toast-body">
          <span class="shared-operation-toast-copy">{{ message }}</span>
          <p v-if="detail" class="shared-operation-toast-detail">{{ detail }}</p>
          <div v-if="reference" class="shared-operation-toast-reference">
            <span class="shared-operation-toast-reference-label">{{ referenceLabel }}</span>
            <code class="shared-operation-toast-reference-value">{{ reference }}</code>
            <button type="button" class="shared-operation-toast-copy-button" @click="copyReference">{{ copyState === 'copied' ? '已复制' : copyState === 'failed' ? '请手动选择复制' : '复制' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Own these tokens: Teleport deliberately leaves each subsystem's theme scope. */
.shared-operation-toast { position: fixed; z-index: 12000; top: 80px; right: 24px; display: flex; align-items: flex-start; gap: 10px; box-sizing: border-box; width: max-content; max-width: min(480px, calc(100vw - 32px)); max-height: min(40vh, 320px); overflow-y: auto; padding: 14px 18px; border-radius: 10px; background: #0f172a; color: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, .25); font: 14px/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
.shared-operation-toast-icon { flex: 0 0 auto; }
.shared-operation-toast-body { display: grid; min-width: 0; gap: 6px; }
.shared-operation-toast-copy { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.shared-operation-toast-detail { margin: 0; color: currentColor; opacity: .82; font-size: 13px; line-height: 1.6; }
.shared-operation-toast-reference { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 2px; padding: 6px 8px; border-radius: 6px; background: rgba(255, 255, 255, .12); }
.shared-operation-toast-reference-label { flex: 0 0 auto; color: currentColor; opacity: .68; font-size: 12px; }
.shared-operation-toast-reference-value { min-width: 0; color: inherit; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; user-select: all; overflow-wrap: anywhere; }
.shared-operation-toast-copy-button { flex: 0 0 auto; min-height: 24px; padding: 2px 8px; border: 1px solid currentColor; border-radius: 5px; background: transparent; color: inherit; font: inherit; font-size: 12px; line-height: 1.4; opacity: .82; cursor: pointer; }
.shared-operation-toast-copy-button:hover { opacity: 1; }
.shared-operation-toast-copy-button:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; opacity: 1; }
.shared-operation-toast.error .shared-operation-toast-icon { color: #fca5a5; }
.shared-operation-toast.warning .shared-operation-toast-icon { color: #fde68a; }
.shared-operation-toast.success .shared-operation-toast-icon { color: #86efac; }
.operation-toast-enter-active, .operation-toast-leave-active { transition: opacity .15s ease, transform .15s ease; }
.operation-toast-enter-from, .operation-toast-leave-to { opacity: 0; transform: translateY(-8px); }
@media (max-width: 560px) { .shared-operation-toast { top: 68px; right: 16px; } }
@media (prefers-reduced-motion: reduce) { .operation-toast-enter-active, .operation-toast-leave-active { transition: none; } }
</style>
