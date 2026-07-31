<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'

// 路由守卫把无权访问的用户送来这里。`from` 是用户原本想去的路径，渲染时透出
// 让用户知道为什么被拦下，也方便管理员复现问题。
const route = useRoute()
const router = useRouter()

const fromPath = computed(() => {
  const raw = route.query.from
  if (typeof raw === 'string' && raw && raw.startsWith('/')) return raw
  return ''
})

function goPortal() {
  router.push({ name: 'portal' })
}

function goLogin() {
  router.push({ name: 'login', query: { reason: 'forbidden' } })
}
</script>

<template>
  <div class="forbidden-page">
    <div class="forbidden-card" role="alert" aria-live="polite">
      <span class="forbidden-icon" aria-hidden="true">
        <ConsoleIcon name="shield" />
      </span>
      <h1 class="forbidden-title">无权访问</h1>
      <p class="forbidden-subtitle">
        当前账号没有访问该模块的权限，请联系平台管理员调整角色或权限。
      </p>
      <p v-if="fromPath" class="forbidden-meta">
        原始请求：<code>{{ fromPath }}</code>
      </p>
      <div class="forbidden-actions">
        <button type="button" class="forbidden-button primary" @click="goPortal">
          返回子系统门户
        </button>
        <button type="button" class="forbidden-button ghost" @click="goLogin">
          切换账号
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.forbidden-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f5f7fb 0%, #eef1f7 100%);
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.forbidden-card {
  max-width: 440px;
  width: 100%;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 18px 48px -16px rgba(15, 23, 42, 0.18);
  padding: 40px 32px;
  text-align: center;
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.forbidden-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
  margin-bottom: 20px;
}

.forbidden-title {
  font-size: 22px;
  font-weight: 600;
  color: #0f172a;
  margin: 0 0 8px;
}

.forbidden-subtitle {
  font-size: 14px;
  line-height: 1.7;
  color: #475569;
  margin: 0 0 16px;
}

.forbidden-meta {
  font-size: 12px;
  color: #64748b;
  margin: 0 0 24px;
  word-break: break-all;
}

.forbidden-meta code {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #0f172a;
}

.forbidden-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.forbidden-button {
  font-size: 14px;
  padding: 8px 18px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.forbidden-button.primary {
  background: #1e293b;
  color: #ffffff;
  border: 1px solid #1e293b;
}

.forbidden-button.primary:hover {
  background: #0f172a;
}

.forbidden-button.ghost {
  background: transparent;
  color: #1e293b;
  border: 1px solid #cbd5e1;
}

.forbidden-button.ghost:hover {
  background: #f1f5f9;
}
</style>
