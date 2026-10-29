// 结算表单反馈纯函数：字段定义、提交前校验与首个错误选择。
// 缺陷 DEF-01/02/03：三处表单原先只依赖原生 HTML5 required，浏览器气泡被 novalidate 关闭后
// 必须由应用层给出字段级中文提示。组件据此渲染 aria-invalid 红框与错误文案，并聚焦首个错误字段。
// 本模块不访问 DOM、不发请求，便于单测锁定字段顺序与文案；组件只做展示与聚焦。

// 用途：生成文本字段缺省必填文案。
// 参数：label 为字段中文名。
// 返回值：中文提示。
const requiredMessageOf = (label) => `请填写${label}。`

// 字段类型：text 仅必填；integer 为正整数；amount 为正数且最多两位小数；
// nonNegativeAmount 为 >=0 且最多两位小数（税额允许 0，服务端非负金额显式支持零税率/免税行）；
// rate 为 >=0 的税率（最多四位小数，0 表示零税率，服务端 decimal 允许 0）。
const KINDS = { INTEGER: 'integer', AMOUNT: 'amount', NONNEGATIVE_AMOUNT: 'nonNegativeAmount', RATE: 'rate' }

// 用途：冻结字段定义，避免运行期改写校验规则。
// 参数：items 为字段定义数组。
// 返回值：逐项冻结的字段定义数组。
const defineFields = (items) => Object.freeze(items.map((item) => Object.freeze(item)))

// 创建人工收款计划：合同、期次、收款日、金额、原因（DEF-01）。
export const PLAN_CREATE_FIELDS = defineFields([
  { key: 'contract_snapshot_id', label: '合同', requiredMessage: '请选择合同。' },
  { key: 'installment_no', label: '期次', kind: KINDS.INTEGER },
  { key: 'due_date', label: '收款日', requiredMessage: '请选择收款日。' },
  { key: 'planned_amount', label: '金额', kind: KINDS.AMOUNT },
  { key: 'reason', label: '原因' },
])

// 受控调整收款计划：计划、收款日、金额、原因（DEF-02）。
export const PLAN_ADJUST_FIELDS = defineFields([
  { key: 'id', label: '收款计划', requiredMessage: '请选择需要调整的收款计划。' },
  { key: 'due_date', label: '收款日', requiredMessage: '请选择收款日。' },
  { key: 'planned_amount', label: '金额', kind: KINDS.AMOUNT },
  { key: 'reason', label: '调整原因' },
])

// 开票申请：应收、购方税号、项目名称、税收分类编码、三个金额项与税率（DEF-03）。
export const INVOICE_REQUEST_FIELDS = defineFields([
  { key: 'receivable_id', label: '可开票应收', requiredMessage: '请选择可开票应收。' },
  { key: 'buyer_tax_no', label: '购方税号' },
  { key: 'item_name', label: '项目名称' },
  { key: 'tax_classification_code', label: '税收分类编码' },
  { key: 'amount_excl_tax', label: '不含税金额', kind: KINDS.AMOUNT },
  { key: 'tax_rate', label: '税率', kind: KINDS.RATE },
  { key: 'tax_amount', label: '税额', kind: KINDS.NONNEGATIVE_AMOUNT },
  { key: 'amount_incl_tax', label: '价税合计', kind: KINDS.AMOUNT },
])

// 用途：把输入值规范为去首尾空白的字符串，数字与 null 也按文本处理。
// 参数：value 为 v-model 绑定的原始值。
// 返回值：规范化字符串。
function normalizeValue(value) {
  return value === null || value === undefined ? '' : String(value).trim()
}

// 用途：判断文本是否为正整数。
// 参数：value 为原始输入。
// 返回值：是否为大于 0 的整数文本。
function isPositiveInteger(value) {
  const text = normalizeValue(value)
  return /^\d+$/.test(text) && Number(text) > 0
}

// 用途：判断文本是否为非负数且小数位不超过上限。
// 参数：value 为原始输入；maxFractionDigits 为允许的最大小数位数；positive 为是否要求 >0。
// 返回值：是否为合法数字文本。
function isNonNegativeNumber(value, maxFractionDigits, positive = false) {
  const text = normalizeValue(value)
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${maxFractionDigits}})?$`)
  return pattern.test(text) && (positive ? Number(text) > 0 : Number(text) >= 0)
}

// 用途：校验单个字段并返回中文错误文案。
// 参数：field 为字段定义；rawValue 为当前输入。
// 返回值：错误文案；通过时为空字符串。
export function validateField(field, rawValue) {
  const value = normalizeValue(rawValue)
  if (!value) return field.requiredMessage || requiredMessageOf(field.label)
  if (field.kind === KINDS.INTEGER && !isPositiveInteger(value)) {
    return field.formatMessage || `${field.label}必须是大于 0 的整数。`
  }
  if (field.kind === KINDS.AMOUNT && !isNonNegativeNumber(value, 2, true)) {
    return field.formatMessage || `${field.label}必须大于 0，且最多保留两位小数。`
  }
  if (field.kind === KINDS.NONNEGATIVE_AMOUNT && !isNonNegativeNumber(value, 2)) {
    return field.formatMessage || `${field.label}必须大于等于 0，且最多保留两位小数。`
  }
  if (field.kind === KINDS.RATE && !isNonNegativeNumber(value, 4)) {
    return field.formatMessage || `${field.label}必须是大于等于 0 的数字，例如 0.06 或 0。`
  }
  return ''
}

// 用途：按字段声明顺序校验整张表单，生成组件展示所需的字段错误映射。
// 参数：fields 为字段定义数组；values 为表单值对象。
// 返回值：字段键到中文错误文案的映射；全部通过时为空对象。
export function validateForm(fields, values) {
  const source = values && typeof values === 'object' ? values : {}
  const errors = {}
  for (const field of fields) {
    const message = validateField(field, source[field.key])
    if (message) errors[field.key] = message
  }
  return errors
}

// 用途：按声明顺序选择第一个错误字段；组件的 DOM 顺序与声明顺序一致，聚焦即可命中该字段。
// 参数：fields 为字段定义数组；errors 为字段错误映射。
// 返回值：首个错误字段定义；没有错误时返回 null。
export function firstInvalidField(fields, errors) {
  if (!errors || typeof errors !== 'object') return null
  return fields.find((field) => Boolean(errors[field.key])) || null
}

// 用途：用户修正字段后只保留仍失败的旧错误，避免已修正字段继续显示红框，也不提前展示尚未提交过的字段错误。
// 参数：fields 为字段定义数组；values 为当前表单值；errors 为当前显示的错误映射。
// 返回值：仅包含旧错误字段中仍校验失败的映射。
export function retainVisibleErrors(fields, values, errors) {
  const previous = errors && typeof errors === 'object' ? errors : {}
  const keys = Object.keys(previous)
  if (!keys.length) return {}
  const revalidated = validateForm(fields, values)
  const retained = {}
  for (const key of keys) if (revalidated[key]) retained[key] = revalidated[key]
  return retained
}
