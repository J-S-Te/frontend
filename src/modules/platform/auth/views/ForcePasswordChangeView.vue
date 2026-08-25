<script setup>
import { computed, ref } from 'vue'
import { changeOwnPassword } from '@/modules/platform/auth/api/auth'
import { resolveSameOriginRedirect } from '@/modules/platform/auth/utils/navigation'

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const error = ref('')

const passwordRules = computed(() => [
  { key: 'length', label: '至少 8 位', passed: newPassword.value.length >= 8 },
  { key: 'uppercase', label: '包含大写字母', passed: /[A-Z]/.test(newPassword.value) },
  { key: 'lowercase', label: '包含小写字母', passed: /[a-z]/.test(newPassword.value) },
  { key: 'number', label: '包含数字', passed: /\d/.test(newPassword.value) },
  { key: 'symbol', label: '包含特殊字符', passed: /[^A-Za-z0-9\s]/.test(newPassword.value) },
])

const passwordMeetsPolicy = computed(() => passwordRules.value.every((rule) => rule.passed))
const passwordsMatch = computed(() => Boolean(confirmPassword.value) && newPassword.value === confirmPassword.value)

function loginURLAfterPasswordChange() {
  const rawReturnTo = new URLSearchParams(window.location.search).get('return_to')
  const returnTo = rawReturnTo === null ? '' : resolveSameOriginRedirect(rawReturnTo)
  const target = new URL('/login', window.location.origin)
  target.searchParams.set('reason', 'password-changed')
  if (returnTo) {
    // 修改密码会撤销当前会话；重新登录后继续此前经过同源校验的 OIDC 授权请求。
    target.searchParams.set('return_to', returnTo)
  }
  return `${target.pathname}${target.search}`
}

async function submit() {
  error.value = ''
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    error.value = '请完整填写当前密码和新密码。'
    return
  }
  if (!passwordMeetsPolicy.value) {
    error.value = '新密码至少需要 8 位，并且需要包含大小写字母、数字和符号。'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致。'
    return
  }
  submitting.value = true
  try {
    await changeOwnPassword({ currentPassword: currentPassword.value, newPassword: newPassword.value })
    window.location.assign(loginURLAfterPasswordChange())
  } catch (value) {
    error.value = `${value.message || '密码修改失败，请稍后重试。'}${value.traceId ? `（追踪号：${value.traceId}）` : ''}`
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="brand-panel" aria-label="基础能力平台安全能力">
      <div class="brand-grid"></div>
      <div class="brand-glow brand-glow-top"></div>
      <div class="brand-glow brand-glow-bottom"></div>
      <header class="brand-logo">
        <span class="brand-logo-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 4.5 5.4v5.1c0 4.7 3.2 9 7.5 10.2 4.3-1.2 7.5-5.5 7.5-10.2V5.4L12 2Zm0 2.2 5.5 2.5v3.8c0 3.5-2.2 6.8-5.5 8-3.3-1.2-5.5-4.5-5.5-8V6.7L12 4.2Z" /></svg></span>
        <span><strong>基础能力平台</strong><small>Basic Capability Platform</small></span>
      </header>
      <div class="brand-content">
        <p class="brand-eyebrow"><span></span>首次登录安全设置</p>
        <h1>先完成设置<br /><span>再开启安全访问</span></h1>
        <p class="brand-description">首次登录需要完成密码更新。新的密码将用于保护统一身份、业务系统访问和安全审计。</p>
        <ul class="capability-list" aria-label="密码设置说明">
          <li><span class="capability-icon"><svg viewBox="0 0 24 24"><path d="M18 9h-1V7a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v9h16v-9a2 2 0 0 0-2-2Zm-9-2a3 3 0 1 1 6 0v2H9V7Zm9 11H6v-7h12v7Z" /></svg></span><span><strong>独立密码</strong><small>请勿与其他系统重复使用</small></span></li>
          <li><span class="capability-icon"><svg viewBox="0 0 24 24"><path d="M12 2 4.5 5.4v5.1c0 4.7 3.2 9 7.5 10.2 4.3-1.2 7.5-5.5 7.5-10.2V5.4L12 2Zm0 2.2 5.5 2.5v3.8c0 3.5-2.2 6.8-5.5 8-3.3-1.2-5.5-4.5-5.5-8V6.7L12 4.2Z" /></svg></span><span><strong>安全规则</strong><small>至少 8 位，包含四类字符</small></span></li>
          <li><span class="capability-icon"><svg viewBox="0 0 24 24"><path d="m9.2 16.6-4-4L3.8 14l5.4 5.4L20.2 8.4 18.8 7 9.2 16.6Z" /></svg></span><span><strong>完成即生效</strong><small>保存后重新登录平台</small></span></li>
        </ul>
      </div>
      <footer class="brand-footer"><span>© {{ new Date().getFullYear() }} 基础能力平台</span><span class="brand-footer-status"><i></i>安全服务运行中</span></footer>
    </section>

    <section class="form-panel" aria-label="首次登录修改密码">
      <div class="mobile-brand"><span class="mobile-logo">基</span><span>基础能力平台</span></div>
      <div class="login-card force-password-card">
        <header class="login-header">
          <span class="login-kicker">FIRST LOGIN SECURITY</span>
          <h2 id="force-password-heading">首次登录，请修改密码</h2>
        <p>管理员为你设置了初始密码或重置了账户密码。修改完成后需要重新登录，才能进入基础能力平台。</p>
        </header>
        <form class="force-password-form" novalidate @submit.prevent="submit">
          <div class="field-group"><label for="current-password">当前密码</label><div class="input-wrap"><input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" required /></div></div>
          <div class="field-group"><label for="new-password">新密码</label><div class="input-wrap"><input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" minlength="8" required /></div></div>
          <div class="field-group"><label for="confirm-password">确认新密码</label><div class="input-wrap"><input id="confirm-password" v-model="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></div></div>
          <div class="password-policy" aria-live="polite">
            <strong>密码设置要求</strong>
            <span>新密码需要同时满足以下规则：</span>
            <ul class="password-policy-rules">
              <li v-for="rule in passwordRules" :key="rule.key" :class="{ passed: rule.passed }">
                <span aria-hidden="true">{{ rule.passed ? '✓' : '○' }}</span>{{ rule.label }}
              </li>
              <li :class="{ passed: passwordsMatch }">
                <span aria-hidden="true">{{ passwordsMatch ? '✓' : '○' }}</span>两次输入一致
              </li>
            </ul>
          </div>
          <p v-if="error" class="form-message error" role="alert"><span>{{ error }}</span></p>
          <button class="login-button" type="submit" :disabled="submitting"><span>{{ submitting ? '保存中…' : '保存新密码' }}</span><svg v-if="!submitting" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 5-1.4 1.4 4.6 4.6H4v2h12.2l-4.6 4.6L13 19l7-7-7-7Z" /></svg></button>
          <p class="force-password-note">保存后当前初始密码将失效，请使用新密码重新登录。</p>
        </form>
      </div>
      <footer class="form-footer"><span>统一身份认证</span><i></i><span>权限管控</span><i></i><span>安全审计</span></footer>
    </section>
  </main>
</template>

<style scoped>
.password-policy-rules {
  margin: 4px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
  list-style: none;
}

.password-policy-rules li {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #64748b;
}

.password-policy-rules li.passed {
  color: #15803d;
}

.password-policy-rules li span {
  width: 14px;
  flex: 0 0 14px;
  font-weight: 700;
  text-align: center;
}

@media (max-width: 520px) {
  .password-policy-rules {
    grid-template-columns: 1fr;
  }
}
</style>
