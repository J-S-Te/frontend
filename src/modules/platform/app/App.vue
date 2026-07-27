<script setup>
import { onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthError, getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import { createSessionLifecycle } from '@/modules/platform/auth/utils/sessionLifecycle'

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

async function synchronizeProtectedSession(requiresAuth) {
  if (!requiresAuth) {
    lifecycle.stop()
    return
  }
  if (loading) return
  loading = true
  try {
    const principal = await getCurrentPrincipal()
    lifecycle.start(principal)
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
onBeforeUnmount(() => lifecycle.destroy())
</script>

<template>
  <RouterView />
</template>
