<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import { createSessionLifecycle } from '@/modules/platform/auth/utils/sessionLifecycle'
import { createSubsystemSessionLifecycle } from '@/modules/shared/session/subsystemSessionLifecycle'
import { getContractSession, recordContractSessionActivity, startContractLogin } from '@/modules/contract_management/api/contract'
import { probeCRMSession, recordCRMSessionActivity, startCRMLogin } from '@/modules/customer_opportunity/api/client'
import { probeProjectSession, recordProjectSessionActivity, startProjectLogin } from '@/modules/project_management/api/projectManagement'
import { probeDataAnalysisSession, recordDataAnalysisSessionActivity, startDataAnalysisLogin } from '@/modules/data_analysis/api/dataAnalysis'
import { createPlatformSessionSynchronizer } from '@/modules/platform/auth/utils/platformSessionSynchronizer'
import {
  AUTHORIZATION_REFRESH_INTERVAL_MS,
  clearAuthorizationSnapshot,
  dispatchAuthorizationRefreshed,
  principalFingerprint,
} from '@/modules/platform/auth/utils/authorizationRefresh'

const route = useRoute()
const router = useRouter()

// 业务子系统（合同/CRM/项目/数析）使用各自独立的 HttpOnly 会话。统一在这里按当前路由
// 启用对应子系统的“空闲窗口 + 绝对上限”生命周期：鼠标/键盘等真实操作节流上报本系统
// 活动接口；前端只在服务端剩余窗口为 0 或会话失效时回本系统登录页。
const subsystemSessionAdapters = Object.freeze({
  contract: Object.freeze({
    probe: () => getContractSession({ force: true, suppressLoginRedirect: true }),
    touch: recordContractSessionActivity,
    login: () => startContractLogin(),
  }),
  crm: Object.freeze({
    probe: probeCRMSession,
    touch: recordCRMSessionActivity,
    login: () => startCRMLogin(),
  }),
  project: Object.freeze({
    probe: probeProjectSession,
    touch: recordProjectSessionActivity,
    login: () => startProjectLogin(),
  }),
  dataAnalysis: Object.freeze({
    probe: probeDataAnalysisSession,
    touch: recordDataAnalysisSessionActivity,
    login: () => startDataAnalysisLogin(),
  }),
})

const activeSubsystemAdapter = { current: null }
const subsystemLifecycle = createSubsystemSessionLifecycle({
  touch: () => activeSubsystemAdapter.current?.touch?.(),
  probe: () => activeSubsystemAdapter.current?.probe?.(),
  onIdle: () => { activeSubsystemAdapter.current?.login?.() },
})
const subsystemSessionAdapter = computed(() => {
  const meta = route.meta || {}
  if (meta.requiresContractSession) return subsystemSessionAdapters.contract
  if (meta.requiresCRMSession) return subsystemSessionAdapters.crm
  if (meta.requiresProjectSession) return subsystemSessionAdapters.project
  if (meta.requiresDataAnalysisSession) return subsystemSessionAdapters.dataAnalysis
  return null
})
let subsystemActivation = 0

async function synchronizeSubsystemSession(adapter) {
  const generation = ++subsystemActivation
  subsystemLifecycle.stop()
  activeSubsystemAdapter.current = adapter
  if (!adapter) return
  try {
    const session = await adapter.probe()
    if (generation !== subsystemActivation || !session) return
    const idleSeconds = Number(session?.idle_timeout_seconds)
    const remaining = Number(session?.idle_remaining_ms)
    subsystemLifecycle.start({
      idleTimeoutSeconds: Number.isFinite(idleSeconds) && idleSeconds >= 60 ? idleSeconds : 30 * 60,
      idleRemainingMs: Number.isFinite(remaining) && remaining > 0 ? remaining : undefined,
    })
  } catch (error) {
    if (generation !== subsystemActivation) return
    // 页面恢复/计时器跨后台时可能先于业务请求发现会话已失效：探测 401 时直接回本系统登录。
    if (Number(error?.status) === 401) adapter.login?.()
  }
}
// 根组件统一维护受保护页面的会话生命周期。子页面只消费授权快照，不各自启动
// 定时器，避免并发的 /auth/me 响应以不同顺序覆盖当前账号权限。
const lifecycle = createSessionLifecycle({
  onSessionEnded: () => {
    clearAuthorizationSnapshot()
    if (route.name !== 'login') {
      void router.replace({ name: 'login', query: { reason: 'session-ended' } })
    }
  },
})

let loading = false
let authorizationRefreshTimer = 0
let latestPrincipalFingerprint = ''

function stopAuthorizationRefresh() {
  if (authorizationRefreshTimer) {
    window.clearInterval(authorizationRefreshTimer)
    authorizationRefreshTimer = 0
  }
}

async function refreshAuthorizationSnapshot() {
  if (loading || route.meta.requiresPlatformSession !== true) return
  loading = true
  try {
    await platformSessions.refresh()
  } finally {
    loading = false
  }
}

function startAuthorizationRefresh() {
  stopAuthorizationRefresh()
  authorizationRefreshTimer = window.setInterval(() => {
    void refreshAuthorizationSnapshot()
  }, AUTHORIZATION_REFRESH_INTERVAL_MS)
}

function onPageVisible() {
  if (document.visibilityState === 'visible') {
    void refreshAuthorizationSnapshot()
    // 页面重新可见时立即校准子系统空闲窗口；隐藏期间浏览器会节流本地计时器。
    subsystemLifecycle.refresh()
  }
}

function deactivatePlatformSession() {
  // 进入登录页等公开路由时立即清空内存授权，账号切换期间绝不保留上一账号的菜单。
  lifecycle.stop()
  stopAuthorizationRefresh()
  latestPrincipalFingerprint = ''
  clearAuthorizationSnapshot()
}

const platformSessions = createPlatformSessionSynchronizer({
  loadPrincipal: getCurrentPrincipal,
  activate(principal) {
    lifecycle.start(principal)
    latestPrincipalFingerprint = principalFingerprint(principal)
    dispatchAuthorizationRefreshed(principal)
    startAuthorizationRefresh()
  },
  deactivate: deactivatePlatformSession,
  async onSynchronizationError(error) {
    if (error instanceof AuthError && error.status === 401 && route.name !== 'login') {
      await router.replace({ name: 'login', query: { reason: 'session-ended' } })
    }
  },
  onRefresh(principal) {
    const nextFingerprint = principalFingerprint(principal)
    // 指纹只包含租户、主体、角色和权限；展示字段变化不会被误判为授权变更。
    // 即使指纹未变仍广播最新主体，门户应用目录等派生授权会自行重新拉取。
    const changed = Boolean(latestPrincipalFingerprint) && latestPrincipalFingerprint !== nextFingerprint
    latestPrincipalFingerprint = nextFingerprint
    dispatchAuthorizationRefreshed(principal, { changed })
  },
  async onRefreshError(error) {
    if (error instanceof AuthError && error.status === 401 && route.name !== 'login') {
      lifecycle.stop()
      stopAuthorizationRefresh()
      await router.replace({ name: 'login', query: { reason: 'session-ended' } })
    }
  },
})

// 合同、CRM 和客户门户各自维护独立 OIDC Cookie。根组件只管理基础平台页面，
// 避免每个子系统标签页的本地空闲计时器注销所有标签共享的平台 SSO 会话。
watch(() => route.meta.requiresPlatformSession === true, platformSessions.synchronize, { immediate: true })
watch(subsystemSessionAdapter, (adapter) => {
  if (!adapter) {
    subsystemActivation += 1
    activeSubsystemAdapter.current = null
    subsystemLifecycle.stop()
    return
  }
  void synchronizeSubsystemSession(adapter)
}, { immediate: true })
// 标签页重新获得可见性或焦点时立即校验，缩短后台期间账号禁用、会话撤销或权限降级的生效延迟。
window.addEventListener('visibilitychange', onPageVisible)
window.addEventListener('focus', onPageVisible)
onBeforeUnmount(() => {
  subsystemActivation += 1
  activeSubsystemAdapter.current = null
  subsystemLifecycle.destroy()
  stopAuthorizationRefresh()
  window.removeEventListener('visibilitychange', onPageVisible)
  window.removeEventListener('focus', onPageVisible)
  lifecycle.destroy()
})
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <RouterView />
</template>

<style scoped>
.skip-link { position: fixed; top: 8px; left: 8px; z-index: 11000; transform: translateY(-160%); padding: 8px 12px; border-radius: 6px; background: #1d4ed8; color: #fff; font-size: 13px; text-decoration: none; }
.skip-link:focus-visible { transform: translateY(0); }
</style>
