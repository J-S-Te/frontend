import platformModule from '../platform/module.js'
import projectManagementModule from '../project_management/module.js'
import contractManagementModule from '../contract_management/module.js'
import customerOpportunityModule from '../customer_opportunity/module.js'
import customerPortalModule from '../customer_portal/module.js'

/**
 * 前端模块清单。
 *
 * 这里登记的是“代码模块”，不是“已接入子系统”。业务子系统是否能在
 * 门户显示，必须以后端 GET /api/v1/portal/applications 的返回结果为准。
 * 这样可以避免仅提交一个前端目录就绕过租户边界、状态校验和接入流程。
 */
export const frontendModules = Object.freeze([
  platformModule,
  projectManagementModule,
  contractManagementModule,
  customerOpportunityModule,
  customerPortalModule,
])

function normalizeCode(value) {
  return String(value || '').trim().toLowerCase()
}

function moduleCodes(moduleDefinition) {
  return [moduleDefinition.code, ...(moduleDefinition.aliases || [])].map(normalizeCode)
}

/** 根据后端应用编码查找同名前端模块，用于补充图标和默认文案。 */
export function findFrontendModule(applicationCode) {
  const normalizedCode = normalizeCode(applicationCode)
  if (!normalizedCode) return null
  return frontendModules.find((moduleDefinition) => moduleCodes(moduleDefinition).includes(normalizedCode)) || null
}

/**
 * 把后端门户应用目录转换为卡片数据。
 *
 * - 内置平台卡片始终显示；
 * - 业务卡片只来自后端已登记、已启用且对当前租户可见的目录；
 * - 后端名称、描述和 public_url 是运行时真值；
 * - 本地模块清单只提供缺省展示信息，不能自行制造可访问卡片。
 */
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
      return {
        key: `registered-${applicationID}-${environmentID}`,
        code,
        name: application?.name || moduleDefinition?.name || code || '未命名子系统',
        // 环境用于后端选择准确的登录目标，但门户卡片只展示逻辑应用，
        // 不向终端用户暴露 dev、test、staging、prod 等部署信息。
        description: application?.description || moduleDefinition?.description || '已接入统一身份平台的业务应用',
        icon: moduleDefinition?.icon || 'dashboard',
        allowed: true,
        authenticationURL: moduleDefinition?.authenticationURL || '',
        // 已随统一前端构建的模块直接使用 Vue Router；只有没有本地模块的
        // 独立子系统才使用后端登记的 public_url。
        route: moduleDefinition?.route,
        publicURL: moduleDefinition?.route ? '' : (application?.public_url || ''),
        source: 'application-registry',
      }
    })

  return [...builtInModules, ...registeredModules]
}
