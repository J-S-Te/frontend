import { paymentAmountMinor } from './paymentTerms.js'

export const externalContractTypes = ['直签', '三方']
export const contractSystemLevels = ['一级', '二级', '三级', '四级']

// 外部合同的权威正文从 DOCX 中提取。
// 共享草稿表单中的空 content 字段仅属于 JSON 草稿 API。
export function externalContractMetadata(payload) {
  const metadata = { ...payload }
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

// 浏览器反馈与 prepareContract/validServiceItems 保持一致。
// 这些检查用于改善输入反馈；所有边界仍由后端强制校验。
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
