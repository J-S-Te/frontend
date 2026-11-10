import { fileURLToPath } from 'node:url'

// 本清单只用于生成编译入口，不读取或推断运行时授权。
export const MODULE_CATALOG = Object.freeze([
  { code: 'basic-platform', directory: 'platform', session: 'Platform',
    setting: 'VITE_API_BASE_URL', prefix: '/api/v1' },
  { code: 'project_management', directory: 'project_management', session: 'Project',
    setting: 'VITE_PROJECT_PUBLIC_PATH_PREFIX', prefix: '/project_management',
    view: 'ProjectManagementView', api: 'projectManagement', ensure: 'ensureProjectSession' },
  { code: 'settlement', directory: 'settlement', session: 'Settlement',
    setting: 'VITE_SETTLEMENT_PUBLIC_PATH_PREFIX', prefix: '/settlement',
    view: 'SettlementView', api: 'settlement', ensure: 'ensureSettlementSession' },
  { code: 'contract_management', directory: 'contract_management', session: 'Contract',
    setting: 'VITE_CONTRACT_PUBLIC_PATH_PREFIX', prefix: '/contract_management',
    view: 'ContractManagementView', api: 'contract', ensure: 'ensureContractSession' },
  { code: 'customer_and_opportunity', directory: 'customer_opportunity', session: 'CRM',
    setting: 'VITE_CRM_PUBLIC_PATH_PREFIX', prefix: '/customer-opportunity',
    view: 'CustomerOpportunityView', api: 'client', ensure: 'ensureCRMSession',
    extraView: 'CRMLoginCompleteView' },
  { code: 'customer_portal', directory: 'customer_portal', session: 'Portal',
    setting: 'VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX', prefix: '/customer-portal',
    view: 'CustomerPortalView', api: 'portal', ensure: 'ensurePortalSession' },
  { code: 'reimbursement', directory: 'reimbursement', session: 'Reimbursement',
    setting: 'VITE_REIMBURSEMENT_PUBLIC_PATH_PREFIX', prefix: '/reimbursement',
    view: 'ReimbursementView', api: 'reimbursement', ensure: 'ensureReimbursementSession' },
  { code: 'data_analysis', directory: 'data_analysis', session: 'DataAnalysis',
    setting: 'VITE_DATA_ANALYSIS_PUBLIC_PATH_PREFIX', prefix: '/data_analysis',
    view: 'DataAnalysisView', viewFile: 'DashboardShellView', api: 'dataAnalysis',
    ensure: 'ensureDataAnalysisSession' },
])

// selectModules 校验发行选择并固定生成顺序，平台始终保留。
// 参数：selection 为 none、all 或逗号分隔的规范业务模块编码。
// 返回值：已选模块描述；未知编码、空项或保留值混用时抛错。
export function selectModules(selection = 'all') {
  const value = String(selection).trim()
  if (!value || value === 'all') return [...MODULE_CATALOG]
  if (value === 'none') return [MODULE_CATALOG[0]]
  const codes = value.split(',').map((code) => code.trim())
  const valid = new Set(MODULE_CATALOG.slice(1).map(({ code }) => code))
  if (codes.some((code) => !valid.has(code))) {
    throw new Error(`VITE_ENABLED_MODULES 无效；请使用 none、all 或规范编码：${[...valid].join(',')}`)
  }
  return MODULE_CATALOG.filter(({ code }, index) => index === 0 || codes.includes(code))
}

// generateModuleManifest 仅为选中模块产生静态元数据与动态业务入口。
// 参数：selection 为发行选择；environment 为公开路由前缀配置。
// 返回值：可直接由 Vite 解析的 ES 模块源码，不引用未选择的业务实现。
export function generateModuleManifest(selection, environment = {}) {
  const modules = selectModules(selection)
  const imports = modules.map(({ directory }, index) =>
    `import module${index} from '../${directory}/module.js'`)
  const views = modules.flatMap(({ directory, view, viewFile, extraView }) =>
    [view && [view, viewFile || view], extraView && [extraView, extraView]]
      .filter(Boolean).map(([name, file]) =>
        `${name}: () => import('../${directory}/views/${file}.vue')`))
  const loaders = modules.filter(({ api }) => api).map(({ session, directory, api, ensure }) =>
    `${session}: async () => (await import('../${directory}/api/${api}.js')).${ensure}()`)
  const systems = modules.map(({ session, setting, prefix }) => [session, setting, prefix])
  const unavailablePrefixes = [...new Set(MODULE_CATALOG.slice(1)
    .filter(({ code }) => !modules.some((module) => module.code === code))
    .flatMap(({ setting, prefix }) => [prefix, environment[setting] || prefix]))]
  return [
    '// 自动生成的默认 all 入口；Vite 按发行选择在内存中替换本模块。',
    ...imports,
    `export const frontendModules = Object.freeze([${modules.map((_, i) => `module${i}`).join(', ')}])`,
    `export const businessViews = Object.freeze({${views.join(',\n')}})`,
    `export const sessionLoaders = Object.freeze({${loaders.join(',\n')}})`,
    `export const sessionSystems = Object.freeze(${JSON.stringify(systems)})`,
    `export const unavailablePrefixes = Object.freeze(${JSON.stringify(unavailablePrefixes)})`,
    '',
  ].join('\n')
}

// selectedModulesPlugin 在 Vite 解析前替换编译入口，并记录实际构建模块图。
// 参数：selection 为发行选择；environment 为公开构建配置。
// 返回值：Vite 插件；如未选业务被其他 import 引入，构建直接失败。
export function selectedModulesPlugin(selection, environment = {}) {
  const modules = selectModules(selection)
  const entry = fileURLToPath(new URL('../src/modules/registry/compiledModules.js', import.meta.url))
  const source = generateModuleManifest(selection, environment)
  const omitted = MODULE_CATALOG.slice(1).filter(({ code }) => !modules.some((item) => item.code === code))
  return {
    name: 'selected-frontend-modules',
    enforce: 'pre',
    // load 用编译时清单取代默认 all 文件，不扫描未售目录。
    // 参数：id 为 Vite 已解析模块标识。
    // 返回值：选中入口源码；其他模块交给已有加载器。
    load(id) {
      if (id === entry) return source
    },
    // generateBundle 校验未售实现未被传递引用，并输出可审计清单。
    // 参数：options 为输出选项；bundle 为 Rollup 生成资源。
    // 返回值：无；发现越界模块则终止构建。
    generateBundle(options, bundle) {
      const moduleIDs = [...this.getModuleIds()]
      for (const { directory } of omitted) {
        if (moduleIDs.some((id) => id.includes(`/src/modules/${directory}/`))) {
          this.error(`未选模块被编译依赖引入：${directory}`)
        }
      }
      const compiledDirectories = MODULE_CATALOG.filter(({ directory }) =>
        moduleIDs.some((id) => id.includes(`/src/modules/${directory}/`)))
        .map(({ code }) => code)
      this.emitFile({ type: 'asset', fileName: 'frontend-modules.json', source: JSON.stringify({
        schema_version: 1,
        enabled_modules: modules.map(({ code }) => code),
        compiled_modules: compiledDirectories,
      }, null, 2) + '\n' })
    },
  }
}
