<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  html: { type: String, required: true },
  title: { type: String, default: '合同预览' },
  closable: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const root = ref(null)
const viewport = ref(null)
const zoomPercent = ref(100)
const fallbackFullscreen = ref(false)
const nativeFullscreen = ref(false)

const minimumZoom = 40
const maximumZoom = 200
const zoomStep = 10
const isFullscreen = computed(() => nativeFullscreen.value || fallbackFullscreen.value)

function setZoom(value) {
  zoomPercent.value = Math.min(maximumZoom, Math.max(minimumZoom, Math.round(value / zoomStep) * zoomStep))
}

function zoomIn() {
  setZoom(zoomPercent.value + zoomStep)
}

function zoomOut() {
  setZoom(zoomPercent.value - zoomStep)
}

function resetZoom() {
  setZoom(100)
}

function fitPage() {
  const availableWidth = Math.max(0, (viewport.value?.clientWidth || 0) - 32)
  if (!availableWidth) return
  setZoom((availableWidth / 794) * 100)
}

async function toggleFullscreen() {
  if (document.fullscreenElement === root.value) {
    await document.exitFullscreen()
    return
  }
  if (fallbackFullscreen.value) {
    fallbackFullscreen.value = false
    return
  }
  if (root.value?.requestFullscreen) {
    try {
      await root.value.requestFullscreen()
      return
    } catch {
      fallbackFullscreen.value = true
      return
    }
  }
  fallbackFullscreen.value = true
}

function syncFullscreenState() {
  nativeFullscreen.value = document.fullscreenElement === root.value
}

function handleKeydown(event) {
  if (event.key === 'Escape' && fallbackFullscreen.value) fallbackFullscreen.value = false
}

function scrollIntoView(options) {
  root.value?.scrollIntoView(options)
}

defineExpose({ scrollIntoView })

onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreenState)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <section ref="root" class="contract-document-preview" :class="{ 'is-fullscreen': isFullscreen, 'is-fullscreen-fallback': fallbackFullscreen }">
    <header class="contract-document-preview__toolbar">
      <h3>{{ title }}</h3>
      <div class="contract-document-preview__actions">
        <button type="button" aria-label="缩小合同预览" title="缩小" :disabled="zoomPercent <= minimumZoom" @click="zoomOut">−</button>
        <output aria-live="polite">{{ zoomPercent }}%</output>
        <button type="button" aria-label="放大合同预览" title="放大" :disabled="zoomPercent >= maximumZoom" @click="zoomIn">＋</button>
        <button type="button" @click="resetZoom">实际大小</button>
        <button type="button" @click="fitPage">适合页面</button>
        <button type="button" @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏显示' }}</button>
        <button v-if="closable" type="button" @click="emit('close')">收起</button>
      </div>
    </header>
    <div ref="viewport" class="contract-document-preview__viewport">
      <div class="contract-document-preview__document" :style="{ zoom: `${zoomPercent}%` }" v-html="sanitizedHtml"></div>
    </div>
  </section>
</template>
