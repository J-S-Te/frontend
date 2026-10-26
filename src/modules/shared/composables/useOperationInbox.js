import { computed, ref } from 'vue'
import { readScopedJSON, sessionScopeOf, writeScopedJSON } from '../utils/sessionScopedStorage.js'

const BASE_KEY = 'uip:operation-inbox'
const MAX_RECORDS = 20

// 按会话作用域（租户+用户）分桶缓存：切换账号后各桶互不可见；scope 尚未识别时
// 只提供内存实例——不恢复历史记录，也不把新记录写入存储，避免跨主体残留。
const buckets = new Map()

function bucketOf(scope) {
  if (!buckets.has(scope)) {
    const stored = scope === null ? null : readScopedJSON(BASE_KEY, scope)
    const records = ref(scope === null ? [] : (Array.isArray(stored?.records) ? stored.records : []))
    buckets.set(scope, { records, scope })
  }
  return buckets.get(scope)
}

function persist(bucket) {
  if (bucket.scope === null) return
  writeScopedJSON(BASE_KEY, bucket.scope, { records: bucket.records.value })
}

/**
 * 跨模块操作记录收件箱。
 * @param {{ principal?: import('vue').Ref<object|null> }} [options] 当前会话主体
 * （须含 tenant_id 与 identity_id，二者齐备才启用持久化；缺失时仅内存态）。
 */
export function useOperationInbox({ principal } = {}) {
  const scope = computed(() => sessionScopeOf(principal?.value ?? null))
  const bucket = computed(() => bucketOf(scope.value ?? null))
  const records = computed(() => bucket.value.records.value)
  const count = computed(() => records.value.length)

  function push(record) {
    if (!record || typeof record !== 'object') return
    const item = {
      id: record.id || `op-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title: String(record.title || '操作完成'),
      message: String(record.message || ''),
      reference: String(record.reference || ''),
      nextAction: String(record.nextAction || ''),
      module: String(record.module || ''),
      savedAt: record.savedAt || new Date().toISOString(),
    }
    const current = bucket.value
    current.records.value = [item, ...current.records.value.filter((existing) => existing.id !== item.id)].slice(0, MAX_RECORDS)
    persist(current)
    return item
  }

  function remove(id) {
    const current = bucket.value
    current.records.value = current.records.value.filter((item) => item.id !== id)
    persist(current)
  }

  function clear() {
    const current = bucket.value
    current.records.value = []
    persist(current)
  }

  return { records, count, push, remove, clear }
}
