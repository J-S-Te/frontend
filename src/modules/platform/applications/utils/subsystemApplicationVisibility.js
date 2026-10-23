const platformApplicationCodes = new Set(['platform', 'basic_platform'])

function normalizedCode(value) {
  return String(value || '').trim().toLowerCase()
}

export function isPlatformApplication(application) {
  return platformApplicationCodes.has(normalizedCode(application?.code))
}

// 生产交付资源包含所有已审核子系统的清单，便于后续接入增量包，
// 无需替换部署脚本。该允许列表的范围大于
// 当前交付范围：应用注册界面仅应展示已准备就绪的目标，
// 以及已经拥有可见环境的应用。
export function visibleSubsystemApplications(applications, options = {}) {
  const items = Array.isArray(applications) ? applications : []
  if (!options.capabilitiesResolved || options.capabilitiesAvailable === false) {
    return items.filter(isPlatformApplication)
  }
  if (!options.production) return items

  const visibleCodes = new Set(platformApplicationCodes)
  for (const value of options.supportedApplicationCodes || []) {
    const code = normalizedCode(value)
    if (code) visibleCodes.add(code)
  }
  for (const value of options.registeredApplicationCodes || []) {
    const code = normalizedCode(value)
    if (code) visibleCodes.add(code)
  }
  return items.filter((application) => visibleCodes.has(normalizedCode(application?.code)))
}
