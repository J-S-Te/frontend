<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { AuthorizationError } from '@/modules/platform/iam/api/authorization'
import {
  assignableActiveCatalogRoles,
  catalogSyncText,
  catalogVersion,
  isCatalogSynchronized,
} from '@/modules/platform/iam/utils/applicationAuthorizationCatalog'
import { positionAuthorizationTargetCatalog } from '@/modules/platform/iam/utils/positionAuthorizationCatalog'
import { hasPermission } from '@/modules/platform/auth/utils/principal'
import { IAM_PERMISSIONS } from '@/modules/platform/iam/utils/iamPermissions'
import {
  authorizationPositionGroupLabel,
  authorizationPositionOptionLabel,
  groupAuthorizationPositions,
} from '@/modules/platform/iam/utils/selectionCatalog'
import {
  createPositionAuthorizationTemplate,
  deletePositionAuthorizationTemplate,
  listPositionAuthorizationTemplateAssignments,
  listPositionAuthorizationTargets,
  listPositionAuthorizationPositions,
  listPositionAuthorizationTemplates,
  previewPositionAuthorization,
  replacePositionAuthorizationTemplateAssignments,
} from '@/modules/platform/iam/api/positionAuthorization'

const emit = defineEmits(['toast'])
const canReadAuthorization = computed(() => hasPermission(IAM_PERMISSIONS.roleBindingRead))
const canManageAuthorization = computed(() => hasPermission(IAM_PERMISSIONS.roleBindingUpdate))
const loading = ref(false)
const saving = ref(false)
const templates = ref([])
const positions = ref([])
const applications = ref([])
const selectedPositionId = ref('')
const assignedTemplateIds = ref([])
// 通用确认弹窗。不用 window.confirm 是为了避免在 WebView 容器里静默失败。
const confirmDialog = ref(null)
function openConfirm({ title, description, confirmText = '确认', danger = false, onConfirm }) {
  confirmDialog.value = { title, description, confirmText, danger, busy: false, onConfirm }
}
function closeConfirm() {
  if (confirmDialog.value?.busy) return
  confirmDialog.value = null
}
const preview = ref(null)
// 编辑器内的"挂载预览"独立 state：与下方页面级 `preview` 共享同一接口，但保留专属 loading / unavailable 态，
// 以便在模板编辑卡片内独立显示骨架、错误与刷新按钮，而不影响已有的"授权预览与影响分析"卡片渲染。
const editorPreview = ref(null)
const editorPreviewLoading = ref(false)
const editorPreviewUnavailable = ref(false)
const positionPreviewRef = ref(null)
let editorPreviewRequest = 0
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
const activeTemplates = computed(() => templates.value.filter((template) => String(template?.status || '').toUpperCase() === 'ACTIVE'))
const positionGroups = computed(() => groupAuthorizationPositions(positions.value))

async function load() {
  if (!canReadAuthorization.value) return
  loading.value = true
  try {
    // 专用目标端点同时返回稳定平台角色 ID 和编辑器所需的授权目录就绪状态。这里不能调用
    // 更宽泛的应用目录 API：角色绑定管理员可能合理地没有 platform:application:read。
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
      const nextCatalogs = {}
      applications.value = targetApplications
      targetApplications.forEach((application) => {
        nextCatalogs[applicationId(application)] = positionAuthorizationTargetCatalog(application)
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
  if (!canReadAuthorization.value) return
  if (!selectedPositionId.value) {
    assignedTemplateIds.value = []
    preview.value = null
    editorPreview.value = null
    editorPreviewUnavailable.value = false
    return
  }
  try {
    const data = await listPositionAuthorizationTemplateAssignments(selectedPositionId.value)
    assignedTemplateIds.value = items(data).filter((item) => String(item?.status || '').toUpperCase() === 'ACTIVE').map((item) => item.template?.template_id || item.template_id)
    // 页面级 preview 与编辑器挂载预览共用同一接口，并行拉取避免遮挡主流程。
    await Promise.all([loadPreview(), loadEditorPreview()])
  } catch (error) {
    emit('toast', error instanceof AuthorizationError ? error.message : (error?.message || '读取岗位授权配置失败。'))
  }
}

function addRole() { form.value.roles.push({ application_id: '', role_id: '', scope_type: 'TENANT', scope_id: '' }) }
function removeRole(index) { if (form.value.roles.length > 1) form.value.roles.splice(index, 1) }
function onApplicationChange(row) { row.role_id = '' }

async function createTemplate() {
	if (!canManageAuthorization.value) return
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
	if (!canManageAuthorization.value) return
  if (!selectedPositionId.value) return
  saving.value = true
  try {
    await replacePositionAuthorizationTemplateAssignments(selectedPositionId.value, assignedTemplateIds.value.map((template_id) => ({ template_id, status: 'ACTIVE' })))
    await Promise.all([loadPreview(), loadEditorPreview()])
    emit('toast', '标准岗位授权模板映射已保存；有效任职关系将动态继承这些角色。')
  } catch (error) {
    emit('toast', error instanceof AuthorizationError ? error.message : (error?.message || '保存岗位授权配置失败。'))
  } finally { saving.value = false }
}

async function loadPreview() {
  if (!selectedPositionId.value) return
  try { preview.value = await previewPositionAuthorization({ position_id: selectedPositionId.value, inherit_authorization: true }) } catch { preview.value = null }
}

// 后端 preview 接口是 position 级别（不是 template / user 级别），因此编辑器内的"挂载预览"
// 只能展示"该岗位当前已分配模板将产生的角色与 CONFLICT"，不能直接模拟"未保存草稿"的影响。
// 在面板文案中明确说明这一限制，并在模板保存后引导用户到"将模板应用到岗位"完成分配。
async function loadEditorPreview() {
  if (!selectedPositionId.value) {
    editorPreview.value = null
    editorPreviewUnavailable.value = false
    return
  }
  const requestId = ++editorPreviewRequest
  editorPreviewLoading.value = true
  editorPreviewUnavailable.value = false
  try {
    const result = await previewPositionAuthorization({ position_id: selectedPositionId.value, inherit_authorization: true })
    if (requestId !== editorPreviewRequest) return
    editorPreview.value = result
  } catch {
    if (requestId !== editorPreviewRequest) return
    editorPreview.value = null
    editorPreviewUnavailable.value = true
  } finally {
    if (requestId === editorPreviewRequest) editorPreviewLoading.value = false
  }
}

async function deleteTemplate(template) {
	if (!canManageAuthorization.value) return
  openConfirm({
    title: '确认删除岗位授权模板',
    description: `确认删除岗位授权模板“${template.name}”吗？\n\n删除后：\n1. 该模板不再出现在岗位映射列表；\n2. 该模板生成的岗位角色授权将被撤销；\n3. 用户、岗位或组织的手工授权不会被删除；\n4. 授权和审计历史仍会保留。`,
    confirmText: '确认删除',
    danger: true,
    onConfirm: async () => {
      try {
        await deletePositionAuthorizationTemplate(templateId(template), template.version)
        assignedTemplateIds.value = assignedTemplateIds.value.filter((idValue) => idValue !== templateId(template))
        emit('toast', '岗位授权模板已删除，相关岗位继承授权已撤销。')
        await load()
      } catch (error) {
        emit('toast', error instanceof AuthorizationError ? error.message : (error?.message || '删除岗位授权模板失败。'))
      } finally {
        closeConfirm()
      }
    },
  })
}

const selectedPosition = computed(() => positions.value.find((item) => positionId(item) === selectedPositionId.value))

// 本地模板草稿统计：纯前端 derived，不打 API，因此对 form.roles 的任何编辑都会即时反映在挂载预览面板上。
const templateDraftStats = computed(() => {
  const rows = Array.isArray(form.value.roles) ? form.value.roles : []
  const valid = rows.filter((row) => row && row.application_id && row.role_id)
  return {
    totalRows: rows.length,
    validRows: valid.length,
    distinctApps: new Set(valid.map((row) => row.application_id)).size,
    environmentRows: valid.filter((row) => row.scope_type === 'ENVIRONMENT').length,
  }
})
const editorPreviewRoles = computed(() => Array.isArray(editorPreview.value?.roles) ? editorPreview.value.roles : [])
const editorPreviewConflicts = computed(() => Array.isArray(editorPreview.value?.conflicts) ? editorPreview.value.conflicts : [])

function scrollToPositionPreview() {
  const target = positionPreviewRef.value
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // 滚动到位后给现有预览卡片一个 1.6s 的描边高亮，便于用户在多卡片页面定位。
  target.classList.add('is-flash')
  window.setTimeout(() => target.classList.remove('is-flash'), 1600)
}

watch(selectedPositionId, loadAssignments)
defineExpose({ reload: load })
onMounted(() => {
  if (canReadAuthorization.value) load()
})
</script>

<template>
  <section class="iam-table-section iam-position-authorization">
    <div v-if="canManageAuthorization" class="console-table-card iam-template-editor">
      <header class="iam-template-card-head">
        <div class="iam-template-card-title">
          <span class="iam-template-card-icon"><ConsoleIcon name="shield" /></span>
          <div>
            <h4>新建岗位授权模板</h4>
            <p>把岗位与各应用的实际角色建立标准映射，员工任职生效后即可动态继承。</p>
          </div>
        </div>
        <span class="iam-standard-authorization-badge">标准授权</span>
      </header>
      <div class="iam-template-grid">
        <label><span>模板名称 *</span><input v-model="form.name" placeholder="例如 销售人员授权模板" /></label>
        <label class="full"><span>说明</span><input v-model="form.description" placeholder="说明适用岗位和授权范围" /></label>
      </div>
      <div class="iam-template-guidance">
        <ConsoleIcon name="info" />
        <p>模板编码由服务端自动生成。基础平台内置角色可直接选择；子系统仅展示已同步且可分配的实际角色，不按中文名称匹配，也不会创建用户级复制授权。</p>
      </div>
      <p v-if="!loading && !applications.length" class="iam-field-help">暂无可授权的目标应用。请确认应用已启用；子系统还需要成功同步至少一个 ACTIVE 且可分配的角色。</p>
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
      <div class="iam-template-mount-preview" aria-label="挂载预览（保存前影响分析）">
        <div class="iam-template-mount-head">
          <span class="iam-template-card-icon is-green"><ConsoleIcon name="shield" /></span>
          <div>
            <h5>挂载预览（保存前影响分析）</h5>
            <p>左侧"本地模板草稿"实时统计当前编辑内容；右侧"岗位实时影响"展示下方所选岗位当前已分配模板产生的角色与 CONFLICT。模板保存后还要在下方"将模板应用到岗位"中分配到岗位，授权才会对任职用户实际生效。</p>
          </div>
        </div>
        <div class="iam-template-mount-grid">
          <div class="iam-mount-tile is-local">
            <div class="iam-mount-tile-head"><span class="iam-mount-tile-dot is-local" />本地模板草稿</div>
            <dl>
              <div><dt>已配置角色</dt><dd>{{ templateDraftStats.validRows }}<small> / {{ templateDraftStats.totalRows }} 行</small></dd></div>
              <div><dt>涉及应用</dt><dd>{{ templateDraftStats.distinctApps }}</dd></div>
              <div><dt>环境范围</dt><dd>{{ templateDraftStats.environmentRows }}</dd></div>
            </dl>
            <p v-if="!templateDraftStats.validRows" class="iam-mount-tile-empty">尚未选择任何"应用 + 实际角色"，保存后不会继承任何应用角色。</p>
          </div>
          <div v-if="selectedPositionId" class="iam-mount-tile is-impact">
            <div class="iam-mount-tile-head">
              <span class="iam-mount-tile-dot" :class="editorPreviewConflicts.length ? 'is-warn' : 'is-ok'" />
              岗位实时影响 · {{ positionName(selectedPosition) }}
            </div>
            <p v-if="editorPreviewLoading" class="iam-mount-tile-loading">正在读取该岗位的授权模板…</p>
            <template v-else-if="editorPreviewUnavailable">
              <p class="iam-mount-tile-empty">授权预览接口暂不可用，请稍后重试或点击"刷新预览"。不影响模板保存；模板分配到岗位后即可在下方"授权预览与影响分析"中查看。</p>
            </template>
            <template v-else-if="editorPreview">
              <dl>
                <div class="is-ok"><dt>将成功继承</dt><dd>{{ editorPreviewRoles.length }}<small>个角色</small></dd></div>
                <div :class="editorPreviewConflicts.length ? 'is-warn' : 'is-ok'"><dt>CONFLICT</dt><dd>{{ editorPreviewConflicts.length }}<small>条</small></dd></div>
              </dl>
              <p v-if="!editorPreviewRoles.length" class="iam-mount-tile-empty">该岗位当前没有任何可继承的角色。请在下方"将模板应用到岗位"中勾选本模板并点击"保存岗位映射"，再回到这里刷新。</p>
              <ul v-if="editorPreviewConflicts.length" class="iam-mount-conflicts">
                <li v-for="(line, index) in editorPreviewConflicts" :key="`editor-conflict-${index}`">{{ line }}</li>
              </ul>
              <p class="iam-mount-tile-foot">当前接口仅返回该岗位已分配模板的角色总数与冲突消息；CONFLICT 来源（USER / ORG_UNIT / POSITION）需要后端扩展分类字段后才能逐项展示。</p>
            </template>
            <p v-else class="iam-mount-tile-empty">暂无预览数据，请点击"刷新预览"重新读取。</p>
          </div>
          <div v-else class="iam-mount-tile is-muted">
            <div class="iam-mount-tile-head"><span class="iam-mount-tile-dot is-muted" />岗位实时影响</div>
            <p class="iam-mount-tile-empty">请先在下方"将模板应用到岗位"中选择一个岗位，再查看该岗位当前已分配模板的实时影响。模板保存并完成岗位分配后，本面板会同步显示"将成功继承 / CONFLICT"的具体数量。</p>
          </div>
        </div>
        <div class="iam-template-mount-actions">
          <button class="console-button ghost small" type="button" :disabled="!selectedPositionId || editorPreviewLoading" @click="loadEditorPreview">
            <ConsoleIcon name="reset" />{{ editorPreviewLoading ? '刷新中…' : '刷新预览' }}
          </button>
          <button class="console-text-button" type="button" :disabled="!selectedPositionId" @click="scrollToPositionPreview">查看完整预览</button>
        </div>
      </div>
      <div class="iam-panel-actions"><button class="console-button ghost small" type="button" @click="addRole"><ConsoleIcon name="plus" />增加角色</button><button class="console-text-button" type="button" :disabled="!selectedPositionId" @click="scrollToPositionPreview">预览影响</button><button class="console-button primary small" type="button" :disabled="saving" @click="createTemplate"><ConsoleIcon name="save" />创建模板</button></div>
    </div>

    <p v-if="canReadAuthorization && !canManageAuthorization" class="iam-field-help" role="status">当前为只读模式：可以查看模板、岗位映射和授权预览，但不能创建、修改或删除模板。</p>

    <div class="console-table-card iam-standard-authorization-card">
      <header class="iam-template-mapping-head">
        <div class="iam-template-card-title">
          <span class="iam-template-card-icon is-green"><ConsoleIcon name="link" /></span>
          <div>
            <h4>将模板应用到岗位</h4>
            <p>选择岗位并勾选模板，保存后由有效任职关系自动继承对应应用角色。</p>
          </div>
        </div>
        <div class="iam-template-mapping-actions">
          <label class="iam-template-position-field">
            <span>目标岗位</span>
            <select v-model="selectedPositionId" class="iam-template-position-select">
              <option value="" disabled>请选择岗位</option>
              <option v-if="!positions.length" value="" disabled>暂无可映射岗位</option>
              <optgroup
                v-for="group in positionGroups"
                :key="group.organization_id || group.organization_name"
                :label="authorizationPositionGroupLabel(group)"
              >
                <option v-for="position in group.positions" :key="positionId(position)" :value="positionId(position)">{{ authorizationPositionOptionLabel(position) }}</option>
              </optgroup>
            </select>
          </label>
          <button v-if="canManageAuthorization" class="console-button primary small" type="button" :disabled="saving || !selectedPositionId" @click="saveAssignments"><ConsoleIcon name="save" />保存岗位映射</button>
        </div>
      </header>
      <p v-if="selectedPosition" class="iam-field-help">{{ positionName(selectedPosition) }} 的有效任职关系会动态继承下列标准模板；任职勾选“参与岗位授权继承”后才会生效。个人、岗位和组织的例外授权不会被模板覆盖或删除。</p>
      <div v-if="loading" class="console-empty">正在读取模板…</div>
      <div v-else-if="!activeTemplates.length" class="console-empty">暂无可用授权模板，请先创建模板。</div>
      <div v-else class="iam-template-assignment-list">
        <div v-for="template in activeTemplates" :key="templateId(template)" class="iam-template-assignment-row">
          <label class="iam-template-assignment"><input v-model="assignedTemplateIds" type="checkbox" :value="templateId(template)" :disabled="!canManageAuthorization" /><span><strong>{{ template.name }}</strong><small>{{ template.code }} · {{ template.affected_users || 0 }} 位受影响用户</small><em>{{ templateRoles(template).map((role) => `${role.application_name || role.application_code} / ${role.role_name || role.role_code}`).join('；') || '未配置角色' }}</em></span></label>
          <button v-if="canManageAuthorization" class="console-text-button danger iam-template-delete" type="button" :disabled="saving" @click="deleteTemplate(template)">删除模板</button>
        </div>
      </div>
    </div>

    <div v-if="preview" ref="positionPreviewRef" class="console-table-card iam-authorization-preview"><h4>授权预览与影响分析</h4><p v-if="preview.conflicts?.length" class="login-target-module__error">{{ preview.conflicts.join('；') }}</p><p v-else class="iam-field-help">以下为该岗位模板产生的角色；用户同时有多个有效任职时，实际权限是全部有效来源的并集。</p><ul><li v-for="role in preview.roles || []" :key="`${role.template_id}-${role.role_id}`"><strong>{{ role.application_name || role.application_code }}</strong> / {{ role.role_name || role.role_code }} <small>来源：{{ role.template_name }}</small></li><li v-if="!(preview.roles || []).length">当前岗位没有从模板获得有效应用角色。</li></ul></div>

    <!-- 通用确认弹窗（替代 window.confirm） -->
    <div v-if="confirmDialog && canManageAuthorization" class="iam-modal-backdrop" role="presentation" @click.self="closeConfirm">
      <section class="iam-modal iam-confirm-modal" role="dialog" aria-modal="true" :aria-label="confirmDialog.title">
        <header><div><p>{{ confirmDialog.danger ? '危险操作' : '请确认' }}</p><h3>{{ confirmDialog.title }}</h3></div><button class="console-modal-close" type="button" :aria-label="`关闭${confirmDialog.title}`" :disabled="confirmDialog.busy" @click="closeConfirm"><ConsoleIcon name="close" /></button></header>
        <div class="iam-confirm-body"><p style="white-space: pre-line;">{{ confirmDialog.description }}</p></div>
        <footer>
          <button class="console-button ghost" type="button" :disabled="confirmDialog.busy" @click="closeConfirm">取消</button>
          <button :class="['console-button', confirmDialog.danger ? 'iam-danger-button' : 'primary']" type="button" :disabled="confirmDialog.busy" @click="async () => { if (confirmDialog.busy) return; confirmDialog.busy = true; try { await confirmDialog.onConfirm() } catch { /* 错误已由 handler 处理 */ } finally { if (confirmDialog) confirmDialog.busy = false } }">{{ confirmDialog.confirmText }}</button>
        </footer>
      </section>
    </div>
  </section>
</template>
