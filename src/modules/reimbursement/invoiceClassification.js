import { formatMinor, toMinor } from './api/client.js'

// 用途：把已确认内容或解析候选明细转换为人工编辑表单，不赋予确认状态。
// 参数：value为票面内容，候选使用detail_lines构造lines后传入。
// 返回值：有界名称、税码及元金额表单；超限时要求人工拆分。
export function invoiceContentForm(value) {
  const lines = value?.lines || []
  if (!Array.isArray(lines) || lines.length > 100) throw new Error('票面明细最多100项，请人工核对并拆分')
  return { lines: lines.map(line => ({ name: String(line.name || ''),
    tax_classification_code: String(line.tax_classification_code || ''),
    amount: line.amount_minor !== undefined && /^\d+$/.test(line.amount_minor) ? formatMinor(line.amount_minor) : '',
    tax: line.tax_minor !== undefined && /^\d+$/.test(line.tax_minor) ? formatMinor(line.tax_minor) : '',
  })) }
}

// 用途：仅编码人工票面内容白名单，剔除候选来源坐标和归类结论。
// 参数：value为人工编辑的明细名称、税码及元金额表单。
// 返回值：正式content DTO；非法文字、税码或金额抛错。
export function invoiceContentInput(value) {
  if (!value) return undefined
  if (!Array.isArray(value.lines) || value.lines.length > 100) throw new Error('票面明细最多100项')
  return { lines: value.lines.map(line => {
    const name = String(line.name || '').trim()
    const code = String(line.tax_classification_code || '').trim()
    if (!name || [...name].length > 256 || /\p{Cc}/u.test(name)) throw new Error('明细名称须为1至256字且不能包含控制字符')
    if (code && !/^\d{1,19}$/.test(code)) throw new Error('税收分类编码须为1至19位数字，无法确认时留空')
    const result = { name, ...(code ? { tax_classification_code: code } : {}) }
    for (const [source, target] of [['amount', 'amount_minor'], ['tax', 'tax_minor']]) {
      if (String(line[source] ?? '').trim()) result[target] = toMinor(String(line[source]))
    }
    return result
  }) }
}

// 用途：把发布规则转换成逐行业务表单，避免使用原始JSON编辑。
// 参数：value为后端content_mappings数组。
// 返回值：税码逗号分隔、关键词逐行编辑的独立规则表单。
export function contentMappingForm(value = []) {
  value = value ?? []
  if (!Array.isArray(value) || value.length > 100) throw new Error('内容归类规则最多100条')
  return value.map(row => ({ id: row.id || '', tax_code_prefixes: (row.tax_code_prefixes || []).join(','),
    keywords: (row.keywords || []).join('\n'), fee_type: row.fee_type || '',
    default_claim_type: row.default_claim_type || '', priority: row.priority ?? 0 }))
}

// 用途：从逐行表单构造有界字面归类规则，拒绝重复ID及非法税码。
// 参数：value为用户填写的内容规则数组。
// 返回值：仅含允许字段的content_mappings；不合法时抛错。
export function contentMappingInput(value = []) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('内容归类规则最多100条')
  const ids = new Set()
  return value.map(row => {
    const id = String(row.id || '').trim(), fee = String(row.fee_type || '').trim()
    const prefixes = String(row.tax_code_prefixes || '').split(',').map(word => word.trim()).filter(Boolean)
    const keywords = String(row.keywords || '').split(/\r?\n/).map(word => word.trim()).filter(Boolean)
    const priority = Number(row.priority ?? 0), type = row.default_claim_type || ''
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id) || ids.has(id)) throw new Error('归类规则ID须合法且不重复')
    ids.add(id)
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(fee)) throw new Error('请填写合法费用类型编码')
    if (prefixes.length > 20 || keywords.length > 20) throw new Error('每条规则至少填写一种条件，每种最多20项')
    if (!prefixes.length && !keywords.length) throw new Error('每条规则至少填写一种条件')
    if (prefixes.some(word => !/^\d{1,19}$/.test(word))) throw new Error('税码前缀须为1至19位数字')
    if (keywords.some(word => [...word].length > 128 || /\p{Cc}/u.test(word))) throw new Error('关键词最多128字且不能包含控制字符')
    if (new Set(prefixes).size !== prefixes.length || new Set(keywords).size !== keywords.length) throw new Error('同一规则内的条件不得重复')
    if (!Number.isSafeInteger(priority) || priority < 0 || priority > 10000) throw new Error('优先级须为0至10000的整数')
    if (!['', 'TRAVEL', 'DAILY', 'PROJECT_EXECUTION'].includes(type)) throw new Error('请选择合法默认报销类型')
    return { id, tax_code_prefixes: prefixes, keywords, fee_type: fee, default_claim_type: type, priority }
  })
}

// 用途：准确显示归类依据来源及人工复核原因，不推断税务验真。
// 参数：value为服务器来源或固定原因码。
// 返回值：中文业务文案，未知编码原样保留。
export function classificationLabel(value) {
  return ({ CONTENT: '人工确认票面内容', INVOICE_TYPE_DEFAULT: '票种默认映射',
    MATCHED: '已有费用建议', NEEDS_REVIEW: '需要人工归类', RULE_CONFLICT: '同优先级规则冲突',
    UNMATCHED_LINES: '部分明细未匹配', MIXED_CATEGORIES: '明细对应不同费用类别或报销类型',
    MATCH_LIMIT: '命中数量超过展示上限', NO_MAPPING: '未命中内容规则且无票种默认映射',
    TAX_CODE_PREFIX: '税码前缀', KEYWORD: '明细关键词' })[value] || value || '历史建议来源未提供'
}

// 用途：按服务端基点展示真实退回率，明确区分零分母和零退回。
// 参数：value为服务器return_rate_basis_points，空值表示分母为零。
// 返回值：百分比文案或暂无已提交单据提示。
export function returnRateLabel(value) {
  if (value === undefined) return '退回率数据未提供'
  return value === null ? '暂无已提交单据' : `${(Number(value) / 100).toFixed(2)}%`
}

// 用途：展示实际自动退回回执，避免把原APPROVE请求误报为批准成功。
// 参数：result为服务端审批结果。
// 返回值：真实原因及合规码文案，非自动退回则为空。
export function autoReturnNotice(result) {
  return result?.auto_returned === true
    ? `合规复检后实际退回：${result.reason || '请查看审批历史'}；合规项：${(result.compliance_codes || []).join('、')}` : ''
}
