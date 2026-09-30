import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { isHiddenFromSubsystemOnboarding, visibleSubsystemEnvironments } from './subsystemEnvironmentVisibility.js'

const onboardingModule = await readFile(new URL('../components/SubsystemOnboardingModule.vue', import.meta.url), 'utf8')

test('retired package-independent seed environments are absent from subsystem onboarding', () => {
  const historicalSeed = {
    environment: 'dev',
    status: 'DISABLED',
    metadata: { hidden_from_onboarding: true, retirement_reason: 'legacy_packaging_seed' },
  }
  const production = { environment: 'prod', status: 'ACTIVE', metadata: {} }

  assert.equal(isHiddenFromSubsystemOnboarding(historicalSeed), true)
  assert.equal(isHiddenFromSubsystemOnboarding({ metadata: { hidden_from_onboarding: 1 } }), true)
  assert.equal(isHiddenFromSubsystemOnboarding(production), false)
  assert.deepEqual(visibleSubsystemEnvironments([historicalSeed, production]), [production])
  assert.deepEqual(visibleSubsystemEnvironments(null), [])
  assert.match(onboardingModule, /visibleSubsystemEnvironments\(data\?\.items\)/)
})
