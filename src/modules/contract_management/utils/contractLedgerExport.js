// 台账导出口径：与 GET /contracts 的服务端分页一致，每页 200 条（后端 page_size 上限），
// 硬上限 10 000 行（200 条 × 50 页）。超过上限时导出已读取的部分并明确告知用户，
// 不允许再把“当前页 20 条”当成整份台账，也不允许静默截断。
export const CONTRACT_LEDGER_EXPORT_PAGE_SIZE = 200
export const CONTRACT_LEDGER_EXPORT_LIMIT = 10000

/**
 * collectContractLedgerExport 按当前筛选逐页读取台账，直到服务端 total 收齐或触达行数上限。
 * 参数：fetchPage 为分页读取函数（GET /contracts?page&page_size&keyword&status&type），
 *   options.filters 为当前 keyword/status/type，options.pageSize/limit 控制批次与硬上限，
 *   options.onProgress 每读取一页回调一次（用于进度提示），options.isCancelled 用于页面卸载后停止。
 * 返回值：{ items, total, truncated }；truncated 为 true 表示撞到硬上限、只导出了已读取部分。
 * 失败时不吞错：由调用方提示用户，不允许把半份数据当作完整导出。
 */
export async function collectContractLedgerExport(fetchPage, {
  filters = {},
  pageSize = CONTRACT_LEDGER_EXPORT_PAGE_SIZE,
  limit = CONTRACT_LEDGER_EXPORT_LIMIT,
  onProgress = () => {},
  isCancelled = () => false,
} = {}) {
  const items = []
  let page = 1
  let reportedTotal = 0
  while (!isCancelled() && items.length < limit) {
    // 每次只请求剩余额度内的条数，撞到上限时不会多取一整页。
    const requestSize = Math.min(pageSize, limit - items.length)
    const envelope = await fetchPage({ ...filters, page, page_size: requestSize })
    // 兼容分页信封 { items, total } 与滚动发布期间的裸数组：缺 total 时以“本批是否取满”判断是否还有下一页。
    const batch = Array.isArray(envelope) ? envelope : (Array.isArray(envelope?.items) ? envelope.items : [])
    const total = Number(envelope?.total)
    if (Number.isFinite(total) && total >= 0) reportedTotal = total
    for (const item of batch) {
      if (items.length >= limit) break
      items.push(item)
    }
    onProgress({ fetched: items.length, total: reportedTotal })
    const reachedTotal = reportedTotal > 0 ? items.length >= reportedTotal : batch.length < requestSize
    if (batch.length === 0 || reachedTotal) break
    page += 1
  }
  // 撞到上限且服务端还有更多行，或 total 不可用但已取满上限时，都必须明确告知“只导出了前 N 条”。
  const truncated = items.length >= limit && (reportedTotal > items.length || reportedTotal === 0)
  return { items, total: Math.max(reportedTotal, items.length), truncated }
}
