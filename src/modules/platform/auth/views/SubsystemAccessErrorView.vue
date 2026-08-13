<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  SUBSYSTEM_ACCESS_PRESENTATION,
  SUBSYSTEM_ACCESS_REASON,
} from '@/modules/shared/authz/sessionCompatibility'

const route = useRoute()
const router = useRouter()

const reason = computed(() => Object.values(SUBSYSTEM_ACCESS_REASON).includes(route.query.reason)
  ? route.query.reason
  : SUBSYSTEM_ACCESS_REASON.UNKNOWN)
const presentation = computed(() => SUBSYSTEM_ACCESS_PRESENTATION[reason.value] || SUBSYSTEM_ACCESS_PRESENTATION.UNKNOWN)
const fromPath = computed(() => {
  const value = typeof route.query.from === 'string' ? route.query.from : ''
  return value.startsWith('/') && !value.startsWith('/access-error') ? value : ''
})
const errorCode = computed(() => typeof route.query.code === 'string' ? route.query.code : '')
const requestID = computed(() => typeof route.query.request_id === 'string' ? route.query.request_id : '')
const canRetry = computed(() => reason.value === SUBSYSTEM_ACCESS_REASON.DEPENDENCY_UNAVAILABLE && Boolean(fromPath.value))
const canRelogin = computed(() => [SUBSYSTEM_ACCESS_REASON.OIDC_CLAIMS_INVALID, SUBSYSTEM_ACCESS_REASON.UNAUTHENTICATED].includes(reason.value))

function loginURL() {
  const target = fromPath.value || '/portal'
  if (target.startsWith('/contract_management')) return '/contract_management/auth/login'
  if (target.startsWith('/project_management')) return '/project_management/auth/login'
  if (target.startsWith('/customer-opportunity')) return `/customer-opportunity/auth/login?return_to=${encodeURIComponent(target)}`
  if (target.startsWith('/customer-portal')) return `/customer-portal/auth/login?return_to=${encodeURIComponent(target)}`
  return '/login'
}

function retry() {
  router.replace(fromPath.value || '/portal')
}

function relogin() {
  window.location.assign(loginURL())
}
</script>

<template>
  <main class="access-error-page">
    <section class="access-error-card" role="alert" aria-live="polite">
      <span class="access-error-icon" aria-hidden="true"><ConsoleIcon name="shield" /></span>
      <p class="access-error-eyebrow">统一认证访问检查</p>
      <h1>{{ presentation.title }}</h1>
      <p class="access-error-message">{{ presentation.message }}</p>
      <dl v-if="errorCode || requestID" class="access-error-diagnostics">
        <div v-if="errorCode"><dt>错误代码</dt><dd><code>{{ errorCode }}</code></dd></div>
        <div v-if="requestID"><dt>追踪号</dt><dd><code>{{ requestID }}</code></dd></div>
      </dl>
      <div class="access-error-actions">
        <button v-if="canRetry" type="button" class="primary" @click="retry">重试访问</button>
        <button v-if="canRelogin" type="button" class="primary" @click="relogin">重新发起 Keycloak 登录</button>
        <button type="button" class="ghost" @click="router.push({ name: 'portal' })">返回子系统门户</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.access-error-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: linear-gradient(145deg, #f4f7fb, #eaf0f8);
  color: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.access-error-card {
  width: min(560px, 100%);
  padding: 40px;
  border: 1px solid #dbe4f0;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 22px 55px -32px rgba(15, 23, 42, .45);
  text-align: center;
}
.access-error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  border-radius: 16px;
  color: #2563eb;
  background: #eff6ff;
}
.access-error-eyebrow {
  margin: 18px 0 6px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .12em;
}
h1 { margin: 0; font-size: 25px; }
.access-error-message { margin: 16px auto 0; max-width: 460px; color: #475569; line-height: 1.8; }
.access-error-diagnostics {
  margin: 24px 0 0;
  padding: 14px 18px;
  border-radius: 10px;
  background: #f8fafc;
  text-align: left;
}
.access-error-diagnostics div { display: grid; grid-template-columns: 72px 1fr; gap: 10px; padding: 4px 0; }
.access-error-diagnostics dt { color: #64748b; }
.access-error-diagnostics dd { margin: 0; min-width: 0; word-break: break-all; }
.access-error-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin-top: 26px; }
.access-error-actions button { padding: 10px 18px; border-radius: 9px; cursor: pointer; font: inherit; }
.access-error-actions .primary { border: 1px solid #2563eb; background: #2563eb; color: white; }
.access-error-actions .ghost { border: 1px solid #cbd5e1; background: white; color: #334155; }
</style>
