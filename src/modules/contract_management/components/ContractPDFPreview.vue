<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchContractPDFSource } from '../api/contract.js'

const props = defineProps({
  descriptor: { type: Object, required: true },
  title: { type: String, default: '合同 PDF 原件' },
})
const loading = ref(false)
const error = ref('')
const objectURL = ref('')
let generation = 0
let controller = null

/**
 * loadSource 读取当前描述对应的PDF并使迟到响应失效。
 * 参数：无；使用当前descriptor，旧请求通过代次和取消信号隔离。
 * 返回值：Promise<void>；失败保留中文提示，成功由浏览器原生PDF查看器显示。
 */
async function loadSource() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  if (objectURL.value) URL.revokeObjectURL(objectURL.value)
  objectURL.value = ''
  loading.value = true
  error.value = ''
  try {
    const blob = await fetchContractPDFSource(props.descriptor.source_path, {
      signal: controller.signal, expectedSHA256: props.descriptor.current_sha256,
    })
    if (current !== generation) return
    objectURL.value = URL.createObjectURL(blob)
  } catch (failure) {
    if (current === generation) error.value = failure?.message || 'PDF 原件读取失败。'
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(() => props.descriptor, loadSource, { immediate: true })
onBeforeUnmount(() => {
  generation++
  controller?.abort()
  if (objectURL.value) URL.revokeObjectURL(objectURL.value)
})
</script>

<template>
  <section class="contract-pdf-preview" :aria-label="title">
    <header><strong>{{ title }}</strong><a v-if="objectURL" :href="objectURL" :download="descriptor.filename || '合同原件.pdf'">下载原件</a></header>
    <p v-if="loading" role="status">正在读取 PDF 原件…</p>
    <p v-else-if="error" role="alert">{{ error }} <button type="button" @click="loadSource">重试</button></p>
    <iframe v-else-if="objectURL" :src="objectURL" :title="title" />
    <p class="contract-pdf-preview__note">显示上传的原始 PDF；无文本扫描件不提供全文检索，原件上传不代表签署核验完成。</p>
  </section>
</template>

<style scoped>
.contract-pdf-preview { border: 1px solid #d9e1ec; border-radius: 8px; overflow: hidden; }
.contract-pdf-preview header { display: flex; justify-content: space-between; gap: 12px; padding: 12px; background: #f5f7fb; }
.contract-pdf-preview iframe { display: block; width: 100%; height: min(70vh, 800px); min-height: 360px; border: 0; }
.contract-pdf-preview p { padding: 10px 12px; margin: 0; }
.contract-pdf-preview__note { color: #64748b; font-size: 12px; }
</style>
