<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { AuthorizationError, getApplicationAuthorizationCatalog } from '@/modules/platform/iam/api/authorization'
import {
  assignableActiveCatalogRoles,
  catalogSyncText,
  catalogVersion,
  isCatalogSynchronized,
} from '@/modules/platform/iam/utils/applicationAuthorizationCatalog'
import { positionTemplateRoleChoices } from '@/modules/platform/iam/utils/positionAuthorizationCatalog'
import {
  createPositionAuthorizationTemplate,
  disablePositionAuthorizationTemplate,
  listPositionAuthorizationTemplateAssignments,
  listPositionAuthorizationTargets,
  listPositionAuthorizationPositions,
  listPositionAuthorizationTemplates,
  previewPositionAuthorization,
  replacePositionAuthorizationTemplateAssignments,
} from '@/modules/platform/iam/api/positionAuthorization'

const emit = defineEmits(['toast'])
const loading = ref(false)
const saving = ref(false)
const templates = ref([])
const positions = ref([])
const applications = ref([])
const selectedPositionId = ref('')
const assignedTemplateIds = ref([])
const preview = ref(null)
const form = ref({ name: '', description: '', roles: [{ application_id: '', role_id: '', scope_type: 'TENANT', scope_id: '' }] })
const catalogs = ref({})

function items(data) { return Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []) }
function id(item, ...keys) { return keys.map((key) => item?.[key]).find(Boolean) || '' }
function applicationId(item) { return id(item, 'application_id', 'id') }
function positionId(item) { return id(item, 'position_id', 'id') }
function positionName(item) { return item?.name || item?.position_name || item?.code || item?.position_code || positionId(item) }
function templateId(item) { return id(item, 'template_id', 'id') }
function roleItems(catalog) {
  return assignableActiveCatalogRoles(catalog).filter((role) => Boolean(roleId(role)))
}

function catalogForApplication(applicationIdValue) {
  return catalogs.value[applicationIdValue] || null
}

function catalogIsReady(applicationIdValue) {
  return isCatalogSynchronized(catalogForApplication(applicationIdValue))
}

function roleId(role) { return id(role, 'role_id', 'id') }
function roleName(role) { return role?.name || role?.role_name || role?.code || roleId(role) }
function appName(app) { return app?.name || app?.application_name || app?.code || applicationId(app) }
function templateRoles(template) { return items(template?.roles) }

async function load() {
  loading.value = true
  try {
    // The target endpoint supplies active application IDs and stable platform role IDs.
    // Each role is then intersected with the application-owned authorization catalog, so the
    // console never assigns a role that the subsystem has not declared ACTIVE + assignable.
    const [templateResult, positionResult, targetResult] = await Promise.allSettled([
      listPositionAuthorizationTemplates(),
      listPositionAuthorizationPositions(),
      listPositionAuthorizationTargets(),
    ])
    const failures = []
    if (templateResult.status === 'fulfilled') templates.value = items(templateResult.value)
    else failures.push(templateResult.reason)
    if (positionResult.status === 'fulfilled') positions.value = items(positionResult.value)
    else failures.push(positionResult.reason)
    if (targetResult.status === 'fulfilled') {
      const targetApplications = items(targetResult.value)
      const catalogResults = await Promise.allSettled(targetApplications.map((application) => getApplicationAuthorizationCatalog(applicationId(application))))
      const nextCatalogs = {}
      applications.value = targetApplications.map((application, index) => {
        const catalogResult = catalogResults[index]
        if (catalogResult?.status !== 'fulfilled') {
          failures.push(catalogResult?.reason)
          nextCatalogs[applicationId(application)] = { roles: [], sync_status: 'NOT_SYNCED' }
          return application
        }
        const catalog = catalogResult.value || { roles: [], sync_status: 'NOT_SYNCED' }
        nextCatalogs[applicationId(application)] = {
          ...catalog,
          // The role-binding endpoint supplies immutable platform role IDs, while the
          // application-owned catalog supplies authoritative status, assignability and names.
          roles: positionTemplateRoleChoices(application?.roles, catalog),
        }
        return application
      })
      catalogs.value = nextCatalogs
    } else {
      applications.value = []
      catalogs.value = {}
      failures.push(targetResult.reason)
    }
    if (!selectedPositionId.value && positions.value.length) selectedPositionId.value = positionId(positions.value[0])
    if (selectedPositionId.value) await loadAssignments()
    if (failures.length) {
      const error = failures[0]
      emit('toast', error instanceof AuthorizationError ? error.message : (error?.message || '部分岗位授权数据读取失败，请检查当前账号权限。'))
    }
  } finally {
    loading.value = false
  }
}

async function loadAssignments() {
  if (!selectedPositionId.value) {
    assignedTemplateIds.value = []
    preview.value = null
    return
  }
  try {
    const data = await listPositionAuthorizationTemplateAssignments(selectedPositionId.value)
    assignedTemplateIds.value = items(data).filter((item) => String(item?.status || '').toUpperCase() === 'ACTIVE').map((item) => item.template?.template_id || item.template_id)
    await loadPreview()
  } catch (error) {
    emit('toast', error instanceof AuthorizationError ? error.message : (error?.message || '读取岗位授权配置失败。'))
  }
}

function addRole() { form.value.roles.push({ application_id: '', role_id: '', scope_type: 'TENANT', scope_id: '' }) }
function removeRole(index) { if (form.value.roles.length > 1) form.value.roles.splice(index, 1) }
function onApplicationChange(row) { row.role_id = '' }

async function createTemplate() {
  const name = String(form.value.name || '').trim()
  const roles = form.value.roles.filter((row) => row.application_id && row.role_id).map((row) => ({ ...row, scope_type: row.scope_type || 'TENANT', scope_id: row.scope_type === 'ENVIRONMENT' ? String(row.scope_id || '').trim() : '' }))
  if (!name || !roles.length) {
    emit('toast', '请填写模板名称，并至少选择一个“应用 + 实际角色”。')
    return
  }
  saving.value = true
  try {
    await createPositionAuthorizationTemplate({ name, description: String(form.value.description || '').trim(), status: 'ACTIVE', roles })
    form.value = { name: '', description: '', roles: [{ application_id: '', role_id: '', scope_type: 'TENANT', scope_id: '' }] }
    emit('toast', '标准岗位授权模板已创建。')
    await load()
  } catch (error) {
    emit('toast', error instanceof AuthorizationError ? error.message : (error?.message || '创建岗位授权模板失败。'))
  } finally { saving.value = false }
}

async function saveAssignments() {
  if (!selectedPositionId.value) return
  saving.value = true
  try {
    await replacePositionAuthorizationTemplateAssignments(selectedPositionId.value, assignedTemplateIds.value.map((template_id) => ({ template_id, status: 'ACTIVE' })))
    await loadPreview()
    emit('toast', '标准岗位授权模板映射已保存；有效任职关系将动态继承这些角色。')
  } catch (error) {
    emit('toast', error instanceof AuthorizationError ? error.message : (error?.message || '保存岗位授权配置失败。'))
  } finally { saving.value = false }
}

async function loadPreview() {
  if (!selectedPositionId.value) return
  try { preview.value = await previewPositionAuthorization({ position_id: selectedPositionId.value, inherit_authorization: true }) } catch { preview.value = null }
}

async function disableTemplate(template) {
  if (!window.confirm(`确认停用授权模板“${template.name}”吗？它不会删除手工授权，但将撤销该模板生成的岗位授权。`)) return
  try {
    await disablePositionAuthorizationTemplate(templateId(template), template.version)
    emit('toast', '岗位授权模板已停用。')
    await load()
  } catch (error) {
    emit('toast', error instanceof AuthorizationError ? error.message : (error?.message || '停用模板失败。'))
  }
}

const selectedPosition = computed(() => positions.value.find((item) => positionId(item) === selectedPositionId.value))
watch(selectedPositionId, loadAssignments)
defineExpose({ reload: load })
onMounted(load)
</script>

<template>
  <section class="iam-table-section iam-position-authorization">
    <div class="iam-filter-row">
      <div><strong>岗位授权模板 <span class="iam-standard-authorization-badge">标准授权（推荐）</span></strong><p class="iam-field-help">日常岗位角色在这里统一配置：岗位 → 授权模板 → 应用实际角色 → 有效任职动态继承。只按“应用 ID + 角色 ID”授权；不会按中文角色名称匹配，也不会生成用户级复制授权。</p></div>
      <button class="console-button ghost small" type="button" :disabled="loading" @click="load"><ConsoleIcon name="refresh" />刷新</button>
    </div>

    <div class="console-table-card iam-template-editor">
      <h4>新建标准岗位授权模板</h4>
      <div class="iam-template-grid">
        <label><span>模板名称 *</span><input v-model="form.name" placeholder="例如 销售人员授权模板" /></label>
        <label class="full"><span>说明</span><input v-model="form.description" placeholder="说明适用岗位和授权范围" /></label>
      </div>
      <p class="iam-field-help">模板编码由服务端自动生成。角色目录和默认权限由子系统只读同步，基础平台在此只能选择已同步且可分配的实际角色，不能创建或编辑子系统角色、权限及其关系。</p>
      <p v-if="!loading && !applications.length" class="iam-field-help">暂无可授权的目标应用。请确认子系统已启用，并已成功同步至少一个 ACTIVE 且可分配的角色。</p>
      <div class="iam-template-roles">
        <div v-for="(row, index) in form.roles" :key="index" class="iam-template-role-row">
          <div class="iam-template-catalog-field">
            <select v-model="row.application_id" @change="onApplicationChange(row)"><option value="">选择目标应用</option><option v-for="app in applications" :key="applicationId(app)" :value="applicationId(app)">{{ appName(app) }}</option></select>
            <small v-if="row.application_id">目录 {{ catalogVersion(catalogForApplication(row.application_id)) }} · {{ catalogSyncText(catalogForApplication(row.application_id)) }}</small>
          </div>
          <div class="iam-template-catalog-field">
            <select v-model="row.role_id" :disabled="!row.application_id || !catalogIsReady(row.application_id)"><option value="">{{ catalogIsReady(row.application_id) ? '选择实际角色' : '请等待目录成功同步' }}</option><option v-for="role in roleItems(catalogForApplication(row.application_id))" :key="roleId(role)" :value="roleId(role)">{{ roleName(role) }}</option></select>
            <small v-if="row.application_id && catalogIsReady(row.application_id) && !roleItems(catalogForApplication(row.application_id)).length">目录中没有 ACTIVE 且可分配的角色</small>
          </div>
          <select v-model="row.scope_type"><option value="TENANT">租户范围</option><option value="ENVIRONMENT">环境范围</option></select>
          <input v-if="row.scope_type === 'ENVIRONMENT'" v-model="row.scope_id" placeholder="环境 ID" />
          <button class="console-text-button danger" type="button" :disabled="form.roles.length === 1" @click="removeRole(index)">移除</button>
        </div>
      </div>
      <div class="iam-panel-actions"><button class="console-button ghost small" type="button" @click="addRole"><ConsoleIcon name="plus" />增加角色</button><button class="console-button primary small" type="button" :disabled="saving" @click="createTemplate"><ConsoleIcon name="save" />创建模板</button></div>
    </div>

    <div class="console-table-card iam-standard-authorization-card">
      <div class="iam-filter-row"><strong>将标准模板应用到岗位</strong><label class="console-search-field"><span>岗位</span><select v-model="selectedPositionId" class="iam-template-position-select"><option value="" disabled>请选择岗位</option><option v-if="!positions.length" value="" disabled>暂无可映射岗位</option><option v-for="position in positions" :key="positionId(position)" :value="positionId(position)">{{ positionName(position) }}</option></select></label><button class="console-button primary small" type="button" :disabled="saving || !selectedPositionId" @click="saveAssignments"><ConsoleIcon name="save" />保存岗位映射</button></div>
      <p v-if="selectedPosition" class="iam-field-help">{{ positionName(selectedPosition) }} 的有效任职关系会动态继承下列标准模板；任职勾选“参与岗位授权继承”后才会生效。个人、岗位和组织的例外授权不会被模板覆盖或删除。</p>
      <div v-if="loading" class="console-empty">正在读取模板…</div>
      <div v-else-if="!templates.length" class="console-empty">暂无授权模板，请先创建模板。</div>
      <div v-else class="iam-template-assignment-list">
        <label v-for="template in templates" :key="templateId(template)" class="iam-template-assignment"><input v-model="assignedTemplateIds" type="checkbox" :value="templateId(template)" :disabled="String(template.status).toUpperCase() !== 'ACTIVE'" /><span><strong>{{ template.name }}</strong><small>{{ template.code }} · {{ template.affected_users || 0 }} 位受影响用户</small><em>{{ templateRoles(template).map((role) => `${role.application_name || role.application_code} / ${role.role_name || role.role_code}`).join('；') || '未配置角色' }}</em></span></label>
      </div>
    </div>

    <div v-if="preview" class="console-table-card iam-authorization-preview"><h4>授权预览与影响分析</h4><p v-if="preview.conflicts?.length" class="login-target-module__error">{{ preview.conflicts.join('；') }}</p><p v-else class="iam-field-help">以下为该岗位模板产生的角色；用户同时有多个有效任职时，实际权限是全部有效来源的并集。</p><ul><li v-for="role in preview.roles || []" :key="`${role.template_id}-${role.role_id}`"><strong>{{ role.application_name || role.application_code }}</strong> / {{ role.role_name || role.role_code }} <small>来源：{{ role.template_name }}</small></li><li v-if="!(preview.roles || []).length">当前岗位没有从模板获得有效应用角色。</li></ul></div>
  </section>
</template>
