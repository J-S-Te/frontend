export const PORTAL_PAGE_SIZE = 9

export function portalGridForCount(value) {
  const count = Math.max(0, Math.min(PORTAL_PAGE_SIZE, Number(value) || 0))
  if (count <= 1) return { columns: 1, rows: 1, density: 'spacious' }
  if (count === 2) return { columns: 2, rows: 1, density: 'spacious' }
  if (count === 3) return { columns: 3, rows: 1, density: 'spacious' }
  if (count === 4) return { columns: 2, rows: 2, density: 'standard' }
  if (count <= 6) return { columns: 3, rows: 2, density: 'standard' }
  if (count <= 8) return { columns: 4, rows: 2, density: 'compact' }
  return { columns: 3, rows: 3, density: 'compact' }
}

export function portalPageCount(total) {
  return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / PORTAL_PAGE_SIZE))
}

export function portalPageItems(items, page) {
  const list = Array.isArray(items) ? items : []
  const safePage = Math.min(Math.max(1, Number(page) || 1), portalPageCount(list.length))
  const start = (safePage - 1) * PORTAL_PAGE_SIZE
  return list.slice(start, start + PORTAL_PAGE_SIZE)
}
