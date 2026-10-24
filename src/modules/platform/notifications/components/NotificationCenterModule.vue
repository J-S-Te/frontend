<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { hasPermission } from '@/modules/platform/auth/utils/principal'
import LoadingState from '@/modules/platform/shared/components/LoadingState.vue'
import EmptyState from '@/modules/platform/shared/components/EmptyState.vue'
import { changeNotificationTemplateStatus, createNotificationTemplate, createNotificationTemplateVersion, getNotification, getNotificationSettings, getUnreadCount, listInbox, listNotificationDeliveries, listNotificationTemplates, markAllNotificationsRead, markNotificationRead, retryFailedNotificationDeliveries, updateNotificationSettings } from '@/modules/platform/notifications/api/notifications'
import '@/modules/platform/notifications/styles/notification-center.css'
import { formatUserError } from '../../../shared/utils/userError.js'

const emit = defineEmits(['toast'])
const tab = ref('inbox'), loading = ref(false), error = ref(''), items = ref([]), unreadCount = ref(0), detail = ref(null), templates = ref([]), deliveries = ref([]), deliveryStatus = ref('')
const settings = reactive({ inbox_enabled: true, email_enabled: false, reminder_frequency: 'IMMEDIATE', version: 1 })
const templateForm = reactive({ code: '', name: '', status: 'ACTIVE', title_template: '', body_template: '' })
const working = ref(false)
const canReadTemplates = computed(() => hasPermission('platform:notification:template:read'))
const canCreateTemplates = computed(() => hasPermission('platform:notification:template:create'))
const canUpdateTemplates = computed(() => hasPermission('platform:notification:template:update'))
const canOperate = computed(() => hasPermission('platform:notification:operate'))
const canReadSettings = computed(() => hasPermission('platform:notification-setting:read'))
const canUpdateSettings = computed(() => hasPermission('platform:notification-setting:update'))
const visibleTabs = computed(() => [{ key: 'inbox', label: '我的通知', visible: true }, { key: 'templates', label: '模板管理', visible: canReadTemplates.value || canCreateTemplates.value }, { key: 'deliveries', label: '投递记录', visible: canOperate.value }, { key: 'settings', label: '通知设置', visible: canReadSettings.value || canUpdateSettings.value }].filter((item) => item.visible))
const normalize = (err, fallback) => formatUserError(err, { fallback })
function safeTarget(value) { try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : '' } catch { return '' } }
async function loadInbox() { const [page, count] = await Promise.all([listInbox({ pageSize: 50 }), getUnreadCount()]); items.value = page?.items || []; unreadCount.value = Number(count?.unread_count || 0) }
async function loadTemplates() { const result = await listNotificationTemplates(); templates.value = result?.items || [] }
async function loadDeliveries() { const result = await listNotificationDeliveries({ status: deliveryStatus.value }); deliveries.value = result?.items || [] }
async function loadSettings() { Object.assign(settings, (await getNotificationSettings()) || {}) }
async function refresh() { loading.value = true; error.value = ''; try { if (tab.value === 'inbox') await loadInbox(); if (tab.value === 'templates') await loadTemplates(); if (tab.value === 'deliveries') await loadDeliveries(); if (tab.value === 'settings') await loadSettings() } catch (err) { error.value = normalize(err, '读取通知数据失败。') } finally { loading.value = false } }
async function switchTab(next) { tab.value = next; await refresh() }
async function open(item) { try { detail.value = await getNotification(item.delivery_id); if (!item.read_at) { await markNotificationRead(item.delivery_id); await loadInbox() } } catch (err) { error.value = normalize(err, '读取通知详情失败。') } }
async function runAction(write, success, reload, failureHint) {
  if (working.value || loading.value) return
  working.value = true; error.value = ''
  try {
    const result = await write()
    emit('toast', typeof success === 'function' ? success(result) : success)
    if (reload) {
      // 写入已经成功：刷新失败只提示重新加载，不能用报错诱导用户重复提交。
      try { await reload() }
      catch (err) { error.value = `操作已完成，但列表刷新失败。${normalize(err, '请重新加载查看最新记录，不要重复提交。')}` }
    }
  } catch (err) {
    // 没有 HTTP 响应（status 为空/0）时写请求结果未知，必须先核对记录再重试。
    const unknownOutcome = Boolean(failureHint) && !err?.status
    error.value = unknownOutcome ? failureHint : normalize(err, '操作未完成，请检查数据后重试。')
  }
  finally { working.value = false }
}
async function readAll() { await runAction(markAllNotificationsRead, '全部通知已标记为已读。', loadInbox) }
async function submitTemplate() {
  await runAction(async () => { const result = await createNotificationTemplate({ ...templateForm, variables: [] }); Object.assign(templateForm, { code: '', name: '', status: 'ACTIVE', title_template: '', body_template: '' }); return result }, '通知模板已创建。', loadTemplates)
}
async function newVersion(template) { if (working.value) return; const title = window.prompt('新版本标题模板', ''); if (title === null) return; const body = window.prompt('新版本正文模板', ''); if (body === null) return; await runAction(() => createNotificationTemplateVersion(template.id, { title_template: title, body_template: body, variables: [] }), '模板新版本已发布。', loadTemplates) }
async function toggleTemplate(template) { await runAction(() => changeNotificationTemplateStatus(template.id, template.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', template.version), '模板状态已更新。', loadTemplates) }
async function retryFailed() {
  await runAction(
    () => retryFailedNotificationDeliveries(50),
    result => `已领取 ${result?.claimed || 0} 条失败投递：成功 ${result?.delivered || 0} 条${result?.failed ? `，仍失败 ${result.failed} 条（可再次重试或先核对记录）` : ''}。`,
    loadDeliveries,
    '重试请求结果未知：请先核对投递记录，确认没有重复领取后再重试。',
  )
}
async function saveSettings() { await runAction(async () => { Object.assign(settings, await updateNotificationSettings({ inboxEnabled: settings.inbox_enabled, reminderFrequency: settings.reminder_frequency, version: settings.version })) }, '通知设置已保存。') }
onMounted(refresh)
</script>

<template>
  <section class="notification-center"><header class="notification-center-head"><div><span class="notification-kicker">NOTIFICATION OPERATIONS</span><h2>通知中心 <b v-if="unreadCount">{{ unreadCount }}</b></h2><p>站内信、模板、投递状态和租户通知偏好统一运营；目标业务仍会重新授权。</p></div><button class="console-button ghost" :disabled="loading" @click="refresh">刷新</button></header>
    <nav class="notification-tabs"><button v-for="item in visibleTabs" :key="item.key" :class="{ active: tab === item.key }" @click="switchTab(item.key)">{{ item.label }}</button></nav><p v-if="error" class="notification-error">{{ error }}</p><LoadingState v-if="loading" title="正在加载通知数据…" compact />
    <template v-else-if="tab === 'inbox'"><div class="notification-actions"><button class="console-button primary small" :disabled="!unreadCount" @click="readAll">全部已读</button></div><EmptyState v-if="!items.length" title="暂无站内信" compact /><div v-else class="notification-list"><button v-for="item in items" :key="item.delivery_id" class="notification-item" :class="{ unread: !item.read_at }" @click="open(item)"><span class="notification-dot" /><span><small>{{ item.category }}</small><strong>{{ item.title }}</strong><p>{{ item.content }}</p><time>{{ item.delivered_at }}</time></span></button></div></template>
    <template v-else-if="tab === 'templates'"><form v-if="canCreateTemplates" class="notification-form" @submit.prevent="submitTemplate"><input v-model="templateForm.code" placeholder="模板编码" required  maxlength="128"/><input v-model="templateForm.name" placeholder="模板名称" required  maxlength="128"/><input v-model="templateForm.title_template" placeholder="标题模板" required  maxlength="500"/><textarea v-model="templateForm.body_template" placeholder="正文模板" required  maxlength="16000"/><button class="console-button primary small">创建模板</button></form><div class="notification-table"><table class="console-data-table"><thead><tr><th>编码</th><th>名称</th><th>状态</th><th>当前版本</th><th>操作</th></tr></thead><tbody><tr v-if="!templates.length"><td colspan="5">暂无模板。</td></tr><tr v-for="item in templates" :key="item.id"><td><code>{{ item.code }}</code></td><td>{{ item.name }}</td><td>{{ item.status }}</td><td>{{ item.current_version }}</td><td><button v-if="canUpdateTemplates" class="console-button ghost small" @click="newVersion(item)">新版本</button><button v-if="canUpdateTemplates" class="console-button ghost small" @click="toggleTemplate(item)">{{ item.status === 'ACTIVE' ? '停用' : '启用' }}</button></td></tr></tbody></table></div></template>
    <template v-else-if="tab === 'deliveries'"><div class="notification-actions"><select v-model="deliveryStatus" @change="refresh"><option value="">全部状态</option><option>PENDING</option><option>PROCESSING</option><option>DELIVERED</option><option>FAILED</option></select><button class="console-button primary small" @click="retryFailed">重试失败投递</button></div><div class="notification-table"><table class="console-data-table"><thead><tr><th>投递 ID</th><th>收件人</th><th>状态</th><th>尝试</th><th>下次重试</th></tr></thead><tbody><tr v-if="!deliveries.length"><td colspan="5">暂无投递记录。</td></tr><tr v-for="item in deliveries" :key="item.id"><td><code>{{ item.id }}</code></td><td><code>{{ item.recipient_user_id }}</code></td><td>{{ item.status }}</td><td>{{ item.attempt_count }}</td><td>{{ item.next_attempt_at || '—' }}</td></tr></tbody></table></div></template>
    <template v-else><form class="notification-settings" @submit.prevent="saveSettings"><label><span>站内信</span><input v-model="settings.inbox_enabled" type="checkbox" :disabled="!canUpdateSettings" /></label><label><span>提醒频率</span><select v-model="settings.reminder_frequency" :disabled="!canUpdateSettings"><option value="IMMEDIATE">即时（创建即可见）</option><option value="DAILY">每日汇总（每日 09:00 北京时间可见）</option><option value="WEEKLY">每周汇总（每周一 09:00 北京时间可见）</option><option value="NEVER">不提醒（不进入站内信）</option></select></label><label class="disabled"><span>邮件通知</span><input type="checkbox" disabled /><small>尚未部署邮件提供方和投递 Worker，已强制关闭。</small></label><button v-if="canUpdateSettings" class="console-button primary">保存设置</button></form></template>
    <aside v-if="detail" class="notification-detail"><header><h3>{{ detail.title }}</h3><button @click="detail = null">×</button></header><p>{{ detail.content }}</p><a v-if="safeTarget(detail.target_url)" :href="safeTarget(detail.target_url)">查看关联内容</a></aside>
  </section>
</template>

<style scoped>
.notification-tabs{display:flex;gap:8px;margin:0 0 18px;border-bottom:1px solid #e2e8f0}.notification-tabs button{padding:10px 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:#64748b;cursor:pointer}.notification-tabs button.active{border-color:#2563eb;color:#1d4ed8;font-weight:700}.notification-actions{display:flex;justify-content:flex-end;gap:10px;margin:0 0 12px}.notification-actions select,.notification-form input,.notification-form textarea,.notification-settings select{padding:9px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff}.notification-form{display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px;margin-bottom:16px}.notification-form textarea{grid-column:1/-2}.notification-table{overflow:auto;border:1px solid #e2e8f0;border-radius:10px}.notification-table code{overflow-wrap:anywhere}.notification-settings{display:grid;gap:14px;max-width:620px}.notification-settings label{display:grid;grid-template-columns:160px 1fr;align-items:center;gap:10px;padding:14px;border:1px solid #e2e8f0;border-radius:9px}.notification-settings label.disabled{background:#f8fafc}.notification-settings small{grid-column:2;color:#64748b}@media(max-width:760px){.notification-form{grid-template-columns:1fr}.notification-form textarea{grid-column:auto}}
</style>
