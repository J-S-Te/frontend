import { formatMinor, toMinor } from './api/client.js'
import { contentMappingForm, contentMappingInput } from './invoiceClassification.js'

const organizations = { key: 'org_id', label: '费用组织', type: 'organization', required: true }
const subject = { key: 'subject_id', label: '人员姓名', type: 'person', required: true }
const period = [{ key: 'valid_from', label: '生效日期', type: 'date', required: true },
  { key: 'valid_until', label: '截止日期（留空持续有效）', type: 'date' }]
const roles = ['ACCOUNTANT', 'FINANCE_DIRECTOR', 'PROJECT_EXPENSE_OWNER',
  'TECHNICAL_DIRECTOR', 'SALES_DIRECTOR', 'BUSINESS_REVIEW']
const fields = {
  standards: [
    { key: 'fee_type', label: '费用类型编码', required: true }, organizations,
    { key: 'city_level', label: '城市等级' },
    { key: 'transport_category', label: '交通分类编码（如TRAIN/AIR，空仅匹配旧空分类）' },
    { key: 'accommodation_category', label: '住宿分类编码' }, { key: 'grade', label: '费用职级', required: true },
    { key: 'unit', label: '标准计量单位', type: 'select', required: true,
      options: ['PER_NIGHT', 'PER_PERSON_DAY', 'PER_OCCURRENCE', 'PER_KM'] },
    { key: 'limit_minor', label: '单位标准上限（元）', type: 'money', required: true },
    ...period, { key: 'priority', label: '匹配优先级', type: 'number' },
    { key:'allow_prepayment',label:'允许附独立证明的预付费用（仍须财务重点复核）',type:'boolean' },
    { key: 'allow_no_invoice', label: '允许政策内无票申请', type: 'boolean' },
    { key: 'require_no_invoice_proof', label: '无票必须提供独立证明', type: 'boolean' },
    { key: 'no_invoice_proof_types', label: '允许证明类型（PAYMENT_PROOF/SERVICE_CONFIRMATION/OTHER，逗号分隔）', type: 'list' },
    { key: 'requires_travel_facts', label: '此标准要求差旅事实核对', type: 'boolean' },
  ],
  city_mappings: [organizations, { key: 'source_city', label: '权威目的地原文（精确匹配）', required: true },
    { key: 'city_code', label: '城市', type: 'city', required: true },
    { key: 'city_level', label: '城市等级编码', required: true }, ...period,
    { key: 'active', label: '启用人工城市映射', type: 'boolean' }],
  archive_retention_policies: [organizations,
    { key: 'retention_months', label: '组织明确保留月数', type: 'number', required: true },
    { key: 'start_basis', label: '起算规则', type: 'select', required: true, options: ['SUBMISSION_DATE'] },
    { key: 'hold', label: '暂停到期处置（HOLD）', type: 'boolean' },
    { key: 'basis', label: '组织批准制度依据', required: true }, ...period],
  historical_tail_policies: [organizations,
    { key: 'project_id', label: '适用历史尾款项目', type: 'project', required: true },
    { key: 'expense_cutoff', label: '费用发生截止日', type: 'date', required: true },
    { key: 'valid_from', label: '政策生效日期', type: 'date', required: true },
    { key: 'valid_until', label: '政策截止日期', type: 'date', required: true },
    { key: 'enabled', label: '明确启用历史尾款政策（默认关闭）', type: 'boolean' }],
  route_rules: [organizations,
    { key: 'route_type', label: '业务线路', type: 'select', required: true, options: ['TECHNICAL', 'SALES'] },
    ...period,
    { key:'extra_threshold_basis_points',label:'逐项超额比例升级阈值（基点；100=1%，0关闭；两项均0为任意超标升级）',type:'number' },
    { key:'extra_threshold_minor',label:'逐项超额金额升级阈值（元；0关闭，任一阈值严格超过即升级）',type:'money',default:'0' },
  ],
  assignments: [organizations, { key: 'project_id', label: '适用项目（项目经理替代必选）', type: 'project' },
    { key: 'role', label: '财务岗位或受控替代用途', type: 'select', required: true, options: roles }, subject, ...period],
  finance_entities: [{ key: 'name', label: '付款主体名称', required: true },
    { key: 'tax_id', label: '购买方税号', required: true },
    { key: 'org_ids', label: '适用组织', type: 'organizations', required: true },
    { key: 'active', label: '启用主体', type: 'boolean' }],
  payment_accounts: [{ key: 'name', label: '付款账户名称', required: true },
    { key: 'finance_entity_id', label: '所属付款主体', type: 'finance-entity', required: true },
    { key: 'account_ref', label: '外部受控付款引用（请勿填写银行账号原文）', required: true },
    { key: 'active', label: '启用付款账户', type: 'boolean' }],
  payee_profiles: [subject, { key: 'account_ref', label: '外部受控收款引用（请勿填写银行账号原文）', required: true },
    { key: 'active', label: '启用收款档案', type: 'boolean' },
    { key: 'reviewed', label: '已按制度核对收款档案', type: 'boolean' }],
  scopes: [subject, { key: 'org_ids', label: '允许的组织', type: 'organizations' },
    { key: 'tenant_all', label: '显式授予租户全部财务数据范围', type: 'boolean' }],
  employee_profiles: [subject, organizations, { key: 'grade', label: '费用职级', required: true },
    { key: 'route_type', label: '业务线路', type: 'select', required: true, options: ['TECHNICAL', 'SALES'] },
    { key: 'active', label: '启用费用档案', type: 'boolean' }],
  invoice_rules: [{ key: 'content_mappings', label: '按票面内容归类规则', type: 'content-mappings' }, { key: 'invoice_type', label: '票种编码', required: true },
    { key:'fee_type',label:'默认费用类型编码（用于确认票据的草稿建议）' },
    { key:'default_claim_type',label:'默认报销类型',type:'select',options:['','TRAVEL','DAILY','PROJECT_EXECUTION'] },
    { key:'deduction_priority',label:'抵扣资料人工复核顺序（不代表税务可抵扣）',type:'select',options:['','NORMAL','PRIORITY_REVIEW'] },
    { key:'max_invoice_age_days',label:'发票有效天数（0为不启用，最多3650）',type:'number' },
    { key:'date_policy',label:'发票超期处理',type:'select',options:['BLOCK','WARN'] },
    { key: 'identity_fields', label: '身份字段（逗号分隔，须包含invoice_number）', type: 'list', required: true },
    { key: 'required_buyer_tax_id', label: '要求核对购买方税号', type: 'boolean' },
    { key: 'required_external_verification', label: '提交前要求外部查验通过', type: 'boolean' },
    { key: 'active', label: '启用票种规则', type: 'boolean' }],
}

// 用途：返回明确配置种类的业务字段，不接受任意配置对象。
// 参数：kind 为后端支持的配置种类。
// 返回值：字段定义数组；未知种类返回空数组。
export function policyFields(kind) { return fields[kind] || [] }

// 用途：将服务端版本转换为适合业务表单的元金额、列表与开关。
// 参数：kind 为配置种类，value 为当前版本或空对象。
// 返回值：仅包含业务可编辑字段的表单对象。
export function policyFormFrom(kind, value = {}) {
  return Object.fromEntries(policyFields(kind).map((field) => {
    let current = value[field.key]
    if (field.type === 'content-mappings') current = contentMappingForm(current)
    else if (field.type === 'organizations') current = Array.isArray(current) ? [...current] : []
    else if (field.type === 'boolean') current = current === true
    else if (field.type === 'list') current = Array.isArray(current) ? current.join(',') : ''
    else if (field.type === 'money') current = current === undefined ? field.default ?? '' : formatMinor(current)
    else current = current ?? (field.type === 'number' ? 0 : '')
    return [field.key, current]
  }))
}

// 用途：从业务字段构造精确DTO并执行必要输入检查。
// 参数：kind 为种类，form 为编辑字段。
// 返回值：配置业务字段；必填、金额或整数不合法时抛错。
export function policyPayload(kind, form) {
  const payload = Object.fromEntries(policyFields(kind).map((field) => {
    let value = form[field.key] ?? field.default
    if (field.required && (value === undefined || String(value).trim() === '')) {
      throw new Error(`请填写${field.label}`)
    }
    if (field.type === 'content-mappings') value = contentMappingInput(value)
    else if (field.type === 'money') value = toMinor(String(value))
    else if (field.type === 'list' || field.type === 'organizations') {
      const values = Array.isArray(value) ? value : String(value || '').split(',')
      value = [...new Set(values.map((part) => String(part).trim()).filter(Boolean))]
    }
    else if (field.type === 'boolean') value = value === true
    else if (field.type === 'number') {
      value = Number(value || 0)
      if (!Number.isSafeInteger(value)) throw new Error(`${field.label}必须为整数`)
    } else value = String(value || '').trim()
    return [field.key, value]
  }))
  if (kind === 'scopes' && !payload.tenant_all && !payload.org_ids.length) {
    throw new Error('请明确填写普通财务范围的组织列表；全租户范围必须显式授权')
  }
  if (kind === 'route_rules') {
    if (!['TECHNICAL', 'SALES'].includes(payload.route_type)) throw new Error('请选择有效业务线路')
    payload.base_role = payload.route_type === 'TECHNICAL' ? 'PROJECT_EXPENSE_OWNER' : 'SALES_DIRECTOR'
    payload.extra_role = payload.route_type === 'TECHNICAL' ? 'TECHNICAL_DIRECTOR' : 'FINANCE_DIRECTOR'
    payload.accounting_role = 'ACCOUNTANT'
  }
  if (kind === 'assignments') {
    if (!roles.includes(payload.role)) throw new Error('请选择明确的财务岗位或受控替代用途')
    if (payload.role === 'PROJECT_EXPENSE_OWNER' && !payload.project_id) throw new Error('项目经理受控替代必须选择项目')
  }
  return payload
}
