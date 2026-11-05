import { paymentAmountMinor } from './paymentTerms.js'

export const externalContractTypes = ['直签', '三方']
export const contractSystemLevels = ['一级', '二级', '三级', '四级']

// 用途：保留外部原件元数据并规范化明确LOCAL引用，正文始终来自原件。
// 参数：payload为正式请求DTO；未知字段仍交给后端严格拒绝。
// 返回值：无content字段且保留独立来源及服务项引用的元数据。
export function externalContractMetadata(payload) {
  const metadata = { ...payload, ...localContractReferencePayload(payload) }
  delete metadata.content
  return metadata
}

export function isContractDOCXFile(file) {
  return Boolean(file && file.name.toLowerCase().endsWith('.docx')
    && ['', 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type || ''))
}

/**
 * validateContractSourceFile 校验外部原件格式及客户端体积边界。
 * 参数：file为选中文件，options.pdfEnabled为服务端明确开放的PDF能力。
 * 返回值：规范格式和最大字节数；未开放、错类型或越界时抛出中文错误。
 */
export function validateContractSourceFile(file, { pdfEnabled = false } = {}) {
  if (!file || typeof file.name !== 'string') throw new Error('请选择外部合同原件。')
  const pdf = file.name.toLowerCase().endsWith('.pdf')
  if (pdf && !pdfEnabled) throw new Error('外部 PDF 上传尚未开启。')
  if (pdf ? !['', 'application/pdf', 'application/octet-stream'].includes(file.type || '') : !isContractDOCXFile(file)) {
    throw new Error('文件类型与 DOCX/PDF 格式不一致。')
  }
  const maximum = (pdf ? 20 : 10) * 1024 * 1024
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('合同原件不能为空。')
  if (file.size > maximum) throw new Error(`${pdf ? 'PDF' : 'DOCX'} 文件不能超过 ${pdf ? 20 : 10}MB。`)
  return { format: pdf ? 'PDF' : 'DOCX', maxBytes: maximum }
}

function validateOptionalDate(value, label) {
  if (!value) return
  const text = String(value)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null
  if (!date || Number.isNaN(date.getTime()) || Number(text.slice(0, 4)) < 1 || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`请选择有效的合同${label}日期。`)
  }
}

// 用途：校验表单的金额、来源、目录版本和服务项，服务端继续强制复核。
// 参数：form为表单，external表示外部原件路径。
// 返回值：无；不符合正式接口边界时抛出可读错误。
export function validateContractForm(form, { external = false } = {}) {
  if (!String(form.title || '').trim()) throw new Error('请填写合同名称。')
  if (!String(form.contract_type || '').trim()) throw new Error('请选择合同类型。')
  if (external && !externalContractTypes.includes(form.contract_type)) throw new Error('外部合同类型只能选择直签或三方。')
  const amountMinor = paymentAmountMinor(form.amount)
  if (external && amountMinor <= 0) throw new Error('外部合同金额必须大于零。')
  if (external && !/^[A-Za-z]{3}$/.test(String(form.currency || '').trim())) throw new Error('币种必须是三位字母代码，例如 CNY。')
  if (form.customer_id && (!/^[1-9]\d*$/.test(String(form.customer_id)) || !Number.isSafeInteger(Number(form.customer_id)))) {
    throw new Error('CRM 客户编号无效或超出可安全提交的范围，请重新选择。')
  }
  localContractReferencePayload(form)
  validateOptionalDate(form.start_date, '开始')
  validateOptionalDate(form.end_date, '结束')
  if (form.start_date && form.end_date && form.start_date > form.end_date) throw new Error('合同开始日期不能晚于结束日期。')
  if (!Array.isArray(form.service_items) || !form.service_items.length || form.service_items.length > 20) throw new Error('请维护 1 至 20 个服务项。')
  form.service_items.forEach((item, index) => {
    if (!String(item.service_type || '').trim()) throw new Error(`请选择服务项 ${index + 1} 的服务类型。`)
    const mode = String(item.test_mode || '').trim().toUpperCase()
    if (mode && !['STANDARD', 'PENETRATION'].includes(mode)) throw new Error(`服务项 ${index + 1} 的检测方式无效，请重新选择。`)
    if (!Array.isArray(item.systems) || item.systems.length > 15) throw new Error(`服务项 ${index + 1} 的系统信息最多 15 个。`)
    item.systems.forEach((system) => {
      if (!String(system.name || '').trim() || !contractSystemLevels.includes(system.level)) {
        throw new Error(`请补全服务项 ${index + 1} 的系统名称，并选择一级至四级的系统等级。`)
      }
    })
  })
}


// 用途：仅输出明确的来源引用白名单，旧表单不新增字段或重解释客户身份。
// 参数：form为合同表单，LOCAL目录ID/版本必须来自已读目录。
// 返回值：可合并入正式请求的独立引用；无效或混用身份时抛出错误。
export function localContractReferencePayload(form) {
  const source = String(form.counterparty_source || '')
  const categorySource = String(form.category_source || '')
  if (source && !['LOCAL', 'CRM'].includes(source)) throw new Error('合同交易对方来源无效。')
  if (categorySource && !['LOCAL', 'PROJECT'].includes(categorySource)) throw new Error('合同类别来源无效。')
  const result = {}
  if (source === 'LOCAL') {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(form.local_counterparty_id || '')) || !Number.isSafeInteger(form.counterparty_version) || form.counterparty_version < 1) {
      throw new Error('请重新选择有效的本地交易对方，确保目录版本完整。')
    }
    if (form.customer_id || form.crm_customer_id || form.opportunity_id || form.opportunity_name) throw new Error('本地交易对方不能混用 CRM 客户或商机引用。')
    Object.assign(result, { counterparty_source: 'LOCAL', local_counterparty_id: form.local_counterparty_id, counterparty_version: form.counterparty_version, crm_customer_id: 0 })
  } else if (source === 'CRM') {
    if (!/^[1-9]\d*$/.test(String(form.customer_id || form.crm_customer_id || ''))) throw new Error('请选择有效的 CRM 客户。')
    result.counterparty_source = 'CRM'
  } else if (form.local_counterparty_id || form.counterparty_version) {
    throw new Error('本地交易对方引用须明确选择本地来源。')
  }
  if (categorySource === 'LOCAL') {
    if (!Array.isArray(form.service_items)) throw new Error('请维护本地类别服务项。')
    result.category_source = 'LOCAL'
    result.service_items = form.service_items.map((item, index) => {
      if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(item.category_id || '')) || !Number.isSafeInteger(item.category_version) || item.category_version < 1) {
        throw new Error(`请重新选择服务项 ${index + 1} 的有效本地类别。`)
      }
      const fields = ['source_id', 'name', 'service_type', 'site', 'batch', 'category', 'requirement', 'test_mode', 'systems', 'category_id', 'category_version']
      return Object.fromEntries(fields.filter(key => item[key] !== undefined).map(key => [key, item[key]]))
    })
  } else if (categorySource === 'PROJECT') result.category_source = 'PROJECT'
  return result
}
