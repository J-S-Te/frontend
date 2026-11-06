<script setup>
// 授权页统一的问题条：人话结论 + 可执行下一步 + 可复制的错误代码/请求标识。
// 只做展示：错误已经由 formatUserError / userErrorDiagnostics 过滤过，
// 这里不再拼接细节，也不猜测后端语义。
import { onBeforeUnmount, ref } from 'vue'
import ConsoleIcon from '@/modules/shared/components/ConsoleIcon.vue'
import { copyTextToClipboard } from '@/modules/shared/utils/clipboard.js'

const props = defineProps({
  title: { type: String, default: '本次操作未完成' },
  message: { type: String, required: true },
  // 后端错误码与请求标识：管理台内可复制给管理员排查。
  code: { type: String, default: '' },
  requestId: { type: String, default: '' },
  nextAction: { type: String, default: '' },
  retryLabel: { type: String, default: '重试' },
  retry: { type: Boolean, default: true },
  tone: { type: String, default: 'danger' },
})

const emit = defineEmits(['retry'])
const copied = ref('')
let resetTimer = null

async function copy(value, field) {
  if (!value) return
  try {
    await copyTextToClipboard(value)
    copied.value = field
  } catch {
    copied.value = 'failed'
  }
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => { copied.value = ''; resetTimer = null }, 2500)
}
onBeforeUnmount(() => { if (resetTimer) clearTimeout(resetTimer) })
</script>

<template>
  <div class="license-problem" :data-tone="tone" role="alert">
    <ConsoleIcon name="info" class="license-problem-icon" />
    <div class="license-problem-body">
      <strong class="license-problem-title">{{ title }}</strong>
      <p class="license-problem-message">{{ message }}</p>
      <p v-if="nextAction" class="license-problem-next"><span>下一步：</span>{{ nextAction }}</p>
      <dl v-if="code || requestId" class="license-problem-diag">
        <div v-if="code">
          <dt>错误代码</dt>
          <dd>
            <code>{{ code }}</code>
            <button type="button" class="license-problem-copy" :aria-label="`复制错误代码 ${code}`" @click="copy(code, 'code')">{{ copied === 'code' ? '已复制' : '复制' }}</button>
          </dd>
        </div>
        <div v-if="requestId">
          <dt>请求标识</dt>
          <dd>
            <code>{{ requestId }}</code>
            <button type="button" class="license-problem-copy" :aria-label="`复制请求标识 ${requestId}`" @click="copy(requestId, 'requestId')">{{ copied === 'requestId' ? '已复制' : '复制' }}</button>
          </dd>
        </div>
      </dl>
      <p v-if="copied === 'failed'" class="license-problem-copy-error">浏览器没有允许复制，请手动选中上面的文本复制。</p>
    </div>
    <button v-if="retry" type="button" class="console-button ghost small license-problem-retry" @click="emit('retry')">{{ retryLabel }}</button>
  </div>
</template>

<style scoped>
.license-problem {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--danger-border, #fecaca);
  border-left: 3px solid var(--danger, #dc2626);
  border-radius: 10px;
  background: var(--danger-soft, #fef2f2);
  color: var(--danger-text, #b91c1c);
}
.license-problem[data-tone="warning"] {
  border-color: var(--warning-border, #fde68a);
  border-left-color: var(--warning, #d97706);
  background: var(--warning-soft);
  color: var(--warning-text, #b45309);
}
.license-problem-icon { flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px; }
.license-problem-body { display: grid; flex: 1 1 auto; gap: 4px; min-width: 0; }
.license-problem-title { font-size: 13.5px; font-weight: 650; }
.license-problem-message { margin: 0; color: inherit; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.license-problem-next { margin: 2px 0 0; color: inherit; font-size: 12.5px; line-height: 1.6; opacity: .92; }
.license-problem-next span { font-weight: 600; }
.license-problem-diag { display: grid; gap: 6px; margin: 8px 0 0; }
.license-problem-diag > div { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.license-problem-diag dt { font-size: 12px; font-weight: 600; }
.license-problem-diag dd { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; min-width: 0; }
.license-problem-diag code {
  padding: 2px 7px;
  border: 1px solid currentColor;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  background: var(--surface-card, #fff);
}
.license-problem-copy {
  padding: 1px 8px;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.license-problem-copy:hover { background: var(--surface-card, #fff); }
.license-problem-copy-error { margin: 4px 0 0; font-size: 12px; }
.license-problem-retry { flex: 0 0 auto; color: inherit; border-color: currentColor; background: transparent; }
.license-problem-retry:hover:not(:disabled) { background: var(--surface-card, #fff); }
@media (max-width: 640px) {
  .license-problem { flex-wrap: wrap; }
  .license-problem-retry { width: 100%; }
}
[data-theme="dark"] .license-problem-retry:hover:not(:disabled),
[data-theme="dark"] .license-problem-copy:hover { background: var(--surface-hover); }
[data-theme="dark"] .license-problem-diag code { background: var(--surface-input); }
</style>
