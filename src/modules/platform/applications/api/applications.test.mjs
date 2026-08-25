import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  ApplicationRegistryError,
  adoptSubsystemRuntime,
  createApplication,
  createEnvironment,
  deleteApplicationRegistration,
  deleteEnvironment,
  getSubsystemCapabilities,
  getKeycloakIntegrationStatus,
	getKeycloakProjectionAlerts,
  getSubsystemStatus,
  listPortalApplications,
	listKeycloakProjectionFailures,
  onboardSubsystem,
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
} from './applications.js'
import { readFile } from 'node:fs/promises'

const onboardingModule = await readFile(new URL('../components/SubsystemOnboardingModule.vue', import.meta.url), 'utf8')

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
  }
}

test('createApplication persists through the registry API with session credentials', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { application_id: 'app-1' } })
  }

  const result = await createApplication({ code: 'business-app', name: '业务应用' })

  assert.deepEqual(result, { application_id: 'app-1' })
  assert.equal(requested.url, '/api/v1/applications')
  assert.equal(requested.options.method, 'POST')
  assert.equal(requested.options.credentials, 'include')
  assert.deepEqual(JSON.parse(requested.options.body), {
    code: 'business-app',
    name: '业务应用',
    application_type: 'web',
    description: null,
    status: 'ACTIVE',
  })
})

test('application registry errors retain actionable detail and request trace id', async () => {
  globalThis.fetch = async () => jsonResponse({
    code: 'PLATFORM_DEPENDENCY_UNAVAILABLE',
    message: '当前部署未启用受控部署 Agent',
    request_id: 'trace-1',
    details: { next_action: '升级生产部署资产后重试' },
  }, { ok: false, status: 503 })

  await assert.rejects(
    () => getSubsystemStatus({ applicationCode: 'contract_management', environment: 'prod' }),
    (error) => error instanceof ApplicationRegistryError
      && error.traceId === 'trace-1'
      && error.nextAction === '升级生产部署资产后重试'
      && error.details.next_action === '升级生产部署资产后重试',
  )
})

test('onboarding errors expose a direct recovery path for an existing environment', () => {
  assert.match(onboardingModule, /IAM_SUBSYSTEM_ALREADY_ONBOARDED/)
  assert.match(onboardingModule, /recoverExistingEnvironment/)
  assert.match(onboardingModule, /查看已有环境/)
  assert.match(onboardingModule, /状态读取失败/)
})

test('getSubsystemCapabilities reads the backend deployment policy without client-side inference', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({
      data: {
        automation_enabled: true,
        deployment_mode: 'production',
        supported_application_codes: ['contract_management'],
        supported_environments: ['prod'],
        targets: [{
          application_code: 'contract_management',
          application_name: '合同管理系统',
          environment: 'prod',
          upstream_url: 'http://contract-api:8081',
          path_prefix: '/contract_management',
          client_type: 'confidential',
        }],
        defaults: {
          application_code: 'contract_management',
          environment: 'prod',
          public_base_url: 'https://portal.example.com',
          upstream_url: 'http://contract-api:8081',
          path_prefix: '/contract_management',
          client_type: 'confidential',
        },
      },
    })
  }

  const capabilities = await getSubsystemCapabilities()

  assert.equal(requested.url, '/api/v1/subsystem-capabilities')
  assert.equal(requested.options.credentials, 'include')
  assert.equal(capabilities.deployment_mode, 'production')
  assert.deepEqual(capabilities.supported_application_codes, ['contract_management'])
  assert.equal(capabilities.targets[0].path_prefix, '/contract_management')
})

test('deleteApplicationRegistration sends the stable code confirmation and optimistic-lock version', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { application_id: 'app/duplicate', status: 'RETIRED', version: 4 } })
  }

  const result = await deleteApplicationRegistration({
    applicationId: 'app/duplicate',
    confirmationCode: 'contract_management',
    version: 3,
  })

  assert.equal(result.status, 'RETIRED')
  assert.equal(requested.url, '/api/v1/applications/app%2Fduplicate')
  assert.equal(requested.options.method, 'DELETE')
  assert.equal(requested.options.credentials, 'include')
  assert.deepEqual(JSON.parse(requested.options.body), {
    confirmation_code: 'contract_management',
    version: 3,
  })
})

test('updateApplication preserves the stable code and sends optimistic-lock fields', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { application_id: 'app-1', version: 4 } })
  }

  await updateApplication({
    applicationId: 'app-1',
    name: '客户管理系统',
    applicationType: 'web',
    homepageUrl: 'https://portal.example/customer_management/',
    description: '客户与商机管理',
    status: 'ACTIVE',
    version: 3,
  })

  assert.equal(requested.url, '/api/v1/applications/app-1')
  assert.equal(requested.options.method, 'PATCH')
  const body = JSON.parse(requested.options.body)
  assert.equal(body.name, '客户管理系统')
  assert.equal(body.version, 3)
  assert.equal('code' in body, false)
})

test('createEnvironment sends public, upstream and path-prefix fields separately', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { environment_id: 'env-1' } })
  }

  await createEnvironment({
    applicationId: 'app/1',
    environment: 'production',
    baseUrl: 'http://portal.example',
    upstreamUrl: 'http://10.0.0.8:8081',
    pathPrefix: '/business-app',
  })

  assert.equal(requested.url, '/api/v1/applications/app%2F1/environments')
  assert.equal(requested.options.method, 'POST')
  assert.deepEqual(JSON.parse(requested.options.body), {
    environment: 'production',
    base_url: 'http://portal.example',
    upstream_url: 'http://10.0.0.8:8081',
    path_prefix: '/business-app',
    issuer_alias: null,
    metadata: {},
    status: 'ACTIVE',
  })
})

test('updateEnvironment carries the optimistic-lock version and gateway fields', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { version: 8 } })
  }

  await updateEnvironment({
    applicationId: 'app-1',
    environmentId: 'env-1',
    baseUrl: 'https://portal.example/root',
    upstreamUrl: 'http://[fd00::8]:8081',
    pathPrefix: '/business-app',
    version: 7,
  })

  assert.equal(requested.url, '/api/v1/applications/app-1/environments/env-1')
  assert.equal(requested.options.method, 'PATCH')
  assert.equal(JSON.parse(requested.options.body).version, 7)
  assert.equal(JSON.parse(requested.options.body).upstream_url, 'http://[fd00::8]:8081')
})

test('deleteEnvironment sends exact scoped confirmation after runtime teardown is handled separately', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ data: { environment_id: 'env-1' } })
  }

  await teardownSubsystem({ applicationCode: 'business-app', environment: 'prod' })
  await deleteEnvironment({
    applicationId: 'app-1',
    environmentId: 'env-1',
    confirmationCode: 'business-app/prod',
    version: 7,
  })

  assert.equal(requests[0].url, '/api/v1/subsystem-teardown')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[1].url, '/api/v1/applications/app-1/environments/env-1')
  assert.equal(requests[1].options.method, 'DELETE')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    confirmation_code: 'business-app/prod',
    version: 7,
  })
})


test('onboardSubsystem requests automatic deployment and returns only safe onboarding metadata', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { automation: { status: 'completed', public_url: 'https://portal.example.com/business-app/' } } }, { status: 201 })
  }

  const result = await onboardSubsystem({
    applicationCode: 'business-app',
    applicationName: '业务应用',
    publicBaseUrl: 'https://portal.example.com',
    upstreamUrl: 'http://10.0.0.8:8081',
    pathPrefix: '/business-app',
  })

  assert.equal(result.automation.status, 'completed')
  assert.equal(result.automation.public_url, 'https://portal.example.com/business-app/')
  assert.equal('integration' in result, false)
  assert.equal(requested.url, '/api/v1/subsystem-onboarding')
  assert.equal(requested.options.method, 'POST')
  assert.deepEqual(JSON.parse(requested.options.body), {
    application_code: 'business-app',
    application_name: '业务应用',
    description: null,
    environment: 'prod',
    public_base_url: 'https://portal.example.com',
    upstream_url: 'http://10.0.0.8:8081',
    path_prefix: '/business-app',
    client_type: 'confidential',
  })
})

test('registerSubsystemDirectory only registers the directory and never sends OAuth client fields', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { application: { application_id: 'app-1' }, environment: { environment_id: 'env-1' }, next_action: '同步 Keycloak Client' } }, { status: 201 })
  }

  const result = await registerSubsystemDirectory({
    applicationCode: 'business-app', applicationName: '业务应用', environment: 'prod',
    publicBaseUrl: 'https://portal.example.com', upstreamUrl: 'http://business-api:8080', pathPrefix: '/business-app', issuerAlias: 'keycloak',
  })

  assert.equal(result.next_action, '同步 Keycloak Client')
  assert.equal(requested.url, '/api/v1/subsystem-directory')
  const body = JSON.parse(requested.options.body)
  assert.equal(body.issuer_alias, 'keycloak')
  assert.equal('client_type' in body, false)
  assert.equal('client_secret' in body, false)
})

test('getKeycloakIntegrationStatus reads the dedicated durable integration endpoint', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { provider: 'keycloak', client_state: 'SYNCED' } })
  }
  const result = await getKeycloakIntegrationStatus({ applicationCode: 'business-app', environment: 'prod' })
  assert.equal(result.client_state, 'SYNCED')
  assert.equal(requested.url, '/api/v1/keycloak-integration/status?application_code=business-app&environment=prod')
  assert.equal(requested.options.method, undefined)
})

test('listPortalApplications uses the authenticated tenant catalog endpoint', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: [{ code: 'business-app', public_url: 'https://portal.example.com/business-app/' }] })
  }

  const result = await listPortalApplications({ environment: 'prod' })

  assert.equal(requested.url, '/api/v1/portal/applications?environment=prod')
  assert.equal(requested.options.credentials, 'include')
  assert.equal(requested.options.cache, 'no-store')
  assert.equal(requested.options.headers['Cache-Control'], 'no-cache')
  assert.equal(result[0].code, 'business-app')
})

test('deployment status, adoption, update and retry use dedicated Agent lifecycle endpoints', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ data: { status: 'PROVISION_FAILED', next_action: '检查生产 Agent 日志后重试' } })
  }

  const status = await getSubsystemStatus({ applicationCode: 'business-app', environment: 'dev' })
  await adoptSubsystemRuntime({
    applicationCode: 'business-app',
    environment: 'dev',
    publicBaseUrl: 'https://portal.example.com',
    upstreamUrl: 'http://10.0.0.8:8081',
    pathPrefix: '/business-app',
    issuerAlias: 'keycloak',
  })
  await updateSubsystemRuntime({
    applicationCode: 'business-app',
    environment: 'dev',
    publicBaseUrl: 'https://portal.example.com',
    upstreamUrl: 'http://10.0.0.8:8081',
    pathPrefix: '/business-app',
  })
  await retrySubsystem({
    applicationCode: 'business-app',
    environment: 'dev',
    publicBaseUrl: 'https://portal.example.com',
    upstreamUrl: 'http://10.0.0.8:8081',
    pathPrefix: '/business-app',
    issuerAlias: 'keycloak',
  })

  assert.equal(status.next_action, '检查生产 Agent 日志后重试')
  assert.equal(requests[0].url, '/api/v1/subsystem-status?application_code=business-app&environment=dev')
  assert.equal(requests[1].url, '/api/v1/subsystem-adoption')
  assert.equal(requests[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    application_code: 'business-app',
    environment: 'dev',
    public_base_url: 'https://portal.example.com',
    upstream_url: 'http://10.0.0.8:8081',
    path_prefix: '/business-app',
    issuer_alias: 'keycloak',
  })
  assert.equal(requests[2].url, '/api/v1/subsystem-update')
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    application_code: 'business-app',
    environment: 'dev',
    public_base_url: 'https://portal.example.com',
    upstream_url: 'http://10.0.0.8:8081',
    path_prefix: '/business-app',
  })
  assert.equal(requests[3].url, '/api/v1/subsystem-retry')
  assert.deepEqual(JSON.parse(requests[3].options.body), {
    application_code: 'business-app',
    environment: 'dev',
    public_base_url: 'https://portal.example.com',
    upstream_url: 'http://10.0.0.8:8081',
    path_prefix: '/business-app',
    issuer_alias: 'keycloak',
  })
})

test('unmanaged environments expose a guarded runtime adoption entry without data deletion language', () => {
  assert.match(onboardingModule, /environmentStatus\(environment\) === 'UNMANAGED'/)
  assert.match(onboardingModule, /接管运行时/)
  assert.match(onboardingModule, /openRuntimeAdoption/)
  assert.match(onboardingModule, /adoptSubsystemRuntime/)
  assert.match(onboardingModule, /不会删除或格式化数据库、数据卷、环境目录、登录目标及现有业务数据/)
  assert.match(onboardingModule, /接管运行时失败；现有服务、数据库和数据卷均未删除/)
})

test('application access UI separates logical retirement, runtime teardown and protected dev deletion', () => {
  assert.match(onboardingModule, /不会物理删除环境、OAuth Client、登录目标和审计历史/)
  assert.match(onboardingModule, /environment\.environment !== 'dev'/)
  assert.match(onboardingModule, /await teardownSubsystem[\s\S]*await deleteEnvironment/)
  assert.match(onboardingModule, /dev 环境不能通过管理页面删除/)
})

test('adding an environment keeps the selected application identity immutable and excludes existing environment codes', () => {
  assert.match(onboardingModule, /onboardExistingApplicationId/)
  assert.match(onboardingModule, /:disabled="onboardingExistingApplication"/)
  assert.match(onboardingModule, /availableOnboardEnvironments/)
  assert.match(onboardingModule, /preferredEnvironments\.value\.find\(\(item\) => !environments\.value\.some/)
})

test('production onboarding only exposes reviewed unused targets while allowing the public base URL to be entered', () => {
  assert.match(onboardingModule, /provisioningCapabilities\.value\?\.targets/)
  assert.match(onboardingModule, /registeredProductionTargetKeys/)
  assert.match(onboardingModule, /productionTargetInventoryReady/)
  assert.match(onboardingModule, /仅显示 subsystems\.d 中审核通过且尚未接入的目标/)
  assert.match(onboardingModule, /暂无可接入目标/)
  assert.match(onboardingModule, /:value="onboardForm\.applicationCode" disabled/)
  assert.match(onboardingModule, /:value="onboardForm\.applicationName" disabled/)
  assert.match(onboardingModule, /:value="onboardForm\.environment" disabled/)
  assert.doesNotMatch(onboardingModule, /:value="onboardForm\.clientType" disabled/)
  assert.match(onboardingModule, /v-model="onboardForm\.publicBaseUrl" type="url"/)
  assert.match(onboardingModule, /:value="onboardForm\.upstreamUrl" readonly/)
  assert.match(onboardingModule, /:value="onboardForm\.pathPrefix" readonly/)
  assert.match(onboardingModule, /defaults\.public_base_url \|\| ''/)
  assert.match(onboardingModule, /当前没有可选服务器目标，不能自由填写接入参数。/)
})

test('onboarding UI does not infer deployment policy from the browser hostname', () => {
  assert.doesNotMatch(onboardingModule, /window\.location\.hostname/)
  assert.doesNotMatch(onboardingModule, /isLoopbackHost/)
  assert.match(onboardingModule, /部署能力与允许范围最终由后端 Agent 校验/)
  assert.match(onboardingModule, /填入服务器接入配置/)
  assert.doesNotMatch(onboardingModule, /只允许合同管理系统 contract_management\/prod/)
  assert.match(onboardingModule, /getSubsystemCapabilities/)
  assert.match(onboardingModule, /deployment_mode === 'production'/)
  assert.match(onboardingModule, /supportedApplicationCodes/)
  assert.match(onboardingModule, /selectableProductionTargets/)
  assert.match(onboardingModule, /服务器接入目标/)
  assert.match(onboardingModule, /if \(isProductionProvisioning\.value\) applyProductionProvisioningPreset\(\)/)
})

test('deployment cards retain and render the backend next action', () => {
  assert.match(onboardingModule, /deploymentStates\.value = Object\.fromEntries/)
  assert.match(onboardingModule, /deploymentStates\.value\[environment\.environment\]\?\.next_action/)
  assert.match(onboardingModule, /environmentNextAction\(environment\)/)
  assert.match(onboardingModule, /处理建议：/)
})

test('Keycloak client synchronization uses the dedicated controlled endpoint', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { alias: 'keycloak', realm: 'basic-platform', client_id: 'contract-prod-web', claims_state: 'READY' } })
  }

  const result = await syncKeycloakClient({
    applicationCode: 'contract_management',
    environment: 'prod',
    publicBaseUrl: 'https://portal.example.com/',
    upstreamUrl: 'http://contract-api:8081/',
    pathPrefix: '/contract_management/',
  })

  assert.equal(requested.url, '/api/v1/keycloak-integration/sync')
  assert.equal(requested.options.method, 'POST')
  assert.deepEqual(JSON.parse(requested.options.body), {
    application_code: 'contract_management',
    environment: 'prod',
    public_base_url: 'https://portal.example.com',
    upstream_url: 'http://contract-api:8081',
    path_prefix: '/contract_management',
  })
  assert.equal(result.client_id, 'contract-prod-web')
})

test('Keycloak cutover and rollback use dedicated fixed-provider endpoints', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ data: { status: 'READY' } })
  }

  const payload = {
    applicationCode: 'contract_management',
    environment: 'prod',
    publicBaseUrl: 'https://portal.example.com/',
    upstreamUrl: 'http://contract-api:8081/',
    pathPrefix: '/contract_management/',
  }
  await switchToKeycloak(payload)
  await rollbackToPlatform(payload)

  const expectedBody = {
    application_code: 'contract_management',
    environment: 'prod',
    public_base_url: 'https://portal.example.com',
    upstream_url: 'http://contract-api:8081',
    path_prefix: '/contract_management',
  }
  assert.equal(requests[0].url, '/api/v1/keycloak-integration/switch')
  assert.equal(requests[1].url, '/api/v1/keycloak-integration/rollback')
  assert.deepEqual(JSON.parse(requests[0].options.body), expectedBody)
  assert.deepEqual(JSON.parse(requests[1].options.body), expectedBody)
  assert.equal('issuer_alias' in JSON.parse(requests[0].options.body), false)
  assert.equal('issuer_alias' in JSON.parse(requests[1].options.body), false)
})

test('Keycloak operations use dedicated status, observation and controlled replay endpoints', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ data: { state: 'OK', items: [], event_id: 'evt-1', replayed: true } })
  }

  await getKeycloakProjectionAlerts()
  await listKeycloakProjectionFailures({ applicationCode: 'customer_portal', environment: 'prod' })
  await startKeycloakObservation({ applicationCode: 'customer_portal', environment: 'prod' })
  await replayKeycloakProjectionFailure({ eventId: 'evt-1', confirmation: 'evt-1', reason: '已修复 Keycloak 连接并确认安全重放。' })

  assert.equal(requests[0].url, '/api/v1/keycloak-integration/projection-alerts')
  assert.equal(requests[1].url, '/api/v1/keycloak-integration/projection-failures?page=1&page_size=50&application_code=customer_portal&environment=prod')
  assert.equal(requests[2].url, '/api/v1/keycloak-integration/observation')
  assert.deepEqual(JSON.parse(requests[2].options.body), { application_code: 'customer_portal', environment: 'prod' })
  assert.equal(requests[3].url, '/api/v1/keycloak-integration/projection-failures/evt-1/replay')
  assert.deepEqual(JSON.parse(requests[3].options.body), { confirmation: 'evt-1', reason: '已修复 Keycloak 连接并确认安全重放。' })
})

test('environment cards partition directory, Keycloak authentication and runtime actions', () => {
  assert.match(onboardingModule, /目录与入口/)
  assert.match(onboardingModule, /Keycloak 认证/)
  assert.match(onboardingModule, /运行时与部署/)
  assert.match(onboardingModule, /application-registry-zone directory/)
  assert.match(onboardingModule, /application-registry-zone runtime/)
  assert.match(onboardingModule, /application-registry-zone authentication/)
  assert.match(onboardingModule, /导入\/同步 Keycloak Client/)
  assert.match(onboardingModule, /切换 Keycloak/)
  assert.match(onboardingModule, /回滚基础平台/)
  assert.match(onboardingModule, /开始 7 天观察/)
  assert.match(onboardingModule, /授权投影告警与受控重放/)
  assert.match(onboardingModule, /Realm/)
  assert.match(onboardingModule, /Claims 映射/)
  assert.match(onboardingModule, /认证提供方在环境卡片的“Keycloak 认证”分区中切换/)
})
