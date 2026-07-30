<script setup>
import { onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import { createSessionLifecycle } from '@/modules/platform/auth/utils/sessionLifecycle'
import {
  AUTHORIZATION_REFRESH_INTERVAL_MS,
  dispatchAuthorizationRefreshed,
  principalFingerprint,
} from '@/modules/platform/auth/utils/authorizationRefresh'

const route = useRoute()
const router = useRouter()
const lifecycle = createSessionLifecycle({
  onSessionEnded: () => {
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
  if (loading || route.meta.requiresAuth !== true) return
  loading = true
  try {
    const principal = await getCurrentPrincipal()
    const nextFingerprint = principalFingerprint(principal)
    const changed = Boolean(latestPrincipalFingerprint) && latestPrincipalFingerprint !== nextFingerprint
    latestPrincipalFingerprint = nextFingerprint
    dispatchAuthorizationRefreshed(principal, { changed })
  } catch (error) {
    if (error instanceof AuthError && error.status === 401 && route.name !== 'login') {
      lifecycle.stop()
      stopAuthorizationRefresh()
      await router.replace({ name: 'login', query: { reason: 'session-ended' } })
    }
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

async function synchronizeProtectedSession(requiresAuth) {
  if (!requiresAuth) {
    lifecycle.stop()
    stopAuthorizationRefresh()
    latestPrincipalFingerprint = ''
    return
  }
  if (loading) return
  loading = true
  try {
    const principal = await getCurrentPrincipal()
    lifecycle.start(principal)
    latestPrincipalFingerprint = principalFingerprint(principal)
    dispatchAuthorizationRefreshed(principal)
    startAuthorizationRefresh()
  } catch (error) {
    lifecycle.stop()
    if (error instanceof AuthError && error.status === 401 && route.name !== 'login') {
      await router.replace({ name: 'login', query: { reason: 'session-ended' } })
    }
  } finally {
    loading = false
  }
}

watch(() => route.meta.requiresAuth === true, synchronizeProtectedSession, { immediate: true })
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
