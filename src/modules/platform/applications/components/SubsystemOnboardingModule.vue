<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import ApplicationLoginTargetModule from '@/modules/platform/login-targets/components/ApplicationLoginTargetModule.vue'
import {
  ApplicationRegistryError,
  deleteApplicationRegistration,
  deleteEnvironment,
  discoverSubsystemCandidates,
  purgeEnvironment,
  getSubsystemCapabilities,
  getKeycloakIntegrationStatus,
	getKeycloakProjectionAlerts,
  getSubsystemStatus,
	listKeycloakProjectionFailures,
  listApplications,
  listEnvironments,
  registerSubsystemDirectory,
  retrySubsystem,
  rollbackToPlatform,
	replayKeycloakProjectionFailure,
	startKeycloakObservation,
  syncKeycloakClient,
  switchToKeycloak,
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
const errorRecovery = ref(null)
const applications = ref([])
const applicationKeyword = ref('')
const applicationStatus = ref('')
const selectedApplicationId = ref('')
const environments = ref([])
const environmentsLoading = ref(false)
const selectedEnvironmentId = ref('')
// 环境卡片内按职责分区（目录入口 / 运行时 / 认证），不再用平级工作区切换；
// 认证区默认折叠，避免单个环境卡片承载过多信息。登记向导用两步收敛新增接入。
const expandedAuthentication = ref({})
const onboardStep = ref(1)
const deploymentStates = ref({})
const deploymentStatusErrors = ref({})
const keycloakSwitchStates = ref({})
const keycloakProjectionAlert = ref(null)
const keycloakProjectionFailures = ref([])
const keycloakOperationsLoading = ref(false)
const showOnboard = ref(false)
const applicationEditorOpen = ref(false)
const environmentEditorOpen = ref(false)
const pendingDeleteApplication = ref(null)
const pendingDeleteEnvironment = ref(null)
const deleteConfirmation = ref('')
const environmentDeleteConfirmation = ref('')
const pendingPurgeEnvironment = ref(null)
const purgeConfirmation = ref('')
const purgeApprovalId = ref('')
const purgeRetentionConfirmed = ref(false)
const purgeOffboardedConfirmed = ref(false)
const onboardExistingApplicationId = ref('')
const provisioningCapabilities = ref(null)
const applicationsLoaded = ref(false)
const productionTargetInventoryReady = ref(false)
const productionTargetInventoryLoading = ref(false)
const productionTargetInventoryError = ref('')
const registeredProductionTargetKeys = ref(new Set())
const discoveredCandidates = ref([])
const discoveryLoading = ref(false)

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
const authenticationProviders = computed(() => Array.isArray(provisioningCapabilities.value?.authentication_providers)
  ? provisioningCapabilities.value.authentication_providers : [])

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
    issuerAlias: '',
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
  errorRecovery.value = null
}

function setError(error, fallback) {
  errorRecovery.value = null
  if (error instanceof ApplicationRegistryError) {
    errorMessage.value = error.message
    errorNextAction.value = error.nextAction
    errorDetail.value = error.detail
    errorTraceId.value = error.traceId
    const applicationCode = textValue(error.details?.application_code)
    const environment = textValue(error.details?.environment)
    if (error.code === 'IAM_SUBSYSTEM_ALREADY_ONBOARDED' && applicationCode && environment) {
      errorRecovery.value = { type: 'existing-environment', applicationCode, environment, label: '查看已有环境' }
    }
    return
  }
  errorMessage.value = fallback
  errorNextAction.value = ''
  errorDetail.value = ''
  errorTraceId.value = ''
}

async function recoverExistingEnvironment() {
  const recovery = errorRecovery.value
  if (!recovery || recovery.type !== 'existing-environment' || saving.value) return
  saving.value = true
  try {
    const targetCode = recovery.applicationCode.toLowerCase()
    clearError()
    await loadApplications()
    const application = applications.value.find((item) => textValue(item.code).toLowerCase() === targetCode)
    if (!application) {
      setError(null, `未找到应用 ${recovery.applicationCode}，请刷新应用登记后重试。`)
      return
    }
    selectApplication(application)
    await loadEnvironments()
    const environment = environments.value.find((item) => textValue(item.environment).toLowerCase() === recovery.environment.toLowerCase())
    if (environment) selectEnvironment(environment)
    else setError(null, `已找到应用 ${recovery.applicationCode}，但未找到 ${recovery.environment} 环境，请刷新后重试。`)
  } catch (error) {
    setError(error, '读取已有接入环境失败。')
  } finally {
    saving.value = false
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

function environmentStatusError(environment) {
  return deploymentStatusErrors.value[environment.environment] || null
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
    deploymentStatusErrors.value = {}
    keycloakSwitchStates.value = {}
		keycloakProjectionAlert.value = null
		keycloakProjectionFailures.value = []
    return
	}
	// 切换应用时先撤销旧环境选择。否则子组件会短暂拿到“新应用 + 旧环境”这组
	// 不属于同一边界的 ID，并向登录目标接口发出必然 404 的请求。
	selectedEnvironmentId.value = ''
	environmentsLoading.value = true
  deploymentStates.value = {}
  deploymentStatusErrors.value = {}
  keycloakSwitchStates.value = {}
	keycloakProjectionAlert.value = null
	keycloakProjectionFailures.value = []
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
    deploymentStatusErrors.value = Object.fromEntries(states
      .map((result, index) => result.status === 'rejected' ? [environments.value[index].environment, {
        message: result.reason instanceof ApplicationRegistryError ? result.reason.message : '无法读取部署 Agent 状态。',
        nextAction: result.reason instanceof ApplicationRegistryError ? result.reason.nextAction : '请刷新状态后重试。',
      }] : null)
      .filter(Boolean))
    // The Keycloak integration is a separate durable control plane.  Loading
    // it here prevents a browser refresh from degrading an already-synchronised
    // Client to the global, non-environment-specific provider summary.
    const integrationStates = await Promise.allSettled(environments.value.map(async (environment) => [
      environment.environment_id,
      await getKeycloakIntegrationStatus({ applicationCode: application.code, environment: environment.environment }),
    ]))
    keycloakSwitchStates.value = Object.fromEntries(integrationStates
      .filter((result) => result.status === 'fulfilled' && result.value[1] && typeof result.value[1] === 'object')
      .map((result) => result.value))
		await loadKeycloakProjectionOperations(application.code)
  } catch (error) {
    environments.value = []
    setError(error, '读取应用环境失败。')
  } finally {
    environmentsLoading.value = false
  }
}

async function loadKeycloakProjectionOperations(applicationCode = selectedApplication.value?.code) {
  if (!applicationCode || !canReadApplications.value) return
  keycloakOperationsLoading.value = true
  try {
    const [alert, failures] = await Promise.all([
      getKeycloakProjectionAlerts(),
      listKeycloakProjectionFailures({ applicationCode, page: 1, pageSize: 50 }),
    ])
    keycloakProjectionAlert.value = alert && typeof alert === 'object' ? alert : null
    keycloakProjectionFailures.value = Array.isArray(failures?.items) ? failures.items : []
  } catch (error) {
    // The status endpoint remains useful even if an older platform API has not
    // yet rolled out the operations extension. Do not turn that into a page-wide
    // failure or hide application environments.
    keycloakProjectionAlert.value = null
    keycloakProjectionFailures.value = []
  } finally {
    keycloakOperationsLoading.value = false
  }
}

function toggleOnboarding() {
  if (showOnboard.value) {
    showOnboard.value = false
    onboardExistingApplicationId.value = ''
    onboardStep.value = 1
    return
  }
  Object.assign(onboardForm, emptyOnboardForm())
  onboardExistingApplicationId.value = ''
  onboardConfirmation.value = ''
  onboardStep.value = 1
  clearError()
  if (isProductionProvisioning.value) applyProductionProvisioningPreset()
  showOnboard.value = true
}

function nextOnboardStep() {
  if (onboardStep.value < 2) onboardStep.value += 1
}

function prevOnboardStep() {
  if (onboardStep.value > 1) onboardStep.value -= 1
}

async function discoverSubsystems() {
  if (discoveryLoading.value || saving.value) return
  discoveryLoading.value = true
  clearError()
  try {
    const result = await discoverSubsystemCandidates()
    discoveredCandidates.value = Array.isArray(result) ? result : []
    if (!discoveredCandidates.value.length) notify('未发现尚未登记且带标准标签的子系统。')
  } catch (error) {
    setError(error, '探测子系统失败。请确认 subsystem-provisioner 正在运行且容器已配置 discovery 标签。')
  } finally {
    discoveryLoading.value = false
  }
}

function useDiscoveredCandidate(candidate) {
  if (!candidate || saving.value) return
  const callbackPath = textValue(candidate.oidc_callback_path)
  const pathPrefix = callbackPath.endsWith('/auth/callback')
    ? callbackPath.slice(0, -'/auth/callback'.length) || '/'
    : `/${textValue(candidate.application_code)}`
  Object.assign(onboardForm, {
    applicationCode: textValue(candidate.application_code),
    applicationName: textValue(candidate.application_code),
    description: `通过 Docker 标签发现：${textValue(candidate.service_name)}${candidate.version ? ` · ${candidate.version}` : ''}`,
    environment: textValue(candidate.environment),
    publicBaseUrl: typeof window === 'undefined' ? 'http://localhost:8081' : window.location.origin,
    upstreamUrl: `${textValue(candidate.protocol) || 'http'}://${textValue(candidate.internal_host)}:${Number(candidate.internal_port)}`,
    pathPrefix,
    clientType: 'confidential',
    // 接入登记只维护应用与运行时。Keycloak Client 必须由“Keycloak 认证接入”
    // 页面显式同步，避免目录登记隐式创建认证 Client。
    issuerAlias: '',
  })
  onboardExistingApplicationId.value = ''
  selectedProductionTargetKey.value = ''
  onboardConfirmation.value = ''
  showOnboard.value = true
  clearError()
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
    issuerAlias: textValue(environment.issuer_alias) || 'platform',
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
    notify('运行时环境配置已更新。')
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

function openPurgeEnvironment(environment) {
  if (environment.environment === 'dev' || environmentStatus(environment) !== 'OFFBOARDED') {
    setError(null, '只有已下线的非 dev 环境才能永久清理。')
    return
  }
  pendingPurgeEnvironment.value = environment
  purgeConfirmation.value = ''
  purgeApprovalId.value = ''
  purgeRetentionConfirmed.value = false
  purgeOffboardedConfirmed.value = false
  clearError()
}

async function confirmPurgeEnvironment() {
  const application = selectedApplication.value
  const environment = pendingPurgeEnvironment.value
  const confirmationCode = `PURGE/${application?.code || ''}/${environment?.environment || ''}`
  if (!application || !environment || purgeConfirmation.value.trim() !== confirmationCode || !purgeApprovalId.value.trim() || !purgeRetentionConfirmed.value || !purgeOffboardedConfirmed.value || !canDeleteEnvironment.value || saving.value) return
  saving.value = true
  clearError()
  try {
    await purgeEnvironment({
      applicationId: application.application_id,
      environmentId: environment.environment_id,
      confirmationCode,
      retentionApprovalId: purgeApprovalId.value,
      retentionConfirmed: true,
      offboardedConfirmed: true,
      version: environment.version,
    })
    pendingPurgeEnvironment.value = null
    notify(`环境 ${confirmationCode} 已永久清理。`)
    await loadApplications(application.application_id)
    await loadEnvironments()
  } catch (error) {
    setError(error, '永久清理应用环境失败。')
  } finally {
    saving.value = false
  }
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
    await action({
      applicationCode: application.code,
      environment: environment.environment,
      publicBaseUrl: environment.base_url || '',
      upstreamUrl: environment.upstream_url || '',
      pathPrefix: environment.path_prefix || '',
      issuerAlias: environment.issuer_alias || 'platform',
    })
    notify(retry ? '部署失败环境已重新尝试。' : '子系统已重新部署。')
    await loadEnvironments()
  } catch (error) {
    setError(error, '部署 Agent 操作失败。')
  } finally {
    saving.value = false
  }
}

function providerLabel(alias) {
  return alias === 'keycloak' ? 'Keycloak' : '基础平台 OIDC'
}

function providerStatus(alias) {
  return authenticationProviders.value.find((item) => item.alias === alias) || null
}

function keycloakSwitchState(environment) {
  if (!environment) return { switch_ready: false, switch_gates: [], next_action: '' }
  return keycloakSwitchStates.value[environment.environment_id]
    || providerStatus('keycloak')
    || { switch_ready: false, switch_gates: [], next_action: '' }
}

function keycloakSwitchReady(environment) {
  const state = keycloakSwitchState(environment)
  const gates = Array.isArray(state.switch_gates) ? state.switch_gates : []
  return state.switch_ready === true && gates.length === 4 && gates.every((gate) => gate?.passed === true)
}

function keycloakRuntimePreparationReady(environment) {
  const state = keycloakSwitchState(environment)
  const gates = Array.isArray(state.switch_gates) ? state.switch_gates : []
  const required = new Set(['client_ready', 'role_catalog_synced', 'user_projection_completed'])
  return required.size === gates.filter((gate) => required.has(gate?.key) && gate?.passed === true).length
}

function gateProgress(environment) {
  const gates = Array.isArray(keycloakSwitchState(environment).switch_gates) ? keycloakSwitchState(environment).switch_gates : []
  const passed = gates.filter((gate) => gate?.passed === true).length
  return { passed, total: gates.length || 4 }
}

function keycloakClientState(environment) {
  const state = keycloakSwitchState(environment)
  return state.client_id ? '已同步' : '待同步'
}

function keycloakClientID(environment) {
  return keycloakSwitchState(environment).client_id || '尚未同步'
}

function keycloakClaimsState(environment) {
  return keycloakSwitchState(environment).claims_state || '尚未读取（同步 Client 后更新）'
}

function keycloakCutoverState(environment) {
  return keycloakSwitchState(environment).cutover || { status: 'NOT_STARTED', timeline: [] }
}

function keycloakObservationReady(environment) {
  return keycloakCutoverState(environment).status === 'READY_TO_SWITCH'
}

function keycloakRollbackAvailable(environment) {
  const state = keycloakCutoverState(environment)
  if (state.status !== 'SWITCHED') return false
  if (!state.rollback_deadline_at) return true
  return new Date(state.rollback_deadline_at).getTime() >= Date.now()
}

function dateTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('zh-CN', { hour12: false })
}

function keycloakRedirectURI(environment) {
  const baseURL = textValue(environment?.base_url).replace(/\/$/, '')
  const pathPrefix = textValue(environment?.path_prefix).replace(/\/$/, '')
  return baseURL && pathPrefix ? `${baseURL}${pathPrefix}/auth/callback` : '请先在运行时与部署中填写 Public BaseURL 和门户路径'
}

async function switchAuthenticationProvider(environment, alias) {
  const application = selectedApplication.value
  const provider = providerStatus(alias)
  if (!application || !environment || (alias === 'keycloak' && !keycloakRuntimePreparationReady(environment)) || (alias !== 'keycloak' && !provider?.switch_ready) || saving.value) return
  const preparingBrokerVerification = alias === 'keycloak' && !keycloakSwitchReady(environment)
  saving.value = true
  clearError()
  const previousIssuerAlias = environment.issuer_alias || 'platform'
  let persistedEnvironment = null
  try {
    const saved = await updateEnvironment({
      applicationId: application.application_id,
      environmentId: environment.environment_id,
      baseUrl: environment.base_url,
      upstreamUrl: environment.upstream_url,
      pathPrefix: environment.path_prefix,
      issuerAlias: alias === 'platform' ? null : alias,
      status: environment.status,
      version: environment.version,
    })
    persistedEnvironment = saved
    const cutover = alias === 'keycloak' ? switchToKeycloak : rollbackToPlatform
    await cutover({
      applicationCode: application.code,
      environment: environment.environment,
      publicBaseUrl: saved.base_url || environment.base_url || '',
      upstreamUrl: saved.upstream_url || environment.upstream_url || '',
      pathPrefix: saved.path_prefix || environment.path_prefix || '',
    })
    notify(preparingBrokerVerification
      ? '已准备 Keycloak 运行时，请使用目标应用完成一次 Broker 登录验证。'
      : `已切换为 ${providerLabel(alias)} 并下发运行配置。`)
    await loadEnvironments()
  } catch (error) {
    // Environment metadata is persisted before the external deployment Agent
    // runs. If the Agent rejects the change, restore the previous provider
    // with the version returned by the first request so the control plane does
    // not claim Keycloak while the running container still uses platform OIDC.
    if (persistedEnvironment && previousIssuerAlias !== alias) {
      try {
        await updateEnvironment({
          applicationId: application.application_id,
          environmentId: environment.environment_id,
          baseUrl: persistedEnvironment.base_url || environment.base_url,
          upstreamUrl: persistedEnvironment.upstream_url || environment.upstream_url,
          pathPrefix: persistedEnvironment.path_prefix || environment.path_prefix,
          issuerAlias: previousIssuerAlias === 'platform' ? null : previousIssuerAlias,
          status: persistedEnvironment.status || environment.status,
          version: persistedEnvironment.version,
        })
        notify('运行时更新失败，已恢复原认证提供方配置。')
      } catch (rollbackError) {
        setError(rollbackError, '运行时更新失败，且认证提供方自动恢复失败；请勿继续切换，先核对环境状态。')
        await loadEnvironments()
        return
      }
    }
    setError(error, '认证提供方切换失败；环境记录已保留，可在修复后重试。')
    await loadEnvironments()
  } finally {
    saving.value = false
  }
}

async function synchronizeKeycloakClient(environment) {
  const application = selectedApplication.value
  if (!application || !environment || saving.value) return
  saving.value = true
  clearError()
  try {
    const result = await syncKeycloakClient({
      applicationCode: application.code,
      environment: environment.environment,
      publicBaseUrl: environment.base_url || '',
      upstreamUrl: environment.upstream_url || '',
      pathPrefix: environment.path_prefix || '',
    })
    keycloakSwitchStates.value = {
      ...keycloakSwitchStates.value,
      [environment.environment_id]: result && typeof result === 'object' ? result : { switch_ready: false, switch_gates: [] },
    }
    notify(result?.next_action || 'Keycloak 同步完成；请完成剩余门禁后再切换认证提供方。')
  } catch (error) {
    setError(error, '同步 Keycloak Realm Client 失败。')
  } finally {
    saving.value = false
  }
}

async function beginKeycloakObservation(environment) {
  const application = selectedApplication.value
  if (!application || !environment || saving.value || !keycloakSwitchReady(environment)) return
  saving.value = true
  clearError()
  try {
    const lifecycle = await startKeycloakObservation({ applicationCode: application.code, environment: environment.environment })
    keycloakSwitchStates.value = {
      ...keycloakSwitchStates.value,
      [environment.environment_id]: { ...keycloakSwitchState(environment), cutover: lifecycle },
    }
    notify('Keycloak 七天观察期已开始。观察期完成前，系统不会下发切换后的运行时配置。')
    await loadEnvironments()
  } catch (error) {
    setError(error, '无法开始 Keycloak 观察期；请先完成全部切换门禁。')
  } finally {
    saving.value = false
  }
}

async function replayProjectionFailure(failure) {
  if (!failure?.event_id || saving.value) return
  const reason = window.prompt(`请填写重放 ${failure.event_id} 的处置原因（至少 6 个字符）。`)
  if (!reason) return
  const confirmation = window.prompt(`为避免误操作，请输入完整事件 ID：${failure.event_id}`)
  if (confirmation !== failure.event_id) {
    notify('未完成事件 ID 确认，未执行重放。')
    return
  }
  saving.value = true
  clearError()
  try {
    const result = await replayKeycloakProjectionFailure({ eventId: failure.event_id, confirmation, reason })
    notify(result?.already_pending ? '该投影已在等待处理，无需重复投递。' : '投影已进入受控重放队列，请等待 Worker 处理。')
    await loadEnvironments()
  } catch (error) {
    setError(error, 'Keycloak 授权投影重放失败。')
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
    const result = await registerSubsystemDirectory({
      applicationCode: onboardForm.applicationCode.trim().toLowerCase(),
      applicationName: onboardForm.applicationName.trim(),
      description: nullable(onboardForm.description),
      environment: onboardForm.environment,
      publicBaseUrl: onboardForm.publicBaseUrl.trim().replace(/\/$/, ''),
      upstreamUrl: onboardForm.upstreamUrl.trim().replace(/\/$/, ''),
      pathPrefix: onboardForm.pathPrefix.trim(),
      issuerAlias: onboardForm.issuerAlias,
    })
    showOnboard.value = false
    onboardExistingApplicationId.value = ''
    onboardConfirmation.value = ''
    notify(result?.next_action || `${onboardForm.applicationName} ${onboardForm.environment} 目录已登记；请继续同步 Keycloak Client。`)
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

function toggleAuthentication(environment) {
  if (!environment?.environment_id) return
  const next = { ...expandedAuthentication.value }
  next[environment.environment_id] = !next[environment.environment_id]
  expandedAuthentication.value = next
}

function authenticationExpanded(environment) {
  return Boolean(environment && expandedAuthentication.value[environment.environment_id])
}

// 接入进度：按“最领先环境”推进，仅作顶部引导，后端四项门禁仍是最终校验。
const onboardingSteps = computed(() => {
  const envs = environments.value
  const any = (predicate) => envs.some(predicate)
  const steps = [
    { key: 'registered', label: '登记应用', done: Boolean(selectedApplication.value) },
    { key: 'environment', label: '登记环境', done: envs.length > 0 },
    { key: 'client', label: '同步 Client', done: any((environment) => Boolean(keycloakSwitchState(environment).client_id)) },
    { key: 'projection', label: '用户投影', done: any((environment) => keycloakRuntimePreparationReady(environment)) },
    { key: 'gates', label: '门禁通过', done: any((environment) => keycloakSwitchReady(environment)) },
    { key: 'observation', label: '观察期', done: any((environment) => keycloakCutoverState(environment).status !== 'NOT_STARTED') },
    { key: 'switched', label: '切换 Keycloak', done: any((environment) => (environment.issuer_alias || 'platform') === 'keycloak') },
  ]
  const completed = steps.filter((step) => step.done).length
  return { steps, completed, total: steps.length }
})

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
          <h2 id="application-registry-title">应用接入</h2>
          <p>应用目录、访问入口与授权信息由基础平台维护；认证接入和运行时部署按环境分区维护，避免把业务授权与 OIDC Client 管理混在一起。</p>
        </div>
        <div class="application-registry-header-actions">
          <button v-if="canReadApplications" class="console-button secondary" type="button" :disabled="discoveryLoading" @click="discoverSubsystems"><ConsoleIcon name="search" />{{ discoveryLoading ? '探测中…' : '探测子系统' }}</button>
          <button v-if="props.canOnboard" class="console-button primary" type="button" @click="toggleOnboarding"><ConsoleIcon name="save" />新增接入</button>
        </div>
      </header>

      <section v-if="discoveredCandidates.length" class="application-registry-discovery" aria-label="发现的未登记子系统">
        <div><strong>发现到 {{ discoveredCandidates.length }} 个未登记子系统</strong><small>服务通过 Docker 标签声明自身能力；选择后会预填运行时接入信息。认证 Client 请在对应环境的“Keycloak 认证”分区中单独同步。</small></div>
        <article v-for="candidate in discoveredCandidates" :key="`${candidate.application_code}/${candidate.environment}/${candidate.service_name}`">
          <div><strong>{{ candidate.application_code }}</strong><span>{{ candidate.environment }} · {{ candidate.service_name }} · {{ candidate.status }}</span><small>{{ candidate.protocol }}://{{ candidate.internal_host }}:{{ candidate.internal_port }} · {{ candidate.health_endpoint || '未声明健康检查' }}</small></div>
          <button v-if="props.canOnboard" class="console-button primary small" type="button" @click="useDiscoveredCandidate(candidate)">采用并接入</button>
        </article>
      </section>

      <div v-if="errorMessage" class="application-registry-error" role="alert">
        <strong>{{ errorMessage }}</strong>
        <span v-if="errorNextAction">处理建议：{{ errorNextAction }}</span>
        <pre v-if="errorDetail" class="application-registry-error-detail">{{ errorDetail }}</pre>
        <small v-if="errorTraceId">追踪号：{{ errorTraceId }}</small>
        <div v-if="errorRecovery" class="application-registry-error-actions"><button class="console-button ghost small" type="button" :disabled="saving" @click="recoverExistingEnvironment">{{ errorRecovery.label }}</button></div>
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

          <nav class="application-registry-progress" aria-label="接入进度">
            <ol>
              <li v-for="(step, index) in onboardingSteps.steps" :key="step.key" :class="{ 'is-done': step.done, 'is-current': !step.done && (index === 0 || onboardingSteps.steps[index - 1].done) }"><i>{{ step.done ? '✓' : index + 1 }}</i><span>{{ step.label }}</span></li>
            </ol>
            <small>{{ onboardingSteps.completed }}/{{ onboardingSteps.total }} 步已完成</small>
          </nav>

          <div v-if="environmentsLoading" class="application-registry-list-state">正在读取已登记环境…</div>
          <div v-else-if="!environments.length" class="application-registry-empty compact"><ConsoleIcon name="info" /><span>当前应用还没有已登记环境，点击右上角「新增接入」登记应用环境。</span></div>
          <div v-else class="application-registry-environments">
            <article v-for="environment in environments" :key="environment.environment_id" class="application-registry-environment" :class="{ 'is-selected': environment.environment_id === selectedEnvironmentId }" @click="selectEnvironment(environment)">
              <div class="application-registry-environment-main">
                <strong>{{ environment.environment }}</strong>
                <span class="application-registry-status" :class="statusClass(environmentStatus(environment))">{{ statusLabel(environmentStatus(environment)) }}</span>
                <span class="application-registry-provider" :class="`is-${environment.issuer_alias || 'platform'}`">{{ providerLabel(environment.issuer_alias || 'platform') }}</span>
                <small>配置版本 {{ environment.version }}</small>
              </div>

              <section class="application-registry-zone directory">
                <header class="application-registry-zone-head"><h5>目录与入口</h5><span class="application-registry-zone-hint">点击环境卡片后在此维护登录目标</span></header>
                <div class="application-registry-environment-uri"><span>{{ environment.base_url || '未设置门户地址' }}{{ environment.path_prefix || '' }}</span><small>{{ environment.upstream_url || '未设置 UpstreamURL' }}</small></div>
                <ApplicationLoginTargetModule v-if="selectedEnvironmentId === environment.environment_id && canReadLoginTargets" :application-id="selectedApplication.application_id" :environment-id="environment.environment_id" :application-name="selectedApplication.name || selectedApplication.code" :environment-name="environment.environment" @toast="notify" />
              </section>

              <section class="application-registry-zone runtime">
                <header class="application-registry-zone-head"><h5>运行时与部署</h5></header>
                <p v-if="environmentNextAction(environment)" class="application-registry-environment-guidance"><strong>处理建议：</strong>{{ environmentNextAction(environment) }}</p>
                <p v-if="environmentStatusError(environment)" class="application-registry-environment-guidance is-error"><strong>状态读取失败：</strong>{{ environmentStatusError(environment).message }}<span v-if="environmentStatusError(environment).nextAction">{{ environmentStatusError(environment).nextAction }}</span><button class="console-button ghost small" type="button" :disabled="environmentsLoading" @click.stop="loadEnvironments">重试查询</button></p>
                <div class="application-registry-environment-actions"><button v-if="canUpdateEnvironment" class="console-button ghost small" type="button" @click.stop="openEnvironmentEditor(environment)"><ConsoleIcon name="settings" />设置</button><button v-if="canRetryRuntime && environmentStatus(environment) === 'PROVISION_FAILED'" class="console-button ghost small" type="button" :disabled="saving" @click.stop="reapplyEnvironment(environment, true)"><ConsoleIcon name="reset" />重试</button><button v-if="canManageRuntime && environmentStatus(environment) === 'READY'" class="console-button ghost small" type="button" :disabled="saving" @click.stop="reapplyEnvironment(environment)"><ConsoleIcon name="reset" />更新运行时</button><button v-if="canDeleteEnvironment && environment.environment !== 'dev'" class="console-button danger small" type="button" @click.stop="openDeleteEnvironment(environment)"><ConsoleIcon name="close" />删除</button><button v-if="canDeleteEnvironment && environment.environment !== 'dev' && environmentStatus(environment) === 'OFFBOARDED'" class="console-button danger small" type="button" @click.stop="openPurgeEnvironment(environment)"><ConsoleIcon name="close" />永久清理</button></div>
              </section>

              <section class="application-registry-zone authentication">
                <header class="application-registry-zone-head"><h5>Keycloak 认证</h5><button class="application-registry-zone-toggle" type="button" @click.stop="toggleAuthentication(environment)">{{ authenticationExpanded(environment) ? '收起' : '展开' }}</button></header>
                <div class="application-registry-auth-summary"><span>Client：{{ keycloakClientState(environment) }}</span><span>门禁：{{ gateProgress(environment).passed }}/{{ gateProgress(environment).total }}</span><span>灰度：{{ keycloakCutoverState(environment).status }}</span></div>
                <template v-if="authenticationExpanded(environment)">
                  <dl class="application-registry-auth-details"><div><dt>Realm</dt><dd>{{ providerStatus('keycloak')?.realm || '未配置' }}</dd></div><div><dt>Client ID</dt><dd><code>{{ keycloakClientID(environment) }}</code></dd></div><div><dt>Redirect URI</dt><dd><code>{{ keycloakRedirectURI(environment) }}</code></dd></div><div><dt>Claims 映射</dt><dd>{{ keycloakClaimsState(environment) }}</dd></div></dl>
                  <div v-if="providerStatus('keycloak')" class="application-registry-switch-gates">
                    <strong>切换 Keycloak 门禁</strong>
                    <ul v-if="keycloakSwitchState(environment).switch_gates?.length"><li v-for="gate in keycloakSwitchState(environment).switch_gates" :key="gate.key" :class="{ 'is-passed': gate.passed }"><span>{{ gate.passed ? '已通过' : '未通过' }}</span>{{ gate.label }}<small>{{ gate.detail }}{{ !gate.passed && gate.next_action ? ` 下一步：${gate.next_action}` : '' }}</small></li></ul>
                    <small v-else>请先同步 Keycloak Client 以读取该环境的切换门禁。</small>
                    <p v-if="!keycloakSwitchReady(environment) && keycloakSwitchState(environment).next_action">下一步：{{ keycloakSwitchState(environment).next_action }}</p>
                  </div>
                  <div class="application-registry-switch-gates">
                    <strong>灰度迁移状态</strong>
                    <p>状态：{{ keycloakCutoverState(environment).status }}；观察开始：{{ dateTime(keycloakCutoverState(environment).observation_started_at) }}；观察截止：{{ dateTime(keycloakCutoverState(environment).observation_ends_at) }}</p>
                    <p v-if="keycloakCutoverState(environment).rollback_deadline_at">回滚截止：{{ dateTime(keycloakCutoverState(environment).rollback_deadline_at) }}</p>
                    <ul v-if="keycloakSwitchState(environment).timeline?.length"><li v-for="event in keycloakSwitchState(environment).timeline" :key="event.id"><span>已记录</span>{{ event.summary }}<small>{{ dateTime(event.occurred_at) }}</small></li></ul>
                    <small v-else>完成同步与门禁后，开始七天观察期；每次观察、切换和回滚都会追加审计时间线。</small>
                  </div>
                  <div class="application-registry-environment-actions"><button v-if="canManageRuntime" class="console-button ghost small" type="button" :disabled="saving || !providerStatus('keycloak') || providerStatus('keycloak')?.status === 'NOT_CONFIGURED'" @click.stop="synchronizeKeycloakClient(environment)"><ConsoleIcon name="shield" />导入/同步 Keycloak Client</button><button v-if="canManageRuntime && keycloakSwitchReady(environment) && keycloakCutoverState(environment).status === 'NOT_STARTED'" class="console-button ghost small" type="button" :disabled="saving" @click.stop="beginKeycloakObservation(environment)"><ConsoleIcon name="shield" />开始 7 天观察</button><button v-if="canManageRuntime && (environment.issuer_alias || 'platform') !== 'keycloak'" class="console-button ghost small" type="button" :disabled="saving || !keycloakRuntimePreparationReady(environment)" @click.stop="switchAuthenticationProvider(environment, 'keycloak')"><ConsoleIcon name="shield" />准备并切换 Keycloak</button><button v-if="canManageRuntime && (environment.issuer_alias || 'platform') === 'keycloak'" class="console-button ghost small" type="button" :disabled="saving || !keycloakRollbackAvailable(environment)" @click.stop="switchAuthenticationProvider(environment, 'platform')"><ConsoleIcon name="reset" />回滚基础平台</button></div>
                </template>
              </section>
            </article>
          </div>

          <section class="application-registry-switch-gates" aria-label="Keycloak 授权投影告警">
            <strong>授权投影告警与受控重放</strong>
            <p v-if="keycloakOperationsLoading">正在读取 FAILED 投影状态…</p>
            <p v-else-if="keycloakProjectionAlert?.state === 'ALERT'">{{ keycloakProjectionAlert.summary }}（{{ keycloakProjectionAlert.failed_count }} 条）。FAILED 投影会阻断对应环境切换。</p>
            <p v-else>当前没有 FAILED 授权投影。</p>
            <ul v-if="keycloakProjectionFailures.length"><li v-for="failure in keycloakProjectionFailures" :key="failure.event_id"><span>FAILED</span><code>{{ failure.application_code }}/{{ failure.environment || '全局' }}</code> · {{ failure.error_code || 'KEYCLOAK_SYNC_FAILED' }}<small>{{ failure.error_message || '请查看平台与 Keycloak 日志后受控重放。' }}</small><button v-if="canManageRuntime" class="console-button ghost small" type="button" :disabled="saving" @click="replayProjectionFailure(failure)">受控重放</button></li></ul>
          </section>
        </main>
        <div v-else class="application-registry-empty"><ConsoleIcon name="dashboard" /><strong>请选择一个应用</strong><p>应用登记、环境配置和登录目标将在这里统一维护。</p></div>
      </div>
    </div>

    <div v-if="showOnboard" class="application-registry-modal-backdrop" role="presentation" @click.self="toggleOnboarding">
      <section class="application-registry-modal application-registry-wizard-modal" role="dialog" aria-modal="true" aria-label="新增接入">
        <header class="application-registry-wizard-head">
          <div><span class="application-registry-eyebrow">ONBOARD</span><h3>新增接入</h3><p>登记应用、环境和登录入口后不会自动创建 OIDC Client 或启动服务；部署能力与允许范围最终由后端 Agent 校验。</p><p v-if="isProductionProvisioning">服务器使用生产部署策略，请从审核清单中选择接入目标。</p><p v-else>第 1 步登记应用，第 2 步登记环境与入口。</p></div>
          <button class="application-registry-wizard-close" type="button" aria-label="关闭" @click="toggleOnboarding">×</button>
        </header>
        <p v-if="automationUnavailable" class="application-registry-inline-warning">当前环境未启用受控部署 Agent，不能执行一键接入；请先由部署人员发布平台生产部署资产。</p>
        <form @submit.prevent="submitOnboarding">
          <template v-if="isProductionProvisioning">
            <p class="application-registry-inline-note">当前服务器使用生产部署策略（{{ productionProvisioningSummary }}）；应用、环境、内部 UpstreamURL 和门户路径由服务器审核清单控制，公网访问地址可按实际域名或端口手动填写。</p>
            <button v-if="!onboardingExistingApplication" class="console-button ghost small" type="button" @click="applyProductionProvisioningPreset()">填入服务器接入配置</button>
            <div class="console-form-grid">
              <label v-if="productionTargetInventoryLoading" class="console-form-item"><span>服务器接入目标</span><input value="正在读取已接入环境…" disabled /></label>
              <label v-else-if="productionTargetInventoryError" class="console-form-item"><span>服务器接入目标</span><input :value="productionTargetInventoryError" disabled /></label>
              <label v-else-if="selectableProductionTargets.length" class="console-form-item"><span>服务器接入目标</span><select :value="selectedProductionTargetKey" @change="selectProductionTarget"><option v-for="target in selectableProductionTargets" :key="productionTargetKey(target)" :value="productionTargetKey(target)">{{ target.application_name || target.application_code }}（{{ productionTargetKey(target) }}）</option></select><small>仅显示 subsystems.d 中审核通过且尚未接入的目标</small></label>
              <div v-else class="application-registry-target-empty" role="status"><ConsoleIcon name="info" /><strong>暂无可接入目标</strong><span>subsystems.d 中没有审核通过且尚未接入的应用环境。</span></div>
              <template v-if="selectedProductionTarget">
                <label class="console-form-item"><span>应用编码</span><input :value="onboardForm.applicationCode" disabled /></label>
                <label class="console-form-item"><span>应用名称</span><input :value="onboardForm.applicationName" disabled /></label>
                <label class="console-form-item"><span>环境</span><input :value="onboardForm.environment" disabled /></label>
                <label class="console-form-item"><span>Public BaseURL</span><input v-model="onboardForm.publicBaseUrl" type="url" inputmode="url" placeholder="https://portal.example.com" required /><small>浏览器实际访问的协议、域名和端口；回调地址会由此地址和门户路径自动生成。</small></label>
                <label class="console-form-item"><span>UpstreamURL</span><input :value="onboardForm.upstreamUrl" readonly /><small>服务器审核清单中的受控编排地址</small></label>
                <label class="console-form-item"><span>门户路径前缀</span><input :value="onboardForm.pathPrefix" readonly /><small>服务器审核清单中的受控门户路径</small></label>
                <label class="console-form-item"><span>应用说明</span><input :value="onboardForm.description" readonly /></label>
                <label class="console-form-item application-registry-confirm"><span>确认码：{{ onboardConfirmationCode }}</span><input v-model="onboardConfirmation" :placeholder="onboardConfirmationCode" autocomplete="off" /></label>
              </template>
            </div>
          </template>
          <template v-else>
            <div v-show="onboardStep === 1" class="console-form-grid">
              <label class="console-form-item"><span>应用编码</span><input v-model="onboardForm.applicationCode" :disabled="onboardingExistingApplication" placeholder="customer_management" /></label>
              <label class="console-form-item"><span>应用名称</span><input v-model="onboardForm.applicationName" :disabled="onboardingExistingApplication" placeholder="客户管理系统" /></label>
              <label class="console-form-item application-registry-confirm"><span>应用说明</span><input v-model="onboardForm.description" placeholder="可选" /></label>
            </div>
            <div v-show="onboardStep === 2" class="console-form-grid">
              <label class="console-form-item"><span>环境</span><select v-model="onboardForm.environment"><option v-for="environment in availableOnboardEnvironments" :key="environment" :value="environment">{{ environment }}</option></select></label>
              <label class="console-form-item"><span>Public BaseURL</span><input v-model="onboardForm.publicBaseUrl" placeholder="http://localhost:8081" /></label>
              <label class="console-form-item"><span>UpstreamURL</span><input v-model="onboardForm.upstreamUrl" :readonly="Boolean(onboardPreset)" placeholder="http://customer-api:8080" /><small v-if="onboardPreset">服务器受控编排地址</small></label>
              <label class="console-form-item"><span>门户路径前缀</span><input v-model="onboardForm.pathPrefix" :readonly="Boolean(onboardPreset)" placeholder="/customer_management" /><small v-if="onboardPreset">服务器受控门户路径</small></label>
              <label class="console-form-item application-registry-confirm"><span>确认码：{{ onboardConfirmationCode || '应用编码/环境' }}</span><input v-model="onboardConfirmation" :placeholder="onboardConfirmationCode || '应用编码/环境'" autocomplete="off" /></label>
            </div>
          </template>
          <footer class="console-form-actions">
            <button v-if="!isProductionProvisioning && onboardStep === 2" class="console-button ghost" type="button" @click="prevOnboardStep">上一步</button>
            <button v-if="!isProductionProvisioning && onboardStep === 1" class="console-button primary" type="button" @click="nextOnboardStep">下一步</button>
            <button v-else class="console-button primary" type="submit" :disabled="!canSubmitOnboard || saving">{{ saving ? '登记中…' : '登记目录' }}</button>
            <button class="console-button ghost" type="button" @click="toggleOnboarding">取消</button>
          </footer>
          <p v-if="isProductionProvisioning && !selectedProductionTarget" class="application-registry-inline-warning">当前没有可选服务器目标，不能自由填写接入参数。</p>
          <p v-else class="application-registry-inline-note">若应用环境已存在，平台会阻止覆盖；请在下方选择后更新或重试。</p>
        </form>
      </section>
    </div>

    <div v-if="environmentEditorOpen" class="application-registry-modal-backdrop" role="presentation" @click.self="environmentEditorOpen = false">
      <section class="application-registry-modal" role="dialog" aria-modal="true" aria-label="设置运行时环境">
        <h3>设置运行时环境</h3>
        <p>environment 编码创建后不可修改；URL 和路径更新需要重新部署运行时。认证提供方在环境卡片的“Keycloak 认证”分区中切换。</p>
        <form @submit.prevent="saveEnvironment">
          <div class="console-form-grid"><label class="console-form-item"><span>环境</span><input v-model="environmentForm.environment" :disabled="Boolean(environmentForm.version)" placeholder="dev / test / staging / prod" /></label><label class="console-form-item"><span>环境状态</span><select v-model="environmentForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label><label class="console-form-item"><span>Public BaseURL</span><input v-model="environmentForm.baseUrl" placeholder="http://localhost:8081" /></label><label class="console-form-item"><span>UpstreamURL</span><input v-model="environmentForm.upstreamUrl" placeholder="http://customer-api:8080" /></label><label class="console-form-item"><span>门户路径前缀</span><input v-model="environmentForm.pathPrefix" placeholder="/customer_management" /></label></div>
          <footer class="console-form-actions"><button class="console-button primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存运行时设置' }}</button><button class="console-button ghost" type="button" @click="environmentEditorOpen = false">取消</button></footer>
        </form>
      </section>
    </div>

    <div v-if="pendingDeleteApplication" class="application-registry-modal-backdrop" role="presentation" @click.self="pendingDeleteApplication = null">
      <section class="application-registry-modal" role="dialog" aria-modal="true" aria-label="退役应用确认"><h3>退役应用「{{ pendingDeleteApplication.name || pendingDeleteApplication.code }}」</h3><p>这是逻辑退役，不会物理删除环境、OAuth Client、登录目标和审计历史；门户将停止展示该应用。若还需停止容器和清理网关，请先逐个删除非 dev 环境，并按运维流程处理受保护的 dev 环境。</p><label class="console-form-item"><span>请输入应用编码确认：{{ pendingDeleteApplication.code }}</span><input v-model="deleteConfirmation" autocomplete="off" /></label><footer class="console-form-actions"><button class="console-button danger" type="button" :disabled="deleteConfirmation.trim() !== pendingDeleteApplication.code || saving" @click="confirmDeleteApplication">确认退役</button><button class="console-button ghost" type="button" @click="pendingDeleteApplication = null">取消</button></footer></section>
    </div>

    <div v-if="pendingDeleteEnvironment" class="application-registry-modal-backdrop" role="presentation" @click.self="pendingDeleteEnvironment = null">
      <section class="application-registry-modal" role="dialog" aria-modal="true" aria-label="删除环境确认"><h3>删除环境 {{ selectedApplication.code }}/{{ pendingDeleteEnvironment.environment }}</h3><p>平台会先按受控 Agent 策略下线运行时，再删除环境记录及其派生登录目标和 OAuth Client。生产合同下线仅停止 API，保留数据库、备份和服务器运行配置以便恢复。</p><label class="console-form-item"><span>请输入确认码：{{ selectedApplication.code }}/{{ pendingDeleteEnvironment.environment }}</span><input v-model="environmentDeleteConfirmation" autocomplete="off" /></label><footer class="console-form-actions"><button class="console-button danger" type="button" :disabled="environmentDeleteConfirmation.trim() !== `${selectedApplication.code}/${pendingDeleteEnvironment.environment}` || saving" @click="confirmDeleteEnvironment">确认下线并删除控制面记录</button><button class="console-button ghost" type="button" @click="pendingDeleteEnvironment = null">取消</button></footer></section>
    </div>
    <div v-if="pendingPurgeEnvironment" class="application-registry-modal-backdrop" role="presentation" @click.self="pendingPurgeEnvironment = null">
      <section class="application-registry-modal" role="dialog" aria-modal="true" aria-label="永久清理环境确认"><h3>永久清理 {{ selectedApplication.code }}/{{ pendingPurgeEnvironment.environment }}</h3><p class="application-registry-inline-warning">该操作不可恢复，将删除 OAuth 客户端、登录目标、服务凭据、配置命名空间和审计记录。请先确认数据保留审批已完成。</p><label class="console-form-item"><span>数据保留审批编号 *</span><input v-model="purgeApprovalId" autocomplete="off" placeholder="例如 RETENTION-APPROVAL-20260806-001" /></label><label class="console-form-item"><span>请输入确认码：PURGE/{{ selectedApplication.code }}/{{ pendingPurgeEnvironment.environment }}</span><input v-model="purgeConfirmation" autocomplete="off" /></label><label class="console-form-checkbox"><input v-model="purgeRetentionConfirmed" type="checkbox" />我确认审计记录可以永久删除</label><label class="console-form-checkbox"><input v-model="purgeOffboardedConfirmed" type="checkbox" />我确认该环境已经完成下线</label><footer class="console-form-actions"><button class="console-button danger" type="button" :disabled="purgeConfirmation.trim() !== `PURGE/${selectedApplication.code}/${pendingPurgeEnvironment.environment}` || !purgeApprovalId.trim() || !purgeRetentionConfirmed || !purgeOffboardedConfirmed || saving" @click="confirmPurgeEnvironment">确认永久清理</button><button class="console-button ghost" type="button" @click="pendingPurgeEnvironment = null">取消</button></footer></section>
    </div>
  </section>
</template>


<style scoped>
.application-registry-module { overflow: hidden; }
.application-registry-header, .application-registry-detail-head, .application-registry-panel-head, .application-registry-sidebar-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.application-registry-header-actions { display: flex; flex: 0 0 auto; gap: 8px; }
.application-registry-header h2 { margin: 6px 0 0; }
.application-registry-header p, .application-registry-panel-head p { max-width: 820px; margin: 7px 0 0; color: #64748b; font-size: 13px; line-height: 1.65; }
.application-registry-workspaces { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; padding: 6px; border: 1px solid #dbeafe; border-radius: 10px; background: #f8fbff; }
.application-registry-workspaces button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 11px; color: #475569; border: 0; border-radius: 7px; background: transparent; font-weight: 650; font-size: 12px; cursor: pointer; }
.application-registry-workspaces button:hover { color: #1d4ed8; background: #eff6ff; }
.application-registry-workspaces button.is-active { color: #1d4ed8; background: #fff; box-shadow: 0 1px 3px rgb(15 23 42 / 12%); }
.application-registry-workspaces :deep(svg) { width: 15px; height: 15px; }
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
.application-registry-discovery { display: grid; gap: 10px; margin-top: 16px; padding: 14px; border: 1px solid #c7d2fe; border-radius: 12px; background: linear-gradient(135deg, #f8faff, #faf8ff); }
.application-registry-discovery > div > strong, .application-registry-discovery > div > small { display: block; }
.application-registry-discovery > div > small { margin-top: 3px; color: #64748b; font-size: 12px; line-height: 1.55; }
.application-registry-discovery article { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border: 1px solid #e0e7ff; border-radius: 9px; background: #fff; }
.application-registry-discovery article > div { min-width: 0; }
.application-registry-discovery article strong, .application-registry-discovery article span, .application-registry-discovery article small { display: block; }
.application-registry-discovery article strong { color: #1e293b; font-size: 13px; overflow-wrap: anywhere; word-break: break-all; }
.application-registry-discovery article span, .application-registry-discovery article small { margin-top: 3px; overflow: hidden; color: #64748b; font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.application-registry-error { display: grid; gap: 4px; margin: 14px 0 0; padding: 10px 12px; color: #b91c1c; border: 1px solid #fecaca; border-radius: 8px; background: #fff7f7; font-size: 12px; line-height: 1.55; }
.application-registry-error-actions { display: flex; gap: 8px; margin-top: 4px; }
.application-registry-error span, .application-registry-error small { color: #7f1d1d; overflow-wrap: anywhere; word-break: break-all; }
.application-registry-error-detail { margin: 6px 0 0; padding: 8px; overflow: auto; max-height: 220px; color: #7f1d1d; border: 1px solid #fecaca; border-radius: 6px; background: #fff; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
.application-registry-environment-guidance.is-error { color: #b91c1c; }
.application-registry-environment-guidance.is-error span { display: block; margin-top: 2px; color: #7f1d1d; }
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
.application-registry-environment.authentication { cursor: default; }
.application-registry-environment.authentication:hover { border-color: #e2e8f0; box-shadow: none; }
.application-registry-auth-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; margin: 10px 0; padding: 10px; border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; }
.application-registry-auth-details div { min-width: 0; }
.application-registry-auth-details dt { color: #64748b; font-size: 10px; font-weight: 700; }
.application-registry-auth-details dd { min-width: 0; margin: 3px 0 0; overflow: hidden; color: #1e293b; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.application-registry-auth-details code { font-size: 10px; }
.application-registry-switch-gates { margin: 8px 0; padding: 8px 10px; border: 1px solid #fde68a; border-radius: 7px; background: #fffbeb; color: #78350f; font-size: 11px; }
.application-registry-switch-gates > strong { display: block; margin-bottom: 4px; }
.application-registry-switch-gates ul { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
.application-registry-switch-gates li { display: grid; grid-template-columns: 44px 1fr; gap: 4px; align-items: baseline; }
.application-registry-switch-gates li code { overflow-wrap: anywhere; word-break: break-all; }
.application-registry-switch-gates li span { color: #b45309; font-weight: 700; }
.application-registry-switch-gates li.is-passed span { color: #15803d; }
.application-registry-switch-gates li small { grid-column: 2; color: #92400e; line-height: 1.45; }
.application-registry-switch-gates p { margin: 6px 0 0; line-height: 1.45; }
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
@media (max-width: 640px) { .application-registry-header, .application-registry-detail-head, .application-registry-panel-head { flex-direction: column; align-items: stretch; } .application-registry-confirm { grid-column: auto; } .application-registry-detail-actions { justify-content: flex-start; } .application-registry-workspaces { display: grid; grid-template-columns: 1fr; } .application-registry-auth-details { grid-template-columns: 1fr; } }

/* 接入进度 stepper */
.application-registry-progress { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 18px 0 4px; }
.application-registry-progress ol { display: flex; flex: 1 1 auto; gap: 0; margin: 0; padding: 0; list-style: none; }
.application-registry-progress li { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; color: #94a3b8; font-size: 11px; }
.application-registry-progress li::after { content: ''; flex: 1; min-width: 12px; height: 1px; margin: 0 6px; background: #e2e8f0; }
.application-registry-progress li:last-child::after { display: none; }
.application-registry-progress li i { display: grid; width: 18px; height: 18px; flex: 0 0 auto; place-items: center; color: #94a3b8; font-size: 10px; font-style: normal; font-weight: 700; border: 1px solid #cbd5e1; border-radius: 50%; background: #fff; }
.application-registry-progress li.is-done { color: #15803d; }
.application-registry-progress li.is-done i { color: #fff; border-color: #16a34a; background: #16a34a; }
.application-registry-progress li.is-current { color: #1d4ed8; font-weight: 600; }
.application-registry-progress li.is-current i { color: #fff; border-color: #2563eb; background: #2563eb; box-shadow: 0 0 0 3px rgb(37 99 235 / 12%); }
.application-registry-progress > small { flex: 0 0 auto; color: #94a3b8; font-size: 11px; }

/* 环境卡片分区 */
.application-registry-environment { padding: 0; cursor: pointer; }
.application-registry-environment-main { padding: 12px 14px; border-bottom: 1px solid #eef2f7; }
.application-registry-zone { padding: 12px 14px; border-top: 1px solid #eef2f7; }
.application-registry-zone:first-of-type { border-top: 0; }
.application-registry-zone-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.application-registry-zone-head h5 { margin: 0; color: #475569; font-size: 12px; font-weight: 700; }
.application-registry-zone-hint { color: #94a3b8; font-size: 10px; }
.application-registry-zone-toggle { padding: 2px 8px; color: #2563eb; font-size: 11px; font-weight: 600; border: 0; border-radius: 6px; background: #eff6ff; cursor: pointer; }
.application-registry-zone-toggle:hover { background: #dbeafe; }
.application-registry-provider { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; white-space: nowrap; }
.application-registry-provider.is-platform { color: #475569; background: #f1f5f9; }
.application-registry-provider.is-keycloak { color: #6d28d9; background: #f5f3ff; }
.application-registry-auth-summary { display: flex; flex-wrap: wrap; gap: 8px 16px; color: #64748b; font-size: 12px; }
.application-registry-auth-summary span { white-space: nowrap; }
.application-registry-auth-summary span:nth-child(2) { color: #b45309; }

/* 新增接入向导弹窗 */
.application-registry-wizard-modal { width: min(720px, 100%); max-height: min(86vh, 720px); overflow: auto; }
.application-registry-wizard-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.application-registry-wizard-head h3 { margin: 4px 0 0; }
.application-registry-wizard-head p { margin: 6px 0 0; font-size: 11px; }
.application-registry-wizard-close { width: 30px; height: 30px; border: 0; border-radius: 6px; background: #f1f5f9; color: #64748b; font-size: 20px; line-height: 1; cursor: pointer; }
.application-registry-wizard-close:hover { background: #e2e8f0; }
.application-registry-inline-note { margin: 10px 0 0; color: #475569; font-size: 12px; line-height: 1.6; }

</style>
