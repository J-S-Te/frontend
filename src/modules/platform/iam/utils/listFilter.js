// 面板关键字过滤（自 IamSettingsModule 提取的纯函数，行为逐字一致）。
export function includesFilter(items, filter, fields) {
  const keyword = String(filter || '').trim().toLowerCase()
  if (!keyword) return items
  return items.filter((item) => fields
    .map((field) => {
      const value = field.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), item)
      return Array.isArray(value) ? value.join(' ') : value
    })
    .join(' ')
    .toLowerCase()
    .includes(keyword))
}
