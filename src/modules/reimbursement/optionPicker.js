// 业务对象选择器共用逻辑：只把接口声明过的关键词与分页发出去，
// 并把响应归一成可渲染的一页；提交仍使用原有内部引用，不改变后端契约。

// 用途：构造选项接口查询串，关键词为空时不发送空搜索条件。
// 参数：path 为固定选项接口（如 /organization-options），params 为业务条件。
// 返回值：带 keyword、page、page_size 及可选 purpose 的请求路径。
export function optionQuery(path, { keyword = '', page = 1, pageSize = 20, purpose = '' } = {}) {
  const query = new URLSearchParams()
  const text = String(keyword ?? '').trim().slice(0, 100)
  const pageNumber = Math.max(1, Math.trunc(Number(page)) || 1)
  const size = Math.min(50, Math.max(1, Math.trunc(Number(pageSize)) || 20))
  if (text) query.set('keyword', text)
  query.set('page', String(pageNumber))
  query.set('page_size', String(size))
  if (purpose) query.set('purpose', purpose)
  return `${path}?${query.toString()}`
}

// 用途：读取选项行的内部引用，保留原值用于提交。
// 参数：option 为接口选项，valueKey 为承载内部引用的字段（id / file_id）。
// 返回值：字符串内部引用；缺失时为空串。
export function optionValue(option, valueKey = 'id') {
  return String(option?.[valueKey] ?? '').trim()
}

// 用途：把选项响应归一成一页可渲染数据，响应不完整时明确失败。
// 参数：payload 为接口 data，fallback 提供缺省页码与页大小。
// 返回值：items、total、page、pageSize；缺少 items 时抛出可展示原因。
export function normalizeOptionPage(payload, fallback = {}) {
  if (!payload || !Array.isArray(payload.items)) throw new Error('选项接口响应不完整，请重试')
  const rows = payload.items.filter((row) => row && typeof row === 'object')
  const total = Number(payload.total)
  return {
    items: rows,
    total: Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : rows.length,
    page: Math.max(1, Math.trunc(Number(payload.page)) || fallback.page || 1),
    pageSize: Math.max(1, Math.trunc(Number(payload.page_size)) || fallback.pageSize || 20),
  }
}

// 用途：把下一页追加到已加载结果，按内部引用去重，避免"加载更多"出现重复行。
// 参数：current 为已加载选项，incoming 为新一页，valueKey 为内部引用字段。
// 返回值：保持原有顺序的去重选项列表。
export function mergeOptionPage(current, incoming, valueKey = 'id') {
  const seen = new Set()
  const result = []
  for (const option of [...(current || []), ...(incoming || [])]) {
    const value = optionValue(option, valueKey)
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(option)
  }
  return result
}

// 用途：判断是否还有未加载的选项页，只依据服务端总数。
// 参数：items 为已加载选项，total 为服务端总数。
// 返回值：仍有下一页时为 true。
export function hasMoreOptions(items, total) {
  const size = Array.isArray(items) ? items.length : 0
  return Number(total) > size
}

// 用途：给出明确的空结果文案，区分"没有匹配"和"当前没有可选对象"。
// 参数：label 为业务对象名称（如 费用组织、证据文件），keyword 为用户输入。
// 返回值：一句可直接展示的中文说明。
export function optionEmptyText(label, keyword) {
  const name = String(label || '选项').trim()
  const text = String(keyword ?? '').trim()
  return text ? `没有找到与“${text}”匹配的${name}，请换关键词再试` : `当前没有可选的${name}`
}
