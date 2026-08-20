<script setup>
import { computed, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  displayMembershipType,
  displayMembershipValidity,
} from '@/modules/platform/iam/utils/iamPresentation'
import {
  groupMembershipsByOrganization,
  membershipId,
} from '@/modules/platform/iam/utils/membershipGroups'

const props = defineProps({
  memberships: { type: Array, default: () => [] },
  organizations: { type: Array, default: () => [] },
  keyword: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['detail'])
const collapsedIds = ref(new Set())
const initialized = ref(false)
const membershipDisplayLimits = ref({})
const defaultMembershipDisplayLimit = 20

const groups = computed(() => groupMembershipsByOrganization(props.memberships, props.organizations, props.keyword))
const allGroups = computed(() => groupMembershipsByOrganization(props.memberships, props.organizations))
const groupIds = computed(() => new Set(allGroups.value.map((group) => group.organization_id)))
const effectiveCollapsedIds = computed(() => String(props.keyword || '').trim() ? new Set() : collapsedIds.value)

watch(groupIds, (currentIds) => {
  if (!initialized.value && currentIds.size) {
    // 首次只展开前两个组织，避免组织较多时任职页面再次退化为超长平铺列表。
    collapsedIds.value = new Set([...currentIds].slice(2))
    initialized.value = true
    return
  }
  collapsedIds.value = new Set([...collapsedIds.value].filter((id) => currentIds.has(id)))
}, { immediate: true })

function toggleGroup(group) {
  const next = new Set(collapsedIds.value)
  if (next.has(group.organization_id)) next.delete(group.organization_id)
  else next.add(group.organization_id)
  collapsedIds.value = next
}

function expandAll() {
  collapsedIds.value = new Set()
}

function collapseAll() {
  collapsedIds.value = new Set(groupIds.value)
}

function userName(membership) {
  return membership?.user?.name || membership?.user?.display_name || membership?.user?.id || '用户信息不可见'
}

function positionName(membership) {
  return membership?.position?.name || membership?.position?.id || '岗位信息不可见'
}

function displayedMemberships(group) {
  return group.memberships.slice(0, membershipDisplayLimits.value[group.organization_id] || defaultMembershipDisplayLimit)
}

function canShowMoreMemberships(group) {
  return group.memberships.length > displayedMemberships(group).length
}

function showMoreMemberships(group) {
  membershipDisplayLimits.value = {
    ...membershipDisplayLimits.value,
    [group.organization_id]: (membershipDisplayLimits.value[group.organization_id] || defaultMembershipDisplayLimit) + defaultMembershipDisplayLimit,
  }
}
</script>

<template>
  <section class="iam-membership-groups-card" aria-label="按组织归类展示任职关系">
    <header class="iam-membership-groups-toolbar">
      <div>
        <p>任职目录</p><strong>任职组织分组</strong>
        <span>{{ allGroups.length }} 个组织 · {{ memberships.length }} 条任职关系</span>
      </div>
      <div class="iam-tree-toolbar-metrics"><span><b>{{ groups.length }}</b> 个当前分组</span><span><b>{{ memberships.length }}</b> 条有效任职</span></div>
      <div class="iam-membership-groups-toolbar-actions">
        <button class="console-button ghost small" type="button" :disabled="loading || !groupIds.size" @click="expandAll">全部展开</button>
        <button class="console-button ghost small" type="button" :disabled="loading || !groupIds.size" @click="collapseAll">全部收起</button>
      </div>
    </header>

    <p v-if="loading" class="iam-membership-groups-empty">正在读取完整任职关系…</p>
    <p v-else-if="!groups.length" class="iam-membership-groups-empty">{{ keyword ? '没有匹配的用户、组织或岗位。' : '暂无任职关系。' }}</p>

    <div v-else class="iam-membership-groups">
      <section
        v-for="group in groups"
        :key="group.organization_id"
        class="iam-membership-group"
        :class="{ 'is-unresolved': group.unresolved }"
      >
        <button
          class="iam-membership-group-head"
          type="button"
          :aria-expanded="!effectiveCollapsedIds.has(group.organization_id)"
          @click="toggleGroup(group)"
        >
          <span class="iam-membership-group-chevron" :class="{ 'is-expanded': !effectiveCollapsedIds.has(group.organization_id) }"><ConsoleIcon name="chevron" /></span>
          <span class="iam-membership-group-icon"><ConsoleIcon :name="group.unresolved ? 'info' : 'organization'" /></span>
          <span class="iam-membership-group-name">
            <strong>{{ group.organization_name }}</strong>
            <small>{{ group.organization_path }}<template v-if="group.organization_code"> · {{ group.organization_code }}</template></small>
          </span>
          <span class="iam-membership-group-count">{{ group.memberships.length }} 人次</span>
        </button>

        <div v-if="!effectiveCollapsedIds.has(group.organization_id)" class="iam-membership-group-body">
          <article v-for="membership in displayedMemberships(group)" :key="membershipId(membership)" class="iam-membership-group-row">
            <div class="iam-membership-person">
              <span class="iam-membership-person-icon"><ConsoleIcon name="user" /></span>
              <span><strong :title="userName(membership)">{{ userName(membership) }}</strong><small class="iam-membership-user-id" :title="membership.user?.id || ''">{{ membership.user?.id || '暂无用户 ID' }}</small></span>
            </div>
            <div class="iam-membership-position"><small>岗位</small><strong>{{ positionName(membership) }}</strong></div>
            <span class="iam-membership-type" :class="membership.membership_type === 'PRIMARY' ? 'is-primary' : 'is-secondary'">{{ displayMembershipType(membership.membership_type) }}</span>
            <span class="console-badge" :class="membership.inherit_authorization === false ? 'status-disabled' : 'status-active'">{{ membership.inherit_authorization === false ? '不继承岗位授权' : '继承岗位授权' }}</span>
            <div class="iam-membership-validity"><small>有效期</small><strong>{{ displayMembershipValidity(membership) }}</strong></div>
            <div class="iam-membership-group-actions"><button class="console-text-button" type="button" @click="emit('detail', membership)">详情</button></div>
          </article>
          <button v-if="canShowMoreMemberships(group)" class="iam-group-load-more" type="button" @click="showMoreMemberships(group)">显示更多任职（还有 {{ group.memberships.length - displayedMemberships(group).length }} 条）</button>
        </div>
      </section>
    </div>
  </section>
</template>
