<script setup>
// InvoiceOriginalViewer — 受控票据原件查看器（整改：合并审批区与发票复核区两套预览容器）。
// 容器、iframe/img 选择、图像缩放旋转与全屏职责收敛于此；父级只传读取状态与展示文案。
// transformable=false 保持审批区的简易展示语义（无变换与操作入口）。
import { computed, ref, watch } from 'vue'

const props = defineProps({
  // preview 为受控 PDF 的 blob URL；download 为原件 blob URL（图片或下载地址）。
  preview: { type: String, default: '' },
  download: { type: String, default: '' },
  media: { type: String, default: '' },
  title: { type: String, required: true },
  alt: { type: String, required: true },
  transformable: { type: Boolean, default: false },
  // reportError 沿用父级统一错误反馈；未提供时全屏失败静默保留容器展示。
  reportError: { type: Function, default: null },
})

const container = ref(null)
const zoom = ref(1)
const rotation = ref(0)

const isImage = computed(() => ['image/png', 'image/jpeg'].includes(props.media) && Boolean(props.download))
const transformStyle = computed(() => props.transformable && isImage.value
  ? { transform: `rotate(${rotation.value}deg) scale(${zoom.value})` }
  : undefined)

// 每次原件内容变化重置变换，与既有 readInvoiceOriginal 的重置语义一致。
watch(() => `${props.preview}\u0000${props.download}`, () => { zoom.value = 1; rotation.value = 0 })

// 用途：对当前查看器自身的容器发起全屏，不依赖全局查询（避免选中另一区域的容器）。
// 参数：无。
// 返回值：无；浏览器不支持或用户拒绝时按既有文案报错。
async function fullscreen() {
  try {
    const element = container.value
    if (!element?.requestFullscreen) throw new Error('此浏览器不支持全屏，请下载原件查看')
    await element.requestFullscreen()
  } catch (cause) {
    if (props.reportError) props.reportError(cause)
  }
}
</script>

<template>
  <div ref="container" data-invoice-preview class="expense-original-container">
    <iframe v-if="preview" :src="preview" class="expense-original-preview" :title="title" referrerpolicy="no-referrer" />
    <img v-else-if="isImage" :src="download" :alt="alt" class="expense-original-image" :style="transformStyle">
  </div>
  <div v-if="transformable && download" class="expense-actions">
    <button type="button" class="expense-button" @click="fullscreen">全屏查看</button>
    <template v-if="isImage">
      <button type="button" class="expense-button" @click="rotation=(rotation+90)%360">旋转</button>
      <button type="button" class="expense-button" :disabled="zoom>=3" @click="zoom+=0.25">放大</button>
      <button type="button" class="expense-button" :disabled="zoom<=0.5" @click="zoom-=0.25">缩小</button>
    </template>
  </div>
</template>
