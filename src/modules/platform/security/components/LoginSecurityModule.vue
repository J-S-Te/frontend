<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  SecurityError,
  getLoginPolicy,
  listLockedAccounts,
  unlockAccount,
  updateLoginPolicy,
} from '@/modules/platform/security/api/security'
import '@/modules/platform/security/styles/login-security.css'

const emit = defineEmits(['toast'])

const loginPolicy = reactive({ maxFailedAttempts: 5, lockoutDurationSeconds: 900, failureResetWindowSeconds: 1800, idleTimeoutSeconds: 1800, version: 0 })
const policyLoading = ref(false)
const policySaving = ref(false)
const policyError = ref('')
const lockedAccounts = ref([])
const lockedLoading = ref(false)
const lockedError = ref('')
const activeLockCount = computed(() => lockedAccounts.value.length)

function emitToast(message) {
  emit('toast', message)
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

async function loadLoginPolicy() {
  policyLoading.value = true
  policyError.value = ''
  try {
    const data = await getLoginPolicy()
    if (data) {
      loginPolicy.maxFailedAttempts = Number(data.max_failed_attempts || 0)
      loginPolicy.lockoutDurationSeconds = Number(data.lockout_duration_seconds || 0)
      loginPolicy.failureResetWindowSeconds = Number(data.failure_reset_window_seconds || 0)
      loginPolicy.idleTimeoutSeconds = Number(data.idle_timeout_seconds || 1800)
      loginPolicy.version = Number(data.version || 0)
    }
  } catch (error) {
    policyError.value = error instanceof SecurityError ? error.message : '读取登录策略失败。'
  } finally {
    policyLoading.value = false
  }
}

async function saveLoginPolicy() {
  if (policySaving.value) return
  policySaving.value = true
  policyError.value = ''
  try {
    const data = await updateLoginPolicy({
      maxFailedAttempts: Number(loginPolicy.maxFailedAttempts || 0),
      lockoutDurationSeconds: Number(loginPolicy.lockoutDurationSeconds || 0),
      failureResetWindowSeconds: Number(loginPolicy.failureResetWindowSeconds || 0),
      idleTimeoutSeconds: Number(loginPolicy.idleTimeoutSeconds || 0),
      version: loginPolicy.version,
    })
    if (data) loginPolicy.version = Number(data.version || loginPolicy.version)
    emitToast('登录安全策略已保存。')
  } catch (error) {
    policyError.value = error instanceof SecurityError ? error.message : '保存登录策略失败。'
  } finally {
    policySaving.value = false
  }
}

async function loadLockedAccounts() {
  lockedLoading.value = true
  lockedError.value = ''
  try {
    const data = await listLockedAccounts({ page: 1, pageSize: 100 })
    lockedAccounts.value = data.items
  } catch (error) {
    lockedError.value = error instanceof SecurityError ? error.message : '读取锁定账号失败。'
    lockedAccounts.value = []
  } finally {
    lockedLoading.value = false
  }
}

async function handleUnlockAccount(account) {
  if (!account?.account_id) return
  try {
    await unlockAccount(account.account_id)
    lockedAccounts.value = lockedAccounts.value.filter((item) => item.account_id !== account.account_id)
    emitToast(`已解锁账号 ${account.account_name || account.account_id}。`)
  } catch (error) {
    emitToast(error.message || '解锁失败。')
  }
}

function formatDuration(seconds) {
  if (!seconds) return '—'
  const minutes = Math.round(Number(seconds) / 60)
  return minutes >= 1 ? `${minutes} 分钟` : `${seconds} 秒`
}

onMounted(async () => {
  await Promise.all([loadLoginPolicy(), loadLockedAccounts()])
})
</script>

<template>
  <section class="login-security" aria-labelledby="login-security-heading">
    <div class="so-summary-grid">
      <article class="so-summary-card blue"><span><ConsoleIcon name="shield" /></span><div><small>当前锁定账号</small><strong>{{ activeLockCount }}</strong><p>登录失败锁定状态</p></div></article>
      <article class="so-summary-card violet"><span><ConsoleIcon name="link" /></span><div><small>登录失败阈值</small><strong>{{ loginPolicy.maxFailedAttempts || '—' }}</strong><p>达到后自动锁定</p></div></article>
      <article class="so-summary-card orange"><span><ConsoleIcon name="bell" /></span><div><small>锁定时长</small><strong>{{ formatDuration(loginPolicy.lockoutDurationSeconds) }}</strong><p>超过时限自动恢复</p></div></article>
      <article class="so-summary-card green"><span><ConsoleIcon name="settings" /></span><div><small>无操作退出</small><strong>{{ formatDuration(loginPolicy.idleTimeoutSeconds) }}</strong><p>超时后统一退出全部系统</p></div></article>
    </div>

    <section class="so-content">
      <header class="so-panel-head"><div><h2 id="login-security-heading">登录安全</h2><p>集中配置失败尝试、账户锁定和会话无操作退出策略。</p></div></header>
      <p v-if="policyError" class="login-target-module__error" role="alert">{{ policyError }}</p>
      <p v-if="lockedError" class="login-target-module__error" role="alert">{{ lockedError }}</p>

      <article class="so-card so-policy-card">
        <header><div><h3>认证与锁定策略</h3><p>统一由 IAM / Security 模块执行，业务系统不保存密码和失败记录。</p></div><span class="so-status success">统一生效</span></header>
        <div class="so-policy-grid">
          <label><span>最大失败次数</span><input v-model.number="loginPolicy.maxFailedAttempts" type="number" min="1" max="20" :disabled="policyLoading" /><small>达到阈值后锁定账号</small></label>
          <label><span>锁定时长（秒）</span><input v-model.number="loginPolicy.lockoutDurationSeconds" type="number" min="60" :disabled="policyLoading" /><small>{{ formatDuration(loginPolicy.lockoutDurationSeconds) }}</small></label>
          <label><span>失败记录重置（秒）</span><input v-model.number="loginPolicy.failureResetWindowSeconds" type="number" min="60" :disabled="policyLoading" /><small>{{ formatDuration(loginPolicy.failureResetWindowSeconds) }}</small></label>
          <label><span>无操作退出（秒）</span><input v-model.number="loginPolicy.idleTimeoutSeconds" type="number" min="60" max="86400" :disabled="policyLoading" /><small>{{ formatDuration(loginPolicy.idleTimeoutSeconds) }}无操作后退出所有应用系统</small></label>
        </div>
        <footer><button class="console-button primary" type="button" :disabled="policySaving" @click="saveLoginPolicy"><ConsoleIcon name="save" />{{ policySaving ? '保存中…' : '保存安全策略' }}</button><button class="console-button ghost" type="button" :disabled="policyLoading" @click="loadLoginPolicy">重新读取</button></footer>
      </article>

      <article class="so-card so-table-card">
        <header><div><h3>已锁定账号</h3><p>管理员可手动解锁，相关操作继续写入基础审计日志。</p></div><span class="so-status warning">{{ lockedAccounts.length }} 个</span></header>
        <div class="console-table-scroll">
          <table class="console-data-table">
            <thead><tr><th>账号</th><th>账号 ID</th><th>失败次数</th><th>最近失败时间</th><th>锁定至</th><th class="console-actions-cell">操作</th></tr></thead>
            <tbody>
              <tr v-if="lockedLoading"><td class="console-empty" colspan="6">正在读取锁定账号…</td></tr>
              <tr v-else-if="!lockedAccounts.length"><td colspan="6" class="console-empty">当前没有锁定账号。</td></tr>
              <tr v-for="item in lockedAccounts" :key="item.account_id">
                <td>{{ item.account_name || '—' }}</td>
                <td class="console-mono">{{ item.account_id }}</td>
                <td>{{ item.failure_count ?? 0 }}</td>
                <td class="console-mono">{{ formatDateTime(item.last_failed_at) }}</td>
                <td class="console-mono">{{ formatDateTime(item.locked_until) }}</td>
                <td class="console-actions-cell"><button class="console-text-button" type="button" @click="handleUnlockAccount(item)">手动解锁</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>
  </section>
</template>
