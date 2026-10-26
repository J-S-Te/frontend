import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref } from 'vue'
import { useOperationInbox } from './useOperationInbox.js'
import { scopedStorageKey, sessionScopeOf } from '../utils/sessionScopedStorage.js'

const USER_A = { tenant_id: 'tenant-1', identity_id: 'user-a' }
const USER_B = { tenant_id: 'tenant-1', identity_id: 'user-b' }
const KEY_A = scopedStorageKey('uip:operation-inbox', sessionScopeOf(USER_A))
const KEY_B = scopedStorageKey('uip:operation-inbox', sessionScopeOf(USER_B))

function fakeStorage() {
  const values = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      key: (index) => [...values.keys()][index] ?? null,
      get length() { return values.size },
    },
  }
  return values
}

test('operation inbox keeps newest records, deduplicates ids and persists per subject', () => {
  const values = fakeStorage()
  const principal = computed(() => USER_A)
  const inbox = useOperationInbox({ principal })
  inbox.clear()
  inbox.push({ id: 'a', title: '创建合同', reference: 'HT-1' })
  inbox.push({ id: 'b', title: '创建员工', reference: 'EMP-1' })
  inbox.push({ id: 'a', title: '创建合同（重试）' })
  assert.deepEqual(inbox.records.value.map((item) => item.id), ['a', 'b'])
  assert.equal(inbox.records.value[0].title, '创建合同（重试）')
  assert.equal(JSON.parse(values.get(KEY_A)).records[0].id, 'a', '必须写入主体 A 的作用域键')
  inbox.remove('b')
  assert.deepEqual(inbox.records.value.map((item) => item.id), ['a'])
  inbox.clear()
  assert.equal(inbox.records.value.length, 0)
  delete globalThis.window
})

test('records left by user A are invisible to user B in the same tab', () => {
  const values = fakeStorage()
  const principal = computed(() => USER_A)
  const inboxA = useOperationInbox({ principal })
  inboxA.push({ id: 'a', title: 'A 的合同', reference: 'HT-A' })
  assert.ok(values.has(KEY_A))

  // 同标签页切换主体：B 的实例读不到 A 的记录，写入落到 B 自己的键。
  const inboxB = useOperationInbox({ principal: computed(() => USER_B) })
  assert.equal(inboxB.records.value.length, 0, 'B 不得读出 A 的操作记录')
  inboxB.push({ id: 'b', title: 'B 的员工', reference: 'EMP-B' })
  assert.deepEqual([...values.keys()].sort(), [KEY_A, KEY_B])
  assert.deepEqual(JSON.parse(values.get(KEY_B)).records.map((item) => item.id), ['b'])
  // 主体回切后 A 仍能看到自己的记录（作用域缓存隔离，而非全局清空）。
  assert.deepEqual(inboxA.records.value.map((item) => item.id), ['a'])
  delete globalThis.window
})

test('principal switching on the same principal ref switches the active bucket', () => {
  const values = fakeStorage()
  // holder 必须响应式：真实调用方传入的 principal 均派生自 ref/computed。
  // 模块级桶跨测试共享：本用例使用独立主体避免读到其他用例的桶。
  const USER_C = { tenant_id: 'tenant-c', identity_id: 'user-c' }
  const USER_D = { tenant_id: 'tenant-c', identity_id: 'user-d' }
  const holder = ref(USER_C)
  const principal = computed(() => holder.value)
  const inbox = useOperationInbox({ principal })
  inbox.push({ id: 'a', title: 'A 记录' })
  holder.value = USER_D
  assert.equal(inbox.records.value.length, 0, '主体切换后旧记录不得可见')
  inbox.push({ id: 'b', title: 'B 记录' })
  holder.value = USER_C
  assert.deepEqual(inbox.records.value.map((item) => item.id), ['a'], '切回 A 后恢复 A 视图')
  delete globalThis.window
})

test('without an identified principal the inbox stays in-memory only', () => {
  const values = fakeStorage()
  const inbox = useOperationInbox({ principal: computed(() => ({ identity_id: 'user-a' })) })
  inbox.push({ id: 'x', title: '未识别主体操作' })
  assert.equal(inbox.records.value.length, 1, '内存态仍可用（当次会话功能不变）')
  assert.equal(values.size, 0, '不得写入任何存储键')
  const legacy = useOperationInbox()
  legacy.push({ id: 'y', title: '未接入主体的调用方' })
  assert.equal(values.size, 0, '无 principal 的调用方同样仅内存态')
  delete globalThis.window
})
