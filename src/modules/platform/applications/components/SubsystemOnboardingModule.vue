<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ApplicationLoginTargetModule from '@/modules/platform/login-targets/components/ApplicationLoginTargetModule.vue'
import {
  ApplicationRegistryError,
  deleteApplicationRegistration,
  deleteEnvironment,
  getSubsystemCapabilities,
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
const errorNextAction = ref('')
const errorDetail = ref('')
const errorTraceId = ref('')
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
const provisioningCapabilities = ref(null)
const applicationsLoaded = ref(false)
const productionTargetInventoryReady = ref(false)
const productionTargetInventoryLoading = ref(false)
const productionTargetInventoryError = ref('')
const registeredProductionTargetKeys = ref(new Set())

const standardEnvironments = Object.freeze(['dev', 'test', 'staging', 'prod'])
const preferredEnvironments = computed(() => {
  const supported = provisioningCapabilities.value?.supported_environments
  return Array.isArray(supported) && supported.length > 0 ? supported : standardEnvironments
})

const appForm = reactive(emptyApplicationForm())
const environmentForm = reactive(emptyEnvironmentForm())
const onboardForm = reactive(emptyOnboardForm())
const onboardConfirmation = ref('')
const selectedProductionTargetKey = ref('')

const canReadApplications = computed(() => hasPermission('platform:application:read'))
const canReadEnvironments = computed(() => hasPermission('platform:application-environment:read'))
const canUpdateApplication = computed(() => hasPermission('platform:application:update'))
const canUpdateEnvironment = computed(() => hasPermission('platform:application-environment:update'))
const canDeleteEnvironment = computed(() => hasPermission('platform:application-environment:delete'))
const canReadLoginTargets = computed(() => hasPermission('platform:application-login-target:read'))
// 运行时重部署/下线会同时影响应用、环境、登录目标和 OAuth 客户端，必须具备完整权限集；
// 只拥有其中一个更新权限时不展示入口，后端仍会逐项执行最终鉴权。
const canManageRuntime = computed(() => [
  'platform:application:update',
  'platform:application-environment:update',
  'platform:application-login-target:update',
  'platform:oauth-client:disable',
].every((permission) => hasPermission(permission)))
const canRetryRuntime = computed(() => canManageRuntime.value && hasPermission('platform:role-binding:update'))

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
const isProductionProvisioning = computed(() => provisioningCapabilities.value?.deployment_mode === 'production')
const automationUnavailable = computed(() => provisioningCapabilities.value?.automation_enabled === false)
const supportedApplicationCodes = computed(() => {
  const supported = provisioningCapabilities.value?.supported_application_codes
  return Array.isArray(supported) ? supported : []
})
const productionTargets = computed(() => {
  const targets = provisioningCapabilities.value?.targets
  if (!Array.isArray(targets)) return []
  return targets.filter((target) => target?.application_code && target?.environment)
})
const selectableProductionTargets = computed(() => {
  if (!productionTargetInventoryReady.value || productionTargetInventoryLoading.value || productionTargetInventoryError.value) return []
  const applicationCode = onboardingExistingApplication.value ? selectedApplication.value?.code : ''
  return productionTargets.value.filter((target) => {
    if (applicationCode && target.application_code !== applicationCode) return false
    return !registeredProductionTargetKeys.value.has(productionTargetKey(target))
  })
})
const selectedProductionTarget = computed(() => selectableProductionTargets.value.find((target) => productionTargetKey(target) === selectedProductionTargetKey.value) || null)
const productionProvisioningSummary = computed(() => {
  if (isProductionProvisioning.value && productionTargets.value.length === 0) return '暂无可接入目标'
  if (productionTargets.value.length > 0) {
    return productionTargets.value
      .map((target) => `${target.application_name || target.application_code}（${target.application_code}/${target.environment}）`)
      .join('、')
  }
  const defaults = provisioningCapabilities.value?.defaults || {}
  const applications = supportedApplicationCodes.value.length
    ? supportedApplicationCodes.value
    : [defaults.application_code].filter(Boolean)
  const environments = preferredEnvironments.value.length
    ? preferredEnvironments.value
    : [defaults.environment].filter(Boolean)
  const applicationText = applications.length ? applications.join('、') : '由服务器配置'
  const environmentText = environments.length ? environments.join('、') : '由服务器配置'
  return `应用：${applicationText}；环境：${environmentText}`
})
const availableOnboardEnvironments = computed(() => {
  if (isProductionProvisioning.value && productionTargets.value.length > 0) {
    const supported = productionTargets.value
      .filter((target) => target.application_code === onboardForm.applicationCode)
      .map((target) => target.environment)
    if (!onboardingExistingApplication.value) return [...new Set(supported)]
    const existing = new Set(environments.value.map((item) => item.environment))
    return [...new Set(supported)].filter((environment) => !existing.has(environment))
  }
  const supported = preferredEnvironments.value
  if (!onboardingExistingApplication.value) return supported
  const existing = new Set(environments.value.map((item) => item.environment))
  return supported.filter((environment) => !existing.has(environment))
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
  && !automationUnavailable.value
  && (!isProductionProvisioning.value || selectedProductionTarget.value)
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
    environment: 'prod',
    publicBaseUrl: typeof window === 'undefined' ? 'http://localhost:8081' : window.location.origin,
    upstreamUrl: '',
    pathPrefix: '',
    clientType: 'confidential',
  }
}

function productionTargetKey(target) {
  return `${target?.application_code || ''}/${target?.environment || ''}`
}

function applyProductionProvisioningPreset(preferredTarget = null) {
  const defaults = provisioningCapabilities.value?.defaults || {}
  const preferredCode = preferredTarget?.application_code || (onboardingExistingApplication.value ? selectedApplication.value?.code : defaults.application_code)
  const preferredEnvironment = preferredTarget?.environment || defaults.environment
  const target = preferredTarget
    || selectableProductionTargets.value.find((item) => item.application_code === preferredCode && item.environment === preferredEnvironment)
    || selectableProductionTargets.value.find((item) => item.application_code === preferredCode)
    || selectableProductionTargets.value[0]
  selectedProductionTargetKey.value = target ? productionTargetKey(target) : ''
  Object.assign(onboardForm, {
    applicationCode: target?.application_code || '',
    applicationName: target?.application_name || '',
    description: target?.description || '',
    environment: target?.environment || '',
    // Production public origin is supplied by the backend OIDC issuer. Never infer it
    // from the browser address bar, which may be a private host or an alternate alias.
    publicBaseUrl: defaults.public_base_url || '',
    upstreamUrl: target?.upstream_url || '',
    pathPrefix: target?.path_prefix || '',
    clientType: target?.client_type || 'confidential',
  })
  onboardConfirmation.value = ''
  clearError()
}

function selectProductionTarget(event) {
  const key = event?.target?.value || ''
  const target = selectableProductionTargets.value.find((item) => productionTargetKey(item) === key)
  if (target) applyProductionProvisioningPreset(target)
}

function clearError() {
  errorMessage.value = ''
  errorNextAction.value = ''
  errorDetail.value = ''
  errorTraceId.value = ''
}

function setError(error, fallback) {
  if (error instanceof ApplicationRegistryError) {
    errorMessage.value = error.message
    errorNextAction.value = error.nextAction
    errorDetail.value = error.detail
    errorTraceId.value = error.traceId
    return
  }
  errorMessage.value = fallback
  errorNextAction.value = ''
  errorDetail.value = ''
  errorTraceId.value = ''
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
    UNKNOWN: '状态未知',
  }[status] || status || '未知'
}

function statusClass(status) {
  return `is-${String(status || 'unknown').toLowerCase().replaceAll('_', '-')}`
}

function environmentStatus(environment) {
  return deploymentStates.value[environment.environment]?.status || (environment.status === 'ACTIVE' ? 'UNKNOWN' : environment.status)
}

function environmentNextAction(environment) {
  return deploymentStates.value[environment.environment]?.next_action || ''
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
  applicationsLoaded.value = false
  productionTargetInventoryReady.value = false
  productionTargetInventoryError.value = ''
  clearError()
  try {
    const data = await listApplications({ page: 1, pageSize: 100, status: '' })
    const items = Array.isArray(data?.items) ? data.items : []
    applications.value = items
    const nextId = items.some((item) => item.application_id === preferredApplicationId)
      ? preferredApplicationId
      : items[0]?.application_id || ''
    selectedApplicationId.value = nextId
    applicationsLoaded.value = true
    await refreshProductionTargetInventory()
  } catch (error) {
    applications.value = []
    applicationsLoaded.value = false
    productionTargetInventoryReady.value = false
    setError(error, '读取应用接入列表失败。')
  } finally {
    loading.value = false
  }
}

// capabilities.targets only describes reviewed server manifests. The browser must also
// inventory every registered application's environments before showing a target, otherwise
// an already-onboarded target could briefly appear selectable while the page is loading.
async function refreshProductionTargetInventory() {
  if (!isProductionProvisioning.value || !applicationsLoaded.value) return
  productionTargetInventoryLoading.value = true
  productionTargetInventoryReady.value = false
  productionTargetInventoryError.value = ''
  registeredProductionTargetKeys.value = new Set()
  if (!canReadEnvironments.value) {
    productionTargetInventoryError.value = '当前账号没有读取应用环境的权限，无法确认服务器接入目标是否已使用。'
    productionTargetInventoryLoading.value = false
    return
  }
  try {
    const results = await Promise.allSettled(applications.value.map(async (application) => {
      const data = await listEnvironments({ applicationId: application.application_id, page: 1, pageSize: 100, status: '' })
      return { application, environments: Array.isArray(data?.items) ? data.items : [] }
    }))
    if (results.some((result) => result.status !== 'fulfilled')) {
      productionTargetInventoryError.value = '暂时无法读取已接入环境，已隐藏服务器接入目标；请刷新后重试。'
      return
    }
    const registered = new Set()
    results.forEach((result) => {
      result.value.environments.forEach((environment) => {
        registered.add(productionTargetKey({
          application_code: result.value.application.code,
          environment: environment.environment,
        }))
      })
    })
    registeredProductionTargetKeys.value = registered
    productionTargetInventoryReady.value = true
  } finally {
    productionTargetInventoryLoading.value = false
  }
}

async function loadProvisioningCapabilities() {
  if (!canReadApplications.value) return
  try {
    provisioningCapabilities.value = await getSubsystemCapabilities()
    if (provisioningCapabilities.value?.deployment_mode === 'production') {
      await refreshProductionTargetInventory()
      if (productionTargetInventoryReady.value) applyProductionProvisioningPreset()
    }
  } catch (error) {
    provisioningCapabilities.value = null
    productionTargetInventoryReady.value = false
    setError(error, '读取部署 Agent 能力失败；后端仍会执行最终安全校验。')
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
    // 环境目录是控制面配置，部署状态来自 Agent。单个 Agent 状态查询失败不应抹掉
    // 其他环境，使用 allSettled 保留成功结果并回退到环境自身状态。
    const states = await Promise.allSettled(environments.value.map(async (environment) => [
      environment.environment,
      await getSubsystemStatus({ applicationCode: application.code, environment: environment.environment }),
    ]))
    deploymentStates.value = Object.fromEntries(states
      .filter((result) => result.status === 'fulfilled' && result.value[1]?.status)
      .map((result) => result.value))
  } catch (error) {
    environments.value = []
    setError(error, '读取应用环境失败。')
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
  clearError()
  if (isProductionProvisioning.value) applyProductionProvisioningPreset()
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
  clearError()
  applicationEditorOpen.value = true
}

async function saveApplication() {
  const application = selectedApplication.value
  if (!application || !canUpdateApplication.value || saving.value) return
  saving.value = true
  clearError()
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
    setError(error, '更新应用登记失败。')
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
  clearError()
  environmentEditorOpen.value = true
}

function openOnboardEnvironment() {
  const application = selectedApplication.value
  if (!application || !props.canOnboard) return
  if (supportedApplicationCodes.value.length > 0 && !supportedApplicationCodes.value.includes(application.code)) {
    setError(null, `当前部署 Agent 不支持应用 ${application.code}，不能在此服务器新增运行环境。`)
    return
  }
  const target = isProductionProvisioning.value
    ? selectableProductionTargets.value.find((item) => item.application_code === application.code)
    : null
  if (isProductionProvisioning.value && !target) {
    setError(null, '暂无可接入目标：该应用在服务器审核清单中没有尚未接入的环境。')
    return
  }
  const environment = target?.environment || preferredEnvironments.value.find((item) => !environments.value.some((existing) => existing.environment === item))
  if (!environment) {
    setError(null, `${preferredEnvironments.value.join('、')} 环境均已接入，不能重复创建。`)
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
  if (target) applyProductionProvisioningPreset(target)
  else applySubsystemOnboardingPreset(onboardForm)
  onboardConfirmation.value = ''
  showOnboard.value = true
}

async function saveEnvironment() {
  const application = selectedApplication.value
  if (!application || saving.value) return
  if (!environmentForm.version || !canUpdateEnvironment.value) return
  saving.value = true
  clearError()
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
    setError(error, '保存应用环境失败。')
  } finally {
    saving.value = false
  }
}

function openDeleteApplication(application) {
  pendingDeleteApplication.value = application
  deleteConfirmation.value = ''
  clearError()
}

async function confirmDeleteApplication() {
  const application = pendingDeleteApplication.value
  if (!application || deleteConfirmation.value.trim() !== application.code || !canUpdateApplication.value || saving.value) return
  saving.value = true
  clearError()
  try {
    await deleteApplicationRegistration({ applicationId: application.application_id, version: application.version, confirmationCode: application.code })
    pendingDeleteApplication.value = null
    deleteConfirmation.value = ''
    notify(`应用「${application.name || application.code}」已退役。`)
    await loadApplications('')
  } catch (error) {
    setError(error, '退役应用失败。')
  } finally {
    saving.value = false
  }
}

function openDeleteEnvironment(environment) {
  if (environment.environment === 'dev') {
    setError(null, 'dev 环境不能通过管理页面删除；如需清理请保留其开发数据卷。')
    return
  }
  pendingDeleteEnvironment.value = environment
  environmentDeleteConfirmation.value = ''
  clearError()
}

async function confirmDeleteEnvironment() {
  const application = selectedApplication.value
  const environment = pendingDeleteEnvironment.value
  const confirmationCode = `${application?.code || ''}/${environment?.environment || ''}`
  if (!application || !environment || environmentDeleteConfirmation.value.trim() !== confirmationCode || !canDeleteEnvironment.value || !canManageRuntime.value || saving.value) return
  saving.value = true
  clearError()
  try {
    // 先清理运行时，再删除控制面环境记录。若 Agent 清理失败，保留数据库配置以便重试，
    // 防止出现“记录已删但容器、密钥和网关入口仍存留”的孤儿运行时。
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
    setError(error, '清理应用环境失败，平台配置未删除。')
  } finally {
    saving.value = false
  }
}

async function reapplyEnvironment(environment, retry = false) {
  const application = selectedApplication.value
  if (!application || !canManageRuntime.value || saving.value) return
  saving.value = true
  clearError()
  try {
    const action = retry ? retrySubsystem : updateSubsystemRuntime
    await action({ applicationCode: application.code, environment: environment.environment })
    notify(retry ? '部署失败环境已重新尝试。' : '子系统已重新部署。')
    await loadEnvironments()
  } catch (error) {
    setError(error, '部署 Agent 操作失败。')
  } finally {
    saving.value = false
  }
}

async function submitOnboarding() {
  if (!canSubmitOnboard.value) return
  // 已纳入统一 Compose 的子系统只允许固定服务名和网关前缀；兼容旧别名时先归一化，
  // 再校验，避免数据库登记地址与实际 Docker 网络拓扑分叉。
  if (normalizeIntegratedSubsystemOnboarding(onboardForm)) {
    notify('已将客户与商机管理系统修正为统一 Docker 编排地址。')
  }
  const presetError = validateIntegratedSubsystemOnboarding(onboardForm)
  if (presetError) {
    setError(null, presetError)
    return
  }
  saving.value = true
  clearError()
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
    setError(error, '子系统接入失败。')
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
  if (isProductionProvisioning.value) return
  applySubsystemOnboardingPreset(onboardForm, String(previousCode || '').trim().toLowerCase())
})
onMounted(() => {
  loadProvisioningCapabilities()
  loadApplications()
})
</script>

<template>
  <section class="console-card application-registry-module" aria-labelledby="application-registry-title">
    <div class="console-card-body">
      <header class="application-registry-header">
        <div>
          <span class="application-registry-eyebrow"><ConsoleIcon name="dashboard" /> APPLICATION REGISTRY</span>
          <h2 id="application-registry-title">应用接入管理</h2>
          <p>应用接入、环境、门户登录目标和部署运行时统一维护。生产环境由平台通过隔离部署 Agent 安全交付一次性凭据，无需在命令行复制 OAuth 配置。</p>
        </div>
        <button v-if="props.canOnboard" class="console-button primary" type="button" @click="toggleOnboarding">
          <ConsoleIcon name="save" />{{ showOnboard ? '收起接入' : '新增接入' }}
        </button>
      </header>

      <form v-if="showOnboard" class="application-registry-onboard" @submit.prevent="submitOnboarding">
        <div class="application-registry-section-title">
          <div><strong>新增子系统接入</strong><small>首次接入一个不存在的应用环境；已有环境请使用下面的编辑或重试。部署能力与允许范围最终由后端 Agent 校验。</small></div>
          <button v-if="isProductionProvisioning && !onboardingExistingApplication" class="console-button ghost small" type="button" @click="applyProductionProvisioningPreset">填入服务器接入配置</button>
        </div>
        <p v-if="automationUnavailable" class="application-registry-inline-warning">当前环境未启用受控部署 Agent，不能执行一键接入；请先由部署人员发布平台生产部署资产。</p>
        <p v-else-if="isProductionProvisioning" class="application-registry-inline-note">当前服务器使用生产部署策略（{{ productionProvisioningSummary }}）；仅可选择服务器审核通过且尚未接入的目标，接入参数由服务器能力配置锁定。</p>
        <div class="console-form-grid">
          <template v-if="isProductionProvisioning">
            <label v-if="productionTargetInventoryLoading" class="console-form-item"><span>服务器接入目标</span><input value="正在读取已接入环境…" disabled /></label>
            <label v-else-if="productionTargetInventoryError" class="console-form-item"><span>服务器接入目标</span><input :value="productionTargetInventoryError" disabled /></label>
            <label v-else-if="selectableProductionTargets.length" class="console-form-item"><span>服务器接入目标</span><select :value="selectedProductionTargetKey" @change="selectProductionTarget"><option v-for="target in selectableProductionTargets" :key="productionTargetKey(target)" :value="productionTargetKey(target)">{{ target.application_name || target.application_code }}（{{ productionTargetKey(target) }}）</option></select><small>仅显示 subsystems.d 中审核通过且尚未接入的目标</small></label>
            <div v-else class="application-registry-target-empty" role="status"><ConsoleIcon name="info" /><strong>暂无可接入目标</strong><span>subsystems.d 中没有审核通过且尚未接入的应用环境。</span></div>
            <template v-if="selectedProductionTarget">
              <label class="console-form-item"><span>应用编码</span><input :value="onboardForm.applicationCode" disabled /></label>
              <label class="console-form-item"><span>应用名称</span><input :value="onboardForm.applicationName" disabled /></label>
              <label class="console-form-item"><span>环境</span><input :value="onboardForm.environment" disabled /></label>
              <label class="console-form-item"><span>客户端类型</span><input :value="onboardForm.clientType" disabled /></label>
              <label class="console-form-item"><span>Public BaseURL</span><input :value="onboardForm.publicBaseUrl" readonly /></label>
              <label class="console-form-item"><span>UpstreamURL</span><input :value="onboardForm.upstreamUrl" readonly /><small>服务器审核清单中的受控编排地址</small></label>
              <label class="console-form-item"><span>门户路径前缀</span><input :value="onboardForm.pathPrefix" readonly /><small>服务器审核清单中的受控门户路径</small></label>
              <label class="console-form-item"><span>应用说明</span><input :value="onboardForm.description" readonly /></label>
              <label class="console-form-item application-registry-confirm"><span>确认码：{{ onboardConfirmationCode }}</span><input v-model="onboardConfirmation" :placeholder="onboardConfirmationCode" autocomplete="off" /></label>
            </template>
          </template>
          <template v-else>
            <label class="console-form-item"><span>应用编码</span><input v-model="onboardForm.applicationCode" :disabled="onboardingExistingApplication" placeholder="customer_management" /></label>
            <label class="console-form-item"><span>应用名称</span><input v-model="onboardForm.applicationName" :disabled="onboardingExistingApplication" placeholder="客户管理系统" /></label>
            <label class="console-form-item"><span>环境</span><select v-model="onboardForm.environment"><option v-for="environment in availableOnboardEnvironments" :key="environment" :value="environment">{{ environment }}</option></select></label>
            <label class="console-form-item"><span>客户端类型</span><select v-model="onboardForm.clientType"><option value="confidential">confidential（推荐）</option><option value="public">public</option></select></label>
            <label class="console-form-item"><span>Public BaseURL</span><input v-model="onboardForm.publicBaseUrl" placeholder="http://localhost:8081" /></label>
            <label class="console-form-item"><span>UpstreamURL</span><input v-model="onboardForm.upstreamUrl" :readonly="Boolean(onboardPreset)" placeholder="http://customer-api:8080" /><small v-if="onboardPreset">服务器受控编排地址</small></label>
            <label class="console-form-item"><span>门户路径前缀</span><input v-model="onboardForm.pathPrefix" :readonly="Boolean(onboardPreset)" placeholder="/customer_management" /><small v-if="onboardPreset">服务器受控门户路径</small></label>
            <label class="console-form-item"><span>应用说明</span><input v-model="onboardForm.description" placeholder="可选" /></label>
            <label class="console-form-item application-registry-confirm"><span>确认码：{{ onboardConfirmationCode || '应用编码/环境' }}</span><input v-model="onboardConfirmation" :placeholder="onboardConfirmationCode || '应用编码/环境'" autocomplete="off" /></label>
          </template>
        </div>
        <div class="console-form-actions"><button class="console-button primary" type="submit" :disabled="!canSubmitOnboard || saving"><ConsoleIcon name="save" />{{ saving ? '接入中…' : '确认接入并部署' }}</button><small v-if="!isProductionProvisioning || selectedProductionTarget">若应用环境已存在，平台会阻止覆盖；请在下方选择后更新或重试。</small><small v-else>当前没有可选服务器目标，不能自由填写接入参数。</small></div>
      </form>

      <div v-if="errorMessage" class="application-registry-error" role="alert">
        <strong>{{ errorMessage }}</strong>
        <span v-if="errorNextAction">处理建议：{{ errorNextAction }}</span>
        <pre v-if="errorDetail" class="application-registry-error-detail">{{ errorDetail }}</pre>
        <small v-if="errorTraceId">追踪号：{{ errorTraceId }}</small>
      </div>

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
            <header class="application-registry-panel-head"><div><h4>部署环境</h4><p>维护 Public BaseURL、UpstreamURL、门户路径和运行状态。生产下线会停止合同 API 并保留数据库与受控运行配置，本地独立子系统按 Agent 策略清理。</p></div><button v-if="props.canOnboard && selectedApplication.status !== 'RETIRED'" class="console-button primary small" type="button" @click="openOnboardEnvironment"><ConsoleIcon name="save" />新增接入环境</button></header>
            <div v-if="!canReadEnvironments" class="application-registry-empty compact"><ConsoleIcon name="shield" /><span>当前账号没有 platform:application-environment:read，不能读取部署环境。</span></div>
            <div v-else-if="environmentsLoading" class="application-registry-list-state">正在读取环境…</div>
            <div v-else-if="!environments.length" class="application-registry-empty compact"><ConsoleIcon name="info" /><span>当前应用还没有部署环境。</span></div>
            <div v-else class="application-registry-environments">
              <article v-for="environment in environments" :key="environment.environment_id" class="application-registry-environment" :class="{ 'is-selected': environment.environment_id === selectedEnvironmentId }" @click="selectEnvironment(environment)">
                <div class="application-registry-environment-main"><strong>{{ environment.environment }}</strong><span class="application-registry-status" :class="statusClass(environmentStatus(environment))">{{ statusLabel(environmentStatus(environment)) }}</span><small>配置版本 {{ environment.version }}</small></div>
                <div class="application-registry-environment-uri"><span>{{ environment.base_url || '未设置 BaseURL' }}{{ environment.path_prefix || '' }}</span><small>{{ environment.upstream_url || '未设置 UpstreamURL' }}</small></div>
                <p v-if="environmentNextAction(environment)" class="application-registry-environment-guidance"><strong>处理建议：</strong>{{ environmentNextAction(environment) }}</p>
                <div class="application-registry-environment-actions"><button v-if="canUpdateEnvironment" class="console-button ghost small" type="button" @click.stop="openEnvironmentEditor(environment)"><ConsoleIcon name="settings" />设置</button><button v-if="canRetryRuntime && environmentStatus(environment) === 'PROVISION_FAILED'" class="console-button ghost small" type="button" :disabled="saving" @click.stop="reapplyEnvironment(environment, true)"><ConsoleIcon name="reset" />重试</button><button v-if="canManageRuntime && environmentStatus(environment) === 'READY'" class="console-button ghost small" type="button" :disabled="saving" @click.stop="reapplyEnvironment(environment)"><ConsoleIcon name="reset" />更新运行时</button><button v-if="canDeleteEnvironment && environment.environment !== 'dev'" class="console-button danger small" type="button" @click.stop="openDeleteEnvironment(environment)"><ConsoleIcon name="close" />删除</button></div>
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
      <section class="application-registry-modal" role="dialog" aria-modal="true" aria-label="删除环境确认"><h3>删除环境 {{ selectedApplication.code }}/{{ pendingDeleteEnvironment.environment }}</h3><p>平台会先按受控 Agent 策略下线运行时，再删除环境记录及其派生登录目标和 OAuth Client。生产合同下线仅停止 API，保留数据库、备份和服务器运行配置以便恢复。</p><label class="console-form-item"><span>请输入确认码：{{ selectedApplication.code }}/{{ pendingDeleteEnvironment.environment }}</span><input v-model="environmentDeleteConfirmation" autocomplete="off" /></label><footer class="console-form-actions"><button class="console-button danger" type="button" :disabled="environmentDeleteConfirmation.trim() !== `${selectedApplication.code}/${pendingDeleteEnvironment.environment}` || saving" @click="confirmDeleteEnvironment">确认下线并删除控制面记录</button><button class="console-button ghost" type="button" @click="pendingDeleteEnvironment = null">取消</button></footer></section>
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
.application-registry-target-empty { display: grid; grid-column: span 2; justify-items: start; gap: 4px; padding: 12px; color: #64748b; border: 1px dashed #cbd5e1; border-radius: 8px; background: #f8fafc; font-size: 12px; }
.application-registry-target-empty :deep(svg) { width: 18px; height: 18px; color: #3b82f6; }
.application-registry-target-empty strong { color: #334155; }
.application-registry-error { display: grid; gap: 4px; margin: 14px 0 0; padding: 10px 12px; color: #b91c1c; border: 1px solid #fecaca; border-radius: 8px; background: #fff7f7; font-size: 12px; line-height: 1.55; }
.application-registry-error span, .application-registry-error small { color: #7f1d1d; }
.application-registry-error-detail { margin: 6px 0 0; padding: 8px; overflow: auto; max-height: 220px; color: #7f1d1d; border: 1px solid #fecaca; border-radius: 6px; background: #fff; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
.application-registry-inline-warning { margin: 10px 0 0; color: #b45309; font-size: 12px; }
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
.application-registry-environment-guidance { margin: 7px 0; color: #b45309; font-size: 11px; line-height: 1.55; }
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
