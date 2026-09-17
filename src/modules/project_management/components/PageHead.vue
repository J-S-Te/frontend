<script setup>
defineProps({
  eyebrow: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
})
</script>

<template>
  <section class="pm-page-head">
    <div><p class="pm-eyebrow">{{ eyebrow }}</p><h1>{{ title }}</h1><p>{{ description }}</p></div>
    <div class="pm-actions"><slot name="actions" /></div>
  </section>
</template>
