import { reactive } from 'vue'

// 用途：创建页面共享的资源命令与回执，不因窗口关闭丢失。
// 参数：无。
// 返回值：仅驻留内存的状态，退出或整页重载后清除。
export function createResourceMetricCommands() {
  return reactive({ pending: null, busy: false, batch: null, batchBusy: false, revision: 0,
    outcome: null, history: [], unresolved: [] })
}

// 用途：保留独立命令副本，使界面切换不改变原操作内容。
// 参数：command 为可序列化的原命令。
// 返回值：带原操作号的副本。
export function copyResourceMetricCommand(command) {
  return JSON.parse(JSON.stringify(command))
}

// 用途：给出命令实际作用的服务项，不借用当前页面选择。
// 参数：command 为冻结的单笔或批次命令。
// 返回值：去重的父项编号，全局容量操作可以为空。
export function resourceMetricItemIDs(command) {
  return [...new Set(command.itemIDs || (command.context_item_id ? [command.context_item_id] : []))]
}

// 用途：在窗口外保留成功、明确拒绝或未知回执。
// 参数：state 为页面状态，command 为原命令，status/message 为真实结果。
// 返回值：无；历史保留50条，未解决原命令另存。
export function recordResourceMetricOutcome(state, command, status, message) {
  const outcome = { status, message, itemIDs: resourceMetricItemIDs(command), kind: command.kind,
    at: new Date().toISOString() }
  state.outcome = outcome
  state.history = [...(state.history || []).slice(-49), { ...outcome, command: copyResourceMetricCommand(command) }]
}

// 用途：确定未知命令影响的资源日或用量行，防止同目标换键重发。
// 参数：command 为普通、候选或批次命令。
// 返回值：页面内防重复的目标键集合。
export function resourceMetricCommandTargets(command) {
  if (command.kind === 'batch') {
    return command.items.flatMap(row => resourceMetricCommandTargets({ id: row.id, payload: row }))
  }
  if (command.id) return [`row:${command.id}`]
  const input = command.payload || {}
  const kind = command.kind === 'capacities' ? 'capacity' : 'usage'
  return [JSON.stringify([kind, kind === 'capacity' ? '' : input.service_item_id || command.itemID || command.context_item_id || '',
    input.resource_type || 'PERSON', input.resource_id, input.business_date])]
}

// 用途：识别新命令是否绕过同目标尚未解决的原操作号。
// 参数：state 为页面状态，command 为拟发出的新命令。
// 返回值：目标重叠时为真，其他服务项或资源仍可继续。
export function hasUnresolvedResourceMetricCommand(state, command) {
  const targets = new Set(resourceMetricCommandTargets(command))
  return (state.unresolved || []).some(entry => resourceMetricCommandTargets(entry.command)
    .some(target => targets.has(target)))
}

// 用途：暂存未知命令以处理其他目标，保留原键和完整作用范围。
// 参数：state 为页面状态，type 为single或batch。
// 返回值：暂存成功为真；在途或结果已确定时不移动。
export function parkResourceMetricCommand(state, type) {
  const command = type === 'batch' ? state.batch : state.pending
  if (!command || state.busy || state.batchBusy || command.state !== 'UNKNOWN') return false
  const original = copyResourceMetricCommand(command)
  const id = original.key || original.payload?.idempotency_key
  state.unresolved ||= []
  if (!state.unresolved.some(entry => entry.id === id)) state.unresolved.push({ id, type, command: original })
  if (type === 'batch') state.batch = null
  else state.pending = null
  return true
}

// 用途：恢复页面内保存的未知命令，按原操作号继续核对。
// 参数：state 为页面状态，entry 为未解决列表内的命令。
// 返回值：恢复成功为真；不覆盖其他活动命令。
export function restoreResourceMetricCommand(state, entry) {
  if (state.pending || state.batch || state.busy || state.batchBusy) return false
  const index = (state.unresolved || []).findIndex(value => value.id === entry.id && value.type === entry.type)
  if (index < 0) return false
  const original = copyResourceMetricCommand(state.unresolved[index].command)
  state.unresolved.splice(index, 1)
  if (entry.type === 'batch') state.batch = original
  else state.pending = original
  return true
}
