// 统一接入预设：权威值来自服务端清单（capabilities.targets）。
// 旧内置表仅作为"服务端清单不可用/旧接口调用"的兼容回退，不再新增条目。
const legacyIntegratedSubsystemPresets = Object.freeze({
  contract_management: Object.freeze({
    applicationName: '合同管理系统',
    upstreamUrl: 'http://contract-api:8081',
    pathPrefix: '/contract_management',
  }),
  customer_and_opportunity: Object.freeze({
    applicationName: '客户与商机管理系统',
    upstreamUrl: 'http://customer-api:8090',
    pathPrefix: '/customer-opportunity',
  }),
  customer_portal: Object.freeze({
    applicationName: '客户自助门户',
    upstreamUrl: 'http://portal-api:8091',
    pathPrefix: '/customer-portal',
  }),
})

// 历史别名：仅用于把失败表单里的旧值归一化到清单值，与服务端清单无关。
const legacyIntegratedSubsystemAliases = Object.freeze({
  customer_and_opportunity: Object.freeze([Object.freeze({
    upstreamUrl: 'http://opportunity-api:8082',
    pathPrefix: '/customer_and_opportunity',
  })]),
  customer_portal: Object.freeze([Object.freeze({
    upstreamUrl: 'http://customer-portal-api:8091',
    pathPrefix: '/customer_portal',
  })]),
})

function normalizeCode(value) {
  return String(value || '').trim().toLowerCase()
}

// 把服务端清单目标折算为预设；同一编码多环境时按 environment 过滤。
export function subsystemPresetsFromTargets(targets, environment = '') {
  const presets = {}
  if (!Array.isArray(targets)) return presets
  const wantedEnvironment = String(environment || '').trim().toLowerCase()
  for (const target of targets) {
    const code = normalizeCode(target?.application_code)
    if (!code) continue
    const targetEnvironment = String(target?.environment || '').trim().toLowerCase()
    if (wantedEnvironment && targetEnvironment && targetEnvironment !== wantedEnvironment) continue
    if (presets[code]) continue
    presets[code] = {
      applicationName: String(target?.application_name || '').trim(),
      upstreamUrl: String(target?.upstream_url || '').trim().replace(/\/$/, ''),
      pathPrefix: String(target?.path_prefix || '').trim().replace(/\/$/, ''),
      clientType: String(target?.client_type || '').trim(),
      manifestChecksum: String(target?.manifest_checksum || '').trim(),
    }
  }
  return presets
}

// 兼容旧签名 subsystemOnboardingPreset(code)；新增可选 targets/environment 走服务端清单。
export function subsystemOnboardingPreset(applicationCode, options = {}) {
  const code = normalizeCode(applicationCode)
  if (!code) return null
  const targets = options?.targets ?? null
  const environment = options?.environment ?? ''
  const fromServer = subsystemPresetsFromTargets(targets, environment)[code]
  const preset = fromServer ?? legacyIntegratedSubsystemPresets[code] ?? null
  if (!preset) return null
  return { ...preset, aliases: legacyIntegratedSubsystemAliases[code] ?? [] }
}

export function applySubsystemOnboardingPreset(form, previousCode = '', options = {}) {
  if (!form) return
  const currentCode = normalizeCode(form.applicationCode)
  const preset = subsystemOnboardingPreset(currentCode, options)
  if (!preset) return

  const previousPreset = subsystemOnboardingPreset(previousCode, options)
  // 仅覆盖空值或仍等于上一预设的值，用户手工填写的名称不会因切换应用编码而丢失。
  if (!String(form.applicationName || '').trim() || form.applicationName === previousPreset?.applicationName) {
    form.applicationName = preset.applicationName
  }
  if (!String(form.upstreamUrl || '').trim() || form.upstreamUrl === previousPreset?.upstreamUrl) {
    form.upstreamUrl = preset.upstreamUrl
  }
  if (!String(form.pathPrefix || '').trim() || form.pathPrefix === previousPreset?.pathPrefix || form.pathPrefix === `/${currentCode}`) {
    form.pathPrefix = preset.pathPrefix
  }
}

export function validateIntegratedSubsystemOnboarding(form, options = {}) {
  const preset = subsystemOnboardingPreset(form?.applicationCode, options)
  if (!preset) return ''
  if (!preset.upstreamUrl || !preset.pathPrefix) return ''
  if (String(form.upstreamUrl || '').trim().replace(/\/$/, '') !== preset.upstreamUrl) {
    return `当前应用已集成平台统一编排，UpstreamURL 必须为 ${preset.upstreamUrl}`
  }
  if (String(form.pathPrefix || '').trim().replace(/\/$/, '') !== preset.pathPrefix) {
    return `当前应用已集成平台统一前端，门户路径前缀必须为 ${preset.pathPrefix}`
  }
  return ''
}

export function normalizeIntegratedSubsystemOnboarding(form, options = {}) {
  const preset = subsystemOnboardingPreset(form?.applicationCode, options)
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
