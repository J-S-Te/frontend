import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '@/modules/platform/auth/views/LoginView.vue'
import ForbiddenView from '@/modules/platform/auth/views/ForbiddenView.vue'
import PlatformConsoleView from '@/modules/platform/views/PlatformConsoleView.vue'
import SubsystemPortalView from '@/modules/platform/views/SubsystemPortalView.vue'
import ContractManagementView from '@/modules/contract_management/views/ContractManagementView.vue'
import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import { ensureContractSession } from '@/modules/contract_management/api/contract'
import { canAccessContractSection } from '@/modules/shared/authz/sys004'
import { dispatchAuthorizationRefreshed } from '@/modules/platform/auth/utils/authorizationRefresh'
import { hasAnyPermission as principalHasAnyPermission } from '@/modules/platform/auth/utils/permissions'
import { DICTIONARY_ENTRY_PERMISSIONS } from '@/modules/platform/dictionaries/utils/dictionaryPermissions'
import { IAM_ENTRY_PERMISSIONS } from '@/modules/platform/iam/utils/iamPermissions'

const contractSections = ['dashboard', 'customers', 'contracts', 'templates', 'approvals', 'rules', 'signing', 'reports']

const settingsSections = new Set([
  'base',
  'iam',
  'notify',
  'security',
  'dict',
])

function normalizeSettingsSection(section) {
  return settingsSections.has(section) ? section : 'iam'
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
      meta: { title: '子系统门户', requiresAuth: true },
    },
    {
      path: '/settings/:section?',
      name: 'settings',
      component: PlatformConsoleView,
      meta: {
        title: '系统设置',
        requiresAuth: true,
        // 路由级 OR 权限：IAM、字典或审计任一实际权限均可进入设置区。
        // 进入后由 PlatformConsoleView 和各模块继续按真实权限细分 Tab、数据与按钮。
        // 后端 403 仍是最终安全边界，前端只负责避免无关的 user:read 门槛。
        permission: [...IAM_ENTRY_PERMISSIONS, ...DICTIONARY_ENTRY_PERMISSIONS, 'platform:audit:view'],
      },
    },
    {
      path: '/audit',
      name: 'audit',
      component: PlatformConsoleView,
      meta: {
        title: '审计日志',
        requiresAuth: true,
        // 注意：真实权限码是 platform:audit:view，不是 audit-log:read。
        // 后端 migrations/000011_seed_platform_defaults.sql 用的是 audit:view。
        permission: 'platform:audit:view',
      },
    },
    {
      path: '/forbidden',
      name: 'forbidden',
      component: ForbiddenView,
      meta: { title: '无权访问' },
    },
    {
      path: '/contract_management/:section?',
      name: 'contract_management',
      component: ContractManagementView,
      meta: { title: '合同管理系统', requiresAuth: true, requiresContractSession: true },
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
      // 合同系统使用自己的 OIDC 会话。这里不能先调用基础平台 /api/v1/auth/me，
      // 否则合同 Cookie 有效但基础平台 Cookie 过期时会被错误送回基础平台登录页。
      const session = await ensureContractSession()
      if (!session) return false

      const requestedSection = typeof to.params.section === 'string' ? to.params.section : 'dashboard'
      if (!canAccessContractSection(session, requestedSection)) {
        const firstAllowedSection = contractSections.find((section) => canAccessContractSection(session, section))
        if (!firstAllowedSection) return { name: 'login' }
        return {
          name: 'contract_management',
          params: { section: firstAllowedSection },
          query: { ...to.query, denied: requestedSection },
          replace: true,
        }
      }
      return true
    } catch {
      // 401 已由 ensureContractSession 发起 OIDC 跳转；网络或服务错误时停留在当前页，
      // 不要把合同后端故障误判成基础平台未登录。
      return false
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
  } catch {
    return { name: 'login' }
  }
})

router.afterEach((to) => {
  document.title = `${to.meta.title || '基础能力平台'} · 基础能力平台`
})

export default router
