<script setup>
// 组织目录面板：组织列表筛选行、服务端分页受限提示与组织树。
// 批次 2 第三步自 IamSettingsModule.vue 逐字迁移；DOM 由快照测试对提取前 golden 逐字节锁定。
import OrgUnitTree from '@/modules/platform/iam/components/OrgUnitTree.vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'

defineProps({
  organizations: { type: Array, default: () => [] },
  filteredOrganizations: { type: Array, default: () => [] },
  panelFilters: { type: Object, required: true },
  pagination: { type: Object, required: true },
  loading: { type: Object, required: true },
  deletingOrganizationId: { type: String, default: '' },
  canCreate: { type: Boolean, default: false },
  canUpdate: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
})

defineEmits(['copy-id', 'create-child', 'detail', 'edit', 'remove'])
</script>

<template>
  <section class="iam-table-section iam-organizations-panel">
    <div class="iam-filter-row"><label class="console-search-field"><ConsoleIcon name="search" /><input v-model="panelFilters.organizations" type="search" placeholder="搜索组织名称或编码"  maxlength="100"/></label><span>{{ filteredOrganizations.length }} / 共 {{ pagination.organizations.total }} 个组织</span></div>
    <p v-if="pagination.organizations.serverPagingSupported === false" class="iam-server-limit-note">未能读取全部组织数据，当前树可能不完整。请检查组织列表接口是否能继续翻页。</p>
    <OrgUnitTree
      :organizations="organizations"
      :keyword="panelFilters.organizations"
      :loading="loading.organizations"
      :can-create="canCreate"
      :can-update="canUpdate"
      :can-delete="canDelete"
      :deleting-id="deletingOrganizationId"
@copy-id="(item) => $emit('copy-id', item)"
@create-child="$emit('create-child', $event)"
@detail="(item) => $emit('detail', item)"
@edit="$emit('edit', $event)"
@remove="$emit('remove', $event)"
    />
  </section>
</template>
