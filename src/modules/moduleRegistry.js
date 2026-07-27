import platformModule from './platform/module.js'
import projectManagementModule from './project_management/module.js'

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
export function buildPortalSubsystems(registeredApplications = []) {
  const builtInModules = frontendModules
    .filter((moduleDefinition) => moduleDefinition.builtIn)
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

  const registeredModules = (Array.isArray(registeredApplications) ? registeredApplications : [])
    .filter((application) => {
      const moduleDefinition = findFrontendModule(application?.code)
      return !moduleDefinition?.builtIn
    })
    .map((application) => {
      const moduleDefinition = findFrontendModule(application?.code)
      const code = normalizeCode(application?.code)
      const applicationID = application?.application_id || code || 'application'
      const environmentID = application?.environment_id || application?.environment || 'environment'
      return {
        key: `registered-${applicationID}-${environmentID}`,
        code,
        name: application?.name || moduleDefinition?.name || code || '未命名子系统',
        description: application?.description || moduleDefinition?.description || `${application?.environment || '默认'} 环境`,
        environment: application?.environment || '',
        icon: moduleDefinition?.icon || 'dashboard',
        allowed: true,
        publicURL: application?.public_url || '',
        source: 'application-registry',
      }
    })

  return [...builtInModules, ...registeredModules]
}
