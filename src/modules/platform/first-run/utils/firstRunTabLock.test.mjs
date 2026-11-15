import assert from 'node:assert/strict'
import test from 'node:test'
import { FIRST_RUN_TAB_LOCK_TTL_MS, createFirstRunTabLock, firstRunTabLockKey } from './firstRunTabLock.js'

function fakeStorage() {
  const values = new Map()
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: (key) => { values.delete(key) },
  }
}

test('同一作用域只允许一个标签页持有导览锁，租约过期后可被接管', () => {
  let clock = 1000
  const storage = fakeStorage()
  const a = createFirstRunTabLock({ storage, now: () => clock, id: 'tab-a' })
  const b = createFirstRunTabLock({ storage, now: () => clock, id: 'tab-b' })
  const scope = 'v2|t:t|u:u'

  assert.equal(firstRunTabLockKey(scope), 'v2|t:t|u:u|tab-lock')
  assert.equal(a.acquire(scope, 'portal'), true)
  assert.equal(b.acquire(scope, 'portal'), false)
  assert.equal(a.heldByOther(scope), false)
  assert.equal(b.heldByOther(scope), true)

  clock += FIRST_RUN_TAB_LOCK_TTL_MS + 1
  assert.equal(b.acquire(scope, 'project'), true)
  assert.equal(a.renew(scope, 'portal'), false)
  assert.equal(b.renew(scope, 'project'), true)
  assert.equal(a.release(scope), false)
  assert.equal(b.release(scope), true)
  assert.equal(storage.values.size, 0)
})

test('存储不可用或损坏时不阻塞，返回 false 而不是抛错', () => {
  const broken = { getItem: () => '{bad', setItem: () => { throw new Error('quota') }, removeItem: () => {} }
  const lock = createFirstRunTabLock({ storage: broken, id: 'tab' })
  assert.equal(lock.acquire('scope'), false)
  assert.equal(lock.heldByOther('scope'), false)
  const nullLock = createFirstRunTabLock({ storage: null, id: 'tab' })
  assert.equal(nullLock.acquire('scope'), false)
  assert.equal(nullLock.release('scope'), false)
})
