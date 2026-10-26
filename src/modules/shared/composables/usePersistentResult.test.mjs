import assert from 'node:assert/strict'
import test from 'node:test'
import { computed } from 'vue'
import { usePersistentResult } from './usePersistentResult.js'
import { scopedStorageKey, sessionScopeOf } from '../utils/sessionScopedStorage.js'

test('persistent result is stored per session scope and dismissible', () => {
  const values = new Map()
  globalThis.window = { sessionStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) } }
  const key = 'uip:test-result'
  const principal = computed(() => ({ tenant_id: 'tenant-1', identity_id: 'user-1' }))
  const scopedKey = scopedStorageKey(key, sessionScopeOf(principal.value))
  const first = usePersistentResult(key, { principal })
  first.save({ title: '已完成', reference: 'HT-001' })
  assert.equal(first.result.value.reference, 'HT-001')
  assert.match(values.get(scopedKey), /HT-001/)
  const second = usePersistentResult(key, { principal })
  assert.equal(second.result.value.title, '已完成')
  second.clear()
  assert.equal(second.result.value, null)
  assert.equal(values.has(scopedKey), false)
  delete globalThis.window
})

test('records of user A are invisible to user B and absent principal stays in memory', () => {
  const values = new Map()
  globalThis.window = { sessionStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) } }
  const key = 'uip:test-result'
  const a = usePersistentResult(key, { principal: computed(() => ({ tenant_id: 't', identity_id: 'a' })) })
  a.save({ title: 'A 的结果', reference: 'HT-A' })
  const b = usePersistentResult(key, { principal: computed(() => ({ tenant_id: 't', identity_id: 'b' })) })
  assert.equal(b.result.value, null, 'B 不得读出 A 的操作结果')
  const anonymous = usePersistentResult(key)
  anonymous.save({ title: '未识别主体' })
  assert.equal(anonymous.result.value.title, '未识别主体', '内存态仍可用')
  assert.equal(values.size, 1, '未识别主体不得新增存储键')
  delete globalThis.window
})
