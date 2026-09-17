<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  suffix: { type: String, default: '' },
  meta: { type: String, default: '' },
  badge: { type: String, default: '' },
  tone: { type: String, default: '' },
  actionable: { type: Boolean, default: false },
})

defineEmits(['activate'])
</script>

<template>
  <component
    :is="actionable ? 'button' : 'article'"
    :type="actionable ? 'button' : undefined"
    class="pm-kpi"
    :class="tone"
    @click="actionable && $emit('activate')"
  >
    <div class="pm-kpi-label"><span>{{ label }}</span><em v-if="badge">{{ badge }}</em></div>
    <strong class="pm-kpi-value">{{ value }}<small v-if="suffix">{{ suffix }}</small></strong>
    <p v-if="meta" class="pm-kpi-meta">{{ meta }}</p>
    <slot />
  </component>
</template>
