// statusLabels.js — 报销域状态文案的单一权威来源。
// 各对象的键是服务器状态编码；同键在不同业务对象上语义不同
// （如 PENDING 在通用单据是「待处理」、借阅申请是「待审核」、
// 归档包是「待生成」），因此按对象拆分为具名字典而不是合并一张表。
// 未知值一律保留原文以兼容后续枚举。

// 通用单据/发票/审批/政策状态（主视图 statusLabel 的字典）。
const claimStatusLabels = {
  ACTIVE: '有效政策', RETIRED: '已退休', DRAFT: '草稿', RETURNED: '已退回', WITHDRAWN: '已撤回', IN_APPROVAL: '审批中',
  APPROVED_PENDING_PAYMENT: '待付款', PAID: '已付款', VOIDED: '已作废', VOID: '已作废', VERIFIED_CONFLICT: '已核实存在冲突', DISMISSED: '已排除', RESOLVED: '已关联合法账本解除冲突',
  PENDING: '待处理', APPROVED: '已同意', CONFIRMED: '已人工复核', AVAILABLE: '可申报',
  RESERVED: '已占用', CONSUMED: '已消费', DONE: '处理完成', SEALED: '已封存', FAILED: '处理失败',
  NOT_CHECKED: '未查验', UNVERIFIED: '未查验', MANUAL_REVIEWED: '已人工核验', VERIFIED: '外部验真通过',
  MISMATCH: '内容不一致', UNAVAILABLE: '不可用', INVALID: '无效', DISPUTED: '票面有争议',
  // 异步任务、原件与审批任务的状态；缺少中文会让进度信息退化为机器码。
  RUNNING: '处理中', PROCESSING: '处理中', READY: '已就绪', PARSED: '已解析', PARTIAL: '部分解析',
  NEEDS_REVIEW: '有候选待人工复核', RECORDED: '已登记', WAITING: '等待前序节点',
  TRANSFERRED: '已转交', CANCELLED: '已取消', REJECTED: '已拒绝', EXPIRED: '已过期',
  ABANDONED: '已被后续尝试取代', NOT_REQUIRED: '无需同步', SYNCED: '已同步',
  AUTHORITATIVE_SNAPSHOT_MISSING: '同步快照待恢复',
}

// 状态胶囊 tone：只决定颜色语义，不参与任何业务判断。
// 同一编码在不同对象上的显示颜色保持稳定；未知码回落 gray，避免把新状态误标成成功。
const claimStatusTones = {
  PAID: 'success', CONFIRMED: 'success', VERIFIED: 'success', MANUAL_REVIEWED: 'success',
  ACTIVE: 'success', SEALED: 'success', DONE: 'success', READY: 'success', PARSED: 'success',
  SYNCED: 'success', RESOLVED: 'success',
  IN_APPROVAL: 'warning', APPROVED_PENDING_PAYMENT: 'warning', PENDING: 'warning',
  RUNNING: 'warning', PROCESSING: 'warning', WAITING: 'warning', PARTIAL: 'warning',
  NEEDS_REVIEW: 'warning', RESERVED: 'warning', TRANSFERRED: 'warning', WITHDRAWN: 'warning',
  RETURNED: 'danger', VOID: 'danger', VOIDED: 'danger', FAILED: 'danger', MISMATCH: 'danger',
  REJECTED: 'danger', EXPIRED: 'danger', INVALID: 'danger', DISPUTED: 'danger',
  VERIFIED_CONFLICT: 'danger', AUTHORITATIVE_SNAPSHOT_MISSING: 'danger',
  APPROVED: 'info', RECORDED: 'info', AVAILABLE: 'info',
  DRAFT: 'gray', NOT_CHECKED: 'gray', UNVERIFIED: 'gray', UNAVAILABLE: 'gray',
  CANCELLED: 'gray', ABANDONED: 'gray',
}

// 解析问题码与字段名只用于人工核对提示，不能把机器码直接交给用户。
// 字段坐标来自发票解析器：FIELD_MISSING / FIELD_CONFLICT / AMOUNT_PRECISION_OR_FORMAT_INVALID。
const parseFieldLabels = {
  invoice_type: '发票类型', invoice_number: '发票号码', invoice_code: '发票代码',
  invoice_date: '开票日期', buyer_name: '购买方名称', buyer_tax_id: '购买方税号',
  seller_name: '销售方名称', seller_tax_id: '销售方税号',
  amount_minor: '不含税金额', tax_minor: '税额', gross_minor: '价税合计（票面总额）',
}

const parseIssueLabels = {
  TEXT_EXTRACTION_IS_NOT_TAX_VERIFICATION: '仅提取票面文字，不代表税务验真',
  OFD_EXTRACTION_IS_NOT_SIGNATURE_OR_TAX_VERIFICATION: '仅提取 OFD 票面信息，不代表电子签章或税务验真',
  MANUAL_CONFIRMATION_REQUIRED: '需人工确认',
  DETAIL_AMOUNTS_INCOMPLETE: '明细金额不完整',
  DETAIL_LINES_REQUIRE_REVIEW: '明细行需人工核对',
  DETAIL_AMOUNTS_REQUIRE_REVIEW: '明细金额需人工核对',
  DETAIL_NET_TOTAL_CONFLICT: '明细不含税金额合计与票面不一致',
  DETAIL_TAX_TOTAL_CONFLICT: '明细税额合计与票面不一致',
  DETAIL_FIELD_CONFLICT: '明细字段存在冲突',
  AMOUNT_CONFLICT: '不含税金额与税额之和不等于价税合计',
  RED_OR_NEGATIVE_INVOICE_REQUIRES_FINANCE_REVIEW: '红字或负数发票需财务复核',
  INVOICE_NUMBER_FORMAT_REQUIRES_REVIEW: '发票号码格式需核对',
  INVOICE_CODE_FORMAT_REQUIRES_REVIEW: '发票代码格式需核对',
  INVOICE_DATE_INVALID: '开票日期无法识别',
  PARTY_REGION_UNKNOWN: '购销方地区未识别',
  PARTY_TAX_ID_FORMAT_REQUIRES_REVIEW: '购销方税号格式需核对',
  MULTIPAGE_DETAILS_REQUIRE_REVIEW: '多页明细需人工核对',
  AMBIGUOUS_OR_MERGED_INVOICES: '检测到多张或合并开票，需拆分核对',
  UNASSIGNED_DETAIL_ROW_REQUIRES_REVIEW: '存在未归属明细行，需人工核对',
  EVIDENCE_COMPACTED_REFER_TO_ORIGINAL: '证据已压缩，请对照原件核对',
}

const parseFieldLabel = (field) => parseFieldLabels[field] || '相关字段'

// 用途：把解析问题码翻译为中文人工核对提示。
// 参数：value 为解析器返回的问题码或历史中文说明。
// 返回值：中文提示；未知码给出通用核对提示，不回显机器码。
export function parseIssueLabel(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '解析提示：请核对原件与字段后人工确认。'
  if (/[\u3400-\u9fff]/u.test(raw)) return raw
  if (raw.startsWith('FIELD_MISSING:')) return `缺少字段：${parseFieldLabel(raw.slice('FIELD_MISSING:'.length))}`
  if (raw.startsWith('FIELD_CONFLICT:')) return `字段存在冲突：${parseFieldLabel(raw.slice('FIELD_CONFLICT:'.length))}`
  if (raw.startsWith('AMOUNT_PRECISION_OR_FORMAT_INVALID:')) return `金额格式或精度需核对：${parseFieldLabel(raw.slice('AMOUNT_PRECISION_OR_FORMAT_INVALID:'.length))}`
  return parseIssueLabels[raw] || '解析提示：请核对原件与字段后人工确认。'
}

// 用途：把服务器状态编码渲染为中文；未知/空值回退「待确认」。
// 参数：value 为服务器状态编码。
// 返回值：中文状态或原文。
export function claimStatusLabel(value) {
  return claimStatusLabels[value] || value || '待确认'
}

// 用途：给状态胶囊选择稳定 tone；未知状态不冒充成功/失败。
// 参数：value 为服务器状态编码。
// 返回值：success / info / warning / danger / gray。
export function claimStatusTone(value) {
  return claimStatusTones[value] || 'gray'
}

// 归档借阅申请状态。
export const borrowStatusLabels = { PENDING: '待审核', APPROVED: '已批准', REJECTED: '已拒绝', EXPIRED: '已过期' }

// 归档证据文件包生成状态。
export const packageStatusLabels = { PENDING: '待生成', RUNNING: '生成中', PROCESSING: '生成中', DONE: '已就绪', FAILED: '生成失败', EXPIRED: '已过期', NOT_REQUESTED: '未申请' }

// 异步任务与队列的稳定失败码；后台只落诊断码，前端负责补上业务原因和下一步。
// 结构：原因 + 下一步，避免把 PARSER_FAILED 之类的机器码直接交给用户。
const failureCodes = {
  PARSER_FAILED: ['未能从原件中提取票面字段。', '请核对文件是否完整清晰后重新发起解析，或对照原件人工录入。'],
  PARSE_FAILURE_PERSISTENCE_UNAVAILABLE: ['解析失败结果未能可靠保存。', '请刷新后重新查询任务；仍失败请联系管理员。'],
  PARSE_LEASE_LOST: ['解析任务已被其他处理进程接管。', '请刷新查询最新解析任务，不要重复发起。'],
  ATTEMPT_SUPERSEDED: ['本次解析尝试已被后续尝试取代。', '请查看最新的解析任务状态。'],
  DELIVERY_OR_PROCESSING_FAILED: ['任务没有处理成功。', '请重试该任务；连续失败请联系管理员并提供任务号。'],
  SUPERSEDED_BY_CONTROLLED_RETRY: ['旧任务已被受控重试取代。', '请查看新的任务结果，不要重复提交。'],
  FILE_GATEWAY_UNAVAILABLE: ['文件服务暂时不可用，原件没有读取成功。', '请稍后重试；仍失败请联系管理员。'],
  ARCHIVE_FILE_GATEWAY_UNAVAILABLE: ['文件服务暂时不可用，归档原件没有读取成功。', '请稍后重试归档；仍失败请联系档案管理员。'],
  ARCHIVE_AUTHORIZATION_UNAVAILABLE: ['归档时未能确认当前授权。', '请重新登录并重试；仍失败请联系档案管理员核对范围。'],
  ARCHIVE_NOT_SEALED: ['归档版本尚未封存，不能生成文件包。', '请先完成归档封存，再生成证据包。'],
  ARCHIVE_PACKAGE_SIZE_LIMIT: ['归档文件包超过单包大小上限。', '请联系档案管理员分批导出或核对保留政策。'],
  ARCHIVE_PACKAGE_EXPIRED: ['归档文件包已超过保留期。', '请重新生成文件包后再下载。'],
  ARCHIVE_PACKAGE_NOT_READY: ['归档文件包尚未生成完成。', '请稍后查询任务状态，完成后再下载。'],
  ARCHIVE_PACKAGE_HASH_MISMATCH: ['归档文件包摘要校验未通过，已停止下载。', '请重新生成文件包；仍失败请联系档案管理员。'],
  EXPORT_LIMIT_EXCEEDED: ['本次导出范围超过受控上限。', '请减少勾选单据或缩小日期范围后重试。'],
  EXPORT_SIZE_LIMIT: ['导出内容超过受控大小上限。', '请缩小导出范围后重试。'],
  EXPORT_AUTHORIZATION_INVALID: ['导出范围未通过当前授权校验。', '请刷新列表并重新勾选当前可见单据。'],
  EXPORT_AUTHORIZATION_UNAVAILABLE: ['暂时无法确认导出授权。', '请稍后重试；仍失败请联系管理员确认数据范围。'],
  APPROVAL_REMINDER_QUALIFICATION_STALE: ['审批提醒对象资格已变化。', '请刷新待办后重新查询提醒结果。'],
  APPROVAL_REMINDER_UNAVAILABLE: ['审批提醒暂时无法投递。', '请稍后重试；待办本身不受影响，可继续办理。'],
}

// 按前缀归类的失败码，覆盖后台同一类任务的稳定诊断码族。
const failureGroups = [
  [/^(?:PDF|OFD|MALFORMED|DOCUMENT)_/, '原件内容不完整或格式不受支持，解析没有完成。',
    '请确认文件可正常打开、未加密后重新发起解析，或对照原件人工录入。'],
  [/^OCR_/, '票面文字识别置信度不足，提取结果需要人工核对。',
    '请对照原件人工录入，或上传更清晰的电子票据后重新解析。'],
  [/^ARCHIVE_/, '归档或证据包任务没有完成。', '请核对归档版本后重试；仍失败请联系档案管理员。'],
  [/^EXPORT_/, '导出任务没有完成。', '请缩小导出范围后重试；仍失败请联系管理员。'],
  [/^PARSE_/, '解析任务没有完成。', '请重新查询解析任务；仍失败请重新发起解析或人工录入。'],
]

// 用途：把后台稳定失败码翻译成「原因 + 下一步」。
// 参数：code 为任务、队列或归档返回的稳定诊断码。
// 返回值：可展示的中文说明；非诊断码或未知码返回空串。
export function failureText(code) {
  const value = typeof code === 'string' ? code.trim() : ''
  if (!value) return ''
  const exact = failureCodes[value]
  if (exact) return `${exact[0]}${exact[1]}`
  for (const [pattern, reason, next] of failureGroups) {
    if (pattern.test(value)) return `${reason}${next}`
  }
  return ''
}

// 用途：展示失败现场；已知码给出原因和下一步，未知码也不回显机器码。
// 参数：value 为 last_error 或错误码，可能是历史中文原因。
// 返回值：可展示的中文说明，至少包含下一步。
export function failureMessage(value) {
  const known = failureText(value)
  if (known) return known
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw && raw.length <= 200 && /[\u3400-\u9fff]/u.test(raw)) {
    return /请|联系/.test(raw) ? raw : `${raw} 请重试；持续失败请联系管理员。`
  }
  return '任务没有完成。请重试；持续失败请联系管理员并提供任务号。'
}
