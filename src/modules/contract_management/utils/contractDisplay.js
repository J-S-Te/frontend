// 合同页面的展示层纯函数与常量：由 ContractManagementView.vue 批次 3 第一步逐字迁移，
// 行为契约由 contractDisplay.test.mjs 固化；页面通过 import 继续以原绑定名使用。
import { contractRole } from '../../shared/authz/sys004.js'

// 合同类型、服务类型与系统等级由业务字典治理（平台控制台“字典管理”维护显示名与排序），
// 字典取值即业务存储字符串；平台会话过期或字典未配置时回退内置清单，表单不中断。
export const fallbackContractTypeOptions = ['直签', '三方']

export const fallbackServiceTypeOptions = ['等保测评', '商用密码应用安全性评估', '软件测试', '源代码审计', '渗透测试', '漏洞扫描', 'APP安全加固', '上线测试', '安全加固', '网络安全风险评估', '差距分析', '机房检测', '网络安全巡检服务', '安全培训', '安全性测试', '应急响应服务', '网络安全攻防演练', '安全运维', '模块开发', '技术咨询']

export const fallbackSystemLevelOptions = ['一级', '二级', '三级', '四级']

export const toDictionaryFallback = (values) => values.map((value) => ({ value, label: value }))

export const ruleFieldOptions = [
  { value: 'amount_minor', label: '合同金额（元）', kind: 'number' },
  { value: 'service_type', label: '服务类型', kind: 'text' },
  { value: 'customer_credit_level', label: '客户信用等级', kind: 'text' },
  { value: 'contract_type', label: '合同类型', kind: 'text' },
  { value: 'terms_identical', label: '条款一致', kind: 'boolean' },
]

export const numericOperators = [
  { value: 'eq', label: '等于' }, { value: 'ne', label: '不等于' },
  { value: 'gt', label: '大于' }, { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' }, { value: 'lte', label: '小于等于' },
]

export const textOperators = [
  { value: 'eq', label: '等于' }, { value: 'ne', label: '不等于' }, { value: 'in', label: '包含于（逗号分隔）' },
]

export function emptyRuleForm() {
  return {
    name: '',
    priority: 0,
    enabled: true,
    logical: 'and',
    conditions: [{ field: 'amount_minor', operator: 'lte', value: '' }],
    expressionReadonly: false,
    originalExpression: null,
    nodes: [{ id: 'sales-director', name: '销售总监审批', role_code: 'sales_director', countersign: 'any' }],
    version: 0,
  }
}

export function roleLabel(roleCode) {
  if (!roleCode) return '未分配角色'
  return contractRole(roleCode)?.name || '未识别角色'
}

export function groupCurrencyTotals(items) {
  const grouped = new Map()
  for (const item of items || []) {
    const currency = /^[A-Z]{3}$/.test(item?.currency || '') ? item.currency : 'CNY'
    const current = grouped.get(currency) || { currency, amountMinor: 0, contracts: 0 }
    current.amountMinor += Number(item?.amount_minor || 0)
    current.contracts += 1
    grouped.set(currency, current)
  }
  return [...grouped.values()].sort((left, right) => left.currency.localeCompare(right.currency))
}

export const statusLabels = {
  draft: '草稿',
  pending: '审批中',
  approved: '已批准',
  active: '已生效',
  in_progress: '履约中',
  pending_pay: '待付款',
  completed: '已完成',
  terminated: '已终止',
  archived: '已归档',
}

export const approvalStatusLabels = {
  running: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
  expired: '已过期',
  failed: '已失败',
}

export const approvalNodeStatusLabels = {
  pending: '待处理',
  active: '处理中',
  approved: '已通过',
  rejected: '已驳回',
  skipped: '已跳过',
}

export const approvalKindLabels = {
  contract_approval: '合同提交审批',
  status_change: '合同状态变更',
}

export const approvalActionLabels = {
  approve: '同意',
  reject: '驳回',
  add_sign: '加签',
  transfer: '转交',
  return: '退回',
  withdraw: '撤回',
  urge: '催办',
  comment: '发表评论',
}

export function approvalStatusLabel(status) {
  return approvalStatusLabels[status] || approvalNodeStatusLabels[status] || status || '—'
}

export function approvalKindLabel(kind) {
  return approvalKindLabels[kind] || '合同审批'
}

export function approvalNotificationTitle(approval) {
  return `${approval.type || '合同审批'}已流转至${approval.step || '当前节点'}`
}

export const emptyServiceItem = () => ({ service_type: '', name: '', site: '', batch: '第一批次', category: '', requirement: '', test_mode: 'STANDARD', systems: [] })

export const emptyNewContract = () => ({
  opportunity_id: '', opportunity_name: '', customer_id: '', title: '', contract_type: '', amount: '', currency: 'CNY',
  customer_name: '', customer_address: '', customer_contact: '', customer_phone: '',
  start_date: '', end_date: '',
  payment_terms: [],
  service_items: [emptyServiceItem()], template_id: '', template_values: {},
})
