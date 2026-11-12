/**
 * CRM 管理端展示模型：把服务端返回的阶段、状态和看板列转换为原型设计稿
 * 需要的展示结构（阶段漏斗、状态徽标、统计值）。这里只做纯计算，不发起请求，
 * 便于在 Node 单测中覆盖边界，模板中也不再堆叠易漂移的判断。
 */

export const CRM_OPPORTUNITY_STAGES = Object.freeze(['初步接触', '需求沟通', '方案制定', '报价', '投标', '已签约', '失败'])

const CUSTOMER_TONES = Object.freeze({ ACTIVE: 'crm-badge--success', VOID: 'crm-badge--danger', MERGED: 'crm-badge--purple' })
const OPPORTUNITY_STAGE_TONES = Object.freeze({
  初步接触: 'crm-badge--gray',
  需求沟通: 'crm-badge--info',
  方案制定: 'crm-badge--purple',
  报价: 'crm-badge--warning',
  投标: 'crm-badge--info',
  已签约: 'crm-badge--success',
  失败: 'crm-badge--danger',
})
const OPPORTUNITY_STATUS_TONES = Object.freeze({ FOLLOWING: 'crm-badge--info', CLOSED: 'crm-badge--gray', VOID: 'crm-badge--danger' })
const PRESALE_STATUS_TONES = Object.freeze({
  APPROVAL_STARTING: 'crm-badge--gray',
  PENDING_APPROVAL: 'crm-badge--warning',
  APPROVED_PENDING_ASSIGNMENT: 'crm-badge--info',
  PENDING_EXECUTION_ASSIGNMENT: 'crm-badge--info',
  EXECUTING: 'crm-badge--info',
  COMPLETED: 'crm-badge--success',
  REJECTED: 'crm-badge--danger',
  CANCELLED: 'crm-badge--gray',
})

/**
 * 把当前商机阶段展开为 7 段漏斗。没有匹配到已知阶段时整条漏斗按未开始展示，
 * 避免把脏数据误判成“已完成”。
 * @param {string} currentStage 服务端当前阶段
 * @returns {Array<{index:number,label:string,state:'done'|'current'|'pending',terminal:''|'win'|'lose'}>}
 */
export function opportunityStageSteps(currentStage) {
  const current = CRM_OPPORTUNITY_STAGES.indexOf(String(currentStage || ''))
  return CRM_OPPORTUNITY_STAGES.map((label, position) => ({
    index: position + 1,
    label,
    state: current < 0 ? 'pending' : position < current ? 'done' : position === current ? 'current' : 'pending',
    terminal: label === '已签约' ? 'win' : label === '失败' ? 'lose' : '',
  }))
}

export function customerStatusTone(status) {
  return CUSTOMER_TONES[String(status || '').toUpperCase()] || 'crm-badge--gray'
}

export function opportunityStageTone(stage) {
  return OPPORTUNITY_STAGE_TONES[String(stage || '')] || 'crm-badge--gray'
}

export function opportunityStatusTone(status) {
  return OPPORTUNITY_STATUS_TONES[String(status || '').toUpperCase()] || 'crm-badge--gray'
}

export function presaleStatusTone(status) {
  return PRESALE_STATUS_TONES[String(status || '').toUpperCase()] || 'crm-badge--gray'
}

/**
 * 售前看板各列带服务端计算的 total，卡片可能被 column_limit 截断；
 * 统计必须使用 total，不能回退成 items.length。
 * @param {Array<{status?:string,total?:number,items?:unknown[]}>} columns
 */
export function presaleBoardCounts(columns) {
  const totals = new Map()
  for (const column of Array.isArray(columns) ? columns : []) {
    const total = Number(column?.total)
    if (Number.isFinite(total) && total >= 0) totals.set(String(column?.status || ''), total)
  }
  const sum = (status) => totals.get(status) || 0
  return {
    total: [...totals.values()].reduce((result, value) => result + value, 0),
    pending: sum('PENDING_APPROVAL'),
    executing: sum('EXECUTING'),
    completed: sum('COMPLETED'),
    rejected: sum('REJECTED'),
    cancelled: sum('CANCELLED'),
  }
}

/**
 * 当前页工时合计。只接受有限的非负数值；服务端以十进制字符串返回工时，
 * 空值或异常值不计入，避免统计卡显示 NaN / Infinity。
 * @param {Array<{total_work_hours?:string|number|null}>} items
 */
export function presaleWorkHours(items) {
  let hours = 0
  for (const item of Array.isArray(items) ? items : []) {
    const raw = item?.total_work_hours
    if (raw === null || raw === undefined || String(raw).trim() === '') continue
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0) hours += value
  }
  return hours.toFixed(1)
}

/** 人员头像缩写：中文取首字，ASCII 取前两位，空值回退为“人”。 */
export function personInitial(name) {
  const value = String(name || '').trim()
  if (!value) return '人'
  if (/^[\x00-\x7F]+$/.test(value)) return value.slice(0, 2).toUpperCase()
  return Array.from(value)[0]
}
