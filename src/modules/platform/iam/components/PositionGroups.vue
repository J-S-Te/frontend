<script setup>
import { computed, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { displayStatus } from '@/modules/platform/iam/utils/iamPresentation'
import {
  buildPositionOrganizationTree,
  flattenPositionOrganizationTree,
  isPositionOrganizationNodeExpanded,
  visiblePositionsForOrganizationNode,
} from '@/modules/platform/iam/utils/positionGroups'

const props = defineProps({
  positions: { type: Array, default: () => [] },
  organizations: { type: Array, default: () => [] },
  keyword: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  canCreate: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  deletingId: { type: String, default: '' },
})

const emit = defineEmits(['create', 'detail', 'remove'])
const collapsedIds = ref(new Set())
const initialized = ref(false)

const completeTree = computed(() => buildPositionOrganizationTree(props.positions, props.organizations))
const displayedTree = computed(() => buildPositionOrganizationTree(props.positions, props.organizations, props.keyword))
const effectiveCollapsedIds = computed(() => String(props.keyword || '').trim() ? new Set() : collapsedIds.value)
const visibleNodes = computed(() => flattenPositionOrganizationTree(displayedTree.value, effectiveCollapsedIds.value))
const branchIds = computed(() => new Set(
  flattenPositionOrganizationTree(completeTree.value)
    .filter((node) => node.hasExpandableContent)
    .map((node) => node.organization_id),
))
const organizationCount = computed(() => flattenPositionOrganizationTree(completeTree.value).filter((node) => !node.unresolved).length)

watch(branchIds, (currentBranchIds) => {
  if (!initialized.value && currentBranchIds.size) {
    // 与组织单元树保持一致：根和第一级默认展开，更深分支按需展开。
    collapsedIds.value = new Set(
      flattenPositionOrganizationTree(completeTree.value)
        .filter((node) => node.hasExpandableContent && node.organization_depth >= 2)
        .map((node) => node.organization_id),
    )
    initialized.value = true
    return
  }
  collapsedIds.value = new Set([...collapsedIds.value].filter((id) => currentBranchIds.has(id)))
}, { immediate: true })

function positionId(position) {
  return String(position?.position_id || position?.id || '')
}

function toggleNode(node) {
  if (!node.hasExpandableContent) return
  const next = new Set(collapsedIds.value)
  if (next.has(node.organization_id)) next.delete(node.organization_id)
  else next.add(node.organization_id)
  collapsedIds.value = next
}

function expandAll() {
  collapsedIds.value = new Set()
}

function collapseAll() {
  collapsedIds.value = new Set(branchIds.value)
}

function isExpanded(node) {
  return isPositionOrganizationNodeExpanded(node, effectiveCollapsedIds.value)
}

function visiblePositions(node) {
  return visiblePositionsForOrganizationNode(node, effectiveCollapsedIds.value)
}
</script>

<template>
  <section class="iam-position-groups-card" aria-label="按组织架构展示岗位">
    <header class="iam-position-groups-toolbar">
      <div>
        <strong>岗位组织树</strong>
        <span>与组织单元层级一致 · {{ organizationCount }} 个组织</span>
      </div>
      <div class="iam-position-groups-toolbar-actions">
        <button class="console-button ghost small" type="button" :disabled="loading || !branchIds.size" @click="expandAll">全部展开</button>
        <button class="console-button ghost small" type="button" :disabled="loading || !branchIds.size" @click="collapseAll">全部收起</button>
      </div>
    </header>

    <p v-if="loading" class="iam-position-groups-empty">正在读取组织架构与岗位…</p>
    <p v-else-if="!visibleNodes.length" class="iam-position-groups-empty">{{ keyword ? '没有匹配的岗位或组织。' : '暂无组织和岗位记录。' }}</p>

    <div v-else class="iam-position-tree" role="tree" aria-label="岗位所属组织树">
      <section
        v-for="node in visibleNodes"
        :key="node.organization_id"
        class="iam-position-tree-node"
        :class="{ 'is-unresolved': node.unresolved }"
        :style="{ '--tree-depth': node.organization_depth }"
        role="treeitem"
        :aria-level="node.organization_depth + 1"
        :aria-expanded="node.hasExpandableContent ? isExpanded(node) : undefined"
      >
        <header class="iam-position-group-head">
          <button
            v-if="node.hasExpandableContent"
            class="iam-position-group-chevron"
            :class="{ 'is-expanded': isExpanded(node) }"
            type="button"
            :aria-label="`${isExpanded(node) ? '收起' : '展开'}${node.organization_name}`"
            @click="toggleNode(node)"
          ><ConsoleIcon name="chevron" /></button>
          <span v-else class="iam-position-group-chevron-spacer" aria-hidden="true"></span>
          <span class="iam-position-group-icon"><ConsoleIcon :name="node.unresolved ? 'info' : 'organization'" /></span>
          <span class="iam-position-group-name">
            <strong>{{ node.organization_name }}</strong>
            <small>{{ node.unresolved ? '岗位关联的组织不存在或当前不可见' : node.organization_path }}</small>
          </span>
          <span class="iam-position-group-count">
            {{ node.direct_position_count }} 个直属岗位<span v-if="node.descendant_position_count !== node.direct_position_count"> · 含下级 {{ node.descendant_position_count }} 个</span>
          </span>
        </header>

        <div v-if="visiblePositions(node).length" class="iam-position-group-body">
          <article v-for="position in visiblePositions(node)" :key="positionId(position)" class="iam-position-group-row">
            <div class="iam-position-group-identity">
              <span class="iam-position-group-role-icon"><ConsoleIcon name="role" /></span>
              <span><strong>{{ position.name }}</strong><small>{{ position.code || '暂无岗位编码' }}</small></span>
            </div>
            <span class="console-badge" :class="(position.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(position.status) }}</span>
            <div class="iam-position-group-actions">
              <button class="console-text-button" type="button" @click="emit('detail', position)">详情</button>
              <button v-if="canDelete" class="console-text-button danger" type="button" :disabled="deletingId === positionId(position)" @click="emit('remove', position)">{{ deletingId === positionId(position) ? '删除中…' : '删除' }}</button>
            </div>
          </article>
        </div>

        <button v-if="canCreate && !node.unresolved && (!node.hasExpandableContent || isExpanded(node))" class="iam-position-group-create" type="button" @click="emit('create', node)">+ 在“{{ node.organization_name }}”下新增岗位</button>
      </section>
    </div>
  </section>
</template>
