<script setup>
import { onMounted } from 'vue'

// CRM 直连登录（合同管理的“CRM 客户/商机”）使用本落地页：登录成功后自动关闭辅助标签页，
// 原合同页面通过轮询 CRM 会话继续加载目录。页面不读取业务数据、不展示账号信息。
function closeTab() {
  try { window.close() } catch { /* 浏览器拒绝脚本关闭时保留手动关闭入口。 */ }
}

onMounted(() => {
  // 等首帧渲染后再尝试关闭，避免弹窗还没来得及呈现就被用户感知为闪退。
  window.setTimeout(closeTab, 60)
})
</script>

<template>
  <main class="crm-login-complete">
    <h1>CRM 登录已完成</h1>
    <p>本页面会在登录完成后自动关闭。若浏览器未自动关闭，请手动关闭此标签页并返回合同表单继续操作。</p>
    <button type="button" @click="closeTab">关闭此标签页</button>
  </main>
</template>

<style scoped>
.crm-login-complete {
  display: grid;
  min-height: 100vh;
  place-content: center;
  gap: 14px;
  padding: 32px;
  color: #0f172a;
  text-align: center;
  background: #f8fafc;
}
.crm-login-complete h1 { margin: 0; font-size: 20px; }
.crm-login-complete p { max-width: 420px; margin: 0; color: #475569; font-size: 13px; line-height: 1.7; }
.crm-login-complete button {
  justify-self: center;
  min-height: 38px;
  padding: 0 18px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  border: 0;
  border-radius: 8px;
  background: #2563eb;
}
.crm-login-complete button:hover { background: #1d4ed8; }

/* 深色主题：登录完成页的浅灰底与墨色；浅色声明未改。 */
[data-theme="dark"] .crm-login-complete {
  color: var(--text);
  background: var(--surface-content);
}
[data-theme="dark"] .crm-login-complete p {
  color: var(--text-secondary);
}
[data-theme="dark"] .crm-login-complete button {
  color: var(--text-strong);
  background: var(--primary);
}
[data-theme="dark"] .crm-login-complete button:hover {
  background: var(--primary-dark);
}
</style>
