export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·\-_/，,。.；;：:（）()]+/g, '')
}

// 除连续包含外也支持按字符顺序命中，例如“xm”可命中“项目经理”。
export function fuzzyIncludes(text, keyword) {
  const source = normalizeSearchText(text)
  const query = normalizeSearchText(keyword)
  if (!query) return true
  if (source.includes(query)) return true
  let cursor = 0
  for (const character of source) {
    if (character === query[cursor]) cursor += 1
    if (cursor === query.length) return true
  }
  return false
}

function searchableText(option) {
  if (option === null || option === undefined) return ''
  if (typeof option !== 'object') return String(option)
  return Object.values(option)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => ['string', 'number', 'boolean'].includes(typeof value))
    .join(' ')
}

export function filterSearchableOptions(options, keyword) {
  const rows = Array.isArray(options) ? options : []
  const query = normalizeSearchText(keyword)
  if (!query) return rows
  return rows.filter((option) => fuzzyIncludes(searchableText(option), query))
}
