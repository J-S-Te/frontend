<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  assignableActiveCatalogRoles,
  isCatalogSynchronized,
} from '@/modules/platform/iam/utils/applicationAuthorizationCatalog'
import {
  PersonalExceptionValidationError,
  buildPersonalExceptionPayload,
  buildPersonalExceptionView,
  createPersonalExceptionDraft,
  hasPersonalExceptionDraftChanges,
  resolvePersonalExceptionDraft,
  roleCodeOf,
  scopeTextOf,
  validityStateOf,
  validityTextOf,
  validatePersonalExceptionDraft,
} from '@/modules/platform/iam/utils/personalExceptionAuthorization'
import PersonalExceptionEditor from './PersonalExceptionEditor.vue'

const props = defineProps({
  application: { type: Object, default: null },
  applications: { type: Array, default: () => [] },
  selectedApplicationCode: { type: String, default: '' },
  access: { type: Object, default: null },
  catalog: { type: Object, default: null },
  environments: { type: Array, default: () => [] },
  loadState: { type: Object, default: () => ({ loading: false, catalogLoading: false, environmentsLoading: false }) },
  canManage: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['create', 'edit', 'select-application', 'submit', 'revoke-role', 'revoke-all', 'retry', 'dirty-change'])

const mode = ref('list')
const draft = ref(null)
const initialDraft = ref(null)
const fieldErrors = ref({})
const blockers = ref([])
const warnings = ref([])
const cancelConfirm = ref(false)
const inheritedExpanded = ref(false)
const now = ref(new Date())
const dirty = ref(false)
let clock = null

const view = computed(() => buildPersonalExceptionView({ access: props.access, catalog: props.catalog, now: now.value }))
const complete = computed(() => Boolean(props.access && props.access.manual_roles_complete === true && Array.isArray(props.access.manual_roles)))
const catalogReady = computed(() => Boolean(props.catalog && isCatalogSynchronized(props.catalog)))
const assignableRoles = computed(() => assignableActiveCatalogRoles(props.catalog))
const canCreate = computed(() => props.canManage && complete.value && catalogReady.value && assignableRoles.value.length > 0 && !props.busy)
const canEdit = computed(() => props.canManage && complete.value && catalogReady.value && !props.busy)
const canRevoke = computed(() => props.canManage && complete.value && !props.busy)
const canRevokeAll = computed(() => canRevoke.value && view.value.counts.manualRecords > 0)
const isEditing = computed(() => mode.value !== 'list')
const loading = computed(() => Boolean(props.loadState?.loading))
const catalogLoading = computed(() => Boolean(props.loadState?.catalogLoading))
const environmentsLoading = computed(() => Boolean(props.loadState?.environmentsLoading))
const currentEditorTitle = computed(() => mode.value === 'create' ? '新增个人例外' : (mode.value === 'normalize' ? '统一调整历史记录' : '修改个人例外'))
const anomalyGroups = computed(() => view.value.groups.filter((group) => group.anomalyTypes.length > 0))
const cleanGroups = computed(() => view.value.groups.filter((group) => !group.anomalyTypes.length))
const inheritedCountText = computed(() => view.value.counts.inheritedSources
  ? '已有岗位继承授权 ' + view.value.counts.inheritedSources + ' 项（角色 ' + view.value.counts.inheritedRoles + ' 个）'
  : '当前没有岗位继承授权')

function setDirty(next) {
  if (dirty.value === Boolean(next)) return
  dirty.value = Boolean(next)
  emit('dirty-change', dirty.value)
}

function resetEditor() {
  mode.value = 'list'
  draft.value = null
  initialDraft.value = null
  fieldErrors.value = {}
  blockers.value = []
  warnings.value = []
  cancelConfirm.value = false
  setDirty(false)
}

function startCreate() {
  if (!canCreate.value) return
  const next = createPersonalExceptionDraft({ mode: 'create' })
  mode.value = 'create'
  draft.value = next
  initialDraft.value = JSON.parse(JSON.stringify(next))
  fieldErrors.value = {}
  blockers.value = []
  warnings.value = []
  cancelConfirm.value = false
  setDirty(false)
  emit('create')
  nextTick(() => emit('dirty-change', false))
}

function startEdit(group, normalize = false) {
  if (!canEdit.value || !group) return
  const nextMode = normalize || group.duplicate ? 'normalize' : 'edit'
  const next = createPersonalExceptionDraft({ mode: nextMode, group })
  mode.value = nextMode
  draft.value = next
  initialDraft.value = JSON.parse(JSON.stringify(next))
  fieldErrors.value = {}
  blockers.value = []
  warnings.value = []
  cancelConfirm.value = false
  setDirty(false)
  emit('edit', group)
}

function onDraftUpdate(next) {
  draft.value = next
  fieldErrors.value = {}
  blockers.value = []
  setDirty(hasPersonalExceptionDraftChanges(initialDraft.value, next))
}

function snapshot() {
  return { access: props.access, environments: props.environments }
}

function submitEditor() {
  if (!draft.value || props.busy) return
  const resolved = resolvePersonalExceptionDraft(draft.value)
  const validation = validatePersonalExceptionDraft({
    draft: resolved,
    snapshot: snapshot(),
    catalog: props.catalog,
    now: new Date(),
  })
  fieldErrors.value = validation.fieldErrors
  blockers.value = validation.blockers
  warnings.value = validation.warnings
  if (Object.keys(validation.fieldErrors).length || validation.blockers.length) return
  try {
    const operationType = mode.value === 'create' ? 'create' : (mode.value === 'normalize' ? 'normalizeRole' : 'update')
    const payload = buildPersonalExceptionPayload({
      snapshot: snapshot(),
      operation: {
        type: operationType,
        targetRoleCode: mode.value === 'create' ? '' : draft.value.roleCode,
        values: {
          roleCode: draft.value.roleCode,
          scopeType: resolved.scopeType,
          environmentCode: resolved.environmentCode,
          validFrom: resolved.validFrom,
          validUntil: resolved.validUntil,
        },
        cleanupRoleCodes: [],
      },
      catalog: props.catalog,
      now: new Date(),
    })
    emit('submit', { payload, summary: payload.summary, operation: payload.operation, changes: payload.changes })
  } catch (error) {
    if (error instanceof PersonalExceptionValidationError) {
      fieldErrors.value = error.fieldErrors || {}
      blockers.value = error.blockers || []
      warnings.value = error.warnings || []
    } else {
      blockers.value = [error?.message || '无法生成授权提交集合。']
    }
  }
}

function requestCancelEditor() {
  if (!dirty.value) {
    resetEditor()
    return
  }
  cancelConfirm.value = true
}

function onEscape(event) {
  if (!isEditing.value) return
  event?.stopPropagation?.()
  event?.preventDefault?.()
  if (cancelConfirm.value) {
    cancelConfirm.value = false
    return
  }
  requestCancelEditor()
}

function confirmAbandon() {
  cancelConfirm.value = false
  resetEditor()
}

function requestRevokeRole(group) {
  if (!canRevoke.value || !group) return
  try {
    const payload = buildPersonalExceptionPayload({
      snapshot: snapshot(),
      operation: { type: 'revokeRole', targetRoleCode: group.roleCode },
      catalog: props.catalog,
      now: new Date(),
    })
    emit('revoke-role', { roleCode: group.roleCode, payload, summary: payload.summary })
  } catch (error) {
    fieldErrors.value = error?.fieldErrors || {}
    blockers.value = error?.blockers || [error?.message || '当前集合仍有未处理的问题，不能撤销这个角色。']
  }
}

function requestCleanup(group) {
  if (!canRevoke.value || !group) return
  try {
    const payload = buildPersonalExceptionPayload({
      snapshot: snapshot(),
      operation: { type: 'cleanup', cleanupRoleCodes: [group.roleCode] },
      catalog: props.catalog,
      now: new Date(),
    })
    emit('submit', { payload, summary: payload.summary, operation: 'cleanup', changes: payload.changes })
  } catch (error) {
    fieldErrors.value = error?.fieldErrors || {}
    blockers.value = error?.blockers || [error?.message || '当前集合仍有未处理的问题，不能清理这个角色。']
  }
}

function requestRevokeAll() {
  if (!canRevokeAll.value) return
  emit('revoke-all', { count: view.value.counts.manualRecords, inheritedCount: view.value.counts.inheritedSources })
}

function onApplicationChange(event) {
  const code = String(event?.target?.value || '').trim()
  if (!code) return
  emit('select-application', { code, event })
}

function retry() {
  emit('retry')
}

function recordValidity(record) {
  return validityTextOf(record)
}

function recordScope(record) {
  return scopeTextOf(record)
}

function statusClass(group) {
  return group.status.code === 'EXPIRED' ? 'is-expired' : (group.status.code === 'PENDING' ? 'is-pending' : 'is-active')
}

function recordStatusLabel(record) {
  const state = validityStateOf(record, now.value)
  if (state === 'EXPIRED') return '已到期，请刷新'
  if (state === 'PENDING') return '待生效'
  return '生效中'
}

function recordStatusClass(record) {
  const state = validityStateOf(record, now.value)
  return state === 'EXPIRED' ? 'is-expired' : (state === 'PENDING' ? 'is-pending' : 'is-active')
}

function groupCountLabel(group) {
  return group.records.length > 1 ? group.records.length + ' 条' : ''
}

watch(() => props.access, () => {
  if (isEditing.value) resetEditor()
})
watch(() => props.selectedApplicationCode, () => {
  if (isEditing.value) resetEditor()
})
onMounted(() => {
  clock = setInterval(() => { now.value = new Date() }, 30000)
})
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
  if (dirty.value) emit('dirty-change', false)
})
</script>

<template>
  <section class="iam-personal-exception" @keydown.esc="onEscape">
    <header class="iam-personal-exception-head">
      <div>
        <h4>个人例外授权</h4>
        <p>为该用户单独补充应用角色，岗位授权请在任职关系和岗位授权模板中维护。</p>
      </div>
      <button v-if="!isEditing && canCreate" type="button" class="console-button primary" :disabled="busy || loading" @click="startCreate">新增例外授权</button>
    </header>

    <div class="iam-personal-exception-application">
      <label>
        <span>应用</span>
        <select :value="selectedApplicationCode" :disabled="busy || isEditing || !applications.length" @change="onApplicationChange">
          <option v-for="app in applications" :key="app.application_id || app.id || app.code" :value="app.code">{{ app.name || app.display_name || app.code }} · {{ app.code }}</option>
        </select>
      </label>
      <span v-if="application" class="iam-application-badge">{{ application.name || application.display_name || application.code }}</span>
      <span v-if="dirty" class="iam-personal-exception-dirty" role="status">有未保存修改</span>
    </div>

    <p v-if="loading" class="iam-empty-inline">正在读取个人例外授权…</p>
    <div v-else-if="error || loadState?.error" class="iam-personal-exception-error-block" role="alert">
      <p>{{ error || loadState?.error }}</p>
      <button type="button" class="console-button ghost" :disabled="busy" @click="retry">重新读取</button>
    </div>
    <div v-else-if="!access" class="iam-personal-exception-error-block" role="status">
      <p>没有读取到完整的个人例外集合，不能把它当作“无授权”继续编辑。</p>
      <button type="button" class="console-button ghost" :disabled="busy" @click="retry">重新读取</button>
    </div>
    <template v-else>
      <p v-if="!complete" class="iam-personal-exception-warning" role="status">当前响应没有完整的 manual_roles 管理集合；本区只读展示，不能保存。请由后端补齐管理字段后重新读取。</p>
      <p v-if="!catalogReady" class="iam-personal-exception-warning" role="status">角色目录未同步或不可用；可以查看和清理已有记录，但不能新增或依赖目录解析的修改。</p>
      <p v-if="!canManage" class="iam-field-help" role="status">当前账号只有查看权限，缺少更新角色绑定权限，不能新增、修改或撤销个人例外。</p>
      <p v-if="catalogLoading || environmentsLoading" class="iam-field-help">正在刷新角色目录或环境…</p>

      <div v-if="isEditing" class="iam-personal-exception-editor-wrap">
        <div v-if="cancelConfirm" class="iam-personal-exception-confirm" role="alertdialog" aria-label="放弃未保存修改">
          <p>当前编辑有未保存修改，确认放弃吗？</p>
          <div><button type="button" class="console-button danger" @click="confirmAbandon">放弃修改</button><button type="button" class="console-button ghost" @click="cancelConfirm = false">继续编辑</button></div>
        </div>
        <PersonalExceptionEditor
          v-else
          :application="application"
          :mode="mode"
          :draft="draft"
          :initial-draft="initialDraft"
          :catalog="catalog"
          :environments="environments"
          :existing-manual-roles="access.manual_roles || []"
          :inherited-roles="access.inherited_roles || []"
          :field-errors="fieldErrors"
          :blockers="blockers"
          :warnings="warnings"
          :busy="busy"
          @update:draft="onDraftUpdate"
          @submit="submitEditor"
          @cancel="requestCancelEditor"
        />
      </div>
      <template v-else>
        <div v-if="anomalyGroups.length" class="iam-personal-exception-anomalies" role="alert">
          <h5>需要先处理的异常</h5>
          <article v-for="group in anomalyGroups" :key="'anomaly-' + group.roleCode" class="iam-personal-exception-anomaly">
            <div>
              <strong>{{ group.name }}</strong>
              <code>{{ group.roleCode }}</code>
              <span v-if="group.duplicate" class="iam-personal-exception-tag">同角色 {{ group.records.length }} 条</span>
              <span v-if="group.unavailable" class="iam-personal-exception-tag is-danger">已停用 / 不在目录</span>
              <span v-if="group.hasExpired" class="iam-personal-exception-tag is-warning">含已到期</span>
            </div>
            <p v-if="group.duplicate">同角色多条记录不能按单条修改覆盖；请统一调整或撤销该角色全部记录。</p>
            <p v-if="group.unavailable">请显式清理；保存其他角色时不会自动丢弃它。</p>
            <p v-if="group.hasExpired">已到期记录不能原样带入保存；请清理或统一调整。</p>
            <div class="iam-personal-exception-actions">
              <button v-if="canEdit && group.duplicate" type="button" class="console-button ghost" :disabled="busy" @click="startEdit(group, true)">统一调整</button>
              <button v-if="canEdit && group.duplicate" type="button" class="console-button ghost" :disabled="busy" @click="requestRevokeRole(group)">撤销此角色全部 {{ group.records.length }} 项</button>
              <button v-if="canRevoke && (group.unavailable || group.hasExpired)" type="button" class="console-button ghost" :disabled="busy" @click="requestCleanup(group)">清理此角色</button>
              <button v-if="canRevoke && !group.duplicate" type="button" class="console-button danger" :disabled="busy" @click="requestRevokeRole(group)">撤销此角色</button>
            </div>
          </article>
        </div>

        <div v-if="!isEditing && blockers.length" class="iam-personal-exception-blockers" role="alert">
          <strong>暂不能执行：</strong>
          <ul><li v-for="blocker in blockers" :key="blocker">{{ blocker }}</li></ul>
        </div>

        <div class="iam-personal-exception-summary" aria-live="polite">
          <strong>个人例外 {{ view.counts.manualRecords }} 项</strong>
          <span>角色 {{ view.counts.manualRoles }} 个</span>
          <span>{{ inheritedCountText }}</span>
        </div>

        <p v-if="!view.groups.length" class="iam-empty-inline">当前没有个人例外。{{ view.counts.inheritedSources ? '已有岗位授权可展开查看。' : '' }}</p>
        <div v-else class="iam-personal-exception-list" role="list">
          <article v-for="group in view.groups" :key="group.roleCode" class="iam-personal-exception-group" role="listitem">
            <header>
              <div class="iam-personal-exception-role">
                <strong>{{ group.name }}</strong>
                <span v-if="groupCountLabel(group)" class="iam-personal-exception-tag">{{ groupCountLabel(group) }}</span>
                <span v-if="group.unavailable" class="iam-personal-exception-tag is-danger">已停用 / 不在目录</span>
                <span v-if="group.hasExpired" class="iam-personal-exception-tag is-warning">含已到期</span>
                <span v-if="group.hasPending" class="iam-personal-exception-tag is-pending">含待生效</span>
              </div>
              <div class="iam-personal-exception-actions">
                <button v-if="canEdit && !group.duplicate && !group.hasExpired && !group.unavailable" type="button" class="console-button ghost" :disabled="busy" @click="startEdit(group)">修改</button>
                <button v-if="canEdit && group.duplicate" type="button" class="console-button ghost" :disabled="busy" @click="startEdit(group, true)">统一调整</button>
                <button v-if="canRevoke && !group.duplicate" type="button" class="console-button danger" :disabled="busy" @click="requestRevokeRole(group)">撤销</button>
                <button v-if="canRevoke && group.duplicate" type="button" class="console-button danger" :disabled="busy" @click="requestRevokeRole(group)">撤销全部 {{ group.records.length }} 项</button>
              </div>
            </header>
            <div class="iam-personal-exception-records">
              <div v-for="(record, index) in group.records" :key="roleCodeOf(record) + '-' + index" class="iam-personal-exception-record">
                <span class="iam-personal-exception-col-scope">{{ recordScope(record) }}</span>
                <span class="iam-personal-exception-col-validity">{{ recordValidity(record) }}</span>
                <span class="iam-personal-exception-col-status" :class="recordStatusClass(record)">{{ recordStatusLabel(record) }}</span>
              </div>
            </div>
            <details class="iam-personal-exception-tech">
              <summary>技术信息</summary>
              <p>角色编码 <code>{{ group.roleCode }}</code></p>
              <p>范围与时间段仅用于管理展示；保存时只会提交角色编码、范围、环境和原始有效期。</p>
            </details>
          </article>
        </div>

        <details v-if="view.inheritedGroups.length" class="iam-personal-exception-inherited" :open="inheritedExpanded" @toggle="inheritedExpanded = $event.target.open">
          <summary>{{ inheritedCountText }} <span>展开查看来源</span></summary>
          <div v-for="group in view.inheritedGroups" :key="'inherited-' + group.roleCode" class="iam-personal-exception-inherited-group">
            <strong>{{ group.name }}</strong>
            <div v-for="(source, index) in group.sources" :key="'source-' + group.roleCode + '-' + index">
              {{ source.source_type || '未知来源' }} · {{ source.source_name || source.source_id || '—' }} · {{ recordScope(source) }} · {{ recordValidity(source) }}
            </div>
          </div>
          <p class="iam-field-help">继承角色由组织单元或岗位产生；保存或撤销个人例外不会删除这些标准授权。</p>
        </details>

        <div class="iam-personal-exception-more">
          <button v-if="canRevokeAll" type="button" class="console-button ghost" :disabled="busy" @click="requestRevokeAll">撤销该应用全部个人例外</button>
          <span v-if="!canRevokeAll && !view.groups.length" class="iam-field-help">没有可撤销的个人例外。</span>
        </div>
      </template>
    </template>
  </section>
</template>
