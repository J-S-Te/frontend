// 资质/能力编码的业务类别：只用于分类标签着色，与状态五档（statusCatalog）互不相干。
// 类别由编码文本推导；后端一旦下发 category 字段，应优先使用字段值。
export const CAPABILITY_CODE_CATEGORIES = Object.freeze(['credential', 'testing', 'system', 'other'])

const RULES = [
  ['credential', ['测评师', '工程师', '密评', '等级保护', 'CISP', 'CISAW']],
  ['testing', ['扫描', '检测', '审计', '漏洞', '渗透测试', 'WEB', 'APP']],
  ['system', ['ISO', 'CMMI', 'ITSS', 'CCRC', '体系', '认证']],
]

// capabilityCodeCategory 把编码归入四类之一，未知一律 other，不猜语义。
// 参数：code 为编码文本（大小写不敏感），category 为后端下发的类别（可缺省）。
// 返回值：CAPABILITY_CODE_CATEGORIES 之一。
export function capabilityCodeCategory(code, category) {
  const declared = String(category ?? '').trim().toLowerCase()
  if (CAPABILITY_CODE_CATEGORIES.includes(declared)) return declared
  const value = String(code ?? '').trim().toUpperCase()
  if (!value) return 'other'
  for (const [name, keywords] of RULES) {
    if (keywords.some(keyword => value.includes(keyword.toUpperCase()))) return name
  }
  return 'other'
}
