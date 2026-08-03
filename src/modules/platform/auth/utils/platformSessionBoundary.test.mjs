import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createPlatformSessionSynchronizer } from './platformSessionSynchronizer.js'

const appSource = await readFile(new URL('../../app/App.vue', import.meta.url), 'utf8')
const routerSource = await readFile(new URL('../../../../router/index.js', import.meta.url), 'utf8')

test('root session lifecycle runs only on routes backed by the platform cookie', () => {
  assert.match(appSource, /route\.meta\.requiresPlatformSession === true/)
  assert.doesNotMatch(appSource, /watch\(\(\) => route\.meta\.requiresAuth === true/)

  for (const routeName of ['portal', 'settings', 'audit']) {
    assert.match(routerSource, new RegExp(`name: '${routeName}'[\\s\\S]*?requiresPlatformSession: true`))
  }
  for (const routeName of ['contract_management', 'customer_opportunity', 'customer_portal']) {
    const start = routerSource.indexOf(`name: '${routeName}'`)
    const end = routerSource.indexOf('\n    },', start)
    assert.ok(start >= 0 && end > start, `route ${routeName} must exist`)
    assert.doesNotMatch(routerSource.slice(start, end), /requiresPlatformSession: true/)
  }
})

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

test('late platform response cannot restart lifecycle after entering a subsystem', async () => {
  const pending = deferred()
  const events = []
  const sessions = createPlatformSessionSynchronizer({
    loadPrincipal: () => pending.promise,
    activate: () => events.push('activate'),
    deactivate: () => events.push('deactivate'),
  })

  const platformRequest = sessions.synchronize(true)
  await sessions.synchronize(false)
  pending.resolve({ user_id: 'platform-user' })
  await platformRequest

  assert.deepEqual(events, ['deactivate'])
})

test('platform to subsystem to platform starts only the newest lifecycle', async () => {
  const first = deferred()
  const second = deferred()
  const events = []
  let loads = 0
  const sessions = createPlatformSessionSynchronizer({
    loadPrincipal: () => (++loads === 1 ? first.promise : second.promise),
    activate: (principal) => events.push(`activate:${principal.user_id}`),
    deactivate: () => events.push('deactivate'),
  })

  const staleRequest = sessions.synchronize(true)
  await sessions.synchronize(false)
  const currentRequest = sessions.synchronize(true)
  first.resolve({ user_id: 'stale-user' })
  second.resolve({ user_id: 'current-user' })
  await Promise.all([staleRequest, currentRequest])

  assert.deepEqual(events, ['deactivate', 'activate:current-user'])
})

test('late authorization refresh cannot repopulate a subsystem snapshot', async () => {
  const refreshResponse = deferred()
  const events = []
  let loads = 0
  const sessions = createPlatformSessionSynchronizer({
    loadPrincipal: () => (++loads === 1 ? Promise.resolve({ user_id: 'initial-user' }) : refreshResponse.promise),
    activate: () => events.push('activate'),
    deactivate: () => events.push('deactivate'),
    onRefresh: () => events.push('refresh'),
  })

  await sessions.synchronize(true)
  const refreshRequest = sessions.refresh()
  await sessions.synchronize(false)
  refreshResponse.resolve({ user_id: 'late-user' })
  await refreshRequest

  assert.deepEqual(events, ['activate', 'deactivate'])
})
