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
    return { ...system, application: application?.kind ? application : null, state: STATUS_NAMES[application?.status] || '状态未知', effectiveAt: Math.max(status?.current?.not_before || 0, application?.not_before || 0) }
  })
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
export function formatLicenseTime(seconds) {
  if (!seconds) return '—'
  return new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false })
}
