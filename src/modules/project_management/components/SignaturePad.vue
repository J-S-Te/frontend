<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits(['signed', 'cleared'])
const canvas = ref(null)
const drawing = ref(false)
const hasInk = ref(false)
let context = null
let resizeObserver = null

function resize() {
  const element = canvas.value
  if (!element) return
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  const rect = element.getBoundingClientRect()
  const snapshot = hasInk.value ? element.toDataURL('image/png') : ''
  element.width = Math.max(1, Math.round(rect.width * ratio))
  element.height = Math.max(1, Math.round(rect.height * ratio))
  context = element.getContext('2d')
  context.scale(ratio, ratio)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = 2.25
  context.strokeStyle = '#172033'
  if (snapshot) {
    const image = new Image()
    image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height)
    image.src = snapshot
  }
}

function point(event) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function start(event) {
  if (!context) return
  drawing.value = true
  canvas.value.setPointerCapture(event.pointerId)
  const current = point(event)
  context.beginPath()
  context.moveTo(current.x, current.y)
}

function move(event) {
  if (!drawing.value || !context) return
  const current = point(event)
  context.lineTo(current.x, current.y)
  context.stroke()
  hasInk.value = true
}

function stop(event) {
  if (!drawing.value) return
  drawing.value = false
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId)
  if (!hasInk.value) return
  canvas.value.toBlob((blob) => {
    if (!blob) return
    emit('signed', new File([blob], `field-signature-${Date.now()}.png`, { type: 'image/png', lastModified: Date.now() }))
  }, 'image/png')
}

function clear() {
  if (!canvas.value || !context) return
  context.clearRect(0, 0, canvas.value.width, canvas.value.height)
  hasInk.value = false
  emit('cleared')
}

onMounted(async () => {
  await nextTick()
  resize()
  if (globalThis.ResizeObserver) {
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas.value)
  }
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <section class="pm-signature-pad">
    <div class="pm-signature-head"><span>电子签名 <em>*</em></span><button type="button" class="pm-link" @click="clear">清除重签</button></div>
    <canvas ref="canvas" aria-label="电子签名画布" @pointerdown.prevent="start" @pointermove.prevent="move" @pointerup.prevent="stop" @pointercancel.prevent="stop"></canvas>
    <small>{{ hasInk ? '签名已采集，将与账号、服务项及时间戳绑定。' : '请使用鼠标、触控笔或手指在框内签名。' }}</small>
  </section>
</template>
