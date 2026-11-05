<script setup>
import { computed, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ListState from '@/modules/shared/components/ListState.vue'
import {
  buildOrganizationTree,
  filterOrganizationTree,
  flattenOrganizationTree,
} from '@/modules/platform/iam/utils/organizationTree'
import { displayStatus } from '@/modules/platform/iam/utils/iamPresentation'

const props = defineProps({
  organizations: { type: Array, default: () => [] },
  keyword: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  // 组织目录读取失败原因：交给 ListState 渲染可重试的错误态，不能退化成「暂无组织记录」。
  error: { type: [String, Object, Error], default: '' },
  canCreate: { type: Boolean, default: false },
  canUpdate: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  deletingId: { type: String, default: '' },
})

const emit = defineEmits(['copy-id', 'create-child', 'detail', 'edit', 'remove', 'retry'])

const collapsedIds = ref(new Set())
const initialized = ref(false)
const treeElement = ref(null)

function organizationId(organization) {
  return String(organization?.org_unit_id || organization?.id || '').trim()
}

const completeTree = computed(() => buildOrganizationTree(props.organizations))
const displayedTree = computed(() => filterOrganizationTree(completeTree.value, props.keyword))
const effectiveCollapsedIds = computed(() => String(props.keyword || '').trim() ? new Set() : collapsedIds.value)
const visibleNodes = computed(() => flattenOrganizationTree(displayedTree.value, effectiveCollapsedIds.value))
// 三态闸门：加载中 > 读取失败（可重试）> 空。失败必须排在空之前，否则失败的组织目录
// 会被渲染成「暂无组织记录」，用户会以为组织被清空而不是请求失败。
const treeListState = computed(() => props.loading || Boolean(props.error) || !visibleNodes.value.length)
const emptyTitle = computed(() => (String(props.keyword || '').trim() ? '没有匹配的组织单元。' : '暂无组织记录。'))
const activeOrganizationCount = computed(() => props.organizations.filter((item) => String(item?.status || '').toUpperCase() === 'ACTIVE').length)
const organizationById = computed(() => new Map(props.organizations.map((item) => [organizationId(item), item])))
const branchIds = computed(() => new Set(
  flattenOrganizationTree(completeTree.value)
    .filter((item) => item.hasChildren)
    .map(organizationId),
))

watch(branchIds, (currentBranchIds) => {
  if (!initialized.value && currentBranchIds.size) {
    // 根与第一级默认展开；更深的分支先收起，避免大型组织首次打开过长。
    collapsedIds.value = new Set(
      flattenOrganizationTree(completeTree.value)
        .filter((item) => item.hasChildren && item.depth >= 2)
        .map(organizationId),
    )
    initialized.value = true
    return
  }
  collapsedIds.value = new Set([...collapsedIds.value].filter((id) => currentBranchIds.has(id)))
}, { immediate: true })

function toggleNode(item) {
  const id = organizationId(item)
  if (!item.hasChildren || !id) return
  const next = new Set(collapsedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedIds.value = next
}

function expandAll() {
  collapsedIds.value = new Set()
}

function collapseAll() {
  collapsedIds.value = new Set(branchIds.value)
}

function parentName(item) {
  const parentId = String(item?.parent_id || '').trim()
  if (!parentId) return '根组织'
  return organizationById.value.get(parentId)?.name || '上级组织不可见'
}

function focusVisibleNode(index) {
  const nodes = treeElement.value?.querySelectorAll('[data-organization-tree-node]') || []
  nodes[Math.min(Math.max(index, 0), nodes.length - 1)]?.focus()
}

function handleNodeKeydown(event, item, index) {
  if (event.target !== event.currentTarget) return
  const id = organizationId(item)
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusVisibleNode(index + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusVisibleNode(index - 1)
  } else if (event.key === 'ArrowRight' && item.hasChildren) {
    event.preventDefault()
    if (collapsedIds.value.has(id)) toggleNode(item)
    else focusVisibleNode(index + 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (item.hasChildren && !collapsedIds.value.has(id)) toggleNode(item)
    else {
      const parentIndex = visibleNodes.value.findIndex((candidate) => organizationId(candidate) === item.parent_id)
      if (parentIndex >= 0) focusVisibleNode(parentIndex)
    }
  } else if (event.key === 'Enter') {
    event.preventDefault()
    emit('detail', item)
  }
}
</script>

<template>
  <section class="iam-organization-tree-card" aria-label="组织架构">
    <header class="iam-organization-tree-toolbar">
      <div>
        <p>组织目录</p><strong>组织架构树</strong>
        <span>同一上级下按显示顺序由小到大排列</span>
      </div>
      <div class="iam-tree-toolbar-metrics"><span><b>{{ activeOrganizationCount }}</b> 个有效组织</span><span><b>{{ visibleNodes.length }}</b> 个当前可见</span></div>
      <div class="iam-organization-tree-toolbar-actions">
        <button class="console-button ghost small" type="button" :disabled="loading || !branchIds.size" @click="expandAll">全部展开</button>
        <button class="console-button ghost small" type="button" :disabled="loading || !branchIds.size" @click="collapseAll">全部收起</button>
      </div>
    </header>

    <div ref="treeElement" class="iam-organization-tree" role="tree" aria-label="组织单元树">
      <ListState
        v-if="treeListState"
        :loading="loading"
        :error="error"
        error-title="组织目录加载失败"
        loading-title="正在读取完整组织架构…"
        :empty-title="emptyTitle"
        compact
        @retry="emit('retry')"
      />
      <template v-else>
        <article
          v-for="(item, index) in visibleNodes"
          :key="organizationId(item)"
          class="iam-organization-tree-row"
          :class="{ 'is-child': item.depth > 0 }"
          :style="{ '--tree-depth': item.depth }"
          role="treeitem"
          :aria-level="item.depth + 1"
          :aria-expanded="item.hasChildren ? !effectiveCollapsedIds.has(organizationId(item)) : undefined"
          tabindex="0"
          data-organization-tree-node
          @keydown="handleNodeKeydown($event, item, index)"
        >
          <div class="iam-organization-tree-identity">
            <button
              v-if="item.hasChildren"
              class="iam-organization-tree-toggle"
              :class="{ 'is-expanded': !effectiveCollapsedIds.has(organizationId(item)) }"
              type="button"
              :aria-label="`${effectiveCollapsedIds.has(organizationId(item)) ? '展开' : '收起'}${item.name}`"
              @click="toggleNode(item)"
            ><ConsoleIcon name="chevron" /></button>
            <span v-else class="iam-organization-tree-toggle-spacer" aria-hidden="true"></span>
            <span class="iam-organization-tree-icon"><ConsoleIcon name="organization" /></span>
            <span class="iam-organization-tree-name">
              <strong>{{ item.name }}</strong>
              <small>{{ item.code || '暂无编码' }}</small>
            </span>
          </div>

          <div class="iam-organization-tree-meta">
            <span><small>上级组织</small><strong>{{ parentName(item) }}</strong></span>
            <span><small>显示顺序</small><strong>{{ item.sort_order ?? 0 }}</strong></span>
            <span v-if="item.hasChildren"><small>直属下级</small><strong>{{ item.children.length }} 个</strong></span>
            <span class="console-badge" :class="(item.status || '').toUpperCase() === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span>
          </div>

          <div class="iam-organization-tree-actions">
            <button class="console-text-button" type="button" @click="emit('detail', item)">详情</button>
            <button class="console-text-button" type="button" :title="`复制组织 ID：${organizationId(item)}`" @click="emit('copy-id', item)">复制 ID</button>
            <button v-if="canCreate" class="console-text-button" type="button" @click="emit('create-child', item)">新增下级</button>
            <button v-if="canUpdate" class="console-text-button" type="button" @click="emit('edit', item)">编辑</button>
            <button v-if="canDelete" class="console-text-button danger" type="button" :disabled="deletingId === organizationId(item)" @click="emit('remove', item)">{{ deletingId === organizationId(item) ? '删除中…' : '删除' }}</button>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>
