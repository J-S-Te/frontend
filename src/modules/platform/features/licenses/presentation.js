import { formatBusinessDateTime } from '../../../shared/utils/businessTime.js'

export const LICENSE_SYSTEMS = [
  { code: 'customer_and_opportunity', name: '客户与商机' },
  { code: 'customer_portal', name: '客户门户' },
  { code: 'contract_management', name: '合同管理' },
  { code: 'project_management', name: '项目管理' },
  { code: 'settlement', name: '结算管理' },
  { code: 'data_analysis', name: '数据分析' },
]
export const systemName = code => LICENSE_SYSTEMS.find(item => item.code === code)?.name || code
const STATUS_NAMES = { NO_LICENSE: '未导入许可证', NOT_PURCHASED: '未购买', VALID: '有效', NOT_EFFECTIVE: '尚未生效', EXPIRED: '已到期', CLOCK_ABNORMAL: '时钟异常', VALIDATION_ERROR: '校验异常' }
export function statusRows(status) {
  return LICENSE_SYSTEMS.map(system => {
    const application = status?.systems?.find(item => item.code === system.code)
    return {
      ...system,
      application: application?.kind ? application : null,
      state: STATUS_NAMES[application?.status] || '状态未知',
      status: application?.status || 'NOT_PURCHASED',
      effectiveAt: Math.max(status?.current?.not_before || 0, application?.not_before || 0),
      // 聚合执行事实与原因码原样透传：undefined = 旧后端没这个字段（页面回退逐应用概览），
      // null = 服务端明确没有聚合（只能显示状态未知），两者不能混为一谈。
      enforcement: application?.enforcement,
      reasonCode: typeof application?.reason_code === 'string' ? application.reason_code : '',
    }
  })
}
// 当前授权面板只展示许可证覆盖的系统；未购买的系统不渲染，避免整屏"未购买"噪音。
export const licensedOnly = rows => rows.filter(row => row.application)
// 到期展示：剩余天数与色调（正常/临近/已过期），供徽标与卡片着色。
export function expiryMeta(expiresAt, now = Date.now() / 1000) {
  if (!expiresAt) return { days: null, tone: 'none', label: '—' }
  const days = Math.floor((expiresAt - now) / 86400)
  const tone = days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok'
  const label = days < 0 ? `已过期 ${-days} 天` : `剩余 ${days} 天`
  return { days, tone, label }
}
export function licenseRows(license, now = Date.now() / 1000) {
  return LICENSE_SYSTEMS.map(system => {
    const application = license?.applications?.find(item => item.code === system.code)
    const effectiveAt = Math.max(license?.not_before || 0, application?.not_before || 0)
    const state = !application ? '未购买' : now < effectiveAt ? '尚未生效' : now >= application.expires_at ? '已到期' : '有效'
    return { ...system, application, state, effectiveAt }
  })
}
export function riskyChange(change) {
  return change.kind === 'REMOVED' || Boolean(change.old && change.new && (change.new.expires_at < change.old.expires_at || change.new.not_before > change.old.not_before || (change.old.kind === 'FULL' && change.new.kind === 'TRIAL')))
}
export function previewCanCommit(preview, confirmChanges, confirmReplacement) {
  if (!preview) return false
  return (!(preview.requires_change_confirmation || preview.changes?.some(riskyChange)) || confirmChanges) && (!preview.requires_pending_replacement || confirmReplacement)
}
const LICENSE_EVENT_NAMES = {
  INITIALIZED: '部署实例已初始化',
  IMPORTED_CURRENT: '当前许可证已导入',
  IMPORTED_PENDING: '待生效许可证已导入',
  ACTIVATED: '待生效许可证已启用',
  CLOCK_RECOVERED: '授权时钟已恢复',
  RUNTIME_SERVICE_REGISTERED: '运行时服务已登记',
  RUNTIME_COMPONENTS_RECONCILED: '运行时组件已更新',
  INSTALLATION_BASELINE_FROZEN: '安装基线已冻结',
  MIGRATION_INVENTORY_FROZEN: '迁移清单已冻结',
  ENFORCEMENT_APPLYING: '正在应用授权限制',
  ENFORCEMENT_ENFORCED: '授权限制已启用',
}
export const licenseEventName = kind => LICENSE_EVENT_NAMES[kind] || kind || '未知事件'

// 授权事件的 created_at 是 Go 的 RFC3339 字符串。<time datetime> 需要机器可读原值，
// 展示仍走 formatLicenseTime 的北京时间；零值 / 本地时间 / 非字符串一律不给 datetime，
// 宁可不写属性，也不输出一个看起来合法其实错 8 小时的时间。
export function licenseEventTimestamp(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (value.startsWith('0001-')) return ''
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? text : ''
}

// digest 只在核对时用：保留前 12 / 后 6，中间显式省略号，避免长串把行撑破或读丢首尾。
// 完整值仍在 DOM 的 title 与复制按钮里，截断只影响可见文本。
export function shortenDigest(value, head = 12, tail = 6) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  if (text.length <= head + tail + 1) return text
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

// 许可证有效期使用 Unix 秒时间戳；事件 created_at 使用 Go 的 RFC3339 时间戳。
// 展示口径统一走共享业务时间（北京时间 UTC+8），与审计日志页同一入口，避免同屏两个页签差 8 小时。
export function formatLicenseTime(value) {
  if (value == null || value === '' || value === 0 || typeof value === 'boolean') return '—'
  let date
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return '—'
    date = new Date(numeric >= 1e12 ? numeric : numeric * 1000)
  } else if (typeof value === 'string') {
    // 拒绝无时区或 Go 零值时间戳，不猜测本地时间。
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || value.startsWith('0001-')) return '—'
    date = new Date(value)
  } else return '—'
  if (!Number.isFinite(date.getTime())) return '—'
  // 事件与有效期都要秒级精度：共享入口的 seconds 选项保持改动前的展示粒度，
  // 时区口径由该模块固定为北京时间，不再依赖调用方浏览器时区。
  return formatBusinessDateTime(date, { seconds: true }) || '—'
}
