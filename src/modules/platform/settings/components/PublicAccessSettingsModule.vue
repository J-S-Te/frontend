<script setup>
import { computed, onMounted, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  AccessSettingsError,
  applyAccessSettings,
  getAccessSettings,
  updateAccessSettings,
} from '@/modules/platform/settings/api/accessSettings'
import { hasPermission } from '@/modules/platform/auth/utils/principal'

const emit = defineEmits(['toast'])

const canRead = computed(() => hasPermission('platform:settings:read'))
const canUpdate = computed(() => hasPermission('platform:settings:update'))

const loading = ref(false)
const saving = ref(false)
const applying = ref(false)
const errorMessage = ref('')
const savedSettings = ref(null)
const form = ref({ publicOrigin: '', allowInsecureHTTPRedirect: false, version: 0 })

const isPublic = computed(() => form.value.publicOrigin.trim() !== '')
const derivedInsecureHTTP = computed(() => {
  const origin = form.value.publicOrigin.trim()
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
})

function showToast(message) {
  emit('toast', message)
}

function readError(error) {
  if (error instanceof AccessSettingsError && error.nextAction) {
    return `${error.message}。${error.nextAction}`
  }
  return error instanceof AccessSettingsError ? error.message : '对外访问配置读取失败。'
}

async function loadSettings() {
  if (!canRead.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const settings = await getAccessSettings()
    savedSettings.value = settings
    Object.assign(form.value, {
      publicOrigin: settings?.publicOrigin || '',
      allowInsecureHTTPRedirect: Boolean(settings?.allowInsecureHTTPRedirect),
      version: Number(settings?.version || 0),
    })
  } catch (error) {
    errorMessage.value = readError(error)
  } finally {
    loading.value = false
  }
}

function normalizePublicOrigin(value) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return url.origin
  } catch {
    return trimmed
  }
}

async function saveSettings() {
  if (!canUpdate.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const saved = await updateAccessSettings({
      publicOrigin: normalizePublicOrigin(form.value.publicOrigin),
      allowInsecureHTTPRedirect: form.value.allowInsecureHTTPRedirect || derivedInsecureHTTP.value,
      version: form.value.version,
    })
    savedSettings.value = saved
    Object.assign(form.value, {
      publicOrigin: saved.publicOrigin || '',
      allowInsecureHTTPRedirect: Boolean(saved.allowInsecureHTTPRedirect),
      version: Number(saved.version || 0),
    })
    showToast('对外访问配置已保存，点击“应用配置”才会生效。')
  } catch (error) {
    errorMessage.value = readError(error)
  } finally {
    saving.value = false
  }
}

async function applySettings() {
  if (!canUpdate.value || applying.value) return
  const target = form.value.publicOrigin.trim()
  const message = target
    ? `确定应用对外访问地址 ${normalizePublicOrigin(target)} 吗？会重建 api、contract-api、customer-api 和 frontend 容器，期间访问可能短暂中断。`
    : '确定恢复为“仅本机访问（127.0.0.1）”吗？会删除临时覆盖文件并重建相关容器。'
  if (!window.confirm(message)) return
  applying.value = true
  errorMessage.value = ''
  try {
    const saved = await applyAccessSettings()
    savedSettings.value = saved
    Object.assign(form.value, {
      publicOrigin: saved.publicOrigin || '',
      allowInsecureHTTPRedirect: Boolean(saved.allowInsecureHTTPRedirect),
      version: Number(saved.version || 0),
    })
    showToast(target ? '对外访问配置已应用。' : '已恢复为仅本机访问。')
  } catch (error) {
    errorMessage.value = readError(error)
  } finally {
    applying.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="console-card settings-card">
    <div class="console-card-body">
      <h2>对外访问</h2>
      <p class="console-card-hint">
        配置统一前端对外公开地址（例如 http://47.111.20.119:8081）。留空表示仅本机
        127.0.0.1 访问。保存后需点击“应用配置”，由部署 Agent 重写覆盖环境文件并重建容器。
      </p>
      <p v-if="loading" class="console-card-hint">正在读取配置…</p>
      <p v-else-if="errorMessage" class="login-target-module__error" role="alert">{{ errorMessage }}</p>

      <div v-if="canRead && !loading" class="console-form-grid">
        <label class="console-form-item">
          <span>公开访问地址</span>
          <input
            v-model="form.publicOrigin"
            inputmode="url"
            :disabled="!canUpdate"
            placeholder="留空 = 仅本机；例如 http://47.111.20.119:8081 或 https://portal.example.com"
            @input="errorMessage = ''"
          />
        </label>
        <label class="console-form-item">
          <span>允许 HTTP 回调</span>
          <label class="console-checkbox">
            <input v-model="form.allowInsecureHTTPRedirect" type="checkbox" :disabled="!canUpdate || derivedInsecureHTTP" />
            <span>允许非 HTTPS 的 OAuth 回调（公网 HTTP 地址会自动开启）</span>
          </label>
        </label>
      </div>

      <div v-if="canRead && !loading" class="console-form-actions">
        <button v-if="canUpdate" class="console-button primary" type="button" :disabled="saving" @click="saveSettings">
          <ConsoleIcon name="save" />{{ saving ? '保存中…' : '保存配置' }}
        </button>
        <button v-if="canUpdate" class="console-button primary" type="button" :disabled="applying || saving" @click="applySettings">
          <ConsoleIcon name="refresh" />{{ applying ? '应用中…' : isPublic ? '应用配置' : '恢复本机访问' }}
        </button>
        <button class="console-button ghost" type="button" :disabled="loading || saving" @click="loadSettings">重新读取</button>
      </div>

      <p v-if="savedSettings && !loading" class="console-card-hint">
        当前已保存：{{ savedSettings.publicOrigin || '仅本机访问' }}（版本 {{ savedSettings.version }}）
      </p>
    </div>
  </div>
</template>

<style scoped>
.console-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.console-checkbox input {
  width: auto;
}
</style>
