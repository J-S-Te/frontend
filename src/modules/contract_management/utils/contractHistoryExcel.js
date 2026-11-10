// 历史Excel只生成既有导入契约，实际目录、权限及开立能力仍由服务端校验。
export const historicalExcelModes = ['ARCHIVE_ONLY', 'HISTORICAL_CLOSED']
export const historyExcelHeaders = ['合同编号', '原签署日期', '原合同状态', '原客户名称',
  '原负责人', '报表统计方式']
const legacyHistoryHeaders = [...historyExcelHeaders, '报表来源通道', '财务处理方式', '无历史财务事实']
export const historyFactHeaders = ['合同编号', '来源系统', '事实类型', '原事实编号']
const statusValues = { 已归档: 'archived', 已完成: 'completed', 已终止: 'terminated' }
const reportValues = { 档案单独统计: 'ARCHIVE_SEPARATE', 历史单独统计: 'HISTORICAL_SEPARATE' }
const channelValues = { 仅API: 'API_ONLY', API及来源事实: 'API_AND_SOURCE_FACTS' }
const keyPattern = /^[A-Za-z0-9_.:-]{1,128}$/

// historyText 规范化Excel文本而不推断业务含义。
// 参数：value为单元格或表单值。
// 返回值：去首尾空白的文本。
function historyText(value) { return String(value ?? '').trim() }

// historyDate 解析真实日期，拒绝被日期库进位的非法日历日期。
// 参数：value为Excel日期对象、序列或日期文本。
// 返回值：有效的日期文本；无效输入保留原文供校验报错。
function historyDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '无效日期' : value.toISOString().slice(0, 10)
  if (typeof value === 'number' && Number.isInteger(value) && value > 60) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10)
  }
  return historyText(value)
}

// validHistoryDate 检查历史签署日期，不把空白转换为合同开始日期。
// 参数：value为日期文本。
// 返回值：合法日期或空白时为真。
function validHistoryDate(value) {
  if (!value) return true
  const parsed = new Date(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
}

// historySheetRows 从指定分表读取有标签的业务行，不接受缺失或重复表头。
// 参数：sheets为工作簿，name为分表名，headers为列白名单，issues为问题集合。
// 返回值：按中文表头定位的行；异常分表返回空并保留阻断错误。
function historySheetRows(sheets, name, headers, issues) {
  const found = sheets.filter(s => historyText(s.sheet) === name)
  if (!found.length) return []
  const data = found[0].data || []
  const index = data.slice(0, 10).findIndex(r => r?.some(c => historyText(c) === '合同编号'))
  const labels = (data[index] || []).map(historyText)
  if (found.length !== 1 || index < 0 || new Set(labels.filter(Boolean)).size !== labels.filter(Boolean).length
      || labels.some(label => label && !headers.includes(label))
      || (name === '历史财务事实' && headers.some(h => !labels.includes(h)))) {
    issues.push({ scope: 'workbook', code: 'HISTORY_HEADERS_INVALID', message: `「${name}」表头缺失或重复。`, blocking: true })
    return []
  }
  return data.slice(index + 1).map((row, offset) => ({ rowNumber: index + offset + 2,
    values: Object.fromEntries(headers.map(h => [h, row[labels.indexOf(h)]])) }))
    .filter(row => Object.values(row.values).some(v => historyText(v)))
}

// historyExcelIssue 记录可定位的分表错误，避免未匹配的历史信息被静默丢弃。
// 参数：issues为集合，row为Excel行，code和message为业务错误。
// 返回值：无。
function historyExcelIssue(issues, row, code, message) {
  issues.push({ scope: 'workbook', rowNumber: row.rowNumber,
    contractNumber: historyText(row.values['合同编号']), code, message, blocking: true })
}

// readHistoryExcelRecords 合并历史档案并拒绝旧财务导入内容，不访问CRM或创建客户。
// 参数：sheets为Excel分表，records为已解析合同记录。
// 返回值：保留原记录字段的新记录及阻断问题；分表可缺省，由页面补齐历史信息。
export function readHistoryExcelRecords(sheets = [], records = []) {
  const result = records.map(r => ({ ...r, ...(historyText(r.currentOwnerName)
    ? { historyEvidence: { ...r.historyEvidence, target_owner_name: historyText(r.currentOwnerName) } } : {}) }))
  const known = new Map(result.map(r => [r.contractNumber, r]))
  const issues = [], seen = new Set()
  for (const row of historySheetRows(sheets, '历史档案', legacyHistoryHeaders, issues)) {
    const v = row.values, number = historyText(v['合同编号']), record = known.get(number)
    if (!record) { historyExcelIssue(issues, row, 'HISTORY_ORPHAN', '历史档案没有对应的合同明细。'); continue }
    if (seen.has(number)) { historyExcelIssue(issues, row, 'HISTORY_DUPLICATE', '同一合同只能填写一行历史档案。'); continue }
    seen.add(number)
    const signed = historyDate(v['原签署日期'])
    if (!validHistoryDate(signed)) historyExcelIssue(issues, row, 'HISTORY_DATE_INVALID', '原签署日期无效。')
    record.historyEvidence ||= {}
    if (signed) record.historyEvidence.declared_signed_date = signed
    if (historyText(v['原客户名称'])) record.historyEvidence.historical_customer_name = historyText(v['原客户名称'])
    if (historyText(v['原负责人'])) record.historyEvidence.historical_owner_label = historyText(v['原负责人'])
    if (historyText(v['原合同状态'])) record.historyEvidence.historical_status = statusValues[historyText(v['原合同状态'])] || historyText(v['原合同状态'])
    if (historyText(v['报表来源通道']) && (channelValues[historyText(v['报表来源通道'])] || historyText(v['报表来源通道'])) !== 'API_ONLY') {
      historyExcelIssue(issues, row, 'HISTORY_REPORT_CHANNEL_UNSUPPORTED',
        '新历史Excel固定通过合同接口同步档案，请移除旧模板的其他来源通道设置；已保存批次保留原值。')
    }
    if (historyText(v['财务处理方式']) || historyText(v['无历史财务事实'])) {
      historyExcelIssue(issues, row, 'HISTORY_FINANCE_NOT_APPLICABLE',
        '历史导入不参与结算开票，请使用新版模板；旧财务策略及声明不能通过导入执行。')
    }
    record.policyOptions = {}
    if (historyText(v['报表统计方式'])) record.policyOptions.report_mode = reportValues[historyText(v['报表统计方式'])] || historyText(v['报表统计方式'])
  }
  for (const row of historySheetRows(sheets, '历史财务事实', historyFactHeaders, issues)) {
    historyExcelIssue(issues, row, 'HISTORY_FINANCE_NOT_APPLICABLE',
      '历史导入不采集收款或核销事实，请保留原财务资料并由财务人员按正常流程处理。')
  }
  return { records: result, issues }
}

// historyImportDetails 以行级原始事实优先生成历史契约，不改写恢复批次的显式策略。
// 参数：row为Excel或恢复行，mode为历史模式，options为操作者明确填写的本批缺省信息。
// 返回值：既有后端所需history_evidence与policy_options。
export function historyImportDetails(row, mode, options = {}) {
  const archive = mode === 'ARCHIVE_ONLY'
  return {
    history_evidence: {
      declared_signed_date: historyText(options.declaredSignedDate),
      historical_status: historyText(options.historicalStatus),
      historical_customer_name: historyText(options.historicalCustomerName),
      historical_owner_label: historyText(options.historicalOwnerLabel),
      target_owner_user_id: row.historyEvidence?.target_owner_name
        ? historyText(row.historyEvidence.target_owner_user_id) : historyText(options.targetOwnerUserID),
      report_required_channels: 'API_ONLY',
      ...row.historyEvidence,
    },
    policy_options: { policy_version: 1, project_mode: 'NONE', responsibility_mode: 'INACTIVE',
      signing_mode: 'DECLARED_ONLY', finance_mode: 'NONE',
      report_mode: archive ? 'ARCHIVE_SEPARATE' : historyText(options.reportMode), ...row.policyOptions },
  }
}

// validateHistoryImportDetails 按现有后端契约校验历史信息，不证明真实财务已经结清。
// 参数：detail为待提交历史契约，mode为历史模式。
// 返回值：字段错误数组；空数组只表示本地结构合法。
export function validateHistoryImportDetails(detail, mode) {
  const e = detail.history_evidence || {}, p = detail.policy_options || {}, issues = []
  const add = (field, message) => issues.push({ field, code: 'HISTORY_INVALID', message })
  if (!historicalExcelModes.includes(mode)) add('mode', 'Excel历史导入只支持历史存档或历史结清档案。')
  if ((!e.target_owner_user_id && !historyText(e.target_owner_name)) || historyText(e.target_owner_user_id).length > 64) {
    add('history_evidence.target_owner_user_id', '请在Excel填写当前负责人姓名，或选择当前负责人。')
  }
  if ([...historyText(e.target_owner_name)].length > 128) add('history_evidence.target_owner_name', '当前负责人姓名不能超过128个字。')
  if (!validHistoryDate(e.declared_signed_date)) add('history_evidence.declared_signed_date', '原签署日期无效。')
  const statuses = mode === 'ARCHIVE_ONLY' ? ['archived'] : ['archived', 'completed', 'terminated']
  if (!statuses.includes(e.historical_status)) add('history_evidence.historical_status', '请明确原合同状态。')
  if (!['API_ONLY', 'API_AND_SOURCE_FACTS'].includes(e.report_required_channels)) add('history_evidence.report_required_channels', '请选择报表来源通道。')
  if (p.policy_version !== 1 || p.project_mode !== 'NONE' || p.responsibility_mode !== 'INACTIVE'
      || p.signing_mode !== 'DECLARED_ONLY' || !['ARCHIVE_SEPARATE', 'HISTORICAL_SEPARATE'].includes(p.report_mode)
      || (mode === 'ARCHIVE_ONLY' && (p.finance_mode !== 'NONE' || p.report_mode !== 'ARCHIVE_SEPARATE'))
      || (mode === 'HISTORICAL_CLOSED' && !['NONE', 'EVIDENCE_ONLY', 'FULL_REPLAY'].includes(p.finance_mode))) {
    add('policy_options', '历史处理策略不完整或与模式冲突，请核对财务及报表处理方式。')
  }
  if (p.finance_mode === 'FULL_REPLAY' && !Array.isArray(e.expected_facts)) {
    add('history_evidence.expected_facts', '重建历史台账须提供完整财务事实；无事实时须显式声明。')
  }
  if (e.expected_facts !== undefined && e.expected_facts !== null) {
    const facts = e.expected_facts, keys = new Set()
    if (!Array.isArray(facts) || facts.length > 1000) add('history_evidence.expected_facts', '财务事实清单无效或超过1000条。')
    else for (const fact of facts) {
      const key = JSON.stringify([fact?.source_system, fact?.fact_type, fact?.external_fact_id])
      if (!fact || !keyPattern.test(fact.source_system || '') || fact.source_system.length > 64
          || !keyPattern.test(fact.external_fact_id || '') || !['RECEIPT', 'ALLOCATION'].includes(fact.fact_type)
          || keys.has(key)) add('history_evidence.expected_facts', '财务事实字段无效或重复。')
      keys.add(key)
    }
  }
  if ([...historyText(e.historical_customer_name)].length > 255
      || [...historyText(e.historical_owner_label)].length > 128) {
    add('history_evidence', '原客户名称或原负责人超出允许长度。')
  }
  if (e.existing_project_id || e.expected_project_version || e.original_contract_ref) {
    add('history_evidence', '该历史批次含项目关联，请使用原始高级清单保留既有策略。')
  }
  return issues
}
