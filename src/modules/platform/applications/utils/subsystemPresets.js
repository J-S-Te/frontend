const integratedSubsystemPresets = Object.freeze({
  contract_management: Object.freeze({
    applicationName: '合同管理系统',
    upstreamUrl: 'http://contract-api:8081',
    pathPrefix: '/contract_management',
    aliases: Object.freeze([]),
  }),
  customer_and_opportunity: Object.freeze({
    applicationName: '客户与商机管理系统',
    upstreamUrl: 'http://customer-api:8090',
    pathPrefix: '/customer-opportunity',
    aliases: Object.freeze([Object.freeze({
      upstreamUrl: 'http://opportunity-api:8082',
      pathPrefix: '/customer_and_opportunity',
    })]),
  }),
  customer_portal: Object.freeze({
    applicationName: '客户自助门户',
    upstreamUrl: 'http://portal-api:8091',
    pathPrefix: '/customer-portal',
    aliases: Object.freeze([Object.freeze({
      upstreamUrl: 'http://customer-portal-api:8091',
      pathPrefix: '/customer_portal',
    })]),
  }),
})

export function subsystemOnboardingPreset(applicationCode) {
  return integratedSubsystemPresets[String(applicationCode || '').trim().toLowerCase()] || null
}

export function applySubsystemOnboardingPreset(form, previousCode = '') {
  if (!form) return
  const currentCode = String(form.applicationCode || '').trim().toLowerCase()
  const preset = subsystemOnboardingPreset(currentCode)
  if (!preset) return

  const previousPreset = subsystemOnboardingPreset(previousCode)
  // 仅覆盖空值或仍等于上一预设的值，用户手工填写的名称不会因切换应用编码而丢失。
  if (!String(form.applicationName || '').trim() || form.applicationName === previousPreset?.applicationName) {
    form.applicationName = preset.applicationName
  }
  if (!String(form.upstreamUrl || '').trim() || form.upstreamUrl === previousPreset?.upstreamUrl) {
    form.upstreamUrl = preset.upstreamUrl
  }
  if (!String(form.pathPrefix || '').trim() || form.pathPrefix === previousPreset?.pathPrefix || form.pathPrefix === `/${previousCode}`) {
    form.pathPrefix = preset.pathPrefix
  }
}

export function validateIntegratedSubsystemOnboarding(form) {
  const preset = subsystemOnboardingPreset(form?.applicationCode)
  if (!preset) return ''
  if (String(form.upstreamUrl || '').trim().replace(/\/$/, '') !== preset.upstreamUrl) {
    return `当前应用已集成平台统一编排，UpstreamURL 必须为 ${preset.upstreamUrl}`
  }
  if (String(form.pathPrefix || '').trim().replace(/\/$/, '') !== preset.pathPrefix) {
    return `当前应用已集成平台统一前端，门户路径前缀必须为 ${preset.pathPrefix}`
  }
  return ''
}

export function normalizeIntegratedSubsystemOnboarding(form) {
  const preset = subsystemOnboardingPreset(form?.applicationCode)
  if (!preset) return false
  const upstreamUrl = String(form.upstreamUrl || '').trim().replace(/\/$/, '')
  const pathPrefix = String(form.pathPrefix || '').trim().replace(/\/$/, '')
  // 集成应用的服务地址和门户前缀可能在历史版本中分别迁移，不能要求两者
  // 必须成对出现；只要两项都属于已知的 canonical/legacy 值，就统一归一化。
  const knownUpstreams = new Set([preset.upstreamUrl, ...preset.aliases.map((alias) => alias.upstreamUrl)])
  const knownPaths = new Set([preset.pathPrefix, ...preset.aliases.map((alias) => alias.pathPrefix)])
  if (!knownUpstreams.has(upstreamUrl) || !knownPaths.has(pathPrefix)) return false
  if (upstreamUrl === preset.upstreamUrl && pathPrefix === preset.pathPrefix) return false
  form.upstreamUrl = preset.upstreamUrl
  form.pathPrefix = preset.pathPrefix
  return true
}
