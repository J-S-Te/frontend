const DEFAULT_PAGE_SIZE = 100
const MAX_PAGES = 1000

function pageItems(result) {
  return Array.isArray(result?.items) ? result.items : []
}

// 逐页读取有界目录，以服务端 total 为权威；空页和硬性页数上限共同防止异常响应造成无限循环。
export async function loadAllCatalogPages(listPage, options = {}, itemKey = null) {
  const pageSize = Math.max(1, Number(options.pageSize || DEFAULT_PAGE_SIZE))
  const query = { ...options, pageSize }
  delete query.page

  const collected = []
  const seen = new Set()
  let page = 1
  let total = Number.POSITIVE_INFINITY
  let fetchedCount = 0

  while (page <= MAX_PAGES && fetchedCount < total) {
    const result = await listPage({ ...query, page })
    const items = pageItems(result)
    total = Math.max(0, Number(result?.total ?? items.length))
    fetchedCount += items.length

    for (const item of items) {
      const key = typeof itemKey === 'function' ? String(itemKey(item) || '') : ''
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      collected.push(item)
    }

    if (items.length === 0 || fetchedCount >= total) break
    page += 1
  }

  return collected
}
