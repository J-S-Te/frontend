import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '@/modules/platform/auth/views/LoginView.vue'
import ForbiddenView from '@/modules/platform/auth/views/ForbiddenView.vue'
import SubsystemAccessErrorView from '@/modules/platform/auth/views/SubsystemAccessErrorView.vue'
import PlatformConsoleView from '@/modules/platform/views/PlatformConsoleView.vue'
import SubsystemPortalView from '@/modules/platform/views/SubsystemPortalView.vue'
import { AuthError, getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import { ensureContractSession } from '@/modules/contract_management/api/contract'
import { ensureProjectSession } from '@/modules/project_management/api/projectManagement'
import { getCRMSession } from '@/modules/customer_opportunity/api/client'
import { ensurePortalSession } from '@/modules/customer_portal/api/portal'
import { canAccessContractSection } from '@/modules/shared/authz/sys004'
import { buildSubsystemAccessErrorRoute } from '@/modules/shared/authz/sessionCompatibility'
import { dispatchAuthorizationRefreshed } from '@/modules/platform/auth/utils/authorizationRefresh'
import { hasAnyPermission as principalHasAnyPermission } from '@/modules/platform/auth/utils/permissions'
import {
  PLATFORM_AUDIT_VIEW_PERMISSION,
  PLATFORM_SETTINGS_ENTRY_PERMISSIONS,
  PLATFORM_SETTINGS_SECTION_KEYS,
  visiblePlatformSettingsSections,
} from '@/modules/platform/auth/utils/platformConsoleAccess'

// Business systems are large, independent route boundaries. Lazy loading keeps
// the platform login and subsystem portal from downloading every business UI
// before the user chooses a system.
const ContractManagementView = () => import('@/modules/contract_management/views/ContractManagementView.vue')
const ProjectManagementView = () => import('@/modules/project_management/views/ProjectManagementView.vue')
const CustomerOpportunityView = () => import('@/modules/customer_opportunity/views/CustomerOpportunityView.vue')
const CustomerPortalView = () => import('@/modules/customer_portal/views/CustomerPortalView.vue')

const contractSections = ['dashboard', 'intakes', 'customers', 'contracts', 'templates', 'approvals', 'rules', 'signing', 'reports']

// 路由守卫与设置页签共享同一份权限模块键，新增设置模块时不会出现
// “页面已展示、点击却被守卫重定向”的双份白名单漂移。
const settingsSections = new Set(PLATFORM_SETTINGS_SECTION_KEYS)

function normalizeSettingsSection(section) {
  return settingsSections.has(section) ? section : 'iam'
}

function subsystemAccessFailure(error, to) {
  return buildSubsystemAccessErrorRoute(error, to.fullPath) || false
}

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior() {
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      redirect: { name: 'portal' },
    },
    {
      path: '/login',
      alias: '/login.html',
      name: 'login',
      component: LoginView,
      meta: { title: '登录' },
    },
    {
      path: '/portal',
      name: 'portal',
      component: SubsystemPortalView,
      meta: { title: '子系统门户', requiresAuth: true, requiresPlatformSession: true },
    },
    {
      path: '/settings/:section?',
      name: 'settings',
      component: PlatformConsoleView,
      meta: {
        title: '系统设置',
        requiresAuth: true,
        requiresPlatformSession: true,
        // 只允许拥有至少一个真实设置模块权限的主体进入；审计权限不再放大为设置权限。
        permission: PLATFORM_SETTINGS_ENTRY_PERMISSIONS,
      },
    },
    {
      path: '/audit',
      name: 'audit',
      component: PlatformConsoleView,
      meta: {
        title: '审计日志',
        requiresAuth: true,
        requiresPlatformSession: true,
        // 注意：真实权限码是 platform:audit:view，不是 audit-log:read。
        // 后端 migrations/000011_seed_platform_defaults.sql 用的是 audit:view。
        permission: PLATFORM_AUDIT_VIEW_PERMISSION,
      },
    },
    {
      path: '/forbidden',
      name: 'forbidden',
      component: ForbiddenView,
      meta: { title: '无权访问' },
    },
    {
      path: '/access-error',
      name: 'subsystem_access_error',
      component: SubsystemAccessErrorView,
      meta: { title: '子系统访问失败' },
    },
    {
      path: '/contract_management/:section?',
      name: 'contract_management',
      component: ContractManagementView,
      meta: { title: '合同管理系统', requiresAuth: true, requiresContractSession: true },
    },
    {
      path: '/project_management/:section?',
      name: 'project_management',
      component: ProjectManagementView,
      meta: { title: '项目管理系统', requiresAuth: true, requiresProjectSession: true },
    },
    {
      path: '/customer-opportunity/:section?',
      name: 'customer_opportunity',
      component: CustomerOpportunityView,
      meta: { title: '客户与商机管理', requiresAuth: true, requiresCRMSession: true },
    },
    {
      path: '/customer-portal/:section?',
      name: 'customer_portal',
      component: CustomerPortalView,
      meta: { title: '客户自助门户', requiresAuth: true, requiresPortalSession: true },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'portal' },
    },
  ],
})

router.beforeEach(async (to) => {
  // 保留设置页面的默认分区规范化逻辑，并在此之前完成身份校验，
  // 避免未登录用户先看到受保护页面再被组件重定向。
  if (to.name === 'settings') {
    const section = normalizeSettingsSection(to.params.section)
    if (to.params.section !== section) {
      return {
        name: 'settings',
        params: { section },
        query: to.query,
        hash: to.hash,
      }
    }
  }

  if (to.name === 'login') {
    const hasLoginTarget =
      typeof to.query.application_id === 'string' &&
      typeof to.query.environment_id === 'string' &&
      typeof to.query.login_target_code === 'string'

    if (!hasLoginTarget) {
      try {
        // 用户仅关闭页面时，HttpOnly Cookie 可能仍然有效。直接恢复已有会话，
        // 避免再次提交口令而误报“其他终端已登录”。
        await getCurrentPrincipal()
        return { name: 'portal', replace: true }
      } catch {
        // 没有可恢复会话时继续显示登录页。
      }
    }
  }

  if (!to.meta.requiresAuth) {
    return true
  }

  if (to.meta.requiresContractSession) {
    try {
      // 合同系统使用自己的 OIDC 会话。ensureContractSession 会在基础平台会话仍然
      // 可读时校验两边用户是否一致；平台 Cookie 过期不会使独立合同会话失效。
      const session = await ensureContractSession()
      if (!session) return false

      const requestedSection = typeof to.params.section === 'string' ? to.params.section : 'dashboard'
      if (!canAccessContractSection(session, requestedSection)) {
        const firstAllowedSection = contractSections.find((section) => canAccessContractSection(session, section))
        if (!firstAllowedSection) {
          return buildSubsystemAccessErrorRoute({ status: 403, code: 'CONTRACT_AUTHORIZATION_REQUIRED' }, to.fullPath)
        }
        return {
          name: 'contract_management',
          params: { section: firstAllowedSection },
          query: { ...to.query, denied: requestedSection },
          replace: true,
        }
      }
      return true
    } catch (error) {
      // 401 已由 ensureContractSession 发起 OIDC 跳转；网络或服务错误时停留在当前页，
      // 不要把合同后端故障误判成基础平台未登录。
      return subsystemAccessFailure(error, to)
    }
  }

  if (to.meta.requiresProjectSession) {
    try {
      // 项目系统持有独立 OIDC Cookie。这里只确认服务器已经建立项目会话；
      // 具体 Permission 与 Data Scope 由项目 API 逐请求执行，浏览器不推导授权范围。
      const session = await ensureProjectSession()
      if (!session) return false
      return true
    } catch (error) {
      // 401 已由项目 API 客户端启动 OIDC；其他错误保持关闭，避免平台会话
      // 在项目服务不可用时意外放行页面。
      return subsystemAccessFailure(error, to)
    }
  }

  if (to.meta.requiresCRMSession) {
    try {
      await getCRMSession()
      return true
    } catch (error) {
      // The CRM client starts its own OIDC redirect on 401. Other errors stay
      // closed so a backend outage cannot fall through to the platform session.
      return subsystemAccessFailure(error, to)
    }
  }

  if (to.meta.requiresPortalSession) {
    try {
      return Boolean(await ensurePortalSession())
    } catch (error) {
      return subsystemAccessFailure(error, to)
    }
  }

  try {
    // `/auth/me` 使用 HttpOnly Cookie，由后端同时校验 JWT 和服务端会话状态。
    // 任意校验失败（401、网络错误或其他异常）都按未登录处理，不能 fail-open。
    const principal = await getCurrentPrincipal()
    // 同步到全局缓存，让按钮级守卫和后续导航都能读到同一份主体。
    try {
      dispatchAuthorizationRefreshed(principal, { changed: true })
    } catch {
      // 派发失败不影响导航本身。
    }
    if (to.name === 'settings') {
      const requestedSection = normalizeSettingsSection(to.params.section)
      const allowedSections = visiblePlatformSettingsSections(principal)
      if (!allowedSections.includes(requestedSection)) {
        const firstAllowedSection = allowedSections[0]
        if (firstAllowedSection) {
          return {
            name: 'settings',
            params: { section: firstAllowedSection },
            query: { ...to.query, denied: requestedSection },
            replace: true,
          }
        }
        if (principalHasAnyPermission(principal, [PLATFORM_AUDIT_VIEW_PERMISSION])) {
          return { name: 'audit', query: { denied: requestedSection }, replace: true }
        }
        return { name: 'forbidden', query: { from: to.fullPath } }
      }
    }
    // 路由级权限硬拦截：路由 meta.permission 命中 / 不命中决定能否访问。
    // 基础能力平台是身份提供方，登录即可进入，但进入之后具体到某个 section / 业务模块
    // 是否可见由该路由声明的 permission 决定。后端 403/401 仍是真正安全边界。
    const required = to?.meta?.permission
    if (required) {
      const codes = Array.isArray(required) ? required : [required]
      if (!principalHasAnyPermission(principal, codes)) {
        return { name: 'forbidden', query: { from: to.fullPath } }
      }
    }
    return true
  } catch (error) {
    // 只有明确的 401 才代表会话失效。502、网络中断或平台 API 短暂重启时
    // 保留当前页面和 HttpOnly Cookie，避免一次部署抖动把用户误退出。
    if (error instanceof AuthError && error.status !== 401) return false
    return { name: 'login' }
  }
})

router.afterEach((to) => {
  document.title = `${to.meta.title || '基础能力平台'} · 基础能力平台`
})

export default router
