import { getCurrentInstance, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { readScopedJSON, removeScopedKey, sessionScopeOf, writeScopedJSON } from '../utils/sessionScopedStorage.js'

/**
 * Session-level draft recovery for long forms. Callers must list sensitive
 * fields in `exclude`; excluded fields are never written to storage.
 *
 * 主体隔离：传入 `principal`（tenant_id + identity_id 齐备）时草稿按会话作用域
 * 存取；未识别主体时不读不写，避免跨账号残留。
 *
 * 卸载保存语义（三条状态分开，不用单一 hasDraft 表达）：
 * - 历史草稿存在（hasDraft）：仅供 UI 提示「有可恢复草稿」。
 * - 当前已修改（dirty）：本会话内表单被写过（restore 灌入不算）。
 * - 待写入：防抖定时器未落地的内容。卸载时若 dirty 则同步落地最后状态；
 *   未修改过则完全不写——首次填写 400ms 内卸载不丢最后输入，仅有历史草稿
 *   但未恢复就卸载也不会用空表单覆盖旧草稿。discard 表示用户明确放弃。
 *
 * onCleanupHook 仅供无组件环境（单测）注入卸载时机；组件调用方不传。
 */
export function useFormDraft({ key, form, exclude = [], debounceMs = 400, principal, onCleanupHook }) {
  const scope = sessionScopeOf(principal?.value ?? null)
  const saved = readScopedJSON(key, scope)
  const hasDraft = ref(Boolean(saved?.values && Object.keys(saved.values).length))
  const savedAt = ref(saved?.savedAt || '')
  const restored = ref(false)
  let timer = 0
  let dirty = false
  let suppressWatch = false

  function persist() {
    if (!scope) return
    const values = JSON.parse(JSON.stringify(form))
    for (const field of exclude) delete values[field]
    if (!Object.keys(values).length) return
    const payload = { values, savedAt: new Date().toISOString() }
    writeScopedJSON(key, scope, payload)
    savedAt.value = payload.savedAt
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(persist, debounceMs)
  }

  watch(form, () => {
    if (suppressWatch) return
    dirty = true
    schedule()
  }, { deep: true })

  async function restore() {
    const current = readScopedJSON(key, scope)
    if (!current?.values) return false
    suppressWatch = true
    try {
      Object.assign(form, current.values)
      restored.value = true
      hasDraft.value = false
      savedAt.value = current.savedAt || ''
      await nextTick()
    } finally {
      suppressWatch = false
    }
    return true
  }

  function discard() {
    removeScopedKey(key, scope)
    hasDraft.value = false
    savedAt.value = ''
    dirty = false
    clearTimeout(timer)
  }

  function clear() {
    window.clearTimeout(timer)
    discard()
  }

  function cleanup() {
    clearTimeout(timer)
    if (dirty) persist()
  }

  if (onCleanupHook) onCleanupHook(cleanup)
  else if (getCurrentInstance()) onBeforeUnmount(cleanup)

  return { hasDraft, savedAt, restored, restore, discard, clear }
}
