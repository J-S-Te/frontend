import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, reactive, ref } from 'vue'
import { useFormDraft } from './useFormDraft.js'
import { clearSessionScopedStorage, scopedStorageKey, sessionScopeOf } from '../utils/sessionScopedStorage.js'

const PRINCIPAL = { tenant_id: 'tenant-1', identity_id: 'user-1' }
const SCOPED_KEY = scopedStorageKey('uip:test-draft', sessionScopeOf(PRINCIPAL))

function fakeStorage({ immediateTimers = true } = {}) {
  const values = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      key: (index) => [...values.keys()][index] ?? null,
      get length() { return values.size },
    },
    clearTimeout,
    setTimeout: immediateTimers
      ? (fn) => { fn(); return 1 }
      : () => 1,
  }
  return values
}

test('draft recovery persists non-sensitive fields and restores them under the session scope', async () => {
  const values = fakeStorage()
  const form = reactive({ name: '', password: 'secret' })
  const draft = useFormDraft({ key: 'uip:test-draft', form, exclude: ['password'], debounceMs: 0, principal: ref(PRINCIPAL) })
  form.name = '张三'
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(values.has(SCOPED_KEY), '必须写入作用域键而不是裸键')
  const stored = JSON.parse(values.get(SCOPED_KEY))
  assert.equal(stored.values.name, '张三')
  assert.equal('password' in stored.values, false)
  assert.equal(draft.hasDraft.value, false)
  form.name = ''
  await draft.restore()
  assert.equal(form.name, '张三')
  assert.equal(form.password, 'secret')
  draft.clear()
  assert.equal(values.has(SCOPED_KEY), false)
  delete globalThis.window
})

test('unmount within the debounce window still persists the latest input', async () => {
  // immediateTimers=false：防抖定时器永不触发，模拟「400ms 内直接卸载」。
  const values = fakeStorage({ immediateTimers: false })
  const form = reactive({ name: '' })
  const cleanups = []
  useFormDraft({ key: 'uip:test-draft', form, debounceMs: 60000, principal: ref(PRINCIPAL), onCleanupHook: (fn) => cleanups.push(fn) })
  form.name = '最后输入'
  await nextTick()
  for (const fn of cleanups) fn()
  const stored = JSON.parse(values.get(SCOPED_KEY))
  assert.equal(stored.values.name, '最后输入', '卸载时必须同步落地防抖未完成的最后输入')
  delete globalThis.window
})

test('historical draft without restore is not overwritten by an untouched form on unmount', async () => {
  const values = fakeStorage({ immediateTimers: false })
  values.set(SCOPED_KEY, JSON.stringify({ values: { name: '历史草稿' }, savedAt: '2026-01-01T00:00:00Z' }))
  const form = reactive({ name: '' })
  const cleanups = []
  const draft = useFormDraft({ key: 'uip:test-draft', form, debounceMs: 0, principal: ref(PRINCIPAL), onCleanupHook: (fn) => cleanups.push(fn) })
  assert.equal(draft.hasDraft.value, true)
  assert.equal(form.name, '', '未恢复前不得灌入历史草稿')
  await nextTick()
  for (const fn of cleanups) fn()
  const stored = JSON.parse(values.get(SCOPED_KEY))
  assert.equal(stored.values.name, '历史草稿', '未修改就卸载不得用空表单覆盖旧草稿')
  delete globalThis.window
})

test('discard is an explicit abandonment and suppresses the unmount write', async () => {
  const values = fakeStorage({ immediateTimers: false })
  const form = reactive({ name: '' })
  const cleanups = []
  const draft = useFormDraft({ key: 'uip:test-draft', form, debounceMs: 0, principal: ref(PRINCIPAL), onCleanupHook: (fn) => cleanups.push(fn) })
  form.name = '输入后放弃'
  await nextTick()
  draft.discard()
  for (const fn of cleanups) fn()
  assert.equal(values.has(SCOPED_KEY), false, '明确放弃后卸载不得再写回')
  delete globalThis.window
})

test('without an identified principal nothing is read or written', async () => {
  const values = fakeStorage()
  values.set(SCOPED_KEY, JSON.stringify({ values: { name: '他人草稿' }, savedAt: '2026-01-01T00:00:00Z' }))
  const form = reactive({ name: '' })
  const draft = useFormDraft({ key: 'uip:test-draft', form, debounceMs: 0, principal: ref({ tenant_id: 'tenant-1' }) })
  form.name = '匿名输入'
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(draft.hasDraft.value, false, '主体字段不全不得恢复')
  assert.deepEqual([...values.keys()], [SCOPED_KEY], '不得新增键，也不得改动在场键')
  delete globalThis.window
})

test('clearSessionScopedStorage removes only scoped keys', () => {
  const values = fakeStorage()
  values.set(SCOPED_KEY, '{}')
  values.set('uip:unrelated', 'keep')
  clearSessionScopedStorage()
  assert.deepEqual([...values.keys()], ['uip:unrelated'])
  delete globalThis.window
})
