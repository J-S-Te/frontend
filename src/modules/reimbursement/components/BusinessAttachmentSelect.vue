<script setup>
import { computed, ref, watch } from 'vue'
import BusinessObjectSelect from './BusinessObjectSelect.vue'

const props = defineProps({
  modelValue: { type: [Array, String], default: '' },
  purpose: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  names: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue', 'upload'])
const selectedDocument = ref('')
const selectedNames = ref(new Map())
const fileIDs = computed(() => {
  const values = Array.isArray(props.modelValue) ? props.modelValue : props.modelValue.split(',')
  return [...new Set(values.filter((value) => typeof value === 'string')
    .map((value) => value.trim()).filter(Boolean))]
})
const accept = computed(() => props.purpose === 'reimbursement.invoice.original'
  ? '.pdf,.ofd,.png,.jpg,.jpeg' : '.pdf,.png,.jpg,.jpeg')

// 用途：只显示父层或真实已选对象提供的文件名，历史未知名称不退回内部编号。
// 参数：fileID 为仅用于查找和提交的附件引用。
// 返回值：真实文件名；名称缺失时返回明确的待核对说明。
function attachmentName(fileID) {
  for (const value of [props.names[fileID], selectedNames.value.get(fileID)]) {
    if (typeof value === 'string' && value.trim() && value.trim() !== fileID) return value.trim()
  }
  return '已关联附件（名称待核对）'
}

// 用途：保持父表单原有数组或逗号字符串协议，内部引用不进入可编辑文本。
// 参数：values 为已去重的真实附件引用数组。
// 返回值：无；发射与父输入类型一致的更新事件。
function updateFiles(values) {
  emit('update:modelValue', Array.isArray(props.modelValue) ? values : values.join(','))
}

// 用途：追加服务端返回的已就绪附件，取消选择不影响原有关联。
// 参数：row 为固定用途选择器返回的真实文档对象，清空时为 null。
// 返回值：无；仅有真实文件引用及业务名称时追加，重复项不重复提交。
function selectAttachment(row) {
  if (props.disabled || !row) return
  const fileID = typeof row.file_id === 'string' ? row.file_id.trim() : ''
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!fileID || !name || name === fileID || name === String(row.id)) return
  selectedNames.value.set(fileID, name)
  if (!fileIDs.value.includes(fileID)) updateFiles([...fileIDs.value, fileID])
}

// 用途：移除用户明确指定的一项附件关联，不删除服务器原文件。
// 参数：fileID 为当前关联列表中的真实文件引用。
// 返回值：无；禁用或引用不在当前列表时不修改父表单。
function removeAttachment(fileID) {
  if (props.disabled || !fileIDs.value.includes(fileID)) return
  selectedDocument.value = ''
  updateFiles(fileIDs.value.filter((value) => value !== fileID))
}

// 用途：把原生文件事件交给父页面现有受控上传流程。
// 参数：event 为用户选择本地文件的真实事件。
// 返回值：无；组件不另建上传会话或生成写入命令。
function upload(event) {
  if (!props.disabled) emit('upload', event)
}

watch(() => props.purpose, () => {
  selectedDocument.value = ''
  selectedNames.value = new Map()
})
</script>

<template>
  <div class="expense-attachment-select">
    <BusinessObjectSelect v-model="selectedDocument" source="/invoice-document-options"
      :extra-params="{ purpose }" label="已上传附件" :disabled="disabled"
      @select="selectAttachment" />
    <label>上传新附件
      <input type="file" :accept="accept" :disabled="disabled" @change="upload">
    </label>
    <ul v-if="fileIDs.length" aria-label="已关联附件">
      <li v-for="fileID in fileIDs" :key="fileID">
        <span>{{ attachmentName(fileID) }}</span>
        <button type="button" class="expense-button" :disabled="disabled"
          :aria-label="`移除${attachmentName(fileID)}`" @click="removeAttachment(fileID)">移除</button>
      </li>
    </ul>
    <p v-else>尚未关联附件。</p>
  </div>
</template>

<style scoped>
.expense-attachment-select { min-width: 0; }
.expense-attachment-select li {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-block: 6px;
}
.expense-attachment-select li span { min-width: 0; overflow-wrap: anywhere; }
</style>
