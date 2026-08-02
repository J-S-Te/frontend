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
