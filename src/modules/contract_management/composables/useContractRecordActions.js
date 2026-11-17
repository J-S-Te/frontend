import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'

// useContractRecordActions 用途：管理异步预检与单次提交，保留冲突原因并只读核对未知结果。
// 参数：api 为真实接口客户端，onChanged 在结果明确后刷新页面并通知用户。
// 返回值：弹窗状态、明确资格与有限的打开、刷新、提交、关闭操作。
export function useContractRecordActions({ api, onChanged = () => {} }) {
  const opened = ref(false), busy = ref(false), loading = ref(false), unknown = ref(false)
  const preview = ref(null), reason = ref(''), error = ref(''), target = ref('deleted')
  let generation = 0, contractID = ''
  const allowed = computed(() => target.value === 'deleted' ? preview.value?.can_delete : preview.value?.can_restore)
  const canSubmit = computed(() => !busy.value && !loading.value && !unknown.value && allowed.value
    && (target.value === 'active' || reason.value.trim().length > 0)
    && Array.from(reason.value.trim()).length <= 1000)

  // refresh 用途：只读重新获取当前资格，保留用户已输入的操作原因。
  // 参数：无；使用当前合同身份与请求代次。
  // 返回值：异步完成；过期读取不覆盖新弹窗或新请求。
  async function refresh() {
    if (!opened.value || busy.value) return
    const ticket = ++generation
    loading.value = true
    try {
      const current = await api.previewContractDeletion(contractID)
      if (ticket !== generation || !opened.value) return
      preview.value = current
      if (unknown.value && current.record_state === target.value) {
        unknown.value = false
        opened.value = false
        await onChanged({ id: contractID, record_state: current.record_state, verified: true })
      } else if (unknown.value) {
        error.value = '当前记录尚未处于目标状态，本次结果仍未确认；请稍后手动核对，不要重复提交。'
      }
    } catch (cause) {
      if (ticket === generation) {
        preview.value = null
        error.value = formatUserError(cause, { fallback: '读取合同操作资格失败，请稍后重新核对。' })
      }
    } finally { if (ticket === generation) loading.value = false }
  }

  // openRecord 用途：打开指定合同的删除或恢复预检，不复用旧列表版本。
  // 参数：id 为稳定合同身份，state 为目标记录状态。
  // 返回值：异步完成；新弹窗只消费自身代次的结果。
  async function openRecord(id, state = 'deleted') {
    if (busy.value) return
    contractID = String(id)
    target.value = state
    reason.value = ''; error.value = ''; preview.value = null; unknown.value = false
    opened.value = true
    await refresh()
  }

  // close 用途：关闭当前交互并使迟到预检失效，提交期间保持锁定。
  // 参数：无。
  // 返回值：无；原有业务记录不因关闭被改变。
  function close() {
    if (busy.value) return
    opened.value = false; loading.value = false; generation++
  }

  // submit 用途：按最新预检版本提交一次，冲突保持输入，未知结果只允许查询。
  // 参数：无；使用当前目标、版本与原因。
  // 返回值：异步完成，成功与列表刷新失败分别呈现，不自动重发写请求。
  async function submit() {
    if (!canSubmit.value) return
    busy.value = true; error.value = ''
    let changed
    try {
      const mutate = target.value === 'deleted' ? api.deleteContractRecord : api.restoreContractRecord
      changed = await mutate(contractID, preview.value.version, reason.value.trim())
      opened.value = false; generation++
    } catch (cause) {
      error.value = formatUserError(cause, { fallback: '操作未完成，请核对原因后重试。' })
      unknown.value = Boolean(cause?.outcomeUnknown || Number(cause?.status) >= 500)
      if (!unknown.value && cause?.status === 409) {
        busy.value = false
        await refresh()
      } else if (!unknown.value && [403, 404].includes(cause?.status)) preview.value = null
    } finally { busy.value = false }
    if (changed) await onChanged(changed)
  }

  if (getCurrentScope()) onScopeDispose(() => { generation++; opened.value = false })
  return { opened, busy, loading, unknown, preview, reason, error, target, canSubmit,
    openRecord, refresh, close, submit }
}
