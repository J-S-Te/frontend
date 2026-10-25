<script setup>
// 操作详情抽屉：只读详情网格（治理批次 3 第三步，模板自 ProjectManagementView.vue 逐字迁移）。
// fields 由父组件的 operationDetailFields 计算注入；DOM 由快照测试对提取前 golden 逐字节锁定。
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { operationSectionLabel } from '@/modules/project_management/projectDisplay'

defineProps({
  detail: { type: Object, required: true },
  fields: { type: Array, default: () => [] },
})

defineEmits(['close'])
</script>

<template>
  <div class="pm-overlay" @click.self="$emit('close')"><aside class="pm-drawer"><header><div><span>{{ operationSectionLabel(detail.section) }}</span><h2>{{ detail.row.name }}</h2></div><button class="pm-icon-button" aria-label="关闭" @click="$emit('close')"><ConsoleIcon name="close" /></button></header><div class="pm-drawer-body"><section class="pm-drawer-hero"><span class="pm-badge neutral">{{ detail.row.state }}</span><p><template v-if="Array.isArray(detail.row.detail)"><span v-if="!detail.row.detail.length">—</span><span v-else class="pm-code-pills"><span v-for="code in detail.row.detail" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ detail.row.detail }}</template><span v-if="detail.row.warning" class="pm-cell-warning">{{ detail.row.warning }}</span></p><div class="pm-progress"><i :style="{ width: `${detail.row.progress}%` }"></i></div><b>{{ detail.row.progress }}% 已完成</b></section><dl><div v-for="field in fields" :key="field.label"><dt>{{ field.label }}</dt><dd><template v-if="Array.isArray(field.value)"><span v-if="!field.value.length">—</span><span v-else class="pm-code-pills"><span v-for="code in field.value" :key="code" class="pm-code-pill">{{ code }}</span></span></template><template v-else>{{ field.value }}</template></dd></div></dl></div><footer><button class="pm-button" @click="$emit('close')">关闭</button></footer></aside></div>
</template>
