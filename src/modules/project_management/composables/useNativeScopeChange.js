import { computed, ref } from 'vue'
import { createIdempotencyKey } from '../../shared/utils/idempotencyKey.js'

// 用途：仅提取服务端允许变更的完整范围字段。
// 参数：item 为当前权威服务项。
// 返回值：不带执行、审批或合同身份的本地范围行。
function scopeLine(item) {
  return { source_id: item.source_service_id || '', batch: item.batch || '第一批',
    site: item.site || '', site_code: item.site_code || '', category: item.category || '',
    system: item.system || '', system_level: item.system_level || '',
    requirement: item.requirement || '', test_mode: item.test_mode || 'STANDARD' }
}

// 用途：识别持久业务回执，拒绝未知状态和坐标漂移。
// 参数：value 为真实响应，command 为已冻结操作，project 为项目坐标。
// 返回值：匹配当前操作的明确回执为真。
function exactReceipt(value, command, project) {
  if (!value || value.project_id !== project || !value.id || !Number.isSafeInteger(value.version)) return false
  if (command.kind === 'request') return value.operation_id === command.payload.operation_id &&
    value.requested_by === command.actor && ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(value.status) && value.version > 0
  const expected = { APPROVE: 'APPROVED', REJECT: 'REJECTED', WITHDRAW: 'WITHDRAWN' }[command.payload.decision]
  return value.id === command.changeID && value.status === expected && value.decided_by === command.actor &&
    value.decision_operation_id === command.payload.operation_id && value.version === command.payload.expected_version + 1 &&
    (expected !== 'APPROVED' || value.applied_scope_version === command.baseScopeVersion + 1)
}

// 用途：管理本地范围提案及异人审批，未知结果仅允许原操作精确重试。
// 参数：projectId 为固定项目，api 为既有真实transport，disabled 为当前禁写状态，uuid 生成操作号。
// 返回值：完整表单、状态、权限及读取和写入动作。
export function useNativeScopeChange({ projectId, api, disabled = () => false, uuid = createIdempotencyKey, onChanged = () => {}, initialState = null }) {
  const state = ref(initialState), lines = ref([]), reason = ref(''), confirmed = ref(false)
  const busy = ref(false), loading = ref(false), error = ref(''), notice = ref(''), pending = ref(null)
  const active = computed(() => state.value?.changes?.find((item) => item.status === 'PENDING'))
  const canRequest = computed(() => state.value?.can_request === true && !active.value && !pending.value && !busy.value && !loading.value && !disabled())

  // 用途：读取真实当前版本及有界提案，避免刷新丢失未知写入操作。
  // 参数：无。
  // 返回值：无；错误显式保留，不把空响应当成功。
  async function load() {
    if (loading.value) return
    loading.value = true; error.value = ''
    try {
      const value = await api.read(projectId)
      if (value?.project_id !== projectId || !Number.isSafeInteger(value.scope_version) || value.scope_version < 1 ||
          !Number.isSafeInteger(value.project_version) || !Array.isArray(value.service_items) || !Array.isArray(value.changes) || !value.actor_id) throw new Error('范围读取回执无效')
      state.value = value
      if (pending.value) {
        const receipt = value.changes.find((item) => exactReceipt(item, pending.value, projectId))
        if (receipt) { pending.value = null; notice.value = '已按原操作号核对持久结果'; onChanged(receipt) }
      }
      if (!pending.value) lines.value = value.service_items.map(scopeLine)
    } catch (cause) { state.value = null; error.value = cause?.message || '范围读取失败' }
    finally { loading.value = false }
  }

  // 用途：判断当前主体是否可对指定提案作异人决定。
  // 参数：change 为持久提案。
  // 返回值：服务端能力和不同身份全部满足时为真。
  function canDecide(change) {
    return state.value?.can_approve === true && change?.status === 'PENDING' &&
      change.requested_by !== state.value.actor_id && !pending.value && !busy.value && !loading.value && !disabled()
  }

  // 用途：执行冻结操作并严格确认真实回执。
  // 参数：command 为原操作号、载荷和发起身份。
  // 返回值：无；网络或未知结果保留同一操作，确定拒绝允许修正后重提。
  async function perform(command) {
    if (busy.value || disabled()) return
    busy.value = true; error.value = ''; pending.value = command
    try {
      const value = command.kind === 'request' ? await api.request(projectId, command.payload) :
        await api[command.payload.decision === 'WITHDRAW' ? 'withdraw' : 'decide'](projectId, command.changeID, command.payload)
      if (!exactReceipt(value, command, projectId)) throw new Error('尚未确认本次操作结果，请按原操作号刷新核对或精确重试')
      pending.value = null; reason.value = ''; confirmed.value = false
      notice.value = value.status === 'APPROVED' ? '范围已批准生效，请重新确认拆解并按原流程分配' : '操作已持久保存'
      onChanged(value); await load()
    } catch (cause) {
      const definite = cause?.status >= 400 && cause.status < 500 && cause.status !== 408 && !cause.outcomeUnknown
      if (definite) pending.value = null
      error.value = definite ? (cause.message || '操作被拒绝') : '尚未确认本次操作结果，请按原操作号刷新核对或精确重试'
    } finally { busy.value = false }
  }

  // 用途：冻结完整范围和版本后提交单级审批提案。
  // 参数：无。
  // 返回值：无；缺少真实版本、确认或原因时不发送。
  async function submit() {
    if (!canRequest.value || !confirmed.value || !reason.value.trim() || !lines.value.length ||
        lines.value.some((line) => !line.site.trim() || !line.category)) return
    await perform({ kind: 'request', actor: state.value.actor_id, payload: JSON.parse(JSON.stringify({
      operation_id: uuid(), expected_project_version: state.value.project_version,
      base_scope_version: state.value.scope_version, reason: reason.value.trim(), service_items: lines.value,
    })) })
  }

  // 用途：执行明确异人审批或申请人撤回，不允许自批。
  // 参数：change 为真实提案，decision 为决定，comment 为必填意见。
  // 返回值：无；角色或身份不符合时不发送。
  async function decide(change, decision, comment) {
    const withdrawal = decision === 'WITHDRAW' && change?.status === 'PENDING' &&
      state.value?.can_request === true && change.requested_by === state.value.actor_id && !pending.value && !busy.value && !disabled()
    if ((!withdrawal && !canDecide(change)) || !['APPROVE', 'REJECT', 'WITHDRAW'].includes(decision) || !comment?.trim()) return
    await perform({ kind: 'decision', actor: state.value.actor_id, changeID: change.id,
      baseScopeVersion: change.base_scope_version, payload: { operation_id: uuid(), expected_version: change.version, decision, comment: comment.trim() } })
  }

  // 用途：仅重放冻结载荷，防止未知结果被新草稿覆盖。
  // 参数：无。
  // 返回值：无；仍须当前禁写状态允许并由服务端重新授权。
  async function retry() { if (pending.value) await perform(pending.value) }
  return { state, lines, reason, confirmed, busy, loading, error, notice, pending, active, canRequest, canDecide, load, submit, decide, retry }
}
