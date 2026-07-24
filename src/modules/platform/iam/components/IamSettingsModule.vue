<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  listAccounts,
  listOrgUnits,
  listPermissions,
  listRoleBindings,
  listRoles,
  listUsers,
} from '@/modules/platform/iam/api/iam.js'
import '@/modules/platform/iam/styles/iam-settings.css'

const emit = defineEmits(['toast'])

const activePanel = ref('users')
const detail = ref(null)
const editor = ref(null)
const loading = ref(false)
const errorMessage = ref('')
const lastLoadedAt = ref('')

const filters = reactive({
  user: '',
  account: '',
  organization: '',
  role: '',
  binding: '',
  permission: '',
})
const form = reactive({})

// ---- 数据容器（API 拉取）----
const users = ref([])
const accounts = ref([])
const organizations = ref([])
const roles = ref([])
const bindings = ref([])
const permissions = ref([])
const userById = computed(() => new Map(users.value.map((item) => [item.user_id, item])))
const orgById = computed(() => new Map(organizations.value.map((item) => [item.org_unit_id, item])))

const panels = [
  { key: 'users', label: '用户', icon: 'user', description: '自然人主体、任职状态与跨系统统一用户标识' },
  { key: 'accounts', label: '登录账号', icon: 'account', description: '账号状态、认证来源与外部身份绑定' },
  { key: 'organizations', label: '组织与任职', icon: 'organization', description: '组织单元、主组织、兼岗和历史任职关系' },
  { key: 'roles', label: '角色', icon: 'role', description: '平台角色、应用角色、自定义角色与权限集合' },
  { key: 'bindings', label: '角色绑定', icon: 'link', description: '主体、应用范围、数据范围和有效期授权' },
  { key: 'permissions', label: '权限注册', icon: 'shield', description: '以 application:resource:action 统一登记原子权限' },
]

// ---- 拉取所有面板数据 ----
async function loadAll() {
  loading.value = true
  errorMessage.value = ''
  try {
    // 并行拉取，单独 try/catch 保证部分失败时其它仍可显示
    const settled = await Promise.allSettled([
      listUsers({ page: 1, page_size: 200 }),
      listAccounts({ page: 1, page_size: 200 }),
      listOrgUnits({ page: 1, page_size: 200 }),
      listRoles({ page: 1, page_size: 200 }),
      listRoleBindings({ page: 1, page_size: 200 }),
      listPermissions({ page: 1, page_size: 200 }),
    ])
    const [u, a, o, r, b, p] = settled
    if (u.status === 'fulfilled') users.value = u.value
    if (a.status === 'fulfilled') accounts.value = a.value
    if (o.status === 'fulfilled') organizations.value = o.value
    if (r.status === 'fulfilled') roles.value = r.value
    if (b.status === 'fulfilled') bindings.value = b.value
    if (p.status === 'fulfilled') permissions.value = p.value
    const failed = settled.filter((s) => s.status === 'rejected')
    if (failed.length) {
      errorMessage.value = failed
        .map((s) => s.reason?.message || '加载失败')
        .join('；')
    }
    lastLoadedAt.value = new Date().toLocaleString('zh-CN')
    if (!failed.length) emitToast('身份与授权数据已从 MySQL 加载完成。')
  } catch (err) {
    errorMessage.value = err?.message || '加载失败'
    emitToast(`加载失败：${errorMessage.value}`)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadAll()
})

// ---- 派生展示（把后端原始字段映射为 UI 期望的形状） ----
function userView(user) {
  const org = orgById.value.get(user.primary_org_id)
  const accountNames = accounts.value
    .filter((acc) => acc.user_id === user.user_id)
    .map((acc) => acc.account_name)
  const userBindings = bindings.value.filter(
    (b) => b.subject_type === 'USER' && b.subject_id === user.user_id && b.status === 'ACTIVE',
  )
  const roleNames = userBindings
    .map((b) => roles.value.find((r) => r.role_id === b.role_id)?.name)
    .filter(Boolean)
  return {
    id: user.user_id,
    displayName: user.display_name,
    legalName: user.display_name,
    employeeNo: user.employee_no || '—',
    primaryOrg: org?.name || '—',
    membershipCount: 1,
    employmentStatus: user.status === 'ACTIVE' ? 'ACTIVE' : 'TERMINATED',
    status: user.status,
    accountCount: accountNames.length,
    accounts: accountNames,
    roles: roleNames,
    lastActiveAt: user.updated_at
      ? new Date(user.updated_at).toLocaleString('zh-CN', { hour12: false })
      : '—',
    memberships: org
      ? [
          {
            organization: org.name,
            type: 'PRIMARY',
            position: user.display_name,
            startedAt: '—',
            endedAt: '—',
            status: 'ACTIVE',
          },
        ]
      : [],
    _raw: user,
  }
}

function accountView(account) {
  const user = userById.value.get(account.user_id)
  return {
    id: account.account_id,
    username: account.account_name,
    user: user?.display_name || '—',
    userId: account.user_id || '',
    accountType: account.account_type || 'HUMAN',
    authSource: account.auth_source || 'LOCAL',
    status: account.status,
    lockedUntil: account.status === 'LOCKED' ? '锁定中' : '—',
    lastLoginAt: account.last_login_at
      ? new Date(account.last_login_at).toLocaleString('zh-CN', { hour12: false })
      : '—',
    identities: [],
    _raw: account,
  }
}

function orgView(org) {
  const parent = org.parent_id ? orgById.value.get(org.parent_id) : null
  return {
    id: org.org_unit_id,
    level: org.depth ? org.depth - 1 : 0,
    code: org.code,
    name: org.name,
    type: org.org_type || 'DEPARTMENT',
    parent: parent?.name || '—',
    manager: '—',
    status: org.status,
    memberCount: 0,
    _raw: org,
  }
}

function roleView(role) {
  const rolePermissions = permissions.value
    .filter((p) => p.code?.startsWith(role.code?.split(':')[0] + ':') || false)
    .slice(0, 5)
    .map((p) => p.code)
  return {
    id: role.role_id,
    code: role.code,
    name: role.name,
    type: role.role_type || 'CUSTOM',
    application: '基础能力平台',
    memberCount: bindings.value.filter(
      (b) => b.role_id === role.role_id && b.status === 'ACTIVE',
    ).length,
    permissionCount: rolePermissions.length,
    status: role.status,
    defaultScope: 'all',
    permissions: rolePermissions,
    _raw: role,
  }
}

function bindingView(binding) {
  const role = roles.value.find((r) => r.role_id === binding.role_id)
  let subject = '—'
  if (binding.subject_type === 'USER') {
    subject = userById.value.get(binding.subject_id)?.display_name || '—'
  } else if (binding.subject_type === 'ORG_UNIT') {
    subject = orgById.value.get(binding.subject_id)?.name || '—'
  } else if (binding.subject_type === 'SERVICE_ACCOUNT') {
    subject =
      accounts.value.find((a) => a.account_id === binding.subject_id)?.account_name || '—'
  }
  const validFrom = binding.valid_from
    ? new Date(binding.valid_from).toLocaleDateString('zh-CN')
    : '—'
  const validUntil = binding.valid_until
    ? new Date(binding.valid_until).toLocaleDateString('zh-CN')
    : '长期有效'
  return {
    id: binding.binding_id,
    subjectType: binding.subject_type,
    subject,
    role: role?.name || '—',
    application: '基础能力平台',
    scope: (binding.scope_type || 'TENANT').toLowerCase(),
    status: binding.status,
    effective: `${validFrom} 至 ${validUntil}`,
    _raw: binding,
  }
}

function permissionView(perm) {
  return {
    id: perm.permission_id,
    code: perm.code,
    name: perm.name,
    application: '基础能力平台',
    resource: perm.code?.split(':')[1] || '',
    action: perm.code?.split(':')[2] || '',
    risk: (perm.risk_level || 'LOW').toUpperCase(),
    status: perm.status,
    description: '由后端 API 返回的权限注册记录。',
    _raw: perm,
  }
}

const panel = computed(() => panels.find((item) => item.key === activePanel.value) || panels[0])
const metrics = computed(() => [
  {
    label: '有效用户',
    value: users.value.filter((item) => item.status === 'ACTIVE').length,
    note: '自然人 User',
    icon: 'user',
    tone: 'blue',
  },
  {
    label: '正常账号',
    value: accounts.value.filter((item) => item.status === 'ACTIVE').length,
    note: 'Account 登录主体',
    icon: 'account',
    tone: 'violet',
  },
  {
    label: '有效角色绑定',
    value: bindings.value.filter((item) => item.status === 'ACTIVE').length,
    note: 'RoleBinding',
    icon: 'link',
    tone: 'green',
  },
  {
    label: '高风险权限',
    value: permissions.value.filter((item) => (item.risk_level || '').toUpperCase() === 'HIGH').length,
    note: '需审计与失败关闭',
    icon: 'shield',
    tone: 'orange',
  },
])

const userRows = computed(() => users.value.map(userView))
const accountRows = computed(() => accounts.value.map(accountView))
const orgRows = computed(() => organizations.value.map(orgView))
const roleRows = computed(() => roles.value.map(roleView))
const bindingRows = computed(() => bindings.value.map(bindingView))
const permissionRows = computed(() => permissions.value.map(permissionView))

const filteredUsers = computed(() =>
  includesFilter(userRows.value, filters.user, ['displayName', 'employeeNo', 'primaryOrg', 'accounts', 'roles']),
)
const filteredAccounts = computed(() =>
  includesFilter(accountRows.value, filters.account, ['username', 'user', 'accountType', 'authSource', 'status']),
)
const filteredOrganizations = computed(() =>
  includesFilter(orgRows.value, filters.organization, ['name', 'code', 'parent', 'manager']),
)
const filteredRoles = computed(() =>
  includesFilter(roleRows.value, filters.role, ['name', 'code', 'application', 'permissions']),
)
const filteredBindings = computed(() =>
  includesFilter(bindingRows.value, filters.binding, ['subject', 'subjectType', 'role', 'application', 'scope']),
)
const filteredPermissions = computed(() =>
  includesFilter(permissionRows.value, filters.permission, ['name', 'code', 'application', 'resource', 'action']),
)

function includesFilter(items, filter, fields) {
  const keyword = filter.trim().toLowerCase()
  if (!keyword) return items
  return items.filter((item) =>
    fields
      .flatMap((field) => (Array.isArray(item[field]) ? item[field] : [item[field]]))
      .join(' ')
      .toLowerCase()
      .includes(keyword),
  )
}

function displayStatus(status) {
  return (
    {
      ACTIVE: '启用',
      DISABLED: '停用',
      LOCKED: '已锁定',
      EXPIRED: '已失效',
      BOUND: '已绑定',
      HISTORICAL: '历史任职',
    }[status] || status
  )
}

function displayRoleType(type) {
  return (
    { PLATFORM: '平台角色', APPLICATION: '应用角色', CUSTOM: '自定义角色' }[type] || type
  )
}

function displaySubjectType(type) {
  return (
    {
      USER: '用户',
      ORG_UNIT: '组织',
      POSITION: '岗位',
      GROUP: '用户组',
      SERVICE_ACCOUNT: '服务账号',
    }[type] || type
  )
}

function displayScope(scope) {
  return (
    {
      all: '全部数据',
      self: '仅本人',
      org: '所属组织',
      org_tree: '所属组织及下级',
      custom_org: '指定组织',
      participant: '参与人相关',
      tenant: '租户',
    }[scope] || scope
  )
}

function displayEmployment(status) {
  return (
    { ACTIVE: '在职', ON_LEAVE: '请假中', TERMINATED: '已离职' }[status] || status
  )
}

function emitToast(message) {
  emit('toast', message)
}

function selectPanel(key) {
  activePanel.value = key
  detail.value = null
}

function openDetail(kind, item) {
  detail.value = { kind, item }
}

function closeDetail() {
  detail.value = null
}

function resetFilters() {
  Object.keys(filters).forEach((key) => {
    filters[key] = ''
  })
  emitToast('已清空当前前端筛选条件。')
}

// 新增/编辑流程仅在前端模拟（后端无对应写接口时保留占位）
function openEditor(kind) {
  editor.value = { kind }
  const templates = {
    user: { displayName: '', employeeNo: '', primaryOrg: '平台运营部', employmentStatus: 'ACTIVE' },
    account: { username: '', user: '', accountType: 'HUMAN', authSource: 'LOCAL', status: 'ACTIVE' },
    organization: { code: '', name: '', type: 'DEPARTMENT', parent: '基础能力平台', manager: '' },
    role: { code: '', name: '', type: 'CUSTOM', application: '基础能力平台', defaultScope: 'self' },
    binding: { subjectType: 'USER', subject: '', role: '', application: '基础能力平台', scope: 'self', effective: '立即生效 至 长期有效' },
    permission: { code: '', name: '', application: '基础能力平台', resource: '', action: '', risk: 'MEDIUM' },
    identity: { provider: 'DINGTALK', subject: '' },
  }
  Object.keys(form).forEach((key) => delete form[key])
  Object.assign(form, templates[kind] || {})
}

function closeEditor() {
  editor.value = null
}

function saveEditor() {
  if (!editor.value) return
  const labels = { user: '用户', account: '账号', organization: '组织', role: '角色', binding: '绑定', permission: '权限', identity: '外部身份' }
  emitToast(`新增${labels[editor.value.kind]}需要调用后端写接口；当前种子数据已通过 SQL 写入 MySQL，可通过刷新按钮重新加载验证。`)
  closeEditor()
}

function toggleStatus(kind, item) {
  emitToast('状态变更需要调用后端写接口；当前仅显示从 MySQL 加载的数据。')
}
</script>

<template>
  <section class="iam-settings" aria-label="身份、组织与授权设置">
    <header class="iam-toolbar">
      <div>
        <h2 class="iam-toolbar-title">身份、组织与授权</h2>
        <p class="iam-toolbar-sub">数据来自基础能力平台 MySQL，最近加载：{{ lastLoadedAt || '尚未加载' }}</p>
      </div>
      <div class="iam-toolbar-actions">
        <button class="console-button ghost small" type="button" :disabled="loading" @click="loadAll">
          <ConsoleIcon name="reset" />{{ loading ? '加载中…' : '刷新数据' }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="iam-error">部分数据加载失败：{{ errorMessage }}</p>

    <div class="iam-summary-grid">
      <article v-for="metric in metrics" :key="metric.label" class="iam-summary-card" :class="metric.tone">
        <span class="iam-summary-icon"><ConsoleIcon :name="metric.icon" /></span>
        <div><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong><p>{{ metric.note }}</p></div>
      </article>
    </div>

    <div class="iam-workspace">
      <aside class="iam-panel-nav" aria-label="身份与授权功能导航">
        <button
          v-for="item in panels"
          :key="item.key"
          type="button"
          :class="{ active: activePanel === item.key }"
          @click="selectPanel(item.key)"
        >
          <ConsoleIcon :name="item.icon" />
          <span>{{ item.label }}</span>
        </button>
      </aside>

      <section class="iam-panel-content">
        <header class="iam-panel-head">
          <div><h3>{{ panel.label }}</h3><p>{{ panel.description }}</p></div>
          <div class="iam-panel-actions">
            <button class="console-button ghost small" type="button" @click="resetFilters"><ConsoleIcon name="reset" />清空筛选</button>
            <button
              class="console-button primary"
              type="button"
              :disabled="loading"
              @click="openEditor(activePanel === 'users' ? 'user' : activePanel === 'accounts' ? 'account' : activePanel === 'organizations' ? 'organization' : activePanel === 'roles' ? 'role' : activePanel === 'bindings' ? 'binding' : 'permission')"
            >
              新增{{ activePanel === 'users' ? '用户' : activePanel === 'accounts' ? '账号' : activePanel === 'organizations' ? '组织' : activePanel === 'roles' ? '角色' : activePanel === 'bindings' ? '绑定' : '权限' }}
            </button>
          </div>
        </header>

        <section v-if="activePanel === 'users'" class="iam-table-section">
          <div class="iam-filter-row">
            <label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.user" type="search" placeholder="姓名 / 工号 / 组织 / 账号 / 角色" /></label>
            <span>展示 {{ filteredUsers.length }} / {{ userRows.length }} 位用户</span>
          </div>
          <div class="console-table-card">
            <div class="console-table-scroll">
              <table class="console-data-table iam-data-table">
                <thead><tr><th>用户</th><th>主组织与任职</th><th>登录账号</th><th>角色</th><th>状态</th><th>最近活动</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="loading && !userRows.length"><td class="console-empty" colspan="7">正在加载…</td></tr>
                  <tr v-else-if="!filteredUsers.length"><td class="console-empty" colspan="7">没有匹配的用户。</td></tr>
                  <tr v-for="item in filteredUsers" :key="item.id">
                    <td><strong class="console-entity-name">{{ item.displayName }}</strong><span class="console-entity-meta console-mono">{{ item.employeeNo }}</span></td>
                    <td><strong>{{ item.primaryOrg }}</strong><span class="console-entity-meta">{{ item.membershipCount }} 条任职 · {{ displayEmployment(item.employmentStatus) }}</span></td>
                    <td>
                      <span v-for="account in item.accounts" :key="account" class="iam-inline-code">{{ account }}</span>
                      <span v-if="!item.accounts.length" class="console-entity-meta">暂无登录账号</span>
                    </td>
                    <td>
                      <span v-for="role in item.roles" :key="role" class="console-role-chip">{{ role }}</span>
                      <span v-if="!item.roles.length" class="console-entity-meta">暂无角色</span>
                    </td>
                    <td><span class="console-badge" :class="item.status === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td>
                    <td class="console-mono">{{ item.lastActiveAt }}</td>
                    <td class="console-actions-cell">
                      <button class="console-text-button" type="button" @click="openDetail('user', item)">详情</button>
                      <button class="console-text-button" type="button" @click="toggleStatus('user', item)">{{ item.status === 'ACTIVE' ? '停用' : '启用' }}</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p class="iam-footnote"><ConsoleIcon name="info" />用户离职或停用后保留历史用户、合同、审批与审计引用，不执行物理删除。</p>
        </section>

        <section v-else-if="activePanel === 'accounts'" class="iam-table-section">
          <div class="iam-filter-row">
            <label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.account" type="search" placeholder="账号 / 用户 / 认证来源 / 状态" /></label>
            <span>展示 {{ filteredAccounts.length }} / {{ accountRows.length }} 个账号</span>
          </div>
          <div class="console-table-card">
            <div class="console-table-scroll">
              <table class="console-data-table iam-data-table">
                <thead><tr><th>登录账号</th><th>关联用户</th><th>账号类型</th><th>认证来源</th><th>外部身份</th><th>状态</th><th>最近登录</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="loading && !accountRows.length"><td class="console-empty" colspan="8">正在加载…</td></tr>
                  <tr v-else-if="!filteredAccounts.length"><td class="console-empty" colspan="8">没有匹配的登录账号。</td></tr>
                  <tr v-for="item in filteredAccounts" :key="item.id">
                    <td><strong class="console-mono">{{ item.username }}</strong><span class="console-entity-meta">{{ item.id }}</span></td>
                    <td>{{ item.user }}</td>
                    <td><span class="iam-type-tag">{{ item.accountType === 'SERVICE' ? '服务账号' : '人类账号' }}</span></td>
                    <td><span class="iam-source-tag">{{ item.authSource }}</span></td>
                    <td><span class="iam-identity-cell"><b>—</b><small>外部身份由 IAM 管理；当前种子未注入绑定</small></span></td>
                    <td><span class="console-badge" :class="item.status === 'ACTIVE' ? 'status-active' : item.status === 'LOCKED' ? 'iam-status-locked' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td>
                    <td class="console-mono">{{ item.lastLoginAt }}</td>
                    <td class="console-actions-cell">
                      <button class="console-text-button" type="button" @click="openDetail('account', item)">详情</button>
                      <button class="console-text-button" type="button" @click="toggleStatus('account', item)">{{ item.status === 'LOCKED' ? '解锁' : item.status === 'ACTIVE' ? '停用' : '启用' }}</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p class="iam-footnote"><ConsoleIcon name="info" />外部身份由 IAM 管理；仅展示脱敏 subject，业务模块不持久化钉钉 unionid、企业微信身份等外部主键。</p>
        </section>

        <section v-else-if="activePanel === 'organizations'" class="iam-table-section">
          <div class="iam-filter-row">
            <label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.organization" type="search" placeholder="组织名称 / 编码 / 上级组织 / 负责人" /></label>
            <span>共 {{ filteredOrganizations.length }} 个组织单元</span>
          </div>
          <div class="console-table-card">
            <div class="console-table-scroll">
              <table class="console-data-table iam-data-table">
                <thead><tr><th>组织结构</th><th>组织编码</th><th>类型</th><th>负责人</th><th>成员数</th><th>状态</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="loading && !orgRows.length"><td class="console-empty" colspan="7">正在加载…</td></tr>
                  <tr v-for="item in filteredOrganizations" :key="item.id">
                    <td>
                      <span class="iam-tree-name" :style="{ paddingLeft: `${item.level * 24}px` }"><i v-if="item.level" />{{ item.name }}</span>
                      <span class="console-entity-meta" :style="{ paddingLeft: `${item.level * 24}px` }">上级：{{ item.parent }}</span>
                    </td>
                    <td class="console-mono">{{ item.code }}</td>
                    <td>{{ item.type === 'COMPANY' ? '主体' : item.type === 'TEAM' ? '团队' : '部门' }}</td>
                    <td>{{ item.manager }}</td>
                    <td>{{ item.memberCount }}</td>
                    <td><span class="console-badge status-active">启用</span></td>
                    <td class="console-actions-cell">
                      <button class="console-text-button" type="button" @click="openDetail('organization', item)">详情</button>
                      <button class="console-text-button" type="button" @click="emitToast('任职关系将通过 Membership 表维护，支持主组织、兼岗和历史任职。')">任职</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p class="iam-footnote"><ConsoleIcon name="info" />主组织是用户快照；真实组织关系以 Membership 为准，因此可表达兼岗、跨部门与历史任职。</p>
        </section>

        <section v-else-if="activePanel === 'roles'" class="iam-table-section">
          <div class="iam-filter-row">
            <label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.role" type="search" placeholder="角色名称 / 编码 / 应用 / 权限" /></label>
            <span>展示 {{ filteredRoles.length }} / {{ roleRows.length }} 个角色</span>
          </div>
          <div class="console-table-card">
            <div class="console-table-scroll">
              <table class="console-data-table iam-data-table">
                <thead><tr><th>角色</th><th>角色类型</th><th>应用范围</th><th>默认数据范围</th><th>权限</th><th>已绑定主体</th><th>状态</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="loading && !roleRows.length"><td class="console-empty" colspan="8">正在加载…</td></tr>
                  <tr v-else-if="!filteredRoles.length"><td class="console-empty" colspan="8">没有匹配的角色。</td></tr>
                  <tr v-for="item in filteredRoles" :key="item.id">
                    <td><strong class="console-entity-name">{{ item.name }}</strong><span class="console-entity-meta console-mono">{{ item.code }}</span></td>
                    <td><span class="console-role-type" :class="`role-${displayRoleType(item.type)}`">{{ displayRoleType(item.type) }}</span></td>
                    <td>{{ item.application }}</td>
                    <td>{{ displayScope(item.defaultScope) }}</td>
                    <td>
                      <span class="iam-permission-count">{{ item.permissionCount }} 项</span>
                      <span class="console-entity-meta">{{ item.permissions.slice(0, 2).join(' · ') }}{{ item.permissions.length > 2 ? ' …' : '' }}</span>
                    </td>
                    <td>{{ item.memberCount }}</td>
                    <td><span class="console-badge" :class="item.status === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td>
                    <td class="console-actions-cell">
                      <button class="console-text-button" type="button" @click="openDetail('role', item)">授权详情</button>
                      <button class="console-text-button" type="button" @click="toggleStatus('role', item)">{{ item.status === 'ACTIVE' ? '停用' : '启用' }}</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p class="iam-footnote"><ConsoleIcon name="info" />角色表达权限集合；对某一具体主体的应用范围、数据范围和有效期，应配置在角色绑定中。</p>
        </section>

        <section v-else-if="activePanel === 'bindings'" class="iam-table-section">
          <div class="iam-filter-row">
            <label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.binding" type="search" placeholder="主体 / 角色 / 应用 / 数据范围" /></label>
            <span>展示 {{ filteredBindings.length }} / {{ bindingRows.length }} 条绑定</span>
          </div>
          <div class="console-table-card">
            <div class="console-table-scroll">
              <table class="console-data-table iam-data-table">
                <thead><tr><th>授权主体</th><th>角色</th><th>应用范围</th><th>数据范围</th><th>有效期</th><th>状态</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="loading && !bindingRows.length"><td class="console-empty" colspan="7">正在加载…</td></tr>
                  <tr v-else-if="!filteredBindings.length"><td class="console-empty" colspan="7">没有匹配的角色绑定。</td></tr>
                  <tr v-for="item in filteredBindings" :key="item.id">
                    <td><strong>{{ item.subject }}</strong><span class="console-entity-meta">{{ displaySubjectType(item.subjectType) }}</span></td>
                    <td>{{ item.role }}</td>
                    <td>{{ item.application }}</td>
                    <td><span class="iam-scope-tag">{{ displayScope(item.scope) }}</span></td>
                    <td class="console-mono">{{ item.effective }}</td>
                    <td><span class="console-badge" :class="item.status === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ displayStatus(item.status) }}</span></td>
                    <td class="console-actions-cell">
                      <button class="console-text-button" type="button" @click="openDetail('binding', item)">详情</button>
                      <button class="console-text-button" type="button" @click="toggleStatus('binding', item)">{{ item.status === 'ACTIVE' ? '停用' : '启用' }}</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p class="iam-footnote"><ConsoleIcon name="info" />支持用户、组织、岗位、用户组、服务账号等主体类型；授权检查需综合范围、有效期与数据策略决策。</p>
        </section>

        <section v-else class="iam-table-section">
          <div class="iam-filter-row">
            <label class="console-search-field"><ConsoleIcon name="search" /><input v-model="filters.permission" type="search" placeholder="权限编码 / 名称 / 应用 / 资源 / 动作" /></label>
            <span>展示 {{ filteredPermissions.length }} / {{ permissionRows.length }} 项权限</span>
          </div>
          <div class="console-table-card">
            <div class="console-table-scroll">
              <table class="console-data-table iam-data-table">
                <thead><tr><th>权限编码</th><th>权限名称</th><th>应用</th><th>资源 / 动作</th><th>风险等级</th><th>状态</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="loading && !permissionRows.length"><td class="console-empty" colspan="7">正在加载…</td></tr>
                  <tr v-else-if="!filteredPermissions.length"><td class="console-empty" colspan="7">没有匹配的权限。</td></tr>
                  <tr v-for="item in filteredPermissions" :key="item.id">
                    <td><code class="iam-permission-code">{{ item.code }}</code></td>
                    <td><strong>{{ item.name }}</strong><span class="console-entity-meta">{{ item.description }}</span></td>
                    <td>{{ item.application }}</td>
                    <td><span class="iam-inline-code">{{ item.resource }}</span><span class="iam-arrow">/</span><span class="iam-inline-code">{{ item.action }}</span></td>
                    <td><span class="iam-risk" :class="item.risk.toLowerCase()">{{ item.risk === 'HIGH' ? '高' : item.risk === 'MEDIUM' ? '中' : '低' }}</span></td>
                    <td><span class="console-badge status-active">启用</span></td>
                    <td class="console-actions-cell"><button class="console-text-button" type="button" @click="openDetail('permission', item)">详情</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p class="iam-footnote"><ConsoleIcon name="info" />权限表示业务原子能力，不以 URL 作为权限编码；多个 API 可映射到同一权限。</p>
        </section>
      </section>
    </div>

    <div v-if="detail" class="iam-modal-backdrop" role="presentation" @click.self="closeDetail">
      <section class="iam-modal" role="dialog" aria-modal="true" aria-label="身份授权详情">
        <header>
          <div>
            <p>{{ detail.kind === 'user' ? '用户与任职' : detail.kind === 'account' ? '登录账号与外部身份' : detail.kind === 'organization' ? '组织单元' : detail.kind === 'role' ? '角色与权限' : detail.kind === 'binding' ? '角色绑定' : '权限注册' }}</p>
            <h3>{{ detail.kind === 'user' ? detail.item.displayName : detail.kind === 'account' ? detail.item.username : detail.kind === 'organization' ? detail.item.name : detail.kind === 'role' ? detail.item.name : detail.kind === 'binding' ? detail.item.subject : detail.item.name }}</h3>
          </div>
          <button class="console-modal-close" type="button" aria-label="关闭详情" @click="closeDetail"><ConsoleIcon name="close" /></button>
        </header>

        <template v-if="detail.kind === 'user'">
          <div class="iam-detail-grid">
            <div><span>统一用户 ID</span><strong class="console-mono">{{ detail.item.id }}</strong></div>
            <div><span>员工编号</span><strong>{{ detail.item.employeeNo }}</strong></div>
            <div><span>主组织快照</span><strong>{{ detail.item.primaryOrg }}</strong></div>
            <div><span>任职状态</span><strong>{{ displayEmployment(detail.item.employmentStatus) }}</strong></div>
            <div><span>用户状态</span><strong>{{ displayStatus(detail.item.status) }}</strong></div>
            <div><span>关联账号</span><strong>{{ detail.item.accountCount }} 个</strong></div>
          </div>
          <section class="iam-detail-section">
            <h4>角色摘要</h4>
            <span v-for="role in detail.item.roles" :key="role" class="console-role-chip large">{{ role }}</span>
            <span v-if="!detail.item.roles.length" class="console-entity-meta">暂未分配角色</span>
          </section>
        </template>

        <template v-else-if="detail.kind === 'account'">
          <div class="iam-detail-grid">
            <div><span>账号 ID</span><strong class="console-mono">{{ detail.item.id }}</strong></div>
            <div><span>关联用户</span><strong>{{ detail.item.user }}</strong></div>
            <div><span>账号类型</span><strong>{{ detail.item.accountType === 'SERVICE' ? '服务账号' : '人类账号' }}</strong></div>
            <div><span>认证来源</span><strong>{{ detail.item.authSource }}</strong></div>
            <div><span>账号状态</span><strong>{{ displayStatus(detail.item.status) }}</strong></div>
            <div><span>最近登录</span><strong class="console-mono">{{ detail.item.lastLoginAt }}</strong></div>
          </div>
          <section class="iam-detail-section">
            <h4>ExternalIdentity 外部身份</h4>
            <p>当前账号未绑定外部身份。</p>
          </section>
        </template>

        <template v-else-if="detail.kind === 'organization'">
          <div class="iam-detail-grid">
            <div><span>组织 ID</span><strong class="console-mono">{{ detail.item.id }}</strong></div>
            <div><span>组织编码</span><strong class="console-mono">{{ detail.item.code }}</strong></div>
            <div><span>组织类型</span><strong>{{ detail.item.type }}</strong></div>
            <div><span>上级组织</span><strong>{{ detail.item.parent }}</strong></div>
            <div><span>负责人</span><strong>{{ detail.item.manager }}</strong></div>
            <div><span>状态</span><strong>{{ displayStatus(detail.item.status) }}</strong></div>
          </div>
          <section class="iam-detail-section">
            <h4>组织关系说明</h4>
            <p>组织单元只描述结构；用户任职关系通过 Membership 表维护，从而支持主组织、兼岗和历史任职。</p>
          </section>
        </template>

        <template v-else-if="detail.kind === 'role'">
          <div class="iam-detail-grid">
            <div><span>角色编码</span><strong class="console-mono">{{ detail.item.code }}</strong></div>
            <div><span>角色类型</span><strong>{{ displayRoleType(detail.item.type) }}</strong></div>
            <div><span>应用范围</span><strong>{{ detail.item.application }}</strong></div>
            <div><span>默认数据范围</span><strong>{{ displayScope(detail.item.defaultScope) }}</strong></div>
            <div><span>已绑定主体</span><strong>{{ detail.item.memberCount }} 个</strong></div>
            <div><span>状态</span><strong>{{ displayStatus(detail.item.status) }}</strong></div>
          </div>
          <section class="iam-detail-section">
            <h4>权限清单</h4>
            <p>角色维护的是权限集合，最终数据范围需由 RoleBinding 和 DataPolicy 合并决定。</p>
            <code v-for="permission in detail.item.permissions" :key="permission" class="iam-permission-code">{{ permission }}</code>
          </section>
        </template>

        <template v-else-if="detail.kind === 'binding'">
          <div class="iam-detail-grid">
            <div><span>绑定 ID</span><strong class="console-mono">{{ detail.item.id }}</strong></div>
            <div><span>主体类型</span><strong>{{ displaySubjectType(detail.item.subjectType) }}</strong></div>
            <div><span>授权主体</span><strong>{{ detail.item.subject }}</strong></div>
            <div><span>角色</span><strong>{{ detail.item.role }}</strong></div>
            <div><span>应用范围</span><strong>{{ detail.item.application }}</strong></div>
            <div><span>数据范围</span><strong>{{ displayScope(detail.item.scope) }}</strong></div>
            <div><span>有效期</span><strong>{{ detail.item.effective }}</strong></div>
            <div><span>状态</span><strong>{{ displayStatus(detail.item.status) }}</strong></div>
          </div>
        </template>

        <template v-else>
          <div class="iam-detail-grid">
            <div><span>权限编码</span><strong class="console-mono">{{ detail.item.code }}</strong></div>
            <div><span>权限名称</span><strong>{{ detail.item.name }}</strong></div>
            <div><span>所属应用</span><strong>{{ detail.item.application }}</strong></div>
            <div><span>资源 / 动作</span><strong>{{ detail.item.resource }} / {{ detail.item.action }}</strong></div>
            <div><span>风险等级</span><strong>{{ detail.item.risk }}</strong></div>
            <div><span>状态</span><strong>{{ displayStatus(detail.item.status) }}</strong></div>
          </div>
          <section class="iam-detail-section">
            <h4>权限定义</h4>
            <p>{{ detail.item.description }}</p>
          </section>
        </template>
        <footer><button class="console-button ghost" type="button" @click="closeDetail">关闭</button></footer>
      </section>
    </div>

    <div v-if="editor" class="iam-modal-backdrop" role="presentation" @click.self="closeEditor">
      <section class="iam-modal iam-editor-modal" role="dialog" aria-modal="true" aria-label="新增身份授权配置">
        <header>
          <div>
            <p>前端模拟表单</p>
            <h3>新增{{ { user: '用户', account: '登录账号', organization: '组织单元', role: '角色', binding: '角色绑定', permission: '权限注册', identity: '外部身份绑定' }[editor.kind] }}</h3>
          </div>
          <button class="console-modal-close" type="button" aria-label="关闭表单" @click="closeEditor"><ConsoleIcon name="close" /></button>
        </header>
        <form class="iam-editor-form" @submit.prevent="saveEditor">
          <label><span>名称（占位）</span><input v-model="form.displayName || form.name || form.username" /></label>
          <p class="iam-form-alert"><ConsoleIcon name="info" />此表单仅模拟前端交互；正式写入需要后端实现 create / update 接口；当前阶段已通过 SQL 注入测试数据，刷新按钮可重新加载。</p>
          <footer>
            <button class="console-button ghost" type="button" @click="closeEditor">取消</button>
            <button class="console-button primary" type="submit"><ConsoleIcon name="save" />保存（占位）</button>
          </footer>
        </form>
      </section>
    </div>
  </section>
</template>
