const sectionPermissions = {
  dashboard: ['settlement.report.read'],
  receivables: ['settlement.receivable.read'],
  invoices: ['settlement.invoice.read'],
  receipts: ['settlement.receipt.read', 'settlement.receipt.record'],
  allocations: ['settlement.allocation.read', 'settlement.allocation.confirm', 'settlement.allocation.reverse'],
  dunning: ['settlement.dunning.read', 'settlement.dunning.manage'],
  tasks: ['settlement.receivable.confirm', 'settlement.invoice.approve',
    'settlement.invoice.special_approve', 'settlement.dunning.feedback'],
  collaboration: ['settlement.collaboration.read', 'settlement.collaboration.manage'],
  finance: ['settlement.difference.manage', 'settlement.voucher.manage'],
  settings: ['settlement.settings.manage'],
  imports: ['settlement.import.reconcile'],
}
const loaderPermissions = {
  getDashboard: ['settlement.report.read'], getAgingSummary: ['settlement.report.read'],
  getInvoicedReceivablesTop10: ['settlement.report.read'],
  listReceivablePlans: ['settlement.receivable.read'], listReceivables: ['settlement.receivable.read'],
  listReceipts: ['settlement.receipt.read', 'settlement.receipt.record'],
  listReceiptAllocations: ['settlement.allocation.read', 'settlement.allocation.confirm', 'settlement.allocation.reverse'],
  listInvoiceRequests: ['settlement.invoice.read'], listTaxInvoices: ['settlement.invoice.read'],
  listInvoiceEligibleReceivables: ['settlement.invoice.request'],
  listDunningCases: ['settlement.dunning.read', 'settlement.dunning.manage'],
  listDunningActions: ['settlement.dunning.read', 'settlement.dunning.manage'],
  listDunningPolicies: ['settlement.dunning.manage'], listDunningRecipients: ['settlement.dunning.manage'],
  getDunningOverview: ['settlement.dunning.manage'], getDunningCoverage: ['settlement.dunning.manage'],
}
// 用途：建立当前会话的精确能力判断，缺失权限时失败关闭。
// 参数：session 为服务端确认的当前会话。
// 返回值：权限判断函数；不根据角色名推断额外能力。
export function permissionCheck(session) {
  const permissions = new Set(Array.isArray(session?.permissions) ? session.permissions : [])
  return (permission) => permissions.has('settlement.admin') || permissions.has(permission)
}
// 用途：生成当前会话允许进入的页面，顺序同时决定默认入口。
// 参数：session 为服务端会话。
// 返回值：允许访问的页面代码数组；无能力时为空。
export function allowedSections(session) {
  const can = permissionCheck(session)
  return Object.keys(sectionPermissions).filter((section) => sectionPermissions[section].some(can))
}
// 用途：过滤当前页面的业务读取接口，避免汇总能力扩大明细请求。
// 参数：name 为接口函数名；can 为精确权限判断函数。
// 返回值：接口是否允许加载；未知接口默认拒绝。
export function canLoad(name, can) {
  return (loaderPermissions[name] || []).some(can)
}
