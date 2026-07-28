import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  createApplication,
  createEnvironment,
  deleteApplicationRegistration,
  listPortalApplications,
  onboardSubsystem,
  updateEnvironment,
} from './applications.js'

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

test('deleteApplicationRegistration sends the stable code confirmation and optimistic-lock version', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: { application_id: 'app/duplicate', status: 'RETIRED', version: 4 } })
  }

  const result = await deleteApplicationRegistration({
    applicationId: 'app/duplicate',
    confirmationCode: 'contract-management',
    version: 3,
  })

  assert.equal(result.status, 'RETIRED')
  assert.equal(requested.url, '/api/v1/applications/app%2Fduplicate')
  assert.equal(requested.options.method, 'DELETE')
  assert.equal(requested.options.credentials, 'include')
  assert.deepEqual(JSON.parse(requested.options.body), {
    confirmation_code: 'contract-management',
    version: 3,
  })
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

test('listPortalApplications uses the authenticated tenant catalog endpoint', async () => {
  let requested
  globalThis.fetch = async (url, options) => {
    requested = { url, options }
    return jsonResponse({ data: [{ code: 'business-app', public_url: 'https://portal.example.com/business-app/' }] })
  }

  const result = await listPortalApplications({ environment: 'prod' })

  assert.equal(requested.url, '/api/v1/portal/applications?environment=prod')
  assert.equal(requested.options.credentials, 'include')
  assert.equal(result[0].code, 'business-app')
})
