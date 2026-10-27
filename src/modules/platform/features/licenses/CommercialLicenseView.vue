<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import RuntimeEnforcementView from './RuntimeEnforcementView.vue'
import { hasPermission } from '../../auth/utils/principal.js'
import { MAX_LICENSE_BYTES, commitLicense, getLicenseEvents, getLicenseRequest, getLicenseStatus, initializeLicense, previewLicense, validateLicenseInput } from './api.js'
import { formatLicenseTime, licenseEventName, licensedOnly, licenseRows, previewCanCommit, riskyChange, statusRows, systemName } from './presentation.js'
import { formatUserError } from '../../../shared/utils/userError.js'

const emit = defineEmits(['toast'])
const canRead = computed(() => hasPermission('platform:license:read'))
const canManage = computed(() => hasPermission('platform:license:manage'))
const status = ref(null)
const loading = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const eventsError = ref('')
const events = ref({ items: [], total: 0, page: 1 })
const eventsLoading = ref(false)
const eventsExpanded = ref(false)
const visibleEvents = computed(() => eventsExpanded.value ? events.value.items : events.value.items.slice(0, 5))
const customerID = ref('')
const environment = ref('')
const raw = ref('')
const preview = ref(null)
const confirmChanges = ref(false)
const confirmReplacement = ref(false)
const initialized = computed(() => Boolean(status.value?.initialized))
// 当前授权只展示许可证覆盖的系统；未购买系统不出现在页面。
const rows = computed(() => licensedOnly(statusRows(status.value)))
const soonestExpiry = computed(() => {
  const times = rows.value.map(row => row.application?.expires_at).filter(Boolean)
  return times.length ? Math.min(...times) : null
})
const summary = computed(() => ({
  licensed: rows.value.length,
  active: rows.value.filter(row => row.status === 'VALID').length,
  expiring: rows.value.filter(row => ['EXPIRED', 'CLOCK_ABNORMAL', 'VALIDATION_ERROR'].includes(row.status) || (row.application && row.application.expires_at * 1000 - Date.now() < 30 * 86400000)).length,
}))
const dangerousChanges = computed(() => preview.value?.requires_change_confirmation || preview.value?.changes?.some(riskyChange))
const commitAllowed = computed(() => canManage.value && !busy.value && !loading.value && previewCanCommit(preview.value, confirmChanges.value, confirmReplacement.value))
const expiry = expiresAt => {
  const days = Math.floor(((expiresAt || 0) * 1000 - Date.now()) / 86400000)
  if (!expiresAt) return { tone: 'muted', label: '—' }
  if (days < 0) return { tone: 'expired', label: `已过期 ${-days} 天` }
  if (days <= 30) return { tone: 'soon', label: `剩余 ${days} 天` }
  return { tone: 'ok', label: `剩余 ${days} 天` }
}
const stateTone = statusCode => ({ VALID: 'ok', NOT_EFFECTIVE: 'info', EXPIRED: 'expired', CLOCK_ABNORMAL: 'expired', VALIDATION_ERROR: 'expired' })[statusCode] || 'muted'

function clearPreview() {
  preview.value = null
  confirmChanges.value = false
  confirmReplacement.value = false
}
watch(raw, clearPreview)

function message(error) {
  return error?.status === 409 && error?.code === 'LICENSE_VERSION_CONFLICT' ? '授权状态已变更，请刷新并重新预览后提交。' : formatUserError(error, { fallback: '商业授权操作失败，请重试。' })
}
async function loadEvents(page = 1) {
  if (!canRead.value || eventsLoading.value) return
  eventsLoading.value = true
  eventsError.value = ''
  try { events.value = await getLicenseEvents(page); eventsExpanded.value = false }
  catch (error) { eventsError.value = message(error) }
  finally { eventsLoading.value = false }
}
async function load() {
  if (!canRead.value || loading.value || busy.value) return
  loading.value = true
  errorMessage.value = ''
  clearPreview()
  try {
    status.value = await getLicenseStatus()
    environment.value = status.value.configured_environment || ''
    await loadEvents()
  } catch (error) {
    status.value = null
    errorMessage.value = message(error)
  } finally { loading.value = false }
}
async function manage(action) {
  if (!canManage.value || busy.value || loading.value) return
  busy.value = true
  errorMessage.value = ''
  try { await action() }
  catch (error) {
    errorMessage.value = message(error)
    if (error?.status === 409) clearPreview()
  } finally { busy.value = false }
}
async function initialize() {
  if (initialized.value || !customerID.value.trim() || !environment.value.trim()) return
  await manage(async () => {
    await initializeLicense(customerID.value.trim(), environment.value.trim())
    status.value = await getLicenseStatus()
    await loadEvents()
    emit('toast', '部署实例已初始化，可导出签发申请。')
  })
}
async function downloadRequest() {
  await manage(async () => {
    const request = await getLicenseRequest()
    const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'commercial-license-request.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}
async function selectFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || busy.value || !canManage.value) return
  clearPreview()
  errorMessage.value = ''
  busy.value = true
  try {
    if (file.size > MAX_LICENSE_BYTES) throw new Error('许可证不能超过 256 KiB。')
    const text = await file.text()
    validateLicenseInput(text)
    raw.value = text
  } catch (error) { raw.value = ''; errorMessage.value = message(error) }
  finally { busy.value = false }
}
async function runPreview() {
  clearPreview()
  await manage(async () => { preview.value = await previewLicense(raw.value) })
}
async function commit() {
  if (!commitAllowed.value) return
  await manage(async () => {
    await commitLicense(raw.value, preview.value, confirmChanges.value, confirmReplacement.value)
    raw.value = ''
    clearPreview()
    status.value = await getLicenseStatus()
    await loadEvents()
    emit('toast', '许可证已导入，请查看当前授权与待生效授权。')
  })
}
onMounted(load)
</script>

<template>
  <section class="license-page" aria-label="商业授权管理">
    <template v-if="canRead">
      <header class="license-header">
        <div>
          <h2>商业授权</h2>
          <p>部署绑定、签发许可证与授权变更记录；签发由供应商完成，此处导入生效。</p>
        </div>
        <button class="license-btn" :disabled="loading || busy" @click="load">刷新状态</button>
      </header>

      <p v-if="loading" role="status" class="license-muted">正在读取授权状态…</p>
      <div v-if="errorMessage" class="license-alert" role="alert">{{ errorMessage }} <button class="license-btn subtle" :disabled="loading || busy" @click="load">重新读取</button></div>

      <template v-if="status && !loading">
        <form v-if="!initialized" class="license-card init-card" @submit.prevent="initialize">
          <h3>初始化部署实例</h3>
          <p class="license-muted">首次初始化将绑定客户、环境和部署实例，之后不可更改；请与签发申请保持一致。</p>
          <template v-if="canManage">
            <div class="license-field-row">
              <label>客户标识<input v-model="customerID" required maxlength="128" :disabled="busy" pattern="[A-Za-z0-9._:-]+" placeholder="如 customer-a" /></label>
              <label>环境（服务端配置）<input :value="environment" readonly required /></label>
            </div>
            <button class="license-btn primary" :disabled="busy || !customerID.trim() || !environment.trim()">首次初始化</button>
          </template>
          <p v-else class="license-muted">需要商业授权管理权限才能初始化。</p>
        </form>

        <template v-else>
          <!-- 概览：授权规模与到期 -->
          <div class="license-summary">
            <div class="license-stat">
              <span class="license-stat-label">许可证版本</span>
              <strong class="license-stat-value">{{ status.current_version || '—' }}</strong>
              <span class="license-stat-hint">状态修订 {{ status.revision }}</span>
            </div>
            <div class="license-stat">
              <span class="license-stat-label">已授权系统</span>
              <strong class="license-stat-value">{{ summary.licensed }}</strong>
              <span class="license-stat-hint">{{ summary.active }} 个当前有效</span>
            </div>
            <div class="license-stat">
              <span class="license-stat-label">最近到期</span>
              <strong class="license-stat-value">{{ soonestExpiry ? formatLicenseTime(soonestExpiry).split(' ')[0] : '—' }}</strong>
              <span class="license-stat-hint">{{ soonestExpiry ? expiry(soonestExpiry).label : '暂无到期项' }}</span>
            </div>
            <div class="license-stat">
              <span class="license-stat-label">绑定环境</span>
              <strong class="license-stat-value">{{ status.environment }}</strong>
              <span class="license-stat-hint mono">{{ status.instance_id }}</span>
            </div>
          </div>

          <p v-if="status.clock_blocked" class="license-alert" role="alert">检测到系统时钟回退，授权已进入保护状态，需要供应商签发恢复凭据。</p>

          <!-- 部署绑定与签发申请 -->
          <div class="license-card binding-card">
            <div class="license-binding">
              <h3>部署绑定</h3>
              <p class="license-muted">许可证按 客户 / 环境 / 实例 三重绑定；签发申请供供应商工具自动填充。</p>
            </div>
            <dl class="license-binding-grid">
              <div><dt>客户标识</dt><dd>{{ status.customer_id }}</dd></div>
              <div><dt>环境</dt><dd>{{ status.environment }}</dd></div>
              <div><dt>实例标识</dt><dd class="mono">{{ status.instance_id }}</dd></div>
            </dl>
            <button v-if="canManage" class="license-btn" :disabled="busy" @click="downloadRequest">下载签发申请 JSON</button>
          </div>

          <!-- 当前授权：仅展示许可证覆盖的系统 -->
          <div class="license-card">
            <div class="license-card-head">
              <h3>当前授权</h3>
              <span class="license-chip">{{ summary.licensed }} 个系统</span>
            </div>
            <p class="license-muted">下表为签名许可证状态，不代表业务系统已开放；请以各系统的运行时登记与执行确认状态为准。</p>
            <p v-if="!status.current" class="license-muted">尚未导入当前生效许可证。</p>
            <p v-else-if="!rows.length" class="license-muted">当前许可证未包含任何业务系统。</p>
            <ul v-else class="license-systems">
              <li v-for="row in rows" :key="row.code" class="license-system" :data-tone="stateTone(row.status)">
                <div class="license-system-main">
                  <strong>{{ row.name }}</strong>
                  <span class="license-badge" :data-tone="stateTone(row.status)">{{ row.state }}</span>
                </div>
                <dl class="license-system-meta">
                  <div><dt>类型</dt><dd>{{ row.application.kind === 'TRIAL' ? '试用' : '正式' }}</dd></div>
                  <div><dt>生效</dt><dd>{{ formatLicenseTime(row.effectiveAt) }}</dd></div>
                  <div><dt>到期</dt><dd>{{ formatLicenseTime(row.application.expires_at) }}</dd></div>
                </dl>
                <span class="license-expiry" :data-tone="expiry(row.application.expires_at).tone">{{ expiry(row.application.expires_at).label }}</span>
              </li>
            </ul>
          </div>

          <!-- 待生效许可证 -->
          <div v-if="status.pending" class="license-card pending-card">
            <div class="license-card-head">
              <h3>待生效许可证 · 版本 {{ status.pending.version }}</h3>
              <span class="license-chip info">预计生效 {{ formatLicenseTime(status.pending.not_before) }}</span>
            </div>
            <ul class="license-systems compact">
              <li v-for="row in licenseRows(status.pending).filter(item => item.application)" :key="row.code" class="license-system">
                <div class="license-system-main"><strong>{{ row.name }}</strong><span class="license-badge" data-tone="info">{{ row.state }}</span></div>
                <span class="license-expiry" :data-tone="expiry(row.application.expires_at).tone">到期 {{ formatLicenseTime(row.application.expires_at) }}</span>
              </li>
            </ul>
          </div>

          <!-- 导入 / 续签 -->
          <div v-if="canManage" class="license-card import-card">
            <div class="license-card-head">
              <h3>导入许可证</h3>
              <span class="license-chip">首次授权与续签同一入口</span>
            </div>
            <p class="license-muted">选择或粘贴供应商签发的 compact JWS（≤256 KiB）。内容仅用于本次操作，不保存在浏览器。</p>
            <div class="license-field-row">
              <label>许可证文件<input type="file" :disabled="busy" @change="selectFile" /></label>
            </div>
            <label>许可证内容<textarea v-model="raw" :disabled="busy" rows="4" autocomplete="off" spellcheck="false" placeholder="eyJhbGciOiJFZERTQSIs…"  maxlength="1000000"/></label>
            <button class="license-btn primary" :disabled="busy || !raw.trim()" @click="runPreview">{{ busy ? '处理中…' : '验证并预览' }}</button>

            <div v-if="preview" class="license-preview">
              <div class="license-card-head">
                <h4>导入预览 · 版本 {{ preview.license.version }}</h4>
                <span class="license-chip">生效 {{ formatLicenseTime(preview.license.not_before) }}</span>
              </div>
              <ul class="license-changes">
                <li v-for="change in preview.changes" :key="change.code" :class="{ risky: riskyChange(change) }">
                  <strong>{{ systemName(change.code) }}</strong>
                  <span>{{ change.kind === 'REMOVED' ? '移除授权' : change.kind === 'ADDED' ? '新增授权' : '变更授权' }}</span>
                  <template v-if="change.old"><span class="license-muted">原到期 {{ formatLicenseTime(change.old.expires_at) }}</span></template>
                  <template v-if="change.new"><span>→ 新到期 {{ formatLicenseTime(change.new.expires_at) }}</span></template>
                  <em v-if="riskyChange(change)">授权范围减少或有效期缩短</em>
                </li>
              </ul>
              <label v-if="dangerousChanges" class="license-risk"><input v-model="confirmChanges" type="checkbox" :disabled="busy" />我已核对并确认本次移除、缩短或其他授权变更</label>
              <label v-if="preview.requires_pending_replacement" class="license-risk"><input v-model="confirmReplacement" type="checkbox" :disabled="busy" />我确认替换现有待生效许可证</label>
              <button class="license-btn primary" :disabled="!commitAllowed" @click="commit">{{ busy ? '处理中…' : '确认导入' }}</button>
            </div>
          </div>
        </template>

        <!-- 授权事件 -->
        <div class="license-card">
          <div class="license-card-head"><h3>授权事件</h3><span class="license-chip">共 {{ events.total }} 条</span></div>
          <p v-if="eventsLoading" role="status" class="license-muted">正在读取事件…</p>
          <div v-if="eventsError" class="license-alert" role="alert">{{ eventsError }} <button class="license-btn subtle" :disabled="eventsLoading" @click="loadEvents(events.page)">重试</button></div>
          <ul v-else-if="events.items.length" id="license-event-list" class="license-timeline" :class="{ expanded: eventsExpanded }" tabindex="0" aria-label="授权事件列表">
            <li v-for="event in visibleEvents" :key="event.id">
              <span class="license-timeline-dot" aria-hidden="true"></span>
              <div class="license-event-content">
                <div class="license-event-heading"><strong :title="event.kind">{{ licenseEventName(event.kind) }}</strong><span class="license-event-meta">版本 {{ event.version ?? '—' }} · 修订 {{ event.revision ?? '—' }}</span></div>
                <code class="license-event-code" :title="event.kind">{{ event.kind }}</code>
              </div>
              <time class="license-event-time">{{ formatLicenseTime(event.created_at) }}</time>
            </li>
          </ul>
          <p v-else-if="!eventsLoading && !eventsError" class="license-muted">暂无授权事件。</p>
          <div v-if="!eventsError && events.items.length > 5" class="license-event-toggle">
            <span class="license-muted">本页显示 {{ visibleEvents.length }} / {{ events.items.length }} 条</span>
            <button class="license-btn subtle" :aria-expanded="eventsExpanded" aria-controls="license-event-list" @click="eventsExpanded = !eventsExpanded">{{ eventsExpanded ? '收起' : '展开本页全部' }}</button>
          </div>
          <div v-if="events.items.length" class="license-pagination">
            <button class="license-btn subtle" :disabled="eventsLoading || events.page <= 1" @click="loadEvents(events.page - 1)">上一页</button>
            <span class="license-muted">第 {{ events.page }} 页 / 共 {{ Math.max(1, Math.ceil(events.total / 20)) }} 页</span>
            <button class="license-btn subtle" :disabled="eventsLoading || events.page * 20 >= events.total" @click="loadEvents(events.page + 1)">下一页</button>
          </div>
        </div>
      </template>
    </template>
    <p v-else role="alert" class="license-alert">无商业授权查看权限。</p>
    <!-- P1：运行时授权概览始终挂载，未登记/未初始化时也持续显示三项事实，不再整块隐藏。 -->
    <RuntimeEnforcementView @toast="emit('toast', $event)" />
  </section>
</template>

<style scoped>
.license-page { display: grid; gap: 20px; color: var(--text-primary, #1f2d3d); }
.license-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.license-header h2 { margin: 0 0 6px; font-size: 22px; }
.license-header p { margin: 0; color: var(--text-secondary, #64748b); font-size: 13px; }
.license-muted { color: var(--text-secondary, #64748b); font-size: 13px; margin: 4px 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }

.license-card { background: var(--surface, #fff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 14px; padding: 20px 22px; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
.license-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.license-card h3, .license-card h4 { margin: 0; font-size: 16px; }

.license-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.license-stat { background: var(--surface, #fff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 14px; padding: 16px 18px; display: grid; gap: 4px; }
.license-stat-label { font-size: 12px; color: var(--text-secondary, #64748b); }
.license-stat-value { font-size: 22px; line-height: 1.2; }
.license-stat-hint { font-size: 12px; color: var(--text-secondary, #64748b); }

.binding-card { display: grid; gap: 12px; }
.license-binding-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 0; }
.license-binding-grid dt { font-size: 12px; color: var(--text-secondary, #64748b); margin-bottom: 2px; }
.license-binding-grid dd { margin: 0; overflow-wrap: anywhere; font-weight: 600; }

.license-systems { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.license-system { border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 14px 16px; display: grid; gap: 8px; background: var(--surface-2, #f8fafc); }
.license-system[data-tone="ok"] { border-left: 3px solid #16a34a; }
.license-system[data-tone="info"] { border-left: 3px solid #2563eb; }
.license-system[data-tone="expired"] { border-left: 3px solid #dc2626; }
.license-system[data-tone="muted"] { border-left: 3px solid #94a3b8; }
.license-systems.compact .license-system { grid-template-columns: 1fr auto; align-items: center; padding: 10px 14px; }
.license-system-main { display: flex; align-items: center; gap: 10px; }
.license-system-meta { display: flex; flex-wrap: wrap; gap: 18px; margin: 0; }
.license-system-meta dt { font-size: 12px; color: var(--text-secondary, #64748b); display: inline; margin-right: 4px; }
.license-system-meta dd { display: inline; margin: 0; font-size: 13px; }
.license-expiry { justify-self: end; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
.license-expiry[data-tone="ok"] { color: #15803d; background: #f0fdf4; }
.license-expiry[data-tone="soon"] { color: #b45309; background: #fffbeb; }
.license-expiry[data-tone="expired"] { color: #b91c1c; background: #fef2f2; }
.license-expiry[data-tone="muted"] { color: #64748b; background: #f1f5f9; }

.license-badge { font-size: 12px; padding: 2px 10px; border-radius: 999px; font-weight: 600; }
.license-badge[data-tone="ok"] { color: #15803d; background: #f0fdf4; }
.license-badge[data-tone="info"] { color: #1d4ed8; background: #eff6ff; }
.license-badge[data-tone="expired"] { color: #b91c1c; background: #fef2f2; }
.license-badge[data-tone="muted"] { color: #64748b; background: #f1f5f9; }
.license-chip { font-size: 12px; color: var(--text-secondary, #64748b); background: #f1f5f9; border-radius: 999px; padding: 3px 10px; }
.license-chip.info { color: #1d4ed8; background: #eff6ff; }

.import-card { display: grid; gap: 8px; }
label { display: block; margin: 6px 0; font-size: 13px; color: var(--text-secondary, #475569); }
input:not([type="checkbox"]), textarea { display: block; width: min(100%, 640px); margin-top: 4px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; box-sizing: border-box; font-size: 14px; background: #fff; }
textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.license-field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }

.license-btn { padding: 8px 16px; border: 1px solid #b9c6d8; border-radius: 8px; background: #fff; cursor: pointer; font-size: 14px; transition: background .15s; }
.license-btn:hover:not(:disabled) { background: #f1f5f9; }
.license-btn.primary { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
.license-btn.primary:hover:not(:disabled) { background: #1e40af; }
.license-btn.subtle { padding: 4px 10px; font-size: 12px; }
.license-btn:disabled { cursor: default; opacity: .5; }

.license-preview { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--border-color, #e2e8f0); display: grid; gap: 8px; }
.license-changes { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.license-changes li { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font-size: 13px; padding: 8px 12px; background: #f8fafc; border-radius: 8px; }
.license-changes li.risky { background: #fef2f2; color: #991b1b; }
.license-changes em { font-style: normal; font-size: 12px; color: #b45309; }
.license-risk { display: flex; gap: 8px; align-items: center; color: #b91c1c; background: #fff2ef; padding: 10px 12px; border-radius: 8px; }

.license-alert { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; padding: 12px 14px; border-radius: 10px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }

.license-timeline { list-style: none; margin: 0; padding: 0 8px 0 6px; max-height: 340px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.license-timeline.expanded { max-height: 400px; }
.license-timeline:focus-visible { outline: 2px solid #2563eb; outline-offset: 4px; border-radius: 4px; }
/* 圆点使用绝对定位，不应占用 14px 的网格列。 */
.license-timeline li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 10px 0 10px 18px; min-height: 58px; box-sizing: border-box; border-left: 2px solid var(--border-color, #e2e8f0); margin-left: 4px; position: relative; }
.license-timeline li + li .license-event-content { border-top: 1px solid var(--border-color, #e2e8f0); }
.license-timeline-dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; position: absolute; left: -5px; top: 26px; }
.license-event-content { min-width: 0; padding-top: 6px; }
.license-event-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.license-event-heading strong { min-width: 0; max-width: 100%; font-size: 13px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.license-event-meta { font-size: 12px; color: var(--text-secondary, #64748b); white-space: nowrap; }
.license-event-code { display: block; margin-top: 3px; font-size: 11px; line-height: 1.5; color: var(--text-secondary, #64748b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.license-event-time { font-size: 12px; color: var(--text-secondary, #64748b); white-space: nowrap; font-variant-numeric: tabular-nums; }
.license-event-toggle { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color, #e2e8f0); }
.license-event-toggle .license-muted { font-size: 12px; }
.license-pagination { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 10px; }

@media (max-width: 640px) {
  .license-card { padding: 14px; }
  .license-timeline li { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .license-event-time { padding-bottom: 4px; }
}
</style>
