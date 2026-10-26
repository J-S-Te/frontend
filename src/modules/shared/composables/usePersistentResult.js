import { computed, ref } from 'vue'
import { readScopedJSON, removeScopedKey, sessionScopeOf, writeScopedJSON } from '../utils/sessionScopedStorage.js'

/**
 * 会话级「最近一次操作结果」。与 useOperationInbox 相同的主体隔离：
 * 主体（tenant_id + identity_id）齐备才按作用域持久化；未识别主体时仅内存态，
 * 不恢复、不落盘，杜绝切换账号后读到上一账号的合同编号等残留。
 */
export function usePersistentResult(key, { principal } = {}) {
  const scope = computed(() => sessionScopeOf(principal?.value ?? null))
  const result = ref(readScopedJSON(key, scope.value ?? null))

  function save(value) {
    if (!value || typeof value !== 'object') return
    const next = { ...value, savedAt: value.savedAt || new Date().toISOString() }
    result.value = next
    writeScopedJSON(key, scope.value ?? null, next)
  }

  function clear() {
    result.value = null
    removeScopedKey(key, scope.value ?? null)
  }

  return { result, save, clear }
}
