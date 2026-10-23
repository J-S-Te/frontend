<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { formatUserError } from '../../../shared/utils/userError.js'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  createOrgUnit,
  createPosition,
} from '@/modules/platform/iam/api/iam'
import { listPositionAuthorizationTargets } from '@/modules/platform/iam/api/positionAuthorization'
import { createApplication } from '@/modules/platform/applications/api/applications'
import { organizationSelectOptions } from '@/modules/platform/iam/utils/selectionCatalog'

const props = defineProps({
  organizations: { type: Array, default: () => [] },
  positions: { type: Array, default: () => [] },
  applications: { type: Array, default: () => [] },
  // 父组件正在重新读取组织 / 岗位 / 应用目录。未确认前不允许进入下一步。
  referencesLoading: { type: Boolean, default: false },
  // 目录读取失败的用户可读原因；必须显式展示并提供重试，不能伪装成“没有组织 / 岗位”。
  referencesError: { type: String, default: '' },
  // 父级每次发起后台刷新时递增；递增后本组件会重新评估 应用目录 与整体状态。
  refreshKey: { type: Number, default: 0 },
})

const emit = defineEmits(['ready', 'not-ready', 'continue', 'refresh', 'retry-references', 'toast'])

// 应用 catalog 的真实"目标数"需要去问后端，prop 的 applications 是基础平台注册的应用列表。
// 两者可能不完全一致 —— 没有 catalog 就没有可分配的岗位授权模板，因此这里独立检查。
const appCatalogLoading = ref(false)
const appCatalogCount = ref(0)
const appCatalogChecked = ref(false)
const appCatalogError = ref('')

const orgForm = reactive({ name: '', parentId: '', sortOrder: 0 })
const positionForm = reactive({ orgUnitId: '', name: '' })
const applicationForm = reactive({ code: '', name: '', applicationType: 'web' })

const activeForm = ref('') // '' | 'organization' | 'position' | 'application'
const creatingKind = ref('')
const formError = ref('')

// 快速创建成功后必须等关联目录确认返回新数据才能继续：写入成功不等于选择器已更新。
const pendingConfirmation = ref(null) // { kind: 'organization' | 'position', id, name }
const confirmationFailure = ref('')

const organizationCount = computed(() => props.organizations.length)
const positionCount = computed(() => props.positions.length)
const organizationOptions = computed(() => organizationSelectOptions(props.organizations))

function catalogItemId(item, ...keys) {
  for (const key of keys) {
    const value = String(item?.[key] || '').trim()
    if (value) return value
  }
  return ''
}

const organizationIds = computed(() => new Set(props.organizations.map((item) => catalogItemId(item, 'org_unit_id', 'id')).filter(Boolean)))
const positionIds = computed(() => new Set(props.positions.map((item) => catalogItemId(item, 'position_id', 'id')).filter(Boolean)))

const organizationReady = computed(() => organizationCount.value > 0)
const positionReady = computed(() => positionCount.value > 0)
const applicationReady = computed(() => appCatalogCount.value > 0)

// 目录未确认（加载中、读取失败或刚创建但尚未在目录中出现）时不允许继续。
const catalogsConfirmed = computed(() => !props.referencesLoading && !props.referencesError && !pendingConfirmation.value && !confirmationFailure.value)
const allReady = computed(() => catalogsConfirmed.value && organizationReady.value && positionReady.value && applicationReady.value)

const continueHint = computed(() => {
  if (props.referencesLoading) return '正在读取最新目录…'
  if (pendingConfirmation.value) return '正在确认新数据…'
  if (confirmationFailure.value || props.referencesError) return '目录未确认，请重试读取'
  if (!organizationReady.value || !positionReady.value || !applicationReady.value) return '请先补齐前置项'
  return '开始新增员工'
})

function emitReadyState() {
  if (allReady.value) emit('ready')
  else emit('not-ready')
}

watch(allReady, () => { emitReadyState() })

function showToast(message) { emit('toast', message) }

function resolvePendingConfirmation() {
  const pending = pendingConfirmation.value
  if (!pending) return
  const present = pending.kind === 'organization'
    ? (pending.id ? organizationIds.value.has(pending.id) : props.organizations.length > 0)
    : (pending.id ? positionIds.value.has(pending.id) : props.positions.length > 0)
  if (present) {
    pendingConfirmation.value = null
    confirmationFailure.value = ''
    return
  }
  if (props.referencesLoading) return
  confirmationFailure.value = props.referencesError
    ? `已保存${pending.name ? `「${pending.name}」` : ''}，关联数据刷新失败：${props.referencesError}`
    : `已保存${pending.name ? `「${pending.name}」` : ''}，但关联目录尚未返回该数据。请重试读取，确认不再是旧目录后再继续。`
}

watch(
  () => [props.organizations, props.positions, props.referencesLoading, props.referencesError],
  () => { resolvePendingConfirmation(); emitReadyState() },
)

function beginConfirmation(kind, created, name) {
  const id = kind === 'organization'
    ? catalogItemId(created, 'org_unit_id', 'id')
    : catalogItemId(created, 'position_id', 'id')
  confirmationFailure.value = ''
  pendingConfirmation.value = { kind, id, name }
}

function retryReferences() {
  confirmationFailure.value = ''
  emit('retry-references')
  loadAppCatalog()
}

async function loadAppCatalog() {
  appCatalogLoading.value = true
  appCatalogError.value = ''
  try {
    const data = await listPositionAuthorizationTargets()
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
    appCatalogCount.value = items.length
  } catch (error) {
    appCatalogError.value = formatUserError(error, { fallback: '读取应用目录失败。' })
    appCatalogCount.value = 0
    console.error('OnboardingPrerequisiteStep: listPositionAuthorizationTargets failed', error)
  } finally {
    appCatalogLoading.value = false
    appCatalogChecked.value = true
    emitReadyState()
  }
}

function openForm(kind) {
  formError.value = ''
  activeForm.value = kind
  if (kind === 'position' && !positionForm.orgUnitId && organizationOptions.value.length) {
    positionForm.orgUnitId = organizationOptions.value[0].option_id
  }
}

function cancelForm() {
  activeForm.value = ''
  formError.value = ''
  creatingKind.value = ''
}

async function submitOrganization() {
  if (creatingKind.value) return
  const name = String(orgForm.name || '').trim()
  if (!name) { formError.value = '请填写组织名称。'; return }
  creatingKind.value = 'organization'
  formError.value = ''
  try {
    const created = await createOrgUnit({
      parentId: orgForm.parentId || null,
      name,
      sortOrder: Number(orgForm.sortOrder) || 0,
    })
    orgForm.name = ''
    orgForm.parentId = ''
    orgForm.sortOrder = 0
    activeForm.value = ''
    // 写入已确认成功；现在等待关联目录返回这条新组织，确认后才允许继续。
    beginConfirmation('organization', created, name)
    showToast(`组织 ${name} 已创建，正在确认关联目录…`)
    emit('refresh')
  } catch (error) {
    formError.value = formatUserError(error, { fallback: '创建组织失败。' })
  } finally {
    creatingKind.value = ''
  }
}

async function submitPosition() {
  if (creatingKind.value) return
  const orgUnitId = positionForm.orgUnitId
  const name = String(positionForm.name || '').trim()
  if (!orgUnitId) { formError.value = '请先选择所属组织。'; return }
  if (!name) { formError.value = '请填写岗位名称。'; return }
  creatingKind.value = 'position'
  formError.value = ''
  try {
    const created = await createPosition({ orgUnitId, name })
    positionForm.name = ''
    activeForm.value = ''
    beginConfirmation('position', created, name)
    showToast(`岗位 ${name} 已创建，正在确认关联目录…`)
    emit('refresh')
  } catch (error) {
    formError.value = formatUserError(error, { fallback: '创建岗位失败。' })
  } finally {
    creatingKind.value = ''
  }
}

async function submitApplication() {
  if (creatingKind.value) return
  const code = String(applicationForm.code || '').trim()
  const name = String(applicationForm.name || '').trim()
  if (!code) { formError.value = '请填写应用编码。'; return }
  if (!name) { formError.value = '请填写应用名称。'; return }
  creatingKind.value = 'application'
  formError.value = ''
  try {
    await createApplication({ code, name, applicationType: applicationForm.applicationType || 'web' })
    applicationForm.code = ''
    applicationForm.name = ''
    activeForm.value = ''
    showToast(`应用 ${name} 已注册。`)
    emit('refresh')
  } catch (error) {
    formError.value = formatUserError(error, { fallback: '注册应用失败。' })
  } finally {
    creatingKind.value = ''
  }
}

function onRefresh() {
  // 'refresh' 由弹窗转成 refresh-prerequisites，父组件据此重读组织 / 岗位 / 应用；
  // 与失败横幅里的 retry-references 走同一条读取路径（同一时刻的重复请求会合并）。
  confirmationFailure.value = ''
  loadAppCatalog()
  emit('refresh')
}

function onContinue() {
  if (!allReady.value) return
  emit('continue')
}

onMounted(() => { loadAppCatalog() })

// 父级每次刷新（含快速补齐后的重新读取）都递增 refreshKey；即使目录条数不变，
// 也要重新评估待确认状态和就绪状态。
watch(() => props.refreshKey, () => { resolvePendingConfirmation(); emitReadyState() })
</script>

<template>
  <section class="console-prereq-layout" aria-label="前置检查">
    <div class="settings-active-summary">
      <span class="settings-active-summary-icon"><ConsoleIcon name="info" /></span>
      <div class="settings-active-summary-copy">
        <strong>新增员工前请确认基础数据</strong>
        <p>至少 1 个组织、1 个岗位、1 个应用目录。缺失项可在此处直接补齐，不必跳到“身份、组织与授权”页面。</p>
      </div>
    </div>

    <div class="console-form-grid console-prereq-grid">
      <article class="console-card console-prereq-card" :data-ready="organizationReady ? 'true' : 'false'">
        <header class="console-prereq-card-head">
          <span class="console-status-dot" :class="organizationReady ? 'console-status-dot--ok' : 'console-status-dot--error'">
            <ConsoleIcon :name="organizationReady ? 'audit' : 'close'" />
          </span>
          <div>
            <h4>组织</h4>
            <p>至少需要 1 个组织作为员工的所属部门</p>
          </div>
          <span class="console-prereq-count">{{ organizationCount }}</span>
        </header>
        <div class="console-prereq-card-foot">
          <span v-if="pendingConfirmation?.kind === 'organization'" class="console-tag console-tag--pending">正在确认新组织…</span>
          <span v-else-if="referencesLoading" class="console-tag console-tag--pending">读取中…</span>
          <span v-else-if="referencesError" class="console-tag console-tag--error">目录读取失败</span>
          <span v-else-if="organizationReady" class="console-tag console-tag--ok">已就绪</span>
          <button v-else class="console-button ghost small" type="button" @click="openForm('organization')">
            <ConsoleIcon name="info" />快速创建组织
          </button>
        </div>
        <form v-if="activeForm === 'organization'" class="console-prereq-form" @submit.prevent="submitOrganization">
          <label><span>组织名称 *</span><input v-model="orgForm.name" required maxlength="64" placeholder="例如：研发中心" /></label>
          <label>
            <span>上级组织（留空为根）</span>
            <select v-model="orgForm.parentId">
              <option value="">无（根组织）</option>
              <option v-for="item in organizationOptions" :key="item.option_id" :value="item.option_id">
                {{ item.option_label }}
              </option>
            </select>
          </label>
          <label><span>显示顺序</span><input v-model.number="orgForm.sortOrder" type="number" min="0" step="10" /><small>数字越小，在同一上级组织下越靠前；建议使用 10、20、30。</small></label>
          <div class="console-form-actions">
            <button class="console-button ghost small" type="button" :disabled="creatingKind === 'organization'" @click="cancelForm">取消</button>
            <button class="console-button primary small" type="submit" :disabled="creatingKind === 'organization'">
              <ConsoleIcon name="save" />{{ creatingKind === 'organization' ? '创建中…' : '创建组织' }}
            </button>
          </div>
        </form>
      </article>

      <article class="console-card console-prereq-card" :data-ready="positionReady ? 'true' : 'false'">
        <header class="console-prereq-card-head">
          <span class="console-status-dot" :class="positionReady ? 'console-status-dot--ok' : 'console-status-dot--error'">
            <ConsoleIcon :name="positionReady ? 'audit' : 'close'" />
          </span>
          <div>
            <h4>岗位</h4>
            <p>至少需要 1 个岗位用于建立任职关系</p>
          </div>
          <span class="console-prereq-count">{{ positionCount }}</span>
        </header>
        <div class="console-prereq-card-foot">
          <span v-if="pendingConfirmation?.kind === 'position'" class="console-tag console-tag--pending">正在确认新岗位…</span>
          <span v-else-if="referencesLoading" class="console-tag console-tag--pending">读取中…</span>
          <span v-else-if="positionReady" class="console-tag console-tag--ok">已就绪</span>
          <button v-else class="console-button ghost small" type="button" @click="openForm('position')">
            <ConsoleIcon name="info" />快速创建岗位
          </button>
        </div>
        <form v-if="activeForm === 'position'" class="console-prereq-form" @submit.prevent="submitPosition">
          <label>
            <span>所属组织 *</span>
            <select v-model="positionForm.orgUnitId" required>
              <option value="">请选择组织</option>
              <option v-for="item in organizationOptions" :key="item.option_id" :value="item.option_id">
                {{ item.option_label }}
              </option>
            </select>
            <small v-if="!organizations.length">需要先创建至少 1 个组织。</small>
          </label>
          <label><span>岗位名称 *</span><input v-model="positionForm.name" required maxlength="64" placeholder="例如：研发经理" /></label>
          <div class="console-form-actions">
            <button class="console-button ghost small" type="button" :disabled="creatingKind === 'position'" @click="cancelForm">取消</button>
            <button class="console-button primary small" type="submit" :disabled="creatingKind === 'position' || !positionForm.orgUnitId">
              <ConsoleIcon name="save" />{{ creatingKind === 'position' ? '创建中…' : '创建岗位' }}
            </button>
          </div>
        </form>
      </article>

      <article class="console-card console-prereq-card" :data-ready="applicationReady ? 'true' : 'false'">
        <header class="console-prereq-card-head">
          <span class="console-status-dot" :class="appCatalogLoading ? 'console-status-dot--pending' : (applicationReady ? 'console-status-dot--ok' : 'console-status-dot--error')">
            <ConsoleIcon :name="appCatalogLoading ? 'info' : (applicationReady ? 'audit' : 'close')" />
          </span>
          <div>
            <h4>应用目录</h4>
            <p>至少需要 1 个应用拥有可分配的岗位授权目标</p>
          </div>
          <span class="console-prereq-count">{{ appCatalogChecked ? appCatalogCount : '…' }}</span>
        </header>
        <div class="console-prereq-card-foot">
          <span v-if="applicationReady" class="console-tag console-tag--ok">已就绪</span>
          <span v-else-if="appCatalogLoading" class="console-tag console-tag--pending">检查中…</span>
          <span v-else-if="appCatalogError" class="console-tag console-tag--error">{{ appCatalogError }}</span>
          <button v-else class="console-button ghost small" type="button" @click="openForm('application')">
            <ConsoleIcon name="info" />快速注册应用
          </button>
        </div>
        <form v-if="activeForm === 'application'" class="console-prereq-form" @submit.prevent="submitApplication">
          <label><span>应用编码 *</span><input v-model="applicationForm.code" required maxlength="64" placeholder="例如：crm-portal" /></label>
          <label><span>应用名称 *</span><input v-model="applicationForm.name" required maxlength="64" placeholder="例如：客户关系管理门户" /></label>
          <label>
            <span>应用类型</span>
            <select v-model="applicationForm.applicationType">
              <option value="web">Web 应用</option>
              <option value="api">API / 后端服务</option>
              <option value="cli">CLI 工具</option>
            </select>
          </label>
          <div class="console-form-actions">
            <button class="console-button ghost small" type="button" :disabled="creatingKind === 'application'" @click="cancelForm">取消</button>
            <button class="console-button primary small" type="submit" :disabled="creatingKind === 'application'">
              <ConsoleIcon name="save" />{{ creatingKind === 'application' ? '注册中…' : '注册应用' }}
            </button>
          </div>
        </form>
      </article>
    </div>

    <p v-if="formError" class="console-prereq-error" role="alert">{{ formError }}</p>
    <p v-if="confirmationFailure" class="console-prereq-error" role="alert">
      {{ confirmationFailure }}
      <button class="console-button ghost small" type="button" :disabled="appCatalogLoading" @click="retryReferences">
        <ConsoleIcon name="reset" />重试读取关联数据
      </button>
    </p>
    <p v-else-if="referencesError" class="console-prereq-error" role="alert">
      关联目录读取失败：{{ referencesError }}
      <button class="console-button ghost small" type="button" :disabled="appCatalogLoading" @click="retryReferences">
        <ConsoleIcon name="reset" />重试读取
      </button>
    </p>

    <div class="console-prereq-actions">
      <button class="console-button ghost small" type="button" :disabled="appCatalogLoading || referencesLoading" @click="onRefresh">
        <ConsoleIcon name="reset" />重新检查
      </button>
      <button class="console-button primary" type="button" :disabled="!allReady" @click="onContinue">
        <ConsoleIcon name="save" />{{ continueHint }}
      </button>
    </div>
  </section>
</template>
