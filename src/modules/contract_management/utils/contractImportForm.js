/**
 * 普通导入表单与 manifest 之间的纯转换层。
 *
 * 背景：底层清单要求 item_key / external_record_id 使用 ASCII 标识，金额必须是整数分，
 * 日期是 RFC3339；业务人员只应看到“原件、合同字段、服务项、金额（元）”。
 * 本文件负责把表单行变成既有 prepareImportManifest 能校验的清单，并给出逐字段中文错误。
 * 不在这里做网络请求，也不放宽服务端校验。
 */
import { externalContractTypes, contractSystemLevels } from './contractPayload.js'
import { paymentAmountMinor, normalizePaymentTerms } from './paymentTerms.js'
import { formatImportMinor } from './contractImport.js'

export const importItemKeyPattern = /^[A-Za-z0-9_.:-]{1,128}$/
export const importSourceSystemPattern = /^[A-Za-z0-9_.:-]{1,64}$/
export const importServiceTestModes = ['STANDARD', 'PENETRATION']

const sessionSalt = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
let generatedCount = 0

function nextGeneratedKey(prefix) {
  generatedCount += 1
  return `${prefix}-${Date.now().toString(36)}-${sessionSalt}${generatedCount.toString(36)}`
}

function asText(value) {
  return String(value ?? '').trim()
}

/**
 * emptyImportServiceItem 生成一条空白服务项；检测方式默认常规检测，批次默认第一批次。
 * 返回值：不含身份字段的服务项行。
 */
export function emptyImportServiceItem() {
  return { serviceType: '', name: '', site: '', batch: '第一批次', category: '', requirement: '', testMode: 'STANDARD', systems: [] }
}

/**
 * createImportFormRow 由已选原件生成一行可编辑合同。
 * 参数：fileName为原件名，source_file_ref将与之保持一致；key/externalRecordId供反填历史行时显式传入。
 * 返回值：不含文件字节的表单行；item_key 使用批次内 ASCII 随机标识，避免中文文件名与重名冲突。
 * externalRecordId 是来源系统的原业务键，服务端据此做唯一性、幂等与追溯：
 * 只在显式传入（如反填已保存批次）时保留，绝不随机生成，也不从文件名猜测。
 */
export function createImportFormRow({ fileName = '', key = '', externalRecordId = '' } = {}) {
  const name = asText(fileName)
  return {
    key: importItemKeyPattern.test(String(key || '')) ? String(key) : nextGeneratedKey('row'),
    externalRecordId: asText(externalRecordId),
    fileName: name,
    title: name ? name.replace(/\.[^.]+$/, '') : '',
    contractType: '',
    opportunityId: '',
    opportunityName: '',
    crmCustomerId: '',
    customerName: '',
    customerAddress: '',
    customerContact: '',
    customerPhone: '',
    customerCreditLevel: '',
    amount: '',
    currency: 'CNY',
    startDate: '',
    endDate: '',
    externalPaperNumber: '',
    paymentTerms: [],
    serviceItems: [emptyImportServiceItem()],
    content: '',
    issues: [],
    batchIssues: [],
    state: 'DRAFT',
    contractId: '',
    normalized: null,
  }
}

function datePart(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : ''
}

function amountText(value) {
  if (!Number.isSafeInteger(value) || value < 0) return ''
  const text = formatImportMinor(value)
  return /^\d+(?:\.\d{2})?$/.test(text) ? text : ''
}

/**
 * importRowsFromItems 把已保存批次项反填成普通表单行，便于查询后继续修订。
 * 参数：entries为批次 items，sources为批次 sources；只处理 NORMAL 项。
 * 返回值：与清单一一对应的表单行；历史项保持原 JSON 工作流，不强行表单化。
 */
export function importRowsFromItems(entries = [], sources = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.item?.mode === 'NORMAL')
    .map((entry) => {
      const item = entry.item, metadata = item.metadata || {}
      const source = (Array.isArray(sources) ? sources : []).find((row) => row.file_ref === item.source_file_ref)
      const row = createImportFormRow({
        fileName: source?.filename || item.source_file_ref || '',
        key: item.item_key,
        externalRecordId: item.external_record_id,
      })
      row.title = asText(metadata.title)
      row.contractType = asText(metadata.contract_type)
      row.opportunityId = asText(metadata.opportunity_id)
      row.opportunityName = asText(metadata.opportunity_name)
      row.crmCustomerId = metadata.crm_customer_id ? String(metadata.crm_customer_id) : ''
      row.customerName = asText(metadata.customer_name)
      row.customerAddress = asText(metadata.customer_address)
      row.customerContact = asText(metadata.customer_contact)
      row.customerPhone = asText(metadata.customer_phone)
      row.customerCreditLevel = asText(metadata.customer_credit_level)
      row.amount = amountText(metadata.amount_minor)
      row.currency = asText(metadata.currency) || 'CNY'
      row.startDate = datePart(metadata.start_date)
      row.endDate = datePart(metadata.end_date)
      row.externalPaperNumber = asText(metadata.external_paper_number)
      row.content = asText(metadata.content)
      row.paymentTerms = (Array.isArray(metadata.payment_terms) ? metadata.payment_terms : []).map((term) => ({
        installment_no: term.installment_no,
        due_date: asText(term.due_date),
        amount: asText(term.amount),
      }))
      const serviceItems = (Array.isArray(metadata.service_items) ? metadata.service_items : []).map((service) => ({
        serviceType: asText(service.service_type),
        name: asText(service.name),
        site: asText(service.site),
        batch: asText(service.batch),
        category: asText(service.category),
        requirement: asText(service.requirement),
        testMode: asText(service.test_mode) || 'STANDARD',
        systems: (Array.isArray(service.systems) ? service.systems : []).map((system) => ({
          name: asText(system.name),
          level: asText(system.level),
        })),
      }))
      row.serviceItems = serviceItems.length ? serviceItems : [emptyImportServiceItem()]
      row.issues = []
      row.batchIssues = Array.isArray(entry.issues) ? entry.issues : []
      row.state = entry.state || 'PENDING'
      row.contractId = entry.contract_id || ''
      row.normalized = entry.normalized_metadata || null
      return row
    })
}

function validImportDate(value) {
  const text = asText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && Number(text.slice(0, 4)) >= 1 && date.toISOString().slice(0, 10) === text
}

function importDateValue(value) {
  const text = asText(value)
  return text ? `${text}T00:00:00Z` : null
}

/**
 * validateImportFormRows 统一收集行级问题，供页面逐字段展示与保存前阻断。
 * 参数：rows为表单行，files为当前所选原件，sources为批次已暂存原件；mode固定普通模式。
 * 返回值：按行定位的问题数组（field/code/message）；空行、缺字段、来源业务键、重名、金额与日期错误均在此收口。
 */
export function validateImportFormRows(rows, { files = [], sources = [], mode = 'NORMAL' } = {}) {
  if (mode !== 'NORMAL') {
    return [{ rowKey: '', field: 'mode', code: 'MODE_UNSUPPORTED', message: '普通表单只用于普通新合同；历史导入需要完整 JSON 清单（含历史来源证据与策略）。' }]
  }
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return [{ rowKey: '', field: 'rows', code: 'ITEM_COUNT_INVALID', message: '请先选择至少一份合同原件再预检。' }]
  if (list.length > 100) return [{ rowKey: '', field: 'rows', code: 'ITEM_COUNT_INVALID', message: '每批最多 100 份合同，请拆分后再导入。' }]

  const issues = []
  const seenNames = new Map()
  const seenExternalRecordIds = new Map()
  const selectedNames = new Set((Array.isArray(files) ? files : []).map((file) => file?.name).filter(Boolean))
  const staged = new Set((Array.isArray(sources) ? sources : [])
    .filter((source) => source?.state === 'READY')
    .map((source) => `${source.item_key}\u0000${source.filename}`))
  // 只有已知当前选择或已暂存原件时才核对“文件是否还在”；纯离线组装清单不冒充已选文件。
  const checkFileSelection = selectedNames.size > 0 || staged.size > 0

  list.forEach((row, index) => {
    const name = asText(row.fileName)
    const label = `第 ${index + 1} 行${name ? `（${name}）` : ''}`
    const add = (field, code, message) => issues.push({ rowKey: row.key || `row-${index + 1}`, field, code, message })

    if (!name) add('fileName', 'FILE_MISSING', `${label}：请重新选择合同原件。`)
    else if (seenNames.has(name)) add('fileName', 'DUPLICATE_SOURCE_FILE', `${label}：同一原件只能导入一次，重复文件请先整理。`)
    else {
      seenNames.set(name, index)
      if (checkFileSelection && !selectedNames.has(name) && !staged.has(`${row.key}\u0000${name}`)) {
        add('fileName', 'FILE_MISSING', `${label}：当前选择的原件中找不到「${name}」，文件重命名后请重新选择原件。`)
      }
    }

    if (!asText(row.title)) add('title', 'REQUIRED', `${label}：请填写合同标题。`)
    if (!externalContractTypes.includes(asText(row.contractType))) add('contractType', 'UNSUPPORTED_ENUM', `${label}：合同类型只能选择直签或三方。`)

    // 来源业务键是原系统业务键，服务端用它做唯一性、幂等与追溯；空值、非法字符和批次内重复都在写前阻断。
    const externalRecordId = asText(row.externalRecordId)
    const externalRecordIdMessage = `${label}：来源业务键（原系统合同编号/业务键）不能为空，只能使用字母/数字/._:-，且不能重复。`
    if (!externalRecordId) add('externalRecordId', 'REQUIRED', externalRecordIdMessage)
    else if (!importItemKeyPattern.test(externalRecordId)) add('externalRecordId', 'INVALID', externalRecordIdMessage)
    else if (seenExternalRecordIds.has(externalRecordId)) add('externalRecordId', 'DUPLICATE_EXTERNAL_RECORD_ID', externalRecordIdMessage)
    else seenExternalRecordIds.set(externalRecordId, index)

    const customerId = asText(row.crmCustomerId)
    if (!customerId) add('crmCustomerId', 'REQUIRED', `${label}：请填写 CRM 客户编号，或从 CRM 客户目录选择。`)
    else if (!/^[1-9]\d*$/.test(customerId) || !Number.isSafeInteger(Number(customerId))) {
      add('crmCustomerId', 'INVALID', `${label}：CRM 客户编号无效或超出可安全提交的范围，请重新选择。`)
    }
    if (!asText(row.customerName)) add('customerName', 'REQUIRED', `${label}：请填写客户名称。`)

    let amountOK = false
    if (!asText(row.amount)) add('amount', 'REQUIRED', `${label}：请填写合同金额（元）。`)
    else {
      try {
        if (paymentAmountMinor(row.amount) <= 0) add('amount', 'POSITIVE_MINOR_UNITS_REQUIRED', `${label}：合同金额必须大于零。`)
        else amountOK = true
      } catch (error) {
        add('amount', 'INVALID_AMOUNT', `${label}：${error.message}`)
      }
    }

    if (!/^[A-Za-z]{3}$/.test(asText(row.currency))) add('currency', 'UNSUPPORTED_ENUM', `${label}：币种必须是三位字母代码，例如 CNY。`)

    const start = asText(row.startDate), end = asText(row.endDate)
    if (start && !validImportDate(start)) add('startDate', 'INVALID_DATE', `${label}：请选择有效的合同开始日期。`)
    if (end && !validImportDate(end)) add('endDate', 'INVALID_DATE', `${label}：请选择有效的合同结束日期。`)
    if (validImportDate(start) && validImportDate(end) && start > end) add('endDate', 'DATE_ORDER_INVALID', `${label}：合同开始日期不能晚于结束日期。`)

    if ([...asText(row.externalPaperNumber)].length > 128) add('externalPaperNumber', 'TOO_LONG', `${label}：外部纸面编号不能超过 128 个字。`)

    if (Boolean(asText(row.opportunityId)) !== Boolean(asText(row.opportunityName))) {
      add('opportunityId', 'OPPORTUNITY_PAIR_REQUIRED', `${label}：商机编号和商机名称必须同时填写，或都留空。`)
    }

    const serviceItems = Array.isArray(row.serviceItems) ? row.serviceItems : []
    if (!serviceItems.length || serviceItems.length > 20) add('serviceItems', 'ITEM_COUNT_INVALID', `${label}：请维护 1 至 20 个服务项。`)
    serviceItems.forEach((service, serviceIndex) => {
      const prefix = `serviceItems.${serviceIndex}`
      for (const [field, fieldLabel] of [['serviceType', '服务类型'], ['site', '实施场所'], ['batch', '实施批次'], ['category', '检测类别'], ['testMode', '检测方式']]) {
        if (!asText(service[field])) add(`${prefix}.${field}`, 'REQUIRED', `${label}：服务项 ${serviceIndex + 1} 请填写${fieldLabel}。`)
      }
      if (service.testMode && !importServiceTestModes.includes(asText(service.testMode).toUpperCase())) {
        add(`${prefix}.testMode`, 'UNSUPPORTED_ENUM', `${label}：服务项 ${serviceIndex + 1} 的检测方式无效。`)
      }
      const systems = Array.isArray(service.systems) ? service.systems : []
      if (systems.length > 15) add(`${prefix}.systems`, 'ITEM_COUNT_INVALID', `${label}：服务项 ${serviceIndex + 1} 的系统信息最多 15 个。`)
      systems.forEach((system, systemIndex) => {
        if (!asText(system.name)) add(`${prefix}.systems.${systemIndex}.name`, 'REQUIRED', `${label}：服务项 ${serviceIndex + 1} 的系统 ${systemIndex + 1} 请填写系统名称。`)
        if (!contractSystemLevels.includes(asText(system.level))) add(`${prefix}.systems.${systemIndex}.level`, 'UNSUPPORTED_ENUM', `${label}：服务项 ${serviceIndex + 1} 的系统 ${systemIndex + 1} 请选择一级至四级的系统等级。`)
      })
    })

    const terms = Array.isArray(row.paymentTerms) ? row.paymentTerms : []
    if (terms.length > 100) add('paymentTerms', 'ITEM_COUNT_INVALID', `${label}：付款条款最多 100 期。`)
    else if (terms.length && amountOK) {
      try {
        normalizePaymentTerms(terms, row.amount, row.currency)
      } catch (error) {
        add('paymentTerms', 'PAYMENT_TERMS_INVALID', `${label}：${error.message}`)
      }
    }
  })
  return issues
}

function buildImportServiceItem(service) {
  return {
    service_type: asText(service.serviceType),
    name: asText(service.name),
    site: asText(service.site),
    batch: asText(service.batch),
    category: asText(service.category),
    requirement: asText(service.requirement),
    test_mode: asText(service.testMode).toUpperCase(),
    systems: (Array.isArray(service.systems) ? service.systems : []).map((system) => ({ name: asText(system.name), level: asText(system.level) })),
  }
}

function buildImportMetadata(row) {
  const currency = asText(row.currency).toUpperCase()
  const serviceItems = (Array.isArray(row.serviceItems) ? row.serviceItems : []).map(buildImportServiceItem)
  const paymentTerms = Array.isArray(row.paymentTerms) ? row.paymentTerms : []
  return {
    title: asText(row.title),
    contract_type: asText(row.contractType),
    service_type: serviceItems[0]?.service_type || '',
    opportunity_id: asText(row.opportunityId),
    opportunity_name: asText(row.opportunityName),
    crm_customer_id: Number(asText(row.crmCustomerId)),
    customer_name: asText(row.customerName),
    customer_address: asText(row.customerAddress),
    customer_contact: asText(row.customerContact),
    customer_phone: asText(row.customerPhone),
    customer_credit_level: asText(row.customerCreditLevel),
    amount_minor: paymentAmountMinor(row.amount),
    currency,
    payment_terms: normalizePaymentTerms(paymentTerms, row.amount, currency),
    start_date: importDateValue(row.startDate),
    end_date: importDateValue(row.endDate),
    external_paper_number: asText(row.externalPaperNumber),
    content: asText(row.content),
    service_items: serviceItems,
  }
}

/**
 * buildImportManifestFromRows 把普通表单行组装成现有 schema_version=1 清单。
 * 参数：rows为表单行，sourceSystem取自批次或默认manual，mode仅允许NORMAL。
 * 返回值：可直接交给 prepareImportManifest 的对象；任何字段错误在调用前阻断并抛出首条中文提示。
 */
export function buildImportManifestFromRows(rows, { sourceSystem = 'manual', mode = 'NORMAL', files = [], sources = [] } = {}) {
  const issues = validateImportFormRows(rows, { files, sources, mode })
  if (issues.length) {
    const error = new Error(issues[0].message)
    error.issues = issues
    throw error
  }
  if (!importSourceSystemPattern.test(asText(sourceSystem))) throw new Error('来源系统标识无效，请保留原批次来源或重新开始批次。')
  return {
    schema_version: 1,
    source_system: asText(sourceSystem),
    items: rows.map((row) => ({
      item_key: asText(row.key),
      external_record_id: asText(row.externalRecordId),
      mode: 'NORMAL',
      source_file_ref: asText(row.fileName),
      metadata: buildImportMetadata(row),
    })),
  }
}

const importMetadataFieldLabels = {
  'metadata.title': '合同标题',
  'metadata.contract_type': '合同类型',
  'metadata.service_type': '服务类型',
  'metadata.opportunity_id': '商机编号',
  'metadata.opportunity_name': '商机名称',
  'metadata.crm_customer_id': 'CRM 客户编号',
  'metadata.customer_name': '客户名称',
  'metadata.customer_address': '客户地址',
  'metadata.customer_contact': '客户联系人',
  'metadata.customer_phone': '客户电话',
  'metadata.customer_credit_level': '客户信用等级',
  'metadata.amount_minor': '合同金额',
  'metadata.currency': '币种',
  'metadata.payment_terms': '付款条款',
  'metadata.start_date': '开始日期',
  'metadata.end_date': '结束日期',
  'metadata.external_paper_number': '外部纸面编号',
  'metadata.service_items': '服务项',
  'metadata.systems': '系统信息',
}

const importServiceFieldLabels = {
  service_type: '服务类型', name: '服务名称', site: '实施场所', batch: '实施批次',
  category: '检测类别', test_mode: '检测方式', requirement: '体系 / 能力要求', systems: '系统信息',
}

/**
 * importFieldLabel 把预检返回的字段路径转成中文定位，避免只显示 metadata.xxx。
 * 参数：path为服务端 field_path。
 * 返回值：中文标签；未知路径保留原文。
 */
export function importFieldLabel(path) {
  const text = asText(path)
  if (importMetadataFieldLabels[text]) return importMetadataFieldLabels[text]
  const service = /^metadata\.service_items\[(\d+)\](?:\.([A-Za-z_]+))?(?:\.systems\[(\d+)\]\.([A-Za-z_]+))?$/.exec(text)
  if (service) {
    const index = Number(service[1]) + 1
    if (service[4]) return `服务项 ${index} · 系统 ${Number(service[3]) + 1} · ${service[4] === 'level' ? '系统等级' : '系统名称'}`
    return `服务项 ${index}${service[2] ? ` · ${importServiceFieldLabels[service[2]] || service[2]}` : ''}`
  }
  return text || '合同字段'
}
