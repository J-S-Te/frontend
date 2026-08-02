<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ApplicationLoginTargetModule from '@/modules/platform/login-targets/components/ApplicationLoginTargetModule.vue'
import {
  ApplicationRegistryError,
  deleteApplicationRegistration,
  deleteEnvironment,
  getSubsystemStatus,
  listApplications,
  listEnvironments,
  onboardSubsystem,
  retrySubsystem,
  teardownSubsystem,
  updateApplication,
  updateEnvironment,
  updateSubsystemRuntime,
} from '@/modules/platform/applications/api/applications'
import { hasPermission } from '@/modules/platform/auth/utils/principal'
import { applySubsystemOnboardingPreset, normalizeIntegratedSubsystemOnboarding, subsystemOnboardingPreset, validateIntegratedSubsystemOnboarding } from '@/modules/platform/applications/utils/subsystemPresets'

const props = defineProps({
  canOnboard: { type: Boolean, default: false },
})
const emit = defineEmits(['toast', 'completed'])

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const applications = ref([])
const applicationKeyword = ref('')
const applicationStatus = ref('')
const selectedApplicationId = ref('')
const environments = ref([])
const environmentsLoading = ref(false)
const selectedEnvironmentId = ref('')
const deploymentStates = ref({})
const showOnboard = ref(false)
const applicationEditorOpen = ref(false)
const environmentEditorOpen = ref(false)
const pendingDeleteApplication = ref(null)
const pendingDeleteEnvironment = ref(null)
const deleteConfirmation = ref('')
const environmentDeleteConfirmation = ref('')
const onboardExistingApplicationId = ref('')

const standardEnvironments = Object.freeze(['dev', 'test', 'staging', 'prod'])

const appForm = reactive(emptyApplicationForm())
const environmentForm = reactive(emptyEnvironmentForm())
const onboardForm = reactive(emptyOnboardForm())
const onboardConfirmation = ref('')

const canReadApplications = computed(() => hasPermission('platform:application:read'))
const canReadEnvironments = computed(() => hasPermission('platform:application-environment:read'))
const canUpdateApplication = computed(() => hasPermission('platform:application:update'))
const canUpdateEnvironment = computed(() => hasPermission('platform:application-environment:update'))
const canDeleteEnvironment = computed(() => hasPermission('platform:application-environment:delete'))
const canReadLoginTargets = computed(() => hasPermission('platform:application-login-target:read'))
const canManageRuntime = computed(() => [
  'platform:application:update',
  'platform:application-environment:update',
  'platform:application-login-target:update',
  'platform:oauth-client:disable',
].every((permission) => hasPermission(permission)))

const filteredApplications = computed(() => {
  const keyword = applicationKeyword.value.trim().toLowerCase()
  return applications.value.filter((item) => {
    if (applicationStatus.value && item.status !== applicationStatus.value) return false
    if (!keyword) return true
    return [item.code, item.name, item.description].some((value) => String(value || '').toLowerCase().includes(keyword))
  })
})
const selectedApplication = computed(() => applications.value.find((item) => item.application_id === selectedApplicationId.value) || null)
const selectedEnvironment = computed(() => environments.value.find((item) => item.environment_id === selectedEnvironmentId.value) || null)
const onboardingExistingApplication = computed(() => Boolean(onboardExistingApplicationId.value))
const availableOnboardEnvironments = computed(() => {
  if (!onboardingExistingApplication.value) return standardEnvironments
  const existing = new Set(environments.value.map((item) => item.environment))
  return standardEnvironments.filter((environment) => !existing.has(environment))
})
const onboardConfirmationCode = computed(() => `${onboardForm.applicationCode.trim().toLowerCase()}/${onboardForm.environment}`)
const onboardPreset = computed(() => subsystemOnboardingPreset(onboardForm.applicationCode))
const canSubmitOnboard = computed(() => Boolean(
  props.canOnboard
  && !loading.value
  && !saving.value
  && onboardForm.applicationCode.trim()
  && onboardForm.applicationName.trim()
  && onboardForm.publicBaseUrl.trim()
  && onboardForm.upstreamUrl.trim()
  && onboardForm.pathPrefix.trim()
  && onboardConfirmation.value.trim() === onboardConfirmationCode.value,
))

function emptyApplicationForm() {
  return {
    name: '',
    applicationType: 'web',
    homepageUrl: '',
    description: '',
    status: 'ACTIVE',
    version: 0,
  }
}

function emptyEnvironmentForm() {
  return {
    environment: '',
    environmentId: '',
    baseUrl: '',
    upstreamUrl: '',
    pathPrefix: '',
    issuerAlias: '',
    status: 'ACTIVE',
    version: 0,
  }
}

function emptyOnboardForm() {
  return {
    applicationCode: '',
    applicationName: '',
    description: '',
    environment: 'dev',
    publicBaseUrl: typeof window === 'undefined' ? 'http://localhost:8081' : window.location.origin,
    upstreamUrl: '',
    pathPrefix: '',
    clientType: 'confidential',
  }
}

function nullable(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function textValue(value) {
  return String(value || '').trim()
}

function notify(message) {
  emit('toast', message)
}

function statusLabel(status) {
  return {
    ACTIVE: '启用',
    DISABLED: '停用',
    DRAFT: '草稿',
    SUSPENDED: '暂停',
    RETIRED: '已退役',
    PROVISIONING: '接入中',
    UPDATING: '更新中',
    READY: '就绪',
    PROVISION_FAILED: '部署失败',
    DRAINING: '下线中',
    OFFBOARDED: '已下线',
  }[status] || status || '未知'
}

function statusClass(status) {
  return `is-${String(status || 'unknown').toLowerCase().replaceAll('_', '-')}`
}

function environmentStatus(environment) {
  return deploymentStates.value[environment.environment] || (environment.status === 'ACTIVE' ? 'READY' : environment.status)
}

function selectApplication(application) {
  selectedApplicationId.value = application.application_id
  applicationEditorOpen.value = false
  environmentEditorOpen.value = false
  pendingDeleteApplication.value = null
  deleteConfirmation.value = ''
  showOnboard.value = false
  onboardExistingApplicationId.value = ''
}

async function loadApplications(preferredApplicationId = selectedApplicationId.value) {
  if (!canReadApplications.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await listApplications({ page: 1, pageSize: 100, status: '' })
    const items = Array.isArray(data?.items) ? data.items : []
    applications.value = items
    const nextId = items.some((item) => item.application_id === preferredApplicationId)
      ? preferredApplicationId
      : items[0]?.application_id || ''
    selectedApplicationId.value = nextId
  } catch (error) {
    applications.value = []
    errorMessage.value = error instanceof ApplicationRegistryError ? error.message : '读取应用接入列表失败。'
  } finally {
    loading.value = false
  }
}

async function loadEnvironments() {
  const application = selectedApplication.value
  if (!application?.application_id || !canReadEnvironments.value) {
    environments.value = []
    selectedEnvironmentId.value = ''
    deploymentStates.value = {}
    return
  }
  environmentsLoading.value = true
  try {
    const data = await listEnvironments({ applicationId: application.application_id, page: 1, pageSize: 100, status: '' })
    environments.value = Array.isArray(data?.items) ? data.items : []
    selectedEnvironmentId.value = environments.value.some((item) => item.environment_id === selectedEnvironmentId.value)
      ? selectedEnvironmentId.value
      : environments.value[0]?.environment_id || ''
    const states = await Promise.allSettled(environments.value.map(async (environment) => [
      environment.environment,
      (await getSubsystemStatus({ applicationCode: application.code, environment: environment.environment }))?.status,
    ]))
    deploymentStates.value = Object.fromEntries(states
      .filter((result) => result.status === 'fulfilled' && result.value[1])
      .map((result) => result.value))
  } catch (error) {
    environments.value = []
    errorMessage.value = error instanceof ApplicationRegistryError ? error.message : '读取应用环境失败。'
  } finally {
    environmentsLoading.value = false
  }
}

function toggleOnboarding() {
  if (showOnboard.value) {
    showOnboard.value = false
    onboardExistingApplicationId.value = ''
    return
  }
  Object.assign(onboardForm, emptyOnboardForm())
  onboardExistingApplicationId.value = ''
  onboardConfirmation.value = ''
  errorMessage.value = ''
  showOnboard.value = true
}

function openApplicationEditor() {
  const application = selectedApplication.value
  if (!application) return
  Object.assign(appForm, {
    name: textValue(application.name),
    applicationType: application.application_type || 'web',
    homepageUrl: textValue(application.homepage_url),
    description: textValue(application.description),
    status: application.status || 'ACTIVE',
    version: application.version,
  })
  errorMessage.value = ''
  applicationEditorOpen.value = true
}

async function saveApplication() {
  const application = selectedApplication.value
  if (!application || !canUpdateApplication.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const updated = await updateApplication({
      applicationId: application.application_id,
      name: appForm.name,
      applicationType: appForm.applicationType,
      homepageUrl: nullable(appForm.homepageUrl),
      description: nullable(appForm.description),
      status: appForm.status,
      version: appForm.version,
    })
    applications.value = applications.value.map((item) => item.application_id === updated.application_id ? updated : item)
    applicationEditorOpen.value = false
    notify('应用登记信息已更新。')
  } catch (error) {
    errorMessage.value = error instanceof ApplicationRegistryError ? error.message : '更新应用登记失败。'
  } finally {
    saving.value = false
  }
}

function openEnvironmentEditor(environment) {
  if (!environment) return
  Object.assign(environmentForm, {
    environment: environment.environment,
    environmentId: environment.environment_id,
    baseUrl: textValue(environment.base_url),
    upstreamUrl: textValue(environment.upstream_url),
    pathPrefix: textValue(environment.path_prefix),
    issuerAlias: textValue(environment.issuer_alias),
    status: environment.status || 'ACTIVE',
    version: environment.version,
  })
  errorMessage.value = ''
  environmentEditorOpen.value = true
}

function openOnboardEnvironment() {
  const application = selectedApplication.value
  if (!application || !props.canOnboard) return
  const environment = standardEnvironments.find((item) => !environments.value.some((existing) => existing.environment === item))
  if (!environment) {
    errorMessage.value = 'dev、test、staging、prod 环境均已接入，不能重复创建。'
    return
  }
  onboardExistingApplicationId.value = application.application_id
  Object.assign(onboardForm, {
    applicationCode: application.code,
    applicationName: application.name || application.code,
    description: textValue(application.description),
    environment,
    publicBaseUrl: typeof window === 'undefined' ? 'http://localhost:8081' : window.location.origin,
    upstreamUrl: '',
    pathPrefix: `/${application.code}`,
    clientType: 'confidential',
  })
  applySubsystemOnboardingPreset(onboardForm)
  onboardConfirmation.value = ''
  showOnboard.value = true
}

async function saveEnvironment() {
  const application = selectedApplication.value
  if (!application || saving.value) return
  if (!environmentForm.version || !canUpdateEnvironment.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const saved = await updateEnvironment({
      applicationId: application.application_id,
      environmentId: environmentForm.environmentId,
      baseUrl: nullable(environmentForm.baseUrl),
      upstreamUrl: nullable(environmentForm.upstreamUrl),
      pathPrefix: nullable(environmentForm.pathPrefix),
      issuerAlias: nullable(environmentForm.issuerAlias),
      status: environmentForm.status,
      version: environmentForm.version,
    })
    environmentEditorOpen.value = false
    notify('应用环境配置已更新。')
    await loadApplications(application.application_id)
    selectedEnvironmentId.value = saved.environment_id
    await loadEnvironments()
  } catch (error) {
    errorMessage.value = error instanceof ApplicationRegistryError ? error.message : '保存应用环境失败。'
  } finally {
    saving.value = false
  }
}

function openDeleteApplication(application) {
  pendingDeleteApplication.value = application
  deleteConfirmation.value = ''
  errorMessage.value = ''
}

async function confirmDeleteApplication() {
  const application = pendingDeleteApplication.value
  if (!application || deleteConfirmation.value.trim() !== application.code || !canUpdateApplication.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await deleteApplicationRegistration({ applicationId: application.application_id, version: application.version, confirmationCode: application.code })
    pendingDeleteApplication.value = null
    deleteConfirmation.value = ''
    notify(`应用「${application.name || application.code}」已退役。`)
    await loadApplications('')
  } catch (error) {
    errorMessage.value = error instanceof ApplicationRegistryError ? error.message : '退役应用失败。'
  } finally {
    saving.value = false
  }
}

function openDeleteEnvironment(environment) {
  if (environment.environment === 'dev') {
    errorMessage.value = 'dev 环境不能通过管理页面删除；如需清理请保留其开发数据卷。'
    return
  }
  pendingDeleteEnvironment.value = environment
  environmentDeleteConfirmation.value = ''
  errorMessage.value = ''
}

async function confirmDeleteEnvironment() {
  const application = selectedApplication.value
  const environment = pendingDeleteEnvironment.value
  const confirmationCode = `${application?.code || ''}/${environment?.environment || ''}`
  if (!application || !environment || environmentDeleteConfirmation.value.trim() !== confirmationCode || !canDeleteEnvironment.value || !canManageRuntime.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await teardownSubsystem({ applicationCode: application.code, environment: environment.environment })
    await deleteEnvironment({
      applicationId: application.application_id,
      environmentId: environment.environment_id,
      confirmationCode,
      version: environment.version,
    })
    pendingDeleteEnvironment.value = null
    environmentDeleteConfirmation.value = ''
    notify(`环境 ${confirmationCode} 已清理并删除。`)
    await loadApplications(application.application_id)
    await loadEnvironments()
  } catch (error) {
    errorMessage.value = error instanceof ApplicationRegistryError ? error.message : '清理应用环境失败，平台配置未删除。'
  } finally {
    saving.value = false
  }
}

async function reapplyEnvironment(environment, retry = false) {
  const application = selectedApplication.value
  if (!application || !canManageRuntime.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const action = retry ? retrySubsystem : updateSubsystemRuntime
    await action({ applicationCode: application.code, environment: environment.environment })
    notify(retry ? '部署失败环境已重新尝试。' : '子系统已重新部署。')
    await loadEnvironments()
  } catch (error) {
    errorMessage.value = error instanceof ApplicationRegistryError ? error.message : '部署 Agent 操作失败。'
  } finally {
    saving.value = false
  }
}

async function submitOnboarding() {
	if (!canSubmitOnboard.value) return
	if (normalizeIntegratedSubsystemOnboarding(onboardForm)) {
		notify('已将客户与商机管理系统修正为统一 Docker 编排地址。')
	}
	const presetError = validateIntegratedSubsystemOnboarding(onboardForm)
	if (presetError) {
		errorMessage.value = presetError
		return
	}
  saving.value = true
  errorMessage.value = ''
  try {
    const result = await onboardSubsystem({
      applicationCode: onboardForm.applicationCode.trim().toLowerCase(),
      applicationName: onboardForm.applicationName.trim(),
      description: nullable(onboardForm.description),
      environment: onboardForm.environment,
      publicBaseUrl: onboardForm.publicBaseUrl.trim().replace(/\/$/, ''),
      upstreamUrl: onboardForm.upstreamUrl.trim().replace(/\/$/, ''),
      pathPrefix: onboardForm.pathPrefix.trim(),
      clientType: onboardForm.clientType,
    })
    showOnboard.value = false
    onboardExistingApplicationId.value = ''
    onboardConfirmation.value = ''
    notify(`${onboardForm.applicationName} ${onboardForm.environment} 环境已完成接入。`)
    emit('completed', result)
    await loadApplications(result?.application?.application_id || '')
  } catch (error) {
    errorMessage.value = error instanceof ApplicationRegistryError ? error.message : '子系统接入失败。'
  } finally {
    saving.value = false
  }
}

function selectEnvironment(environment) {
  selectedEnvironmentId.value = environment.environment_id
  environmentEditorOpen.value = false
}

watch(selectedApplicationId, () => { loadEnvironments() }, { immediate: true })
watch(() => onboardForm.applicationCode, (applicationCode, previousCode) => {
	applySubsystemOnboardingPreset(onboardForm, String(previousCode || '').trim().toLowerCase())
})
onMounted(() => { loadApplications() })
</script>

<template>
  <section class="console-card application-registry-module" aria-labelledby="application-registry-title">
    <div class="console-card-body">
      <header class="application-registry-header">
        <div>
          <span class="application-registry-eyebrow"><ConsoleIcon name="dashboard" /> APPLICATION REGISTRY</span>
          <h2 id="application-registry-title">应用接入管理</h2>
          <p>应用接入、环境、门户登录目标和部署运行时统一维护。应用编码保持稳定，配置修改使用版本校验，退役操作不会物理删除历史审计记录。</p>
        </div>
        <button v-if="props.canOnboard" class="console-button primary" type="button" @click="toggleOnboarding">
          <ConsoleIcon name="save" />{{ showOnboard ? '收起接入' : '新增接入' }}
        </button>
      </header>

      <form v-if="showOnboard" class="application-registry-onboard" @submit.prevent="submitOnboarding">
        <div class="application-registry-section-title"><div><strong>新增子系统接入</strong><small>首次接入一个不存在的应用环境；已有环境请使用下面的编辑或重试。</small></div></div>
        <div class="console-form-grid">
          <label class="console-form-item"><span>应用编码</span><input v-model="onboardForm.applicationCode" :disabled="onboardingExistingApplication" placeholder="customer_management" /></label>
          <label class="console-form-item"><span>应用名称</span><input v-model="onboardForm.applicationName" :disabled="onboardingExistingApplication" placeholder="客户管理系统" /></label>
          <label class="console-form-item"><span>环境</span><select v-model="onboardForm.environment"><option v-for="environment in availableOnboardEnvironments" :key="environment" :value="environment">{{ environment }}</option></select></label>
          <label class="console-form-item"><span>客户端类型</span><select v-model="onboardForm.clientType"><option value="confidential">confidential（推荐）</option><option value="public">public</option></select></label>
          <label class="console-form-item"><span>Public BaseURL</span><input v-model="onboardForm.publicBaseUrl" placeholder="http://localhost:8081" /></label>
          <label class="console-form-item"><span>UpstreamURL</span><input v-model="onboardForm.upstreamUrl" :readonly="Boolean(onboardPreset)" placeholder="http://customer-api:8080" /><small v-if="onboardPreset">统一 Docker 编排固定地址</small></label>
          <label class="console-form-item"><span>门户路径前缀</span><input v-model="onboardForm.pathPrefix" :readonly="Boolean(onboardPreset)" placeholder="/customer_management" /><small v-if="onboardPreset">统一前端固定路径</small></label>
          <label class="console-form-item"><span>应用说明</span><input v-model="onboardForm.description" placeholder="可选" /></label>
          <label class="console-form-item application-registry-confirm"><span>确认码：{{ onboardConfirmationCode || '应用编码/环境' }}</span><input v-model="onboardConfirmation" :placeholder="onboardConfirmationCode || '应用编码/环境'" autocomplete="off" /></label>
        </div>
        <div class="console-form-actions"><button class="console-button primary" type="submit" :disabled="!canSubmitOnboard || saving"><ConsoleIcon name="save" />{{ saving ? '接入中…' : '确认接入并部署' }}</button><small>若应用环境已存在，平台会阻止覆盖；请在下方选择后更新或重试。</small></div>
      </form>

      <p v-if="errorMessage" class="application-registry-error" role="alert">{{ errorMessage }}</p>

      <div v-if="!canReadApplications" class="application-registry-empty"><ConsoleIcon name="shield" /><strong>当前账号没有应用读取权限</strong><p>请联系平台管理员授予 platform:application:read。</p></div>
      <div v-else class="application-registry-layout">
        <aside class="application-registry-sidebar">
          <div class="application-registry-sidebar-head"><strong>已登记应用</strong><button class="console-button ghost small" type="button" :disabled="loading" @click="loadApplications()"><ConsoleIcon name="reset" />刷新</button></div>
          <div class="application-registry-filters"><input v-model="applicationKeyword" placeholder="搜索应用编码或名称" aria-label="搜索应用" /><select v-model="applicationStatus" aria-label="应用状态"><option value="">全部状态</option><option value="ACTIVE">启用</option><option value="DRAFT">草稿</option><option value="SUSPENDED">暂停</option><option value="RETIRED">已退役</option></select></div>
          <div v-if="loading" class="application-registry-list-state">正在读取…</div>
          <button v-for="application in filteredApplications" :key="application.application_id" type="button" class="application-registry-list-item" :class="{ 'is-selected': application.application_id === selectedApplicationId }" @click="selectApplication(application)">
            <span class="application-registry-app-icon"><ConsoleIcon name="dashboard" /></span>
            <span class="application-registry-list-copy"><strong>{{ application.name || application.code }}</strong><small>{{ application.code }}</small></span>
            <span class="application-registry-status" :class="statusClass(application.status)">{{ statusLabel(application.status) }}</span>
          </button>
          <div v-if="!loading && !filteredApplications.length" class="application-registry-list-state">暂无符合条件的应用。</div>
        </aside>

        <main v-if="selectedApplication" class="application-registry-detail">
          <header class="application-registry-detail-head">
            <div><span class="application-registry-eyebrow">APPLICATION</span><h3>{{ selectedApplication.name || selectedApplication.code }}</h3><p><code>{{ selectedApplication.code }}</code><span> · 版本 {{ selectedApplication.version }}</span></p></div>
            <div class="application-registry-detail-actions"><span class="application-registry-status" :class="statusClass(selectedApplication.status)">{{ statusLabel(selectedApplication.status) }}</span><button v-if="canUpdateApplication && selectedApplication.code !== 'platform'" class="console-button ghost small" type="button" @click="openApplicationEditor"><ConsoleIcon name="settings" />编辑应用</button><button v-if="canUpdateApplication && selectedApplication.code !== 'platform' && selectedApplication.status !== 'RETIRED'" class="console-button danger small" type="button" @click="openDeleteApplication(selectedApplication)"><ConsoleIcon name="close" />退役应用</button></div>
          </header>

          <form v-if="applicationEditorOpen" class="application-registry-editor" @submit.prevent="saveApplication">
            <div class="application-registry-section-title"><div><strong>编辑应用登记</strong><small>应用编码不可修改；修改会使用当前 version 防止覆盖其他管理员的更新。</small></div></div>
            <div class="console-form-grid"><label class="console-form-item"><span>应用编码</span><input :value="selectedApplication.code" disabled /></label><label class="console-form-item"><span>应用名称</span><input v-model="appForm.name" /></label><label class="console-form-item"><span>应用类型</span><select v-model="appForm.applicationType"><option value="web">web</option><option value="spa">spa</option><option value="backend">backend</option><option value="mobile">mobile</option><option value="third_party">third_party</option></select></label><label class="console-form-item"><span>应用状态</span><select v-model="appForm.status"><option value="DRAFT">草稿</option><option value="ACTIVE">启用</option><option value="SUSPENDED">暂停</option><option value="RETIRED">已退役</option></select></label><label class="console-form-item"><span>主页地址</span><input v-model="appForm.homepageUrl" placeholder="可选 HTTPS 地址" /></label><label class="console-form-item"><span>应用说明</span><input v-model="appForm.description" /></label></div>
            <div class="console-form-actions"><button class="console-button primary" type="submit" :disabled="saving"><ConsoleIcon name="save" />保存应用</button><button class="console-button ghost" type="button" :disabled="saving" @click="applicationEditorOpen = false">取消</button></div>
          </form>

          <section class="application-registry-panel">
            <header class="application-registry-panel-head"><div><h4>部署环境</h4><p>维护 Public BaseURL、UpstreamURL、门户路径和运行状态。删除环境前会先清理容器、配置文件和网关入口。</p></div><button v-if="props.canOnboard && selectedApplication.status !== 'RETIRED'" class="console-button primary small" type="button" @click="openOnboardEnvironment"><ConsoleIcon name="save" />新增接入环境</button></header>
            <div v-if="!canReadEnvironments" class="application-registry-empty compact"><ConsoleIcon name="shield" /><span>当前账号没有 platform:application-environment:read，不能读取部署环境。</span></div>
            <div v-else-if="environmentsLoading" class="application-registry-list-state">正在读取环境…</div>
            <div v-else-if="!environments.length" class="application-registry-empty compact"><ConsoleIcon name="info" /><span>当前应用还没有部署环境。</span></div>
            <div v-else class="application-registry-environments">
              <article v-for="environment in environments" :key="environment.environment_id" class="application-registry-environment" :class="{ 'is-selected': environment.environment_id === selectedEnvironmentId }" @click="selectEnvironment(environment)">
                <div class="application-registry-environment-main"><strong>{{ environment.environment }}</strong><span class="application-registry-status" :class="statusClass(environmentStatus(environment))">{{ statusLabel(environmentStatus(environment)) }}</span><small>配置版本 {{ environment.version }}</small></div>
                <div class="application-registry-environment-uri"><span>{{ environment.base_url || '未设置 BaseURL' }}{{ environment.path_prefix || '' }}</span><small>{{ environment.upstream_url || '未设置 UpstreamURL' }}</small></div>
                <div class="application-registry-environment-actions"><button v-if="canUpdateEnvironment" class="console-button ghost small" type="button" @click.stop="openEnvironmentEditor(environment)"><ConsoleIcon name="settings" />设置</button><button v-if="canManageRuntime && environmentStatus(environment) === 'PROVISION_FAILED'" class="console-button ghost small" type="button" :disabled="saving" @click.stop="reapplyEnvironment(environment, true)"><ConsoleIcon name="reset" />重试</button><button v-if="canManageRuntime && environmentStatus(environment) === 'READY'" class="console-button ghost small" type="button" :disabled="saving" @click.stop="reapplyEnvironment(environment)"><ConsoleIcon name="reset" />更新运行时</button><button v-if="canDeleteEnvironment && environment.environment !== 'dev'" class="console-button danger small" type="button" @click.stop="openDeleteEnvironment(environment)"><ConsoleIcon name="close" />删除</button></div>
              </article>
            </div>
          </section>

          <form v-if="environmentEditorOpen" class="application-registry-editor" @submit.prevent="saveEnvironment">
            <div class="application-registry-section-title"><div><strong>设置应用环境</strong><small>environment 编码创建后不可修改；URL 和路径更新需要重新部署运行时。</small></div></div>
            <div class="console-form-grid"><label class="console-form-item"><span>环境</span><input v-model="environmentForm.environment" :disabled="Boolean(environmentForm.version)" placeholder="dev / test / staging / prod" /></label><label class="console-form-item"><span>环境状态</span><select v-model="environmentForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label><label class="console-form-item"><span>Public BaseURL</span><input v-model="environmentForm.baseUrl" placeholder="http://localhost:8081" /></label><label class="console-form-item"><span>UpstreamURL</span><input v-model="environmentForm.upstreamUrl" placeholder="http://customer-api:8080" /></label><label class="console-form-item"><span>门户路径前缀</span><input v-model="environmentForm.pathPrefix" placeholder="/customer_management" /></label><label class="console-form-item"><span>Issuer Alias</span><input v-model="environmentForm.issuerAlias" placeholder="可选" /></label></div>
            <div class="console-form-actions"><button class="console-button primary" type="submit" :disabled="saving"><ConsoleIcon name="save" />{{ saving ? '保存中…' : '保存环境' }}</button><button class="console-button ghost" type="button" :disabled="saving" @click="environmentEditorOpen = false">取消</button></div>
          </form>

          <ApplicationLoginTargetModule v-if="selectedEnvironment && canReadLoginTargets" :application-id="selectedApplication.application_id" :environment-id="selectedEnvironment.environment_id" :application-name="selectedApplication.name || selectedApplication.code" :environment-name="selectedEnvironment.environment" @toast="notify" />
        </main>
        <div v-else class="application-registry-empty"><ConsoleIcon name="dashboard" /><strong>请选择一个应用</strong><p>应用登记、环境配置和登录目标将在这里统一维护。</p></div>
      </div>
    </div>

    <div v-if="pendingDeleteApplication" class="application-registry-modal-backdrop" role="presentation" @click.self="pendingDeleteApplication = null">
      <section class="application-registry-modal" role="dialog" aria-modal="true" aria-label="退役应用确认"><h3>退役应用「{{ pendingDeleteApplication.name || pendingDeleteApplication.code }}」</h3><p>这是逻辑退役，不会物理删除环境、OAuth Client、登录目标和审计历史；门户将停止展示该应用。若还需停止容器和清理网关，请先逐个删除非 dev 环境，并按运维流程处理受保护的 dev 环境。</p><label class="console-form-item"><span>请输入应用编码确认：{{ pendingDeleteApplication.code }}</span><input v-model="deleteConfirmation" autocomplete="off" /></label><footer class="console-form-actions"><button class="console-button danger" type="button" :disabled="deleteConfirmation.trim() !== pendingDeleteApplication.code || saving" @click="confirmDeleteApplication">确认退役</button><button class="console-button ghost" type="button" @click="pendingDeleteApplication = null">取消</button></footer></section>
    </div>

    <div v-if="pendingDeleteEnvironment" class="application-registry-modal-backdrop" role="presentation" @click.self="pendingDeleteEnvironment = null">
      <section class="application-registry-modal" role="dialog" aria-modal="true" aria-label="删除环境确认"><h3>删除环境 {{ selectedApplication.code }}/{{ pendingDeleteEnvironment.environment }}</h3><p>平台会先停止容器、删除 `.env.local`、移除网关入口，再删除环境记录及其派生登录目标和 OAuth Client。</p><label class="console-form-item"><span>请输入确认码：{{ selectedApplication.code }}/{{ pendingDeleteEnvironment.environment }}</span><input v-model="environmentDeleteConfirmation" autocomplete="off" /></label><footer class="console-form-actions"><button class="console-button danger" type="button" :disabled="environmentDeleteConfirmation.trim() !== `${selectedApplication.code}/${pendingDeleteEnvironment.environment}` || saving" @click="confirmDeleteEnvironment">确认清理并删除</button><button class="console-button ghost" type="button" @click="pendingDeleteEnvironment = null">取消</button></footer></section>
    </div>
  </section>
</template>

<style scoped>
.application-registry-module { overflow: hidden; }
.application-registry-header, .application-registry-detail-head, .application-registry-panel-head, .application-registry-sidebar-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.application-registry-header h2 { margin: 6px 0 0; }
.application-registry-header p, .application-registry-panel-head p { max-width: 820px; margin: 7px 0 0; color: #64748b; font-size: 13px; line-height: 1.65; }
.application-registry-eyebrow { display: inline-flex; align-items: center; gap: 6px; color: #2563eb; font-size: 11px; font-weight: 750; letter-spacing: .08em; }
.application-registry-eyebrow :deep(svg) { width: 15px; height: 15px; }
.application-registry-onboard, .application-registry-editor { margin-top: 18px; padding: 16px; border: 1px solid #bfdbfe; border-radius: 12px; background: #f8fbff; }
.application-registry-section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.application-registry-section-title strong, .application-registry-section-title small { display: block; }
.application-registry-section-title small { margin-top: 4px; color: #64748b; font-size: 12px; }
.application-registry-confirm { grid-column: span 2; }
.application-registry-error { margin: 14px 0 0; padding: 10px 12px; color: #b91c1c; border: 1px solid #fecaca; border-radius: 8px; background: #fff7f7; font-size: 12px; line-height: 1.55; }
.application-registry-layout { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 18px; margin-top: 20px; }
.application-registry-sidebar { min-width: 0; padding: 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
.application-registry-sidebar-head { align-items: center; }
.application-registry-sidebar-head strong { color: #1e293b; }
.application-registry-filters { display: grid; gap: 8px; margin: 12px 0; }
.application-registry-filters input, .application-registry-filters select { width: 100%; min-height: 34px; padding: 0 9px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: #334155; font-size: 12px; }
.application-registry-list-item { display: flex; align-items: center; width: 100%; gap: 9px; padding: 10px 8px; border: 0; border-radius: 8px; background: transparent; color: #334155; text-align: left; cursor: pointer; }
.application-registry-list-item:hover, .application-registry-list-item.is-selected { background: #eaf2ff; }
.application-registry-app-icon { display: grid; flex: 0 0 28px; width: 28px; height: 28px; place-items: center; color: #2563eb; border-radius: 7px; background: #dbeafe; }
.application-registry-app-icon :deep(svg) { width: 15px; height: 15px; }
.application-registry-list-copy { min-width: 0; flex: 1; }
.application-registry-list-copy strong, .application-registry-list-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.application-registry-list-copy strong { font-size: 12px; }
.application-registry-list-copy small { margin-top: 2px; color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
.application-registry-status { display: inline-flex; align-items: center; padding: 3px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; white-space: nowrap; }
.application-registry-status.is-active, .application-registry-status.is-ready { color: #047857; background: #d1fae5; }
.application-registry-status.is-draft, .application-registry-status.is-provisioning, .application-registry-status.is-updating { color: #1d4ed8; background: #dbeafe; }
.application-registry-status.is-disabled, .application-registry-status.is-suspended, .application-registry-status.is-offboarded { color: #64748b; background: #e2e8f0; }
.application-registry-status.is-retired, .application-registry-status.is-provision-failed { color: #b91c1c; background: #fee2e2; }
.application-registry-status.is-draining { color: #b45309; background: #fef3c7; }
.application-registry-list-state { padding: 18px 8px; color: #94a3b8; font-size: 12px; text-align: center; }
.application-registry-detail { min-width: 0; }
.application-registry-detail-head { align-items: center; padding-bottom: 15px; border-bottom: 1px solid #e2e8f0; }
.application-registry-detail-head h3 { margin: 5px 0 0; color: #0f172a; font-size: 21px; }
.application-registry-detail-head p { margin: 5px 0 0; color: #94a3b8; font-size: 11px; }
.application-registry-detail-head code, .application-registry-environment-uri span, .application-registry-environment-uri small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.application-registry-detail-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 7px; }
.application-registry-panel { margin-top: 18px; }
.application-registry-panel-head { align-items: center; margin-bottom: 11px; }
.application-registry-panel-head h4 { margin: 0; color: #1e293b; font-size: 15px; }
.application-registry-panel-head p { margin-top: 4px; font-size: 11px; }
.application-registry-environments { display: grid; gap: 8px; }
.application-registry-environment { padding: 12px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; cursor: pointer; }
.application-registry-environment:hover, .application-registry-environment.is-selected { border-color: #93c5fd; box-shadow: 0 0 0 2px #eff6ff; }
.application-registry-environment-main, .application-registry-environment-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.application-registry-environment-main strong { color: #0f172a; font-size: 13px; }
.application-registry-environment-main small { color: #94a3b8; font-size: 10px; }
.application-registry-environment-uri { display: grid; min-width: 0; gap: 3px; margin: 7px 0; color: #475569; font-size: 11px; }
.application-registry-environment-uri small { color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.application-registry-environment-actions { justify-content: flex-end; }
.application-registry-empty { display: grid; min-height: 180px; place-items: center; align-content: center; gap: 7px; margin-top: 20px; color: #94a3b8; text-align: center; }
.application-registry-empty :deep(svg) { width: 28px; height: 28px; color: #60a5fa; }
.application-registry-empty strong { color: #475569; font-size: 14px; }
.application-registry-empty p { margin: 0; font-size: 12px; }
.application-registry-empty.compact { min-height: 90px; display: flex; justify-content: center; }
.application-registry-modal-backdrop { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / 35%); }
.application-registry-modal { width: min(460px, 100%); padding: 22px; border-radius: 14px; background: #fff; box-shadow: 0 20px 60px rgb(15 23 42 / 25%); }
.application-registry-modal h3 { margin: 0; color: #0f172a; font-size: 17px; }
.application-registry-modal p { margin: 10px 0 16px; color: #64748b; font-size: 12px; line-height: 1.65; }
.application-registry-modal .console-form-actions { justify-content: flex-end; margin-top: 16px; }
.console-button.danger { color: #b91c1c; border-color: #fecaca; background: #fff7f7; }
@media (max-width: 980px) { .application-registry-layout { grid-template-columns: 1fr; } .application-registry-sidebar { max-height: 300px; overflow: auto; } }
@media (max-width: 640px) { .application-registry-header, .application-registry-detail-head, .application-registry-panel-head { flex-direction: column; align-items: stretch; } .application-registry-confirm { grid-column: auto; } .application-registry-detail-actions { justify-content: flex-start; } }
</style>
