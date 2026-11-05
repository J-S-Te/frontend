import { frontendModules, unavailablePrefixes } from './compiledModules.js'
import { portalPublicURL } from './moduleAvailability.js'

export { frontendModules }

// normalizeCode 统一后端登记编码的比较口径。
// 参数：value 为原始应用编码。
// 返回值：去除空白后的英文小写编码。
function normalizeCode(value) {
  return String(value || '').trim().toLowerCase()
}

// moduleCodes 汇集前端模块主编码和历史别名。
// 参数：moduleDefinition 为已编译的模块定义。
// 返回值：规范化后的可匹配编码列表。
function moduleCodes(moduleDefinition) {
  return [moduleDefinition.code, ...(moduleDefinition.aliases || [])].map(normalizeCode)
}

// findFrontendModule 根据登记编码查找已编译前端模块。
// 参数：applicationCode 为后端应用编码或历史别名。
// 返回值：匹配模块；未编译或未知应用返回 null。
export function findFrontendModule(applicationCode) {
  const normalizedCode = normalizeCode(applicationCode)
  if (!normalizedCode) return null
  return frontendModules.find((moduleDefinition) => moduleCodes(moduleDefinition).includes(normalizedCode)) || null
}

// buildPortalSubsystems 将后端可见目录映射为门户入口，保留投影门禁。
// 参数：registeredApplications 为后端应用；options 控制平台卡片是否显示。
// 返回值：已登记应用卡片；未编译的本地入口保持不可访问。
export function buildPortalSubsystems(registeredApplications = [], { includeBuiltInPlatform = true } = {}) {
  const builtInModules = frontendModules
    .filter((moduleDefinition) => moduleDefinition.builtIn)
    .filter(() => includeBuiltInPlatform)
    .map((moduleDefinition) => ({
      key: `built-in-${moduleDefinition.code}`,
      code: moduleDefinition.code,
      name: moduleDefinition.name,
      description: moduleDefinition.description,
      icon: moduleDefinition.icon || 'dashboard',
      allowed: true,
      route: moduleDefinition.route,
      source: 'built-in',
    }))

  const registeredApplicationsByIdentity = new Map()

  for (const application of Array.isArray(registeredApplications) ? registeredApplications : []) {
    const moduleDefinition = findFrontendModule(application?.code)
    if (moduleDefinition?.builtIn) continue

    const code = normalizeCode(application?.code)
    const canonicalCode = normalizeCode(moduleDefinition?.code) || code
    const applicationID = String(application?.application_id || '').trim()

    // 同一个前端模块可能同时以连字符编码和历史下划线别名登记；同一个
    // application_id 也可能返回多个环境。门户按“逻辑子系统”展示，因此
    // 这两类情况都只能生成一张卡片，避免用户看到重复登录目标。
    const identity = moduleDefinition
      ? `frontend-module:${canonicalCode}`
      : `application:${applicationID || code || application?.name || 'unknown'}`
    const existing = registeredApplicationsByIdentity.get(identity)

    // 优先保留与模块主编码完全一致的登记。历史别名只作为兼容项，不应
    // 覆盖新接入配置；同等优先级保持后端返回顺序稳定。
    const isCanonicalRegistration = Boolean(moduleDefinition) && code === canonicalCode
    const existingCode = normalizeCode(existing?.code)
    const existingIsCanonical = Boolean(moduleDefinition) && existingCode === canonicalCode
    if (!existing || (isCanonicalRegistration && !existingIsCanonical)) {
      registeredApplicationsByIdentity.set(identity, application)
    }
  }

  const registeredModules = Array.from(registeredApplicationsByIdentity.values())
    .map((application) => {
      const moduleDefinition = findFrontendModule(application?.code)
      const code = normalizeCode(moduleDefinition?.code) || normalizeCode(application?.code)
      const applicationID = application?.application_id || code || 'application'
      const environmentID = application?.environment_id || application?.environment || 'environment'
      const projectionStatus = String(application?.projection_status || '').trim().toUpperCase()
      const publicURL = moduleDefinition?.route ? '' : portalPublicURL(
        application?.public_url, unavailablePrefixes,
      )
      const locallyUnavailable = !moduleDefinition && Boolean(application?.public_url) && !publicURL
      const projectionReady = application?.projection_ready !== false && application?.allowed !== false
      return {
        key: `registered-${applicationID}-${environmentID}`,
        code,
        name: application?.name || moduleDefinition?.name || code || '未命名子系统',
        // 环境用于后端选择准确的登录目标，但门户卡片只展示逻辑应用，
        // 不向终端用户暴露 dev、test、staging、prod 等部署信息。
        description: application?.description || moduleDefinition?.description || '已接入统一身份平台的业务应用',
        icon: moduleDefinition?.icon || 'dashboard',
        allowed: projectionReady && !locallyUnavailable,
        projectionStatus,
        projectionNextAction: String(application?.projection_next_action || '').trim(),
        authenticationURL: moduleDefinition?.authenticationURL || '',
        // 已随统一前端构建的模块直接使用 Vue Router；只有没有本地模块的
        // 独立子系统才使用后端登记的 public_url。
        route: moduleDefinition?.route,
        publicURL,
        source: 'application-registry',
      }
    })

  return [...builtInModules, ...registeredModules]
}
