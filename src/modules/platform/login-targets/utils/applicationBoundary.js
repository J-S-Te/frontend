function normalizedName(application) {
  return String(application?.name || application?.code || '').trim().toLocaleLowerCase('zh-CN')
}

function normalizedCode(application) {
  return String(application?.code || '').trim()
}

function shortApplicationID(applicationID) {
  const value = String(applicationID || '').trim()
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

/**
 * 构造登录目标管理边界的应用选项。
 *
 * 管理界面必须保留每一条真实应用登记，不能像门户卡片一样按名称或前端模块别名去重，
 * 否则同名应用中的某一条 application_id 会失去维护入口。只有同名登记需要追加唯一 ID，
 * 让管理员能明确选择实际的应用边界。
 */
export function buildLoginTargetApplicationOptions(applications) {
  const entries = (Array.isArray(applications) ? applications : [])
    .filter((application) => String(application?.application_id || '').trim())

  const nameCounts = new Map()
  for (const application of entries) {
    const name = normalizedName(application)
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
  }

  return entries
    .map((application) => {
      const applicationID = String(application.application_id).trim()
      const code = normalizedCode(application)
      const name = String(application.name || code || applicationID).trim()
      const hasSameName = (nameCounts.get(normalizedName(application)) || 0) > 1
      const codeLabel = code ? `（${code}）` : ''
      const identityLabel = hasSameName ? ` · ID ${shortApplicationID(applicationID)}` : ''

      return {
        application,
        applicationID,
        code,
        name,
        hasSameName,
        label: `${name}${codeLabel}${identityLabel}`,
      }
    })
    .sort((left, right) => (
      left.name.localeCompare(right.name, 'zh-CN')
      || left.code.localeCompare(right.code, 'zh-CN')
      || left.applicationID.localeCompare(right.applicationID, 'zh-CN')
    ))
}
