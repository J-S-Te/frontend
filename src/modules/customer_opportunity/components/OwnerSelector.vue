<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { listOwnerDirectory } from '../api/ownerDirectory.js'

const props = defineProps({
  userId: { type: String, default: '' },
  organizationId: { type: String, default: '' },
  defaultUserId: { type: String, default: '' },
  defaultOrganizationId: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:userId', 'update:organizationId'])

const keyword = ref('')
const users = ref([])
const loading = ref(false)
const error = ref('')
let loadSequence = 0

const selectedUser = computed(() => users.value.find((item) => item.user_id === props.userId) || null)
const organizations = computed(() => selectedUser.value?.organizations || [])

function errorMessage(value) {
  if (value?.status === 403) return '当前账号没有选择客户或商机负责人的权限。'
  if (value?.code === 'CRM_OWNER_DIRECTORY_UNAVAILABLE' || value?.status === 503) return '基础平台负责人目录尚未配置或暂不可用。'
  return value?.message || '负责人目录加载失败。'
}

function preferredOrganization(user, requestedOrganizationID = '') {
  const organizations = Array.isArray(user?.organizations) ? user.organizations : []
  if (requestedOrganizationID && organizations.some((item) => item.organization_id === requestedOrganizationID)) return requestedOrganizationID
  const primary = organizations.find((item) => item.is_primary)
  return primary?.organization_id || organizations[0]?.organization_id || ''
}

function selectUser(userID, requestedOrganizationID = '') {
  const user = users.value.find((item) => item.user_id === userID)
  emit('update:userId', user?.user_id || '')
  emit('update:organizationId', preferredOrganization(user, requestedOrganizationID))
}

async function load(params, initializeSelection = false) {
  if (props.disabled) return
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const result = await listOwnerDirectory({ ...params, page: 1, page_size: 50 })
    if (sequence !== loadSequence) return
    const loadedUsers = Array.isArray(result?.items) ? result.items : []
    const previousSelection = users.value.find((item) => item.user_id === props.userId)
    users.value = previousSelection && !loadedUsers.some((item) => item.user_id === previousSelection.user_id)
      ? [previousSelection, ...loadedUsers]
      : loadedUsers
    if (initializeSelection) {
      const desiredUserID = props.userId || props.defaultUserId
      const desiredOrganizationID = props.organizationId || (desiredUserID === props.defaultUserId ? props.defaultOrganizationId : '')
      selectUser(desiredUserID, desiredOrganizationID)
    }
  } catch (value) {
    if (sequence !== loadSequence) return
    users.value = []
    error.value = errorMessage(value)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

async function initialize() {
  const desiredUserID = props.userId || props.defaultUserId
  if (desiredUserID) await load({ user_id: desiredUserID }, true)
  else await load({}, false)
}

async function search() {
  await load(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}, false)
}

function onUserChange(event) {
  selectUser(event.target.value, props.organizationId)
}

watch(() => props.userId, async (userID) => {
  if (props.disabled || !userID || users.value.some((item) => item.user_id === userID)) return
  await load({ user_id: userID }, false)
})

onMounted(initialize)
</script>

<template>
  <fieldset class="crm-owner-selector" :disabled="disabled">
    <legend>负责人</legend>
    <div class="crm-owner-search">
      <label>
        查找内部用户
        <input v-model.trim="keyword" type="search" placeholder="姓名或平台用户 ID" @keydown.enter.prevent="search">
      </label>
      <button type="button" :disabled="loading" @click="search">{{ loading ? '查询中…' : '查询' }}</button>
      <button v-if="error" type="button" :disabled="loading" @click="initialize">重试</button>
    </div>
    <p v-if="error" class="crm-alert error" role="alert">{{ error }}</p>
    <label>
      负责人用户
      <select :value="userId" :disabled="disabled || loading || Boolean(error)" required @change="onUserChange">
        <option value="">请选择负责人</option>
        <option v-for="user in users" :key="user.user_id" :value="user.user_id">
          {{ user.display_name }}（{{ user.user_id }}）
        </option>
      </select>
    </label>
    <label>
      负责人组织
      <select
        :value="organizationId"
        :disabled="disabled || loading || Boolean(error) || !userId"
        required
        @change="emit('update:organizationId', $event.target.value)"
      >
        <option value="">请选择负责人组织</option>
        <option v-for="organization in organizations" :key="organization.organization_id" :value="organization.organization_id">
          {{ organization.organization_name }}{{ organization.is_primary ? '（主组织）' : '' }}
        </option>
      </select>
    </label>
    <p class="crm-note">用户 ID 使用基础平台 OIDC sub；组织必须是该用户当前有效的成员组织。</p>
  </fieldset>
</template>
