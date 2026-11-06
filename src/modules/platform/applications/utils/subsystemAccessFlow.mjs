// 统一接入向导的纯逻辑：步骤、阶段文案、状态判定与幂等键。
// 这里不依赖 Vue，便于用 node:test 直接验证；组件只负责渲染与调用接口。
import { isManualRecoveryCandidate } from './subsystemAccessRecovery.mjs'

export const SUBSYSTEM_ACCESS_STEPS = Object.freeze([
  Object.freeze({ key: 'select', label: '选择系统与环境' }),
  Object.freeze({ key: 'check', label: '检查条件' }),
  Object.freeze({ key: 'confirm', label: '确认操作' }),
  Object.freeze({ key: 'progress', label: '自动执行' }),
  Object.freeze({ key: 'result', label: '查看结果／继续恢复' }),
])

export const SUBSYSTEM_ACCESS_STAGE_LABELS = Object.freeze({
  CHECK: '条件检查',
  DIRECTORY: '目录登记',
  AUTH: '认证配置',
  DEPLOY: '运行部署',
  READINESS: '就绪核验',
  RESULT: '接入结果',
})

export const SUBSYSTEM_ACCESS_ACTION_LABELS = Object.freeze({
  ONBOARD: '首次接入',
  ADOPT: '接管运行时',
  UPDATE: '受控更新',
  RETRY: '重试失败部署',
  NONE: '无需操作',
})

export const SUBSYSTEM_ACCESS_STATUS_LABELS = Object.freeze({
  PENDING: '待执行',
  RUNNING: '执行中',
  WAITING: '等待处理',
  FAILED: '失败',
  SUCCEEDED: '已完成',
})

// 终态包含 WAITING：等待人工补齐条件，页面不应继续轮询。
export function isTerminalOperationStatus(status) {
  return ['SUCCEEDED', 'FAILED', 'WAITING'].includes(String(status || '').toUpperCase())
}

export function isResumableOperation(operation) {
  const status = String(operation?.status || '').toUpperCase()
  return status === 'WAITING' || status === 'FAILED'
}

// 可继续处理的判定：等待中的"部署结果未知"不能靠重排推进——同一持久代次不会从
// DISPATCHED 退回 PREPARED，重复提交只会再回到未知，服务端会直接返回 409 并要求
// 人工核验。这里把它排除掉，页面主按钮改为"前往人工核验"。
export function isAutoResumableOperation(operation) {
  if (!isResumableOperation(operation)) return false
  return !isManualRecoveryCandidate(operation)
}

export function stageLabel(stage) {
  const key = String(stage || '').toUpperCase()
  return SUBSYSTEM_ACCESS_STAGE_LABELS[key] || key || '—'
}

export function actionLabel(action) {
  const key = String(action || '').toUpperCase()
  return SUBSYSTEM_ACCESS_ACTION_LABELS[key] || key || '—'
}

export function operationStatusLabel(status) {
  const key = String(status || '').toUpperCase()
  return SUBSYSTEM_ACCESS_STATUS_LABELS[key] || key || '—'
}

export function formatMissingItem(item) {
  const source = item && typeof item === 'object' ? item : {}
  // 幂等：本函数会被父子组件各归一化一次，输出是 camelCase，因此二次转换必须也能读
  // `nextAction`，否则"下一步"指引会在第二次转换后被清空（页面丢失下一步提示）。
  return {
    code: String(source.Code || source.code || '').trim(),
    message: String(source.Message || source.message || '').trim(),
    nextAction: String(source.NextAction || source.next_action || source.nextAction || '').trim(),
  }
}

export function missingItems(list) {
  return Array.isArray(list) ? list.map(formatMissingItem).filter((item) => item.code || item.message) : []
}

// 阶段行：合并操作当前阶段与已落库的阶段结果，保证顺序稳定。
export function operationStageRows(stages) {
  const rows = Array.isArray(stages) ? stages : []
  return rows.map((stage) => ({
    stage: String(stage?.stage || '').toUpperCase(),
    label: stageLabel(stage?.stage),
    status: String(stage?.status || '').toUpperCase(),
    statusLabel: operationStatusLabel(stage?.status),
    attemptCount: Number(stage?.attempt_count || stage?.attemptCount || 0),
    errorCode: String(stage?.error_code || stage?.errorCode || ''),
    evidenceRef: String(stage?.evidence_ref || stage?.evidenceRef || ''),
  }))
}

// 幂等键：同一目标 + 同一预览版本重复提交时返回原操作。
export function subsystemAccessIdempotencyKey({ applicationCode = '', environment = '', previewVersion = '' } = {}) {
  const code = String(applicationCode || '').trim().toLowerCase()
  const target = String(environment || '').trim().toLowerCase()
  const version = String(previewVersion || '').trim()
  if (!code || !target || !version) return ''
  return `subsystem-access:${code}:${target}:${version}`
}

// 当前应高亮的步骤：有操作看操作状态，有预览看确认，否则看选择。
export function subsystemAccessStepIndex({ applicationCode = '', environment = '', preview = null, operation = null } = {}) {
  const status = String(operation?.status || '').toUpperCase()
  if (status) {
    return isTerminalOperationStatus(status) ? 4 : 3
  }
  if (preview) return 2
  if (String(applicationCode || '').trim() && String(environment || '').trim()) return 1
  return 0
}

// 提交会真实派发部署，因此预览里的阻塞类缺项必须拦住确认按钮；
// 认证观察期（AUTH_OBSERVATION_PENDING）不阻塞：服务端 worker 会如实返回 WAITING。
export const SUBSYSTEM_ACCESS_BLOCKING_MISSING_CODES = Object.freeze([
  'OUT_OF_SCOPE',
  'RUNTIME_APPROVAL_MISSING',
  'LICENSE_MISSING',
  'IMAGES_MISSING',
  'IMAGES_UNVERIFIED',
])

// 从预览缺项中筛出阻塞类缺项（归一化后按 code 比较，兼容服务端两种字段大小写）。
export function blockingMissingItems(list) {
  const blocking = new Set(SUBSYSTEM_ACCESS_BLOCKING_MISSING_CODES)
  return missingItems(list).filter((item) => blocking.has(String(item.code || '').toUpperCase()))
}

// confirmBlockedReason 返回"为什么不能确认"的可读原因；空串表示可以提交。
// 与 canConfirmPreview 共用同一判定顺序，避免按钮状态与提示文案不一致。
export function confirmBlockedReason(preview) {
  if (!preview || typeof preview !== 'object') return '请先完成条件检查'
  if (preview.display_only) return '目标已接入且配置一致，无需重复操作'
  const version = String(preview.preview_version || '').trim()
  if (!version) return '缺少预览版本，请重新检查条件后再确认'
  // 执行入口为"既有受控更新入口"时，统一入口不能提交（否则必然失败）：页面只展示提示。
  if (String(preview.execution_path || '').trim().toLowerCase() === 'legacy') {
    return '本次动作需由既有受控入口执行，统一入口不能提交'
  }
  const blocking = blockingMissingItems(preview.missing)
  if (blocking.length > 0) {
    const reasons = blocking.map((item) => item.message || item.code).filter(Boolean).join('、')
    const steps = [...new Set(blocking.map((item) => item.nextAction).filter(Boolean))]
    return `仍有阻塞缺项：${reasons}${steps.length ? `。下一步：${steps.join('；')}` : ''}`
  }
  const missingPermissions = Array.isArray(preview.missing_permissions) ? preview.missing_permissions : []
  if (missingPermissions.length > 0) return `当前账号缺少权限：${missingPermissions.join('、')}`
  return ''
}

// 提交前必须满足的条件（页面据此禁用确认按钮，最终仍由服务端校验）。
export function canConfirmPreview(preview) {
  return confirmBlockedReason(preview) === ''
}

// 候选系统按服务端清单标注范围：
// - 清单不可用（null/空）→ 全部标为「未知范围」，页面不过滤（服务端仍会拒绝范围外目标）；
// - 清单可用 → 逐个标注 inScope，页面据此禁用范围外选项并提示。
export function markApplicationScope(applications, capabilityCodes) {
  const list = Array.isArray(applications) ? applications : []
  const codes = Array.isArray(capabilityCodes)
    ? capabilityCodes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : []
  if (codes.length === 0) {
    return list.map((item) => ({ ...item, inScope: null }))
  }
  const known = new Set(list.map((item) => String(item?.code || '').trim().toLowerCase()))
  const candidates = [...list]
  for (const code of new Set(codes)) {
    if (!known.has(code)) candidates.push({ code, name: code })
  }
  return candidates.map((item) => ({
    ...item,
    inScope: codes.includes(String(item?.code || '').trim().toLowerCase()),
  }))
}
