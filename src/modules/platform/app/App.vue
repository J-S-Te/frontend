<script setup>
import { onBeforeUnmount, provide, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import { createSessionLifecycle } from '@/modules/platform/auth/utils/sessionLifecycle'
import { createUnifiedSessionLifecycle } from '@/modules/shared/session/unifiedSessionLifecycle'
import { createSessionTransport, sessionTargetForRoute } from '@/modules/shared/session/sessionTransport'
import { clearSessionScopedStorage } from '@/modules/shared/utils/sessionScopedStorage'
import { createPlatformSessionSynchronizer } from '@/modules/platform/auth/utils/platformSessionSynchronizer'
import {
  AUTHORIZATION_REFRESH_INTERVAL_MS,
  clearAuthorizationSnapshot,
  dispatchAuthorizationRefreshed,
  principalFingerprint,
} from '@/modules/platform/auth/utils/authorizationRefresh'

const route = useRoute()
const router = useRouter()
const transport = createSessionTransport()
// 一个路由只使用一个活动时钟；独立Cookie、业务权限和客户边界仍由各自后端检查。
const lifecycle = createUnifiedSessionLifecycle({
  read: transport.read,
  activity: transport.activity,
  onEnded: (_reason, target) => {
    clearAuthorizationSnapshot()
    clearSessionScopedStorage()
    if (target.key !== 'Platform') {
      window.location.replace(`${target.loginURL}?return_to=${encodeURIComponent(route.fullPath)}`)
    } else if (route.name !== 'login') {
      void router.replace({ name: 'login', query: { reason: 'session-ended' } })
    }
  },
  onIdentityChanged: () => {
    clearAuthorizationSnapshot()
    clearSessionScopedStorage()
    window.location.reload()
  },
})
provide('central-session-record-activity', lifecycle.recordEmbeddedActivity)
// 滚动发布期间未启用中央管理的旧平台仍使用原实现；两种模式互斥，启用由平台响应决定。
let platformSessionMode = ''
let legacyLifecycle = null

// synchronizePlatformLifecycle 根据平台已验证响应选择生命周期，不用前端配置决定策略。
// 参数：principal为平台当前主体及可选中央上下文。
// 返回值：无；后台权限刷新不会重置已启动的空闲计时。
function synchronizePlatformLifecycle(principal) {
  if (principal.session_context) {
    legacyLifecycle?.stop()
    platformSessionMode = 'central'
    void lifecycle.setTarget(sessionTargetForRoute(route.meta))
  } else if (platformSessionMode !== 'legacy') {
    lifecycle.stop()
    legacyLifecycle ||= createSessionLifecycle({ onSessionEnded: () => {
      clearAuthorizationSnapshot()
      void router.replace({ name: 'login', query: { reason: 'session-ended' } })
    } })
    platformSessionMode = 'legacy'
    legacyLifecycle.start(principal)
  }
}

let loading = false
let authorizationRefreshTimer = 0
let latestPrincipalFingerprint = ''

// stopAuthorizationRefresh 停止平台权限快照轮询。
// 参数：无。
// 返回值：无。
function stopAuthorizationRefresh() {
  if (authorizationRefreshTimer) {
    window.clearInterval(authorizationRefreshTimer)
    authorizationRefreshTimer = 0
  }
}

// refreshAuthorizationSnapshot 只读刷新平台权限，不作为会话交互。
// 参数：无。
// 返回值：权限校验完成的Promise。
async function refreshAuthorizationSnapshot() {
  if (loading || route.meta.requiresPlatformSession !== true) return
  loading = true
  try {
    await platformSessions.refresh()
  } finally {
    loading = false
  }
}

// startAuthorizationRefresh 启动当前平台页面的权限核对。
// 参数：无。
// 返回值：无。
function startAuthorizationRefresh() {
  stopAuthorizationRefresh()
  authorizationRefreshTimer = window.setInterval(() => {
    void refreshAuthorizationSnapshot()
  }, AUTHORIZATION_REFRESH_INTERVAL_MS)
}

// onPageVisible 在平台页面恢复可见时只读检查权限。
// 参数：无。
// 返回值：无。
function onPageVisible() {
  if (document.visibilityState === 'visible') {
    void refreshAuthorizationSnapshot()
  }
}

// deactivatePlatformSession 退出平台路由时清理平台菜单，保留业务入口的会话时钟。
// 参数：无。
// 返回值：无。
function deactivatePlatformSession() {
  // 进入登录页等公开路由时立即清空内存授权，账号切换期间绝不保留上一账号的菜单。
  stopAuthorizationRefresh()
  platformSessionMode = ''
  legacyLifecycle?.stop()
  latestPrincipalFingerprint = ''
  clearAuthorizationSnapshot()
}

const platformSessions = createPlatformSessionSynchronizer({
  loadPrincipal: getCurrentPrincipal,
  activate(principal) {
    synchronizePlatformLifecycle(principal)
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
    synchronizePlatformLifecycle(principal)
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

// 平台权限快照只在平台路由读取；会话期限则始终使用当前入口代理的中央状态。
watch(() => route.meta.requiresPlatformSession === true, platformSessions.synchronize, { immediate: true })
watch(() => sessionTargetForRoute(route.meta)?.key, () => {
  const target = sessionTargetForRoute(route.meta)
  if (target?.key !== 'Platform') void lifecycle.setTarget(target)
  else if (platformSessionMode !== 'central') lifecycle.stop()
}, { immediate: true })

// onExternalSessionEnd 仅对用户显式全局退出清理界面；其他失效信号先核对当前入口。
// 参数：event为同源退出通知。
// 返回值：无。
function onExternalSessionEnd(event) {
  const reason = event?.detail?.reason || event?.data?.reason
  if (reason !== 'manual-logout' && reason !== 'logout') { void lifecycle.probe(); return }
  lifecycle.stop()
  legacyLifecycle?.stop()
  clearAuthorizationSnapshot()
  clearSessionScopedStorage()
  if (route.name !== 'login') void router.replace({ name: 'login', query: { reason: 'logout' } })
}
const sessionChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('basic-platform-auth')
if (sessionChannel) sessionChannel.onmessage = event => {
  if (event.data?.type === 'session-ended') onExternalSessionEnd(event)
}
window.addEventListener('platform-auth:session-ended', onExternalSessionEnd)
// 标签页重新获得可见性或焦点时立即校验，缩短后台期间账号禁用、会话撤销或权限降级的生效延迟。
window.addEventListener('visibilitychange', onPageVisible)
window.addEventListener('focus', onPageVisible)
onBeforeUnmount(() => {
  stopAuthorizationRefresh()
  window.removeEventListener('visibilitychange', onPageVisible)
  window.removeEventListener('focus', onPageVisible)
  window.removeEventListener('platform-auth:session-ended', onExternalSessionEnd)
  sessionChannel?.close()
  lifecycle.destroy()
  legacyLifecycle?.destroy()
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
