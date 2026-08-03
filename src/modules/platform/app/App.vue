<script setup>
import { onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import { createSessionLifecycle } from '@/modules/platform/auth/utils/sessionLifecycle'
import { createPlatformSessionSynchronizer } from '@/modules/platform/auth/utils/platformSessionSynchronizer'
import {
  AUTHORIZATION_REFRESH_INTERVAL_MS,
  clearAuthorizationSnapshot,
  dispatchAuthorizationRefreshed,
  principalFingerprint,
} from '@/modules/platform/auth/utils/authorizationRefresh'

const route = useRoute()
const router = useRouter()
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
// 标签页重新获得可见性或焦点时立即校验，缩短后台期间账号禁用、会话撤销或权限降级的生效延迟。
window.addEventListener('visibilitychange', onPageVisible)
window.addEventListener('focus', onPageVisible)
onBeforeUnmount(() => {
  stopAuthorizationRefresh()
  window.removeEventListener('visibilitychange', onPageVisible)
  window.removeEventListener('focus', onPageVisible)
  lifecycle.destroy()
})
</script>

<template>
  <RouterView />
</template>
