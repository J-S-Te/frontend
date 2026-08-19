<script setup>
import { ref } from 'vue'
import { changeOwnPassword } from '@/modules/platform/auth/api/auth'

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    error.value = '请完整填写当前密码和新密码。'
    return
  }
  if (newPassword.value.length < 8) {
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
    window.location.assign('/login?reason=password-changed')
  } catch (value) {
    error.value = `${value.message || '密码修改失败，请稍后重试。'}${value.traceId ? `（追踪号：${value.traceId}）` : ''}`
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card force-password-card" aria-labelledby="force-password-heading">
      <header class="login-header">
        <span class="login-kicker">FIRST LOGIN SECURITY</span>
        <h1 id="force-password-heading">首次登录，请修改密码</h1>
        <p>管理员为你设置了初始密码。修改完成后需要重新登录，才能进入基础能力平台。</p>
      </header>
      <form class="login-form" @submit.prevent="submit">
        <label>当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" required /></label>
        <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" minlength="8" required /></label>
        <label>确认新密码<input v-model="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label>
        <p class="login-hint">新密码至少 8 位，并需包含大小写字母、数字和符号。</p>
        <p v-if="error" class="login-error" role="alert">{{ error }}</p>
        <button class="login-button" type="submit" :disabled="submitting">{{ submitting ? '保存中…' : '修改密码' }}</button>
      </form>
    </section>
  </main>
</template>
