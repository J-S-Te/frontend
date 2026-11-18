<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { THEME_MODES, THEME_STORAGE_KEY, THEME_PREFERENCE_CHANGED_EVENT,
  readThemePreference, writeThemePreference } from '../theme/themePreference.js'
import { SIDEBAR_COLLAPSED_STORAGE_KEY, readSidebarCollapsed,
  writeSidebarCollapsed } from '../utils/shellPreferences.js'

const props = defineProps({ sidebarId: { type: String, required: true } })
const emit = defineEmits(['collapse-change'])
const collapsed = ref(readSidebarCollapsed())
const theme = ref(readThemePreference())
const labels = { light: '浅色', dark: '深色', system: '跟随系统' }

// syncPreferences 同步门户或其他标签页改变的外壳偏好。
// 参数：event 为可选的存储变更事件。
// 返回值：无。
function syncPreferences(event) {
  if (event?.type === 'storage' && event.key !== null &&
      ![THEME_STORAGE_KEY, SIDEBAR_COLLAPSED_STORAGE_KEY].includes(event.key)) return
  theme.value = readThemePreference()
  collapsed.value = readSidebarCollapsed()
  emit('collapse-change', collapsed.value)
}

// toggleCollapsed 切换并持久化桌面侧栏折叠。
// 参数：无。
// 返回值：无；存储失败不会阻断当前页面布局。
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  writeSidebarCollapsed(collapsed.value)
  emit('collapse-change', collapsed.value)
}

// selectTheme 更新与门户一致的主题偏好及文档主题。
// 参数：event 为原生选择框事件。
// 返回值：无；不接受未定义的主题值。
function selectTheme(event) {
  const value = event.target.value
  if (!THEME_MODES.includes(value)) return
  theme.value = value
  writeThemePreference(value)
}

onMounted(() => {
  syncPreferences()
  window.addEventListener('storage', syncPreferences)
  window.addEventListener(THEME_PREFERENCE_CHANGED_EVENT, syncPreferences)
})
onBeforeUnmount(() => {
  window.removeEventListener('storage', syncPreferences)
  window.removeEventListener(THEME_PREFERENCE_CHANGED_EVENT, syncPreferences)
})
</script>

<template>
  <div class="shell-preferences">
    <button type="button" class="shell-preferences-collapse" :aria-controls="props.sidebarId"
      :aria-expanded="!collapsed" @click="toggleCollapsed">{{ collapsed ? '展开侧栏' : '收起侧栏' }}</button>
    <label><span class="shell-preferences-label">主题</span><select :value="theme" aria-label="界面主题" @change="selectTheme">
      <option v-for="mode in THEME_MODES" :key="mode" :value="mode">{{ labels[mode] }}</option>
    </select></label>
  </div>
</template>

<style scoped>
.shell-preferences { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.shell-preferences button, .shell-preferences select { min-height: 32px; padding: 4px 7px; border: 1px solid var(--border); border-radius: var(--radius-sm, 6px); color: var(--text); background: var(--surface-card); font: inherit; font-size: var(--fs-xs); }
.shell-preferences label { display: flex; align-items: center; gap: 4px; margin: 0; }
.shell-preferences-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 900px) { .shell-preferences-collapse { display: none; } }
</style>
