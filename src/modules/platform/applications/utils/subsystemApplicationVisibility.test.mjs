import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleSubsystemApplications } from './subsystemApplicationVisibility.js'

const applications = [
  { code: 'platform', name: '基础能力平台' },
  { code: 'customer_and_opportunity', name: '客户与商机管理系统' },
  { code: 'contract_management', name: '合同管理系统' },
]

test('production catalog hides an unshipped seeded subsystem application', () => {
  const visible = visibleSubsystemApplications(applications, {
    capabilitiesResolved: true,
    production: true,
    supportedApplicationCodes: ['customer_and_opportunity'],
    registeredApplicationCodes: [],
  })
  assert.deepEqual(visible.map((item) => item.code), ['platform', 'customer_and_opportunity'])
})

test('production catalog preserves an already registered subsystem for lifecycle operations', () => {
  const visible = visibleSubsystemApplications(applications, {
    capabilitiesResolved: true,
    production: true,
    supportedApplicationCodes: ['customer_and_opportunity'],
    registeredApplicationCodes: ['contract_management'],
  })
  assert.deepEqual(visible.map((item) => item.code), [
    'platform',
    'customer_and_opportunity',
    'contract_management',
  ])
})

test('catalog remains unrestricted outside production mode', () => {
  const visible = visibleSubsystemApplications(applications, {
    capabilitiesResolved: true,
    production: false,
  })
  assert.equal(visible.length, applications.length)
})

test('catalog shows only the platform while capabilities are unresolved', () => {
  const visible = visibleSubsystemApplications(applications, {
    capabilitiesResolved: false,
    production: true,
  })
  assert.deepEqual(visible.map((item) => item.code), ['platform'])
})

test('catalog fails closed when production capabilities cannot be read', () => {
  const visible = visibleSubsystemApplications(applications, {
    capabilitiesResolved: true,
    capabilitiesAvailable: false,
  })
  assert.deepEqual(visible.map((item) => item.code), ['platform'])
})
