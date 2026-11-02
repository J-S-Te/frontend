<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { fetchContractPDFSource } from '../api/contract.js'
import { createContractPDFRenderer } from '../utils/contractPDFRenderer.js'
import { getContractPDFDocument } from '../utils/contractPDFRuntime.js'

const props = defineProps({
  descriptor: { type: Object, required: true },
  title: { type: String, default: '合同 PDF 原件' },
})
const loading = ref(false)
const rendering = ref(false)
const error = ref('')
const objectURL = ref('')
const canvas = ref(null)
const pageNumber = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
let generation = 0
let controller = null
let renderer = null

// renderCurrentPage 绘制当前页，不把自动绘制或程序翻页当作真实用户活动。
// 参数：current为原件加载代次，默认使用当前代次。
// 返回值：绘制完成的Promise；当前代次失败时显示安全提示。
async function renderCurrentPage(current = generation) {
  if (!renderer || pageCount.value < 1) return
  rendering.value = true
  try {
    await renderer.render(pageNumber.value, zoom.value,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio)
  } catch {
    if (current === generation) error.value = 'PDF 预览失败，请重试；也可下载原件查看。'
  } finally {
    if (current === generation) rendering.value = false
  }
}

// loadSource 加载授权及SHA校验后的原件，取消旧代次下载和绘制。
// 参数：无；原件位置、SHA和文件名来自当前descriptor。
// 返回值：加载完成的Promise；失败保留提示及已取得的原件下载。
async function loadSource() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  if (objectURL.value) URL.revokeObjectURL(objectURL.value)
  objectURL.value = ''
  pageCount.value = 0
  pageNumber.value = 1
  zoom.value = 1
  loading.value = true
  error.value = ''
  let sourceLoaded = false
  try {
    await renderer?.clear()
    const blob = await fetchContractPDFSource(props.descriptor.source_path, {
      signal: controller.signal, expectedSHA256: props.descriptor.current_sha256,
    })
    if (current !== generation) return
    sourceLoaded = true
    objectURL.value = URL.createObjectURL(blob)
    await nextTick()
    if (current !== generation) return
    if (!renderer) {
      renderer = createContractPDFRenderer({ canvas: canvas.value,
        loadDocument: getContractPDFDocument })
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (current !== generation) return
    const total = await renderer.load(bytes)
    if (current !== generation || total === null) return
    pageCount.value = total
    await renderCurrentPage(current)
  } catch (failure) {
    if (current !== generation) return
    error.value = sourceLoaded
      ? 'PDF 预览失败，请重试；也可下载原件查看。'
      : failure?.message || 'PDF 原件读取失败，请重试。'
  } finally {
    if (current === generation) loading.value = false
  }
}

// changePage 选择合法页码，只保留最后一次翻页绘制。
// 参数：delta为上一页或下一页的增量。
// 返回值：绘制完成的Promise；页码越界时不操作。
async function changePage(delta) {
  const next = pageNumber.value + delta
  if (loading.value || next < 1 || next > pageCount.value) return
  pageNumber.value = next
  error.value = ''
  await renderCurrentPage()
}

// changeZoom 在资源预算内缩放当前页，不改变原始PDF字节。
// 参数：delta为缩放比例增量。
// 返回值：重新绘制完成的Promise。
async function changeZoom(delta) {
  if (loading.value || !pageCount.value) return
  zoom.value = Math.min(2, Math.max(0.5, zoom.value + delta))
  error.value = ''
  await renderCurrentPage()
}

// releasePreview 释放本组件的原件URL、下载及Worker资源。
// 参数：无。
// 返回值：无；释放异常仅记录固定提示，不泄漏引擎内部信息。
function releasePreview() {
  generation++
  controller?.abort()
  if (objectURL.value) URL.revokeObjectURL(objectURL.value)
  void renderer?.destroy().catch(() => {
    console.warn('PDF 预览资源释放失败。')
  })
}

watch(() => props.descriptor, loadSource, { immediate: true })
onBeforeUnmount(releasePreview)
</script>

<template>
  <section class="contract-pdf-preview" :aria-label="title"
    @keydown.right.prevent="changePage(1)" @keydown.left.prevent="changePage(-1)">
    <header>
      <strong>{{ title }}</strong>
      <a v-if="objectURL" :href="objectURL"
        :download="descriptor.filename || '合同原件.pdf'">下载原件</a>
    </header>
    <p v-if="loading" role="status">正在读取 PDF 原件…</p>
    <p v-if="error" role="alert">
      {{ error }} <button type="button" @click="loadSource">重试</button>
    </p>
    <nav v-if="pageCount" class="contract-pdf-preview__controls" aria-label="原件翻页与缩放">
      <button type="button" aria-label="上一页" :disabled="pageNumber <= 1"
        @click="changePage(-1)">上一页</button>
      <span aria-live="polite">第 {{ pageNumber }} / {{ pageCount }} 页</span>
      <button type="button" aria-label="下一页" :disabled="pageNumber >= pageCount"
        @click="changePage(1)">下一页</button>
      <button type="button" aria-label="缩小" :disabled="zoom <= 0.5"
        @click="changeZoom(-0.25)">−</button>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <button type="button" aria-label="放大" :disabled="zoom >= 2"
        @click="changeZoom(0.25)">＋</button>
      <span v-if="rendering" role="status">正在绘制…</span>
    </nav>
    <div v-show="objectURL && !loading" class="contract-pdf-preview__viewport"
      tabindex="0" :aria-label="`${title}，可用左右方向键翻页`">
      <canvas ref="canvas" :aria-label="`原件第${pageNumber}页`" />
    </div>
    <p class="contract-pdf-preview__note">显示上传的原始 PDF；无文本扫描件不提供全文检索，原件上传不代表签署核验完成。</p>
  </section>
</template>

<style scoped>
.contract-pdf-preview { border: 1px solid #d9e1ec; border-radius: 8px; overflow: hidden; }
.contract-pdf-preview header {
  display: flex; justify-content: space-between; gap: 12px; padding: 12px; background: #f5f7fb;
}
.contract-pdf-preview__controls {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 12px;
}
.contract-pdf-preview__viewport {
  overflow: auto; max-height: min(70vh, 800px); min-height: 260px; background: #40434a;
}
.contract-pdf-preview canvas { display: block; margin: 12px auto; background: white; }
.contract-pdf-preview p { padding: 10px 12px; margin: 0; }
.contract-pdf-preview__note { color: #64748b; font-size: 12px; }
</style>
