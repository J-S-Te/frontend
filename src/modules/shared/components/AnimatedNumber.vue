<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { easeOutCubic, formatMetricNumber, parseMetricValue } from './animatedNumber.js'

// 大系统指标数字入场：800ms 缓出、延迟 300ms，与原型 A 一致；
// 纯数字才动画，带单位/复合文案直接显示原文；减少动态偏好下直接显示终值。
const props = defineProps({
  value: { type: [Number, String], default: 0 },
  duration: { type: Number, default: 800 },
  delay: { type: Number, default: 300 },
  decimals: { type: Number, default: 0 },
})

const target = computed(() => parseMetricValue(props.value))
// SSR/首帧直接输出终值，挂载后才从 0 开始动画，避免服务端快照出现 0。
const current = ref(target.value ?? 0)
const displayText = computed(() => target.value === null
  ? String(props.value ?? '')
  : formatMetricNumber(current.value, { decimals: props.decimals }))

let frame = 0
let timer = 0

function stop() {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  clearTimeout(timer)
  frame = 0
  timer = 0
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function run() {
  stop()
  if (target.value === null) {
    current.value = 0
    return
  }
  if (prefersReducedMotion()) {
    current.value = target.value
    return
  }
  current.value = 0
  const startedAt = { value: 0 }
  timer = window.setTimeout(() => {
    startedAt.value = performance.now()
    const tick = (now) => {
      const progress = Math.min((now - startedAt.value) / props.duration, 1)
      current.value = target.value * easeOutCubic(progress)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else current.value = target.value
    }
    frame = requestAnimationFrame(tick)
  }, props.delay)
}

onMounted(run)
watch(() => [props.value, props.duration, props.delay, props.decimals], run)
onBeforeUnmount(stop)
</script>

<template>{{ displayText }}</template>
