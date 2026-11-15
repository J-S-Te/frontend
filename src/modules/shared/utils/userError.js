// 仅处理展示：调用方保留状态、错误码、详情和请求标识。
// 此处不负责传输、会话处理、重试或业务状态决策。
const GENERIC_MESSAGES = /^(?:请求参数不合法|请求内容不合法|参数错误|参数无效|请求失败|操作失败|服务处理失败|服务暂不可用|服务暂时不可用|依赖服务暂时不可用|请求的资源不存在|没有执行此操作的权限|登录状态无效或已过期|资源状态冲突)[。！!\s]*$/
const INTERNAL_DETAILS = /(?:https?:\/\/|\/api\/|\/(?:Users|root|etc|var|opt|home)\/|[A-Z]:\\|<\/?[a-z!][^>]*>|SQLSTATE|\b(?:mysql|postgres|gorm|panic|stack|stacktrace|goroutine|TypeError|SyntaxError|ReferenceError|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b|dial tcp|connection refused|connection reset|\bError\s+\d{3,}\b|\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b|\b(?:SELECT\s+.+?\s+FROM|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\S+\s+SET)\b|\b(?:Table\s+[^\r\n]+?\s+(?:does\s+not\s+exist|doesn't\s+exist)|Duplicate\s+entry|Unknown\s+column|column\s+[^\r\n]+?\s+does\s+not\s+exist|duplicate\s+key\s+value|syntax\s+error\s+at\s+or\s+near|foreign\s+key\s+constraint\s+fails)\b|\b(?:json|uuid|http|trace[_ -]?id|request[_ -]?id|next[_ -]?action)\b|cannot unmarshal|validation for|failed on the|-----BEGIN|\bBearer\s+|(?:access_token|refresh_token|client_secret|password|api_key)\s*[:=]|[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]+|[\u0000-\u0008\u000b\u000c\u000e-\u001f])/i
const TECHNICAL_GUIDANCE = /\b(?:docker(?:-compose)?|kubectl|systemctl|journalctl|sudo|chmod|chown|curl|wget|bash|powershell)\s+\S|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/

/** 仅使用已本地化、长度受限且不含实现或凭据信息的消息。 */
export function safeUserMessage(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || text.length > 400 || !/[\u3400-\u9fff]/u.test(text) || INTERNAL_DETAILS.test(text) || TECHNICAL_GUIDANCE.test(text)) return ''
  return text
}

const FIELDS = {
  name: ['名称', '填写'], title: ['名称', '填写'], display_name: ['姓名', '填写'], account: ['账号', '填写'], account_name: ['账号', '填写'], email: ['邮箱', '填写'], mobile: ['手机号', '填写'], phone: ['联系电话', '填写'],
  password: ['密码', '填写'], current_password: ['当前密码', '填写'], new_password: ['新密码', '填写'],
  customer_id: ['客户', '选择'], crm_customer_id: ['客户', '选择'], customer_name: ['客户名称', '填写'], opportunity_id: ['关联商机', '选择'],
  owner_user_id: ['负责人', '选择'], owner_org_id: ['负责人所属组织', '选择'], user_id: ['用户', '选择'], org_unit_id: ['组织', '选择'], position_id: ['岗位', '选择'], role_id: ['角色', '选择'],
  application_id: ['应用系统', '选择'], environment_id: ['应用环境', '选择'], application_code: ['应用系统', '选择'], environment_code: ['应用环境', '选择'],
  contract_id: ['合同', '选择'], contract_type: ['合同类型', '选择'], contract_name: ['合同名称', '填写'], template_id: ['合同模板', '选择'],
  service_type: ['服务类型', '选择'], service_items: ['服务项', '添加'], services: ['服务项', '添加'], category: ['检测类别', '选择'], detection_category: ['检测类别', '选择'],
  batch: ['实施批次', '填写'], site: ['实施场所', '填写'], system: ['系统名称', '填写'], system_level: ['系统等级', '选择'], test_mode: ['检测方式', '选择'],
  amount: ['金额', '填写'], amount_minor: ['金额', '填写'], amount_incl_tax: ['含税金额', '填写'], currency: ['币种', '选择'],
  planned_start: ['计划开始时间', '填写'], planned_end: ['计划结束时间', '填写'], start_date: ['开始日期', '填写'], end_date: ['结束日期', '填写'], due_date: ['到期日期', '填写'],
  valid_from: ['有效期开始时间', '填写'], valid_until: ['有效期结束时间', '填写'], effective_from: ['生效日期', '填写'], effective_to: ['失效日期', '填写'],
  reason: ['操作原因', '填写'], comment: ['说明', '填写'], content: ['内容', '填写'], file: ['文件', '选择'], file_id: ['文件', '选择'],
  code: ['编码', '填写'], type: ['类型', '选择'], status: ['状态', '选择'], type_ids: ['商机类型', '选择'], source_ids: ['商机来源', '选择'],
  registration_contact_name: ['登记联系人姓名', '填写'], registration_contact_phone: ['登记联系人电话', '填写'],
  receipt_date: ['回款日期', '填写'], payment_method: ['回款方式', '选择'], bank_transaction_reference: ['银行流水号', '填写'],
  employee_no: ['工号', '填写'], pms_person_id: ['项目人员', '选择'],
  membership_type: ['任职类型', '选择'], initial_password: ['初始密码', '填写'],
  paid_date: ['付款日期', '填写'], transaction_no: ['流水或现金凭证号', '填写'],
  source_account_ref: ['付款来源账户', '选择'], voucher_file_ids: ['付款附件', '添加'],
  invoice_usages: ['发票使用明细', '添加'], invoice_id: ['发票', '选择'],
  invoice_date: ['开票日期', '填写'], quantity: ['数量', '填写'], unit_price: ['单价', '填写'],
  tax_rate: ['税率', '填写'], tax_amount: ['税额', '填写'],
}
const AUTO_FIELDS = new Set(['version', 'expected_version', 'expected_revision', 'idempotency_key', 'client_operation_id', 'tenant_id', 'source_id'])

// 用途：把结构体字段或请求路径转换为已有中文字段标签的查询键。
// 参数：value 为字段名或数组中的真实字段路径。
// 返回值：去除数组下标并标准化的末级字段，不包含用户填写值。
function fieldKey(value) {
  if (typeof value !== 'string' || value.length > 180) return ''
  // 现有后端同时使用 Gin 结构体字段名和 JSON 路径。
  return value.replace(/\[\d+\]/g, '').split('.').pop()
    ?.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() || ''
}

// 用途：从现有字段规则或安全业务说明生成可执行的中文提示。
// 参数：issue 为不包含待回显值的字段问题元数据。
// 返回值：已知字段的中文说明，无法安全解释时返回空串。
function issueMessage(issue) {
  if (!issue || typeof issue !== 'object') return ''
  const field = fieldKey(issue.field || issue.path || issue.name)
  if (AUTO_FIELDS.has(field)) return '页面数据已过期或不完整，请刷新后重新操作；仍失败时请联系管理员。'
  const definition = Object.hasOwn(FIELDS, field) ? FIELDS[field] : null
  const message = safeUserMessage(issue.message)
  if (message && !GENERIC_MESSAGES.test(message)) return message
  if (!definition) return ''
  const [label, action] = definition
  const rule = String(issue.rule || issue.tag || issue.reason || issue.code || '').toLowerCase()
  if (/required|missing|empty/.test(rule)) return `请${action}${label}。`
  if (/email/.test(rule)) return '邮箱格式不正确，请检查后重新填写。'
  if (/date|time/.test(rule)) return `${label}格式不正确，请重新选择日期或时间。`
  if (/min|max|range|length/.test(rule)) return `${label}超出允许范围，请检查后重新填写。`
  return `${label}未通过校验，请检查后重新${action}。`
}

// 用途：解释有界字段问题，保留费用行坐标且不回显拒绝值或原始诊断。
// 参数：details 为后端已有的 issues、field_errors 或字段映射。
// 返回值：最多三项中文字段问题，同一错误发生在不同行时分别保留。
export function userFieldErrors(details) {
  if (!details || typeof details !== 'object') return []
  const candidates = Array.isArray(details) ? details : details.issues || details.field_errors || details.errors || details.fields || (details.field ? [details] : [])
  const issues = Array.isArray(candidates) ? candidates : Object.entries(candidates || {}).slice(0, 20)
    .map(([field, value]) => ({ field, ...(typeof value === 'object' && value !== null
      ? value : safeUserMessage(value) ? { message: value } : { rule: value }) }))
  const found = []
  for (const issue of issues.slice(0, 20)) {
    let message = issueMessage(issue)
    if (!message) continue
    const raw = issue.field || issue.path || issue.name || ''
    const path = typeof raw === 'string' && raw.length <= 180 &&
      /^[A-Za-z_][A-Za-z0-9_]*(?:\[\d{1,6}\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(raw)
      ? raw : ''
    const index = path.match(/\[(\d+)\]/)?.[1]
    const row = Number(issue.row || issue.line || (index === undefined ? 0 : Number(index) + 1))
    if (row > 0 && Number.isSafeInteger(row)) message = `第 ${row} 行：${message}`
    const field = path.includes('[') ? path : fieldKey(raw)
    if (found.some(item => item.field === field && item.message === message)) continue
    found.push({ field, message })
    if (found.length >= 3) break
  }
  return found
}

const CODE_MESSAGES = {
  INVALID_CREDENTIALS: '账号或密码错误，请重新输入。', AUTH_INVALID_CREDENTIALS: '账号或密码错误，请重新输入。',
  AUTH_CONCURRENT_SESSION: '该账号已在其他页面登录。请确认原会话后，再选择退出原会话并登录。',
  AUTH_TOKEN_EXCHANGE_FAILED: '进入系统时未能完成身份确认，请返回门户重新进入；仍失败时请联系管理员检查应用接入配置。',
  OIDC_CLAIMS_INVALID: '当前登录信息与应用配置不一致，请重新登录；仍失败时请联系管理员。',
  AUTHORIZATION_CONTEXT_UNAVAILABLE: '暂时无法确认当前账号的访问权限，请稍后重新进入；仍失败时请联系管理员。',
  CONTRACT_SIGNED_READ_ONLY: '合同已签署，不能直接修改正文；请使用正式变更流程。',
  CON_APPROVAL_ASSIGNEE_UNAVAILABLE: '审批流程缺少可用审批人，本次未提交。请先在基础平台为合同应用分配相应角色的人员，或调整审批规则后重试。',
  METRIC_NOT_BOUND: '该指标尚未绑定统计计算，不能启用。请先完成计算配置。',
  METRIC_IN_USE: '该指标已被看板或报表引用，不能直接删除；请先解除引用或停用。',
  METRIC_VERSION_CONFLICT: '指标已被其他人修改，请刷新后重新编辑。', RULE_VERSION_CONFLICT: '规则已被其他人修改，请刷新后重新编辑。',
  LICENSE_INVALID: '许可证未通过校验，请核对许可证文件、部署实例和有效期；仍失败时请联系授权管理员。',
  LICENSE_VERSION_CONFLICT: '授权状态已经变化，请刷新页面后重新验证许可证。',
  LICENSE_EXPIRED: '商业授权已到期，当前操作不可用；请联系管理员续期。',
  LICENSE_NOT_EFFECTIVE: '商业授权尚未生效，请核对授权开始时间或联系管理员。',
  LICENSE_NOT_PURCHASED: '当前系统未获得商业授权，请联系管理员确认购买范围。',
}
const CONTRACT_MISMATCH = '当前页面的数据格式与服务要求不一致，请刷新页面后重新操作；仍失败时请联系管理员检查系统版本。'
const REFRESH = '数据已被修改或当前状态不允许此操作，请刷新列表后检查记录，再重新操作。'
const WRITE_UNKNOWN = '暂时无法确认操作结果，请先刷新列表或查看记录核对，避免重复提交；仍有问题请联系管理员。'

// 用途：兼容各客户端的错误元数据，统一方法、字段问题与结果未知标记。
// 参数：input 为接口错误或文案，options 为调用方已知的请求信息。
// 返回值：仅供展示判定的标准化元数据，不改变请求和业务状态。
function normalize(input, options) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    status: Number(options.status ?? source.status ?? 0),
    code: String(options.code ?? source.code ?? ''),
    message: options.message ?? (typeof input === 'string' ? input : source.message ?? source.msg ?? ''),
    details: options.details ?? source.details ?? source.field_errors ?? source.fieldErrors,
    method: String(options.method || source.method || source.request_method ||
      source.context?.method || options.operation || source.operation || 'GET').toUpperCase(),
    outcomeUnknown: options.outcomeUnknown === true || source.outcomeUnknown === true,
    name: source.name || '',
  }
}

// 用途：为客户端保留写入结果未知标记，与展示提示使用相同的错误元数据。
// 参数：input 为服务回执或异常，options 为已知请求方法和状态。
// 返回值：明确无法确认的写请求返回 true；具体业务拒绝和普通读取返回 false。
export function isWriteOutcomeUnknown(input, options = {}) {
  const error = normalize(input, options)
  if (error.outcomeUnknown) return true
  if (['GET', 'HEAD', 'OPTIONS'].includes(error.method)) return false
  const text = typeof error.message === 'string' ? error.message : ''
  const safe = safeUserMessage(text)
  return [408, 502, 504].includes(error.status) || error.name === 'AbortError' ||
    /(?:^|_)(?:NETWORK_ERROR|REQUEST_ABORTED)$|(?:TIMEOUT|TIMED_OUT)$/.test(error.code) ||
    /(?:^|_)(?:(?:INVALID|UNEXPECTED|MALFORMED)_(?:[A-Z]+_)?RESPONSE|RESPONSE_(?:INVALID|UNEXPECTED)|INVALID_ENVELOPE)$/.test(error.code) ||
    /^(?:Failed to fetch|NetworkError|Load failed|fetch failed)$/i.test(text) ||
    (error.status >= 500 && (!safe || GENERIC_MESSAGES.test(safe)))
}

// 用途：把当前错误转换为准确中文，保留业务拒绝并优先保护未知写入结果。
// 参数：input 为错误或文案，options 为可信请求方法、元数据和兜底提示。
// 返回值：可展示文本，不暴露原始异常，不推断操作已经成功或自动重发。
export function formatUserError(input, options = {}) {
  const error = normalize(input, options)
  const { status, code, details, method } = error
  const writing = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const text = typeof error.message === 'string' ? error.message : ''
  const safe = safeUserMessage(text)
  const fallback = safeUserMessage(options.fallback)
  if (error.outcomeUnknown) return WRITE_UNKNOWN
  if (code === 'REQUEST_ABORTED' || error.name === 'AbortError') return writing ? WRITE_UNKNOWN : '读取已取消，请重新加载。'
  if (/(?:^|_)NETWORK_ERROR$/.test(code) || /^(?:Failed to fetch|NetworkError|Load failed|fetch failed)$/i.test(text)) return writing ? `网络连接中断，${WRITE_UNKNOWN}` : (safe || fallback || '无法连接服务，请检查网络连接后重试。')
  if (status === 408 || status === 504 || /(?:TIMEOUT|TIMED_OUT)$/.test(code)) return writing ? WRITE_UNKNOWN : '服务响应超时，请稍后重新加载；仍失败时请联系管理员。'
  if (/(?:^|_)(?:(?:INVALID|UNEXPECTED|MALFORMED)_(?:[A-Z]+_)?RESPONSE|RESPONSE_(?:INVALID|UNEXPECTED)|INVALID_ENVELOPE)$/.test(code)) return writing ? `服务返回的信息无法识别，${WRITE_UNKNOWN}` : '服务返回的信息无法识别，请刷新页面后重试；仍失败时请联系管理员。'
  if ([400, 422].includes(status) || /(?:VALIDATION|INVALID_JSON|INVALID_REQUEST|INVALID_BODY)/.test(code)) {
    if (['unknown_field', 'invalid_type', 'invalid_json', 'malformed_json'].includes(details?.reason) || /unknown field|cannot unmarshal|unexpected end of json|invalid character/i.test(text) || code === 'PM_INVALID_JSON') return CONTRACT_MISMATCH
    // 服务端已给出具体业务原因、并在 details 带结构化 reason_code 时，直接透出原因本身，不能被字段标签折叠成通用文案。
    const reasonCode = typeof details?.reason_code === 'string' ? details.reason_code.trim() : ''
    if (reasonCode && safe && !GENERIC_MESSAGES.test(safe)) return safe
    const fields = userFieldErrors(details)
    if (fields.length) return fields.map(row => row.message).join(' ')
    // 旧版 Gin 校验器在消息中返回结构体字段与标签的诊断信息。
    const gin = [...text.matchAll(/Field validation for '([A-Za-z0-9_]+)' failed on the '([a-z0-9_]+)' tag/g)].slice(0, 3)
    if (gin.length) {
      const known = gin.map(([, field, rule]) => issueMessage({ field, rule })).filter(Boolean)
      if (known.length) return [...new Set(known)].join(' ')
    }
  }
  // 准确的中文业务拒绝原因比通用 HTTP 状态标签更有用。
  if (safe && !GENERIC_MESSAGES.test(safe)) return safe
  if (CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  if (/(?:VERSION|REVISION)_(?:CONFLICT|MISMATCH)$/.test(code)) return '数据已被其他操作更新，请刷新页面后重新操作。'
  if (/(?:IDEMPOTENCY|DUPLICATE_OPERATION|OPERATION_IN_PROGRESS)/.test(code)) return '该操作已提交或正在处理，请先查看处理结果，不要重复提交。'
  if (/(?:LICENSE|COMMERCIAL).*(?:EXPIRED|NOT_PURCHASED|DENIED|CLOCK|UNAVAILABLE)/.test(code)) return '当前商业授权状态不允许此操作，请联系授权管理员核对有效期和系统范围。'
  if (/(?:IN_USE|REFERENCED)$/.test(code)) return '该记录已被业务数据引用，不能直接删除；请先解除引用或停用。'
  if (status === 401) return '登录状态已失效，请重新登录后继续操作。'
  if (status === 403) return '你没有执行此操作的权限，请联系管理员确认账号权限和数据范围。'
  if (status === 404 || status === 410) return '记录不存在、已被移除或不在当前可访问范围内，请刷新列表后重新选择。'
  if (status === 409 || status === 412 || status === 423) return REFRESH
  if (status === 413) return '文件或提交内容过大，请减小文件大小或减少本次提交数量。'
  if (status === 415) return '文件或提交内容的格式不受支持，请使用页面提供的模板和允许的文件类型。'
  if (status === 429) return '操作过于频繁，请稍候再试；不要连续点击提交。'
  if (status === 400 || status === 422) return '提交的信息未通过校验，请检查必填项、选择项和格式；若内容无误仍失败，请刷新页面或联系管理员。'
  if (status === 405 || status === 501) return '当前功能与服务版本不匹配或尚不可用，请联系管理员确认系统版本。'
  if (status >= 500) return writing ? WRITE_UNKNOWN : '服务暂时无法完成请求，请稍后重新加载；仍失败时请联系管理员。'
  return safe || fallback || '操作未能完成，请检查当前数据后重试；仍失败时请联系管理员。'
}

// 已认证页面可显式启用诊断信息，绝不暴露任意 details/cause。
export function userErrorDiagnostics(error) {
  if (!error || typeof error !== 'object') return {}
  const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code) ? error.code : ''
  const candidate = error.requestID || error.requestId || error.traceId || error.context?.requestId || error.context?.traceId
  const requestId = typeof candidate === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : ''
  return { code, requestId }
}
