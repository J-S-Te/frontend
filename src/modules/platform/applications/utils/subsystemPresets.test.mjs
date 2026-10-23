import assert from 'node:assert/strict'
import test from 'node:test'
import { applySubsystemOnboardingPreset, normalizeIntegratedSubsystemOnboarding, subsystemOnboardingPreset, validateIntegratedSubsystemOnboarding } from './subsystemPresets.js'

test('customer integrated preset uses the actual Compose alias and unified frontend path', () => {
  const preset = subsystemOnboardingPreset('customer_and_opportunity')
  assert.equal(preset.applicationName, '客户与商机管理系统')
  assert.equal(preset.upstreamUrl, 'http://customer-api:8090')
  assert.equal(preset.pathPrefix, '/customer-opportunity')
})

test('customer portal preset uses its isolated backend and canonical public path', () => {
  const preset = subsystemOnboardingPreset('customer_portal')
  assert.equal(preset.applicationName, '客户自助门户')
  assert.equal(preset.upstreamUrl, 'http://portal-api:8091')
  assert.equal(preset.pathPrefix, '/customer-portal')
})

test('preset fills empty fields without overwriting manual standalone configuration', () => {
  const empty = { applicationCode: 'customer_and_opportunity', applicationName: '', upstreamUrl: '', pathPrefix: '' }
  applySubsystemOnboardingPreset(empty)
  assert.equal(empty.upstreamUrl, 'http://customer-api:8090')
  assert.equal(empty.pathPrefix, '/customer-opportunity')

  const manual = { applicationCode: 'customer_and_opportunity', applicationName: '自定义', upstreamUrl: 'https://crm.internal', pathPrefix: '/crm' }
  applySubsystemOnboardingPreset(manual)
  assert.equal(manual.upstreamUrl, 'https://crm.internal')
  assert.equal(manual.pathPrefix, '/crm')
})

test('integrated preset validation rejects an unavailable network alias', () => {
  assert.match(validateIntegratedSubsystemOnboarding({
    applicationCode: 'customer_and_opportunity', upstreamUrl: 'http://opportunity-api:8082', pathPrefix: '/customer_and_opportunity',
  }), /customer-api:8090/)
})

test('normalization upgrades the legacy customer values shown in the failed form', () => {
  const form = { applicationCode: 'customer_and_opportunity', upstreamUrl: 'http://opportunity-api:8082', pathPrefix: '/customer_and_opportunity' }
  assert.equal(normalizeIntegratedSubsystemOnboarding(form), true)
  assert.equal(form.upstreamUrl, 'http://customer-api:8090')
  assert.equal(form.pathPrefix, '/customer-opportunity')
})

test('normalization repairs independently migrated integrated values', () => {
  const form = { applicationCode: 'customer_and_opportunity', upstreamUrl: 'http://customer-api:8090', pathPrefix: '/customer_and_opportunity' }
  assert.equal(normalizeIntegratedSubsystemOnboarding(form), true)
  assert.equal(form.upstreamUrl, 'http://customer-api:8090')
  assert.equal(form.pathPrefix, '/customer-opportunity')
})

// ---- 服务端清单驱动（步骤 4 首片）------------------------------------------------

const serverTargets = Object.freeze([
  Object.freeze({ application_code: 'contract_management', application_name: '合同管理系统', environment: 'dev',
    upstream_url: 'http://contract-api:8081', path_prefix: '/contract_management', client_type: 'confidential', manifest_checksum: 'm-contract' }),
  Object.freeze({ application_code: 'customer_and_opportunity', application_name: '客户与商机管理系统', environment: 'dev',
    upstream_url: 'http://customer-api:8090', path_prefix: '/customer-opportunity', client_type: 'confidential' }),
  Object.freeze({ application_code: 'customer_portal', application_name: '客户自助门户', environment: 'dev',
    upstream_url: 'http://portal-api:8091', path_prefix: '/customer-portal', client_type: 'confidential' }),
  Object.freeze({ application_code: 'project_management', application_name: '项目管理系统', environment: 'dev',
    upstream_url: 'http://project-api:8083', path_prefix: '/project-management', client_type: 'confidential' }),
  Object.freeze({ application_code: 'settlement', application_name: '结算系统', environment: 'dev',
    upstream_url: 'http://settlement-api:8084', path_prefix: '/settlement', client_type: 'confidential' }),
  Object.freeze({ application_code: 'data_analysis', application_name: '数据分析系统', environment: 'dev',
    upstream_url: 'http://data-analysis-api:8085', path_prefix: '/data-analysis', client_type: 'confidential' }),
])

test('server manifest drives presets for all six integrated subsystems', () => {
  const expected = {
    contract_management: ['合同管理系统', 'http://contract-api:8081', '/contract_management'],
    customer_and_opportunity: ['客户与商机管理系统', 'http://customer-api:8090', '/customer-opportunity'],
    customer_portal: ['客户自助门户', 'http://portal-api:8091', '/customer-portal'],
    project_management: ['项目管理系统', 'http://project-api:8083', '/project-management'],
    settlement: ['结算系统', 'http://settlement-api:8084', '/settlement'],
    data_analysis: ['数据分析系统', 'http://data-analysis-api:8085', '/data-analysis'],
  }
  for (const [code, [name, upstream, path]] of Object.entries(expected)) {
    const preset = subsystemOnboardingPreset(code, { targets: serverTargets, environment: 'dev' })
    assert.equal(preset.applicationName, name, code)
    assert.equal(preset.upstreamUrl, upstream, code)
    assert.equal(preset.pathPrefix, path, code)
  }
})

test('server manifest wins over the legacy built-in table', () => {
  const targets = [{ application_code: 'contract_management', application_name: '合同（新）', environment: 'prod',
    upstream_url: 'http://contract-api:18081', path_prefix: '/contracts' }]
  const preset = subsystemOnboardingPreset('contract_management', { targets, environment: 'prod' })
  assert.equal(preset.upstreamUrl, 'http://contract-api:18081')
  assert.equal(preset.pathPrefix, '/contracts')
  // 环境不匹配时退回内置兼容表，避免把其它环境的地址填进当前表单。
  const otherEnvironment = subsystemOnboardingPreset('contract_management', { targets, environment: 'dev' })
  assert.equal(otherEnvironment.upstreamUrl, 'http://contract-api:8081')
})

test('server-driven preset fills the previously missing three subsystems', () => {
  const form = { applicationCode: 'settlement', applicationName: '', upstreamUrl: '', pathPrefix: '' }
  applySubsystemOnboardingPreset(form, '', { targets: serverTargets, environment: 'dev' })
  assert.equal(form.applicationName, '结算系统')
  assert.equal(form.upstreamUrl, 'http://settlement-api:8084')
  assert.equal(form.pathPrefix, '/settlement')

  const analytics = { applicationCode: 'data_analysis', applicationName: '自定义分析', upstreamUrl: '', pathPrefix: '' }
  applySubsystemOnboardingPreset(analytics, '', { targets: serverTargets, environment: 'dev' })
  assert.equal(analytics.applicationName, '自定义分析')
  assert.equal(analytics.pathPrefix, '/data-analysis')
})

test('server-driven validation and normalization use manifest values', () => {
  assert.match(validateIntegratedSubsystemOnboarding({
    applicationCode: 'project_management', upstreamUrl: 'http://legacy-project:9999', pathPrefix: '/pm',
  }, { targets: serverTargets, environment: 'dev' }), /project-api:8083/)

  // 归一化只升级"已知历史别名"，不会把任意自定义地址改成清单值。
  const arbitrary = { applicationCode: 'settlement', upstreamUrl: 'http://legacy-settlement:9999', pathPrefix: '/settlement' }
  assert.equal(normalizeIntegratedSubsystemOnboarding(arbitrary, { targets: serverTargets, environment: 'dev' }), false)
  assert.equal(arbitrary.upstreamUrl, 'http://legacy-settlement:9999')
  // 历史别名在服务端清单存在时仍可被归一化（兼容旧失败表单）。
  const legacyAlias = { applicationCode: 'customer_and_opportunity', upstreamUrl: 'http://opportunity-api:8082', pathPrefix: '/customer_and_opportunity' }
  assert.equal(normalizeIntegratedSubsystemOnboarding(legacyAlias, { targets: serverTargets, environment: 'dev' }), true)
  assert.equal(legacyAlias.upstreamUrl, 'http://customer-api:8090')
  assert.equal(legacyAlias.pathPrefix, '/customer-opportunity')
  // 无服务端清单时退回旧内置表：未收录的系统不做强制校验（保持既有行为）。
  assert.equal(validateIntegratedSubsystemOnboarding({
    applicationCode: 'settlement', upstreamUrl: 'http://legacy-settlement:9999', pathPrefix: '/settlement',
  }), '')
})

