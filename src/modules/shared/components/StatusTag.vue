<script setup>
// 状态胶囊的唯一渲染原语：只接收五档语义 tone，不接收任意色值。
// family 用于复用各子系统既有的徽标皮肤（pm / contract / crm / settlement / expense / da / console）。
defineProps({
  tone: { type: String, default: 'neutral' },
  label: { type: String, default: '' },
  family: { type: String, default: 'pm' },
})
</script>

<template>
  <span :class="[`${family}-badge`, tone]"><slot>{{ label }}</slot></span>
</template>
