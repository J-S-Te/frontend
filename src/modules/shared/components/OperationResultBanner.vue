<script setup>
defineProps({
  title: { type: String, required: true },
  message: { type: String, default: '' },
  reference: { type: String, default: '' },
  nextAction: { type: String, default: '' },
  savedAt: { type: String, default: '' },
  actionText: { type: String, default: '' },
})
const emit = defineEmits(['dismiss', 'action'])

function timeLabel(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <section class="operation-result" role="status" aria-live="polite">
    <div class="operation-result-main">
      <span class="operation-result-icon" aria-hidden="true">✓</span>
      <div>
        <strong>{{ title }}</strong>
        <p v-if="message">{{ message }}</p>
        <dl>
          <template v-if="reference"><div><dt>业务编号</dt><dd>{{ reference }}</dd></div></template>
          <template v-if="nextAction"><div><dt>下一步</dt><dd>{{ nextAction }}</dd></div></template>
          <template v-if="savedAt"><div><dt>完成时间</dt><dd>{{ timeLabel(savedAt) }}</dd></div></template>
        </dl>
        <button v-if="actionText" type="button" class="operation-result-action" @click="emit('action')">{{ actionText }}</button>
      </div>
    </div>
    <button type="button" aria-label="关闭操作结果" @click="emit('dismiss')">×</button>
  </section>
</template>

<style scoped>
.operation-result { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin: 0 0 16px; padding: 14px 16px; border: 1px solid #b7e4c7; border-radius: 12px; background: #f0fdf4; color: #14532d; }
.operation-result-main > div { min-width: 0; overflow-wrap: anywhere; }
.operation-result-main { display: flex; gap: 12px; min-width: 0; }
.operation-result-icon { display: grid; place-items: center; flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%; background: #16a34a; color: #fff; font-weight: 700; }
.operation-result strong { font-size: 14px; }
.operation-result p { margin: 4px 0 0; color: #166534; line-height: 1.6; }
.operation-result dl { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 8px 0 0; }
.operation-result dl div { display: flex; gap: 6px; min-width: 0; }
.operation-result dt { flex: 0 0 auto; color: #4d7c5b; font-size: 12px; }
.operation-result dd { margin: 0; color: #14532d; font-size: 12px; overflow-wrap: anywhere; }
.operation-result-action { margin-top: 10px; border: 1px solid #86c99a; border-radius: 7px; background: #fff; color: #166534; padding: 6px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.operation-result > button { flex: 0 0 auto; border: 0; background: transparent; color: #166534; font-size: 22px; line-height: 1; cursor: pointer; }
@media (max-width: 640px) { .operation-result dl { flex-direction: column; gap: 4px; } }
</style>
