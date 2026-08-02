import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPortalSubsystems, findFrontendModule } from './moduleRegistry.js'

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
  assert.equal(cards[1].environment, 'prod')
  assert.deepEqual(cards[1].route, { name: 'contract_management', params: { section: 'dashboard' } })
  assert.equal(cards[1].publicURL, '')
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
})
