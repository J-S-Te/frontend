import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildPortalSubsystems, findFrontendModule } from './moduleRegistry.js'

const subsystemPortalView = await readFile(new URL('../platform/views/SubsystemPortalView.vue', import.meta.url), 'utf8')

test('基础能力平台是唯一无需后端登记的内置门户卡片', () => {
  const cards = buildPortalSubsystems([])
  assert.equal(cards.length, 1)
  assert.equal(cards[0].code, 'basic-platform')
  assert.equal(cards[0].source, 'built-in')
  assert.deepEqual(cards[0].route, { name: 'settings', params: { section: 'iam' } })
})

test('没有平台管理权限时可以隐藏内置基础平台卡片', () => {
  assert.deepEqual(buildPortalSubsystems([], { includeBuiltInPlatform: false }), [])
})

test('未内置的已登记应用使用后端地址', () => {
  const cards = buildPortalSubsystems([{
    application_id: 'app-1',
    environment_id: 'env-1',
    code: 'project_management',
    name: '',
    description: '',
    environment: 'prod',
    public_url: 'https://portal.example.com/project-management',
  }])

  assert.equal(cards.length, 2)
  assert.equal(cards[1].name, '项目管理系统')
  assert.equal(cards[1].description, '项目立项、计划、协作、进度、风险与归档管理')
  assert.deepEqual(cards[1].route, { name: 'project_management', params: { section: 'dashboard' } })
  assert.equal(cards[1].publicURL, '')
  assert.equal(cards[1].source, 'application-registry')
})

test('未内置的已登记应用使用后端地址', () => {
  const cards = buildPortalSubsystems([{
    application_id: 'external-app',
    environment_id: 'external-env',
    code: 'external-system',
    name: '外部业务系统',
    description: '由基础能力平台完成接入',
    environment: 'prod',
    public_url: 'https://portal.example.com/external-system',
  }])

  assert.equal(cards.length, 2)
  assert.equal(cards[1].name, '外部业务系统')
  assert.equal(cards[1].description, '由基础能力平台完成接入')
  assert.equal(cards[1].publicURL, 'https://portal.example.com/external-system')
  assert.equal(cards[1].source, 'application-registry')
})

test('后端返回的应用名称和描述优先于本地默认文案', () => {
  const cards = buildPortalSubsystems([{
    application_id: 'app-2',
    environment_id: 'env-2',
    code: 'external-system',
    name: '外部业务系统',
    description: '由基础能力平台完成接入',
    environment: 'test',
    public_url: 'https://portal.example.com/external-system',
  }])

  assert.equal(cards[1].name, '外部业务系统')
  assert.equal(cards[1].description, '由基础能力平台完成接入')
  assert.equal(cards[1].icon, 'dashboard')
})

test('后端重复返回基础平台登记时不会生成第二张平台卡片', () => {
  const cards = buildPortalSubsystems([{
    application_id: 'platform-app',
    environment_id: 'platform-env',
    code: 'platform',
    name: '基础能力平台',
    public_url: 'https://portal.example.com/platform',
  }])

  assert.equal(cards.length, 1)
  assert.equal(cards[0].code, 'basic-platform')
})

test('数据看板子系统使用本地默认文案与统一前端路由', () => {
  const cards = buildPortalSubsystems([{
    application_id: 'da-app',
    environment_id: 'da-prod',
    code: 'data_analysis',
    name: '',
    description: '',
    environment: 'prod',
    public_url: 'http://localhost:8081/data_analysis/',
  }])

  assert.equal(cards.length, 2)
  assert.equal(cards[1].name, '数据看板与统计分析')
  assert.equal(cards[1].description, '经营总览、合同/项目/报告/财务看板、预警中心与指标字典')
  assert.deepEqual(cards[1].route, { name: 'data_analysis', params: { section: 'overview' } })
  assert.equal(cards[1].publicURL, '')
})

test('合同管理系统使用统一编码和统一前端路由', () => {
  const cards = buildPortalSubsystems([{
    application_id: 'contract-app',
    environment_id: 'contract-prod',
    code: 'contract_management',
    name: '合同管理系统',
    environment: 'prod',
    public_url: 'http://localhost:8081/contract_management/',
  }])

  assert.equal(cards.length, 2)
  assert.equal(cards[1].code, 'contract_management')
  assert.equal(cards[1].environment, undefined)
  assert.deepEqual(cards[1].route, { name: 'contract_management', params: { section: 'dashboard' } })
  assert.equal(cards[1].publicURL, '')
})

test('客户与商机系统门户入口强制先经过服务端 OIDC 登录', () => {
  const cards = buildPortalSubsystems([{
    application_id: 'crm-app',
    environment_id: 'crm-prod',
    code: 'customer_and_opportunity',
    name: '客户与商机管理系统',
    environment: 'prod',
    public_url: 'http://localhost:8090/customer-opportunity/',
  }])

  assert.equal(
    cards[1].authenticationURL,
    '/customer-opportunity/auth/login?return_to=%2Fcustomer-opportunity%2Fcustomers',
  )
  assert.match(subsystemPortalView, /if \(subsystem\.authenticationURL\)/)
  assert.ok(
    subsystemPortalView.indexOf('if (subsystem.authenticationURL)')
      < subsystemPortalView.indexOf('if (subsystem.publicURL)'),
  )
})

test('Keycloak 用户投影未完成时门户入口保持失败关闭并保留恢复提示', () => {
  const cards = buildPortalSubsystems([{
    application_id: 'crm-app',
    environment_id: 'crm-prod',
    code: 'customer_and_opportunity',
    name: '客户与商机管理系统',
    projection_status: 'PENDING',
    projection_ready: false,
    allowed: false,
    projection_next_action: '账号权限正在等待同步，请稍后重试。',
  }])

  assert.equal(cards[1].allowed, false)
  assert.equal(cards[1].projectionStatus, 'PENDING')
  assert.equal(cards[1].projectionNextAction, '账号权限正在等待同步，请稍后重试。')
  assert.match(subsystemPortalView, /subsystem\.projectionNextAction/)
  assert.match(subsystemPortalView, /权限同步中/)
  assert.match(subsystemPortalView, /\['PENDING', 'RUNNING', 'QUEUED', 'RETRYING', 'SYNCING'\]/)
  assert.match(subsystemPortalView, /loadPortalCatalog\(\{ silent: true \}\)/)
})

test('同一个外部应用返回多个环境时只显示一个逻辑子系统入口', () => {
  const cards = buildPortalSubsystems([
    {
      application_id: 'external-app',
      environment_id: 'external-dev',
      code: 'external-system',
      environment: 'dev',
      public_url: 'https://dev.example.com/',
    },
    {
      application_id: 'external-app',
      environment_id: 'external-prod',
      code: 'external-system',
      environment: 'prod',
      public_url: 'https://example.com/',
    },
  ])

  assert.equal(cards.length, 2)
  assert.equal(cards[1].publicURL, 'https://dev.example.com/')
  assert.equal(cards[1].description, '已接入统一身份平台的业务应用')
  assert.doesNotMatch(cards[1].description, /dev|prod|test|staging/i)
})

test('子系统门户卡片不展示部署环境标识', () => {
  assert.doesNotMatch(subsystemPortalView, /subsystem-card__environment|subsystem\.environment/)
})
