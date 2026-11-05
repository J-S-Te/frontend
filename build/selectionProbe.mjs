// 专用构建测试入口，供真实 Vite 解析后检查门户与会话的发行边界。
export { frontendModules, buildPortalSubsystems } from '../src/modules/registry/moduleRegistry.js'
export { sessionTargetForRoute } from '../src/modules/shared/session/sessionTransport.js'
