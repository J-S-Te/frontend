import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '@/modules/platform/auth/views/LoginView.vue'
import PlatformConsoleView from '@/modules/platform/views/PlatformConsoleView.vue'
import SubsystemPortalView from '@/modules/platform/views/SubsystemPortalView.vue'
import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'

const settingsSections = new Set([
  'base',
  'iam',
  'login-targets',
  'notify',
  'security',
  'files',
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
      meta: { title: '系统设置', requiresAuth: true },
    },
    {
      path: '/audit',
      name: 'audit',
      component: PlatformConsoleView,
      meta: { title: '审计日志', requiresAuth: true },
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

  if (!to.meta.requiresAuth) {
    return true
  }

  try {
    // `/auth/me` 使用 HttpOnly Cookie，由后端同时校验 JWT 和服务端会话状态。
    // 任意校验失败（401、网络错误或其他异常）都按未登录处理，不能 fail-open。
    await getCurrentPrincipal()
    return true
  } catch {
    return { name: 'login' }
  }
})

router.afterEach((to) => {
  document.title = `${to.meta.title || '基础能力平台'} · 基础能力平台`
})

export default router
