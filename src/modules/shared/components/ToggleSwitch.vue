<script setup>
// 共享开关：role=switch + aria-checked 由组件保证，避免各模块只画视觉轨道而漏掉读屏语义。
// 使用 button 而不是隐藏 checkbox，键盘 Space/Enter 和焦点环由浏览器原生提供。
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  id: { type: String, default: undefined },
})
const emit = defineEmits(['update:modelValue', 'change'])

function toggle() {
  if (props.disabled || props.busy) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <button
    :id="id"
    type="button"
    role="switch"
    class="ui-toggle-switch"
    :class="{ 'is-on': modelValue, 'is-busy': busy }"
    :aria-checked="modelValue"
    :aria-label="label || undefined"
    :aria-busy="busy || undefined"
    :disabled="disabled || busy"
    @click="toggle"
  >
    <span class="ui-toggle-switch__track" aria-hidden="true">
      <span class="ui-toggle-switch__thumb" />
    </span>
    <span v-if="$slots.default || label" class="ui-toggle-switch__label"><slot>{{ label }}</slot></span>
  </button>
</template>

<style scoped>
.ui-toggle-switch {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  max-width: 100%;
  padding: 0;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  border: 0;
  background: transparent;
}
.ui-toggle-switch:disabled {
  cursor: not-allowed;
  opacity: .55;
}
.ui-toggle-switch__track {
  position: relative;
  width: 40px;
  height: 23px;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-muted);
  transition: background-color 160ms ease, border-color 160ms ease;
}
.ui-toggle-switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--surface-card);
  box-shadow: var(--shadow-card);
  transition: transform 160ms ease;
}
.ui-toggle-switch.is-on .ui-toggle-switch__track {
  border-color: var(--primary);
  background: var(--primary);
}
.ui-toggle-switch.is-on .ui-toggle-switch__thumb {
  transform: translateX(17px);
}
.ui-toggle-switch:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  border-radius: 6px;
}
.ui-toggle-switch__label {
  min-width: 0;
  overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) {
  .ui-toggle-switch__track,
  .ui-toggle-switch__thumb { transition: none; }
}
</style>
