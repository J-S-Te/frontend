<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import RuntimeEnforcementView from './RuntimeEnforcementView.vue'
import { hasPermission } from '../../auth/utils/principal.js'
import { MAX_LICENSE_BYTES, commitLicense, getLicenseEvents, getLicenseRequest, getLicenseStatus, initializeLicense, previewLicense, validateLicenseInput } from './api.js'
import { formatLicenseTime, licenseRows, previewCanCommit, riskyChange, statusRows, systemName } from './presentation.js'

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
const customerID = ref('')
const environment = ref('')
const raw = ref('')
const preview = ref(null)
const confirmChanges = ref(false)
const confirmReplacement = ref(false)
const initialized = computed(() => Boolean(status.value?.initialized))
const rows = computed(() => statusRows(status.value))
const dangerousChanges = computed(() => preview.value?.requires_change_confirmation || preview.value?.changes?.some(riskyChange))
const commitAllowed = computed(() => canManage.value && !busy.value && !loading.value && previewCanCommit(preview.value, confirmChanges.value, confirmReplacement.value))

function clearPreview() {
  preview.value = null
  confirmChanges.value = false
  confirmReplacement.value = false
}
watch(raw, clearPreview)

function message(error) {
  return error?.status === 409 && error?.code === 'LICENSE_VERSION_CONFLICT' ? '授权状态已变更，请刷新并重新预览后提交。' : error?.message || '商业授权操作失败，请重试。'
}
async function loadEvents(page = 1) {
  if (!canRead.value || eventsLoading.value) return
  eventsLoading.value = true
  eventsError.value = ''
  try { events.value = await getLicenseEvents(page) }
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
  <section class="commercial-license" aria-label="商业授权管理">
    <template v-if="canRead">
      <header><div><h2>商业授权</h2><p>管理部署绑定、供应商签发的许可证与授权变更记录。</p></div><button :disabled="loading || busy" @click="load">刷新</button></header>
      <p v-if="loading" role="status">正在读取授权状态…</p>
      <div v-if="errorMessage" class="license-error" role="alert">{{ errorMessage }} <button :disabled="loading || busy" @click="load">重新读取</button></div>
      <template v-if="status && !loading">
        <p class="license-panel">下表显示签名许可证状态，不代表业务系统已开放。请以下方各系统的运行时登记与执行确认状态为准；只有完成当前授权确认后才会生效。服务端时间：{{ status.server_time }}。</p>
        <form v-if="!initialized" class="license-panel" @submit.prevent="initialize">
          <h3>部署尚未初始化</h3><p>首次初始化将绑定客户、环境和部署实例。请确认填写的信息与签发申请一致。</p>
          <template v-if="canManage"><label>客户标识<input v-model="customerID" required maxlength="128" :disabled="busy" pattern="[A-Za-z0-9._:-]+" /></label><label>环境标识（服务端配置）<input :value="environment" readonly required /></label><button :disabled="busy || !customerID.trim() || !environment.trim()">首次初始化</button></template>
          <p v-else>需要商业授权管理权限才能初始化。</p>
        </form>
        <template v-else>
          <div class="license-panel"><h3>部署绑定</h3><dl><dt>客户</dt><dd>{{ status.customer_id }}</dd><dt>环境</dt><dd>{{ status.environment }}</dd><dt>实例</dt><dd>{{ status.instance_id }}</dd><dt>当前版本 / 状态修订</dt><dd>{{ status.current_version }} / {{ status.revision }}</dd></dl><button v-if="canManage" :disabled="busy" @click="downloadRequest">下载签发申请 JSON</button><p v-if="status.clock_blocked" class="license-error" role="alert">检测到系统时钟回退，授权已进入保护状态，需要供应商签发恢复凭据。</p></div>
          <div class="license-panel"><h3>当前授权</h3><p v-if="!status.current">尚未导入当前生效许可证。</p><div class="license-table"><table><thead><tr><th>业务系统</th><th>购买类型</th><th>状态</th><th>生效时间</th><th>到期时间</th></tr></thead><tbody><tr v-for="row in rows" :key="row.code"><td>{{ row.name }}</td><td>{{ row.application ? row.application.kind === 'TRIAL' ? '试用' : '正式' : '—' }}</td><td>{{ row.state }}</td><td>{{ row.application ? formatLicenseTime(row.effectiveAt) : '—' }}</td><td>{{ formatLicenseTime(row.application?.expires_at) }}</td></tr></tbody></table></div></div>
          <div v-if="status.pending" class="license-panel"><h3>待生效许可证（版本 {{ status.pending.version }}）</h3><p>此许可证尚未替换当前授权；预计生效时间：{{ formatLicenseTime(status.pending.not_before) }}。</p><ul><li v-for="row in licenseRows(status.pending)" :key="row.code">{{ row.name }}：{{ row.application ? '待生效' : '未购买' }} · 到期 {{ formatLicenseTime(row.application?.expires_at) }}</li></ul></div>
          <div v-if="canManage" class="license-panel"><h3>导入许可证</h3><p>选择或粘贴供应商签发的 compact JWS，最大 256 KiB。许可证仅用于当前操作，不保存在浏览器；此处不接受私钥。</p><label>许可证文件<input type="file" :disabled="busy" @change="selectFile" /></label><label>许可证内容<textarea v-model="raw" :disabled="busy" rows="5" autocomplete="off" spellcheck="false" /></label><button :disabled="busy || !raw.trim()" @click="runPreview">验证并预览</button>
            <div v-if="preview" class="license-preview"><h4>导入预览 · 版本 {{ preview.license.version }}</h4><p>许可证生效时间：{{ formatLicenseTime(preview.license.not_before) }}。最终状态由服务端提交时校验。</p><ul><li v-for="change in preview.changes" :key="change.code" :class="{ 'license-risk': riskyChange(change) }">{{ systemName(change.code) }}：{{ change.kind === 'REMOVED' ? '移除授权' : change.kind === 'ADDED' ? '新增授权' : '变更授权' }}<template v-if="change.old"> · 原到期 {{ formatLicenseTime(change.old.expires_at) }}</template><template v-if="change.new"> → 新到期 {{ formatLicenseTime(change.new.expires_at) }}</template><strong v-if="riskyChange(change)"> · 授权范围减少或有效期缩短</strong></li></ul><label v-if="dangerousChanges" class="license-risk"><input v-model="confirmChanges" type="checkbox" :disabled="busy" />我已核对并确认本次移除、缩短或其他授权变更</label><label v-if="preview.requires_pending_replacement" class="license-risk"><input v-model="confirmReplacement" type="checkbox" :disabled="busy" />我确认替换现有待生效许可证</label><button :disabled="!commitAllowed" @click="commit">{{ busy ? '处理中…' : '确认导入' }}</button></div>
          </div>
        </template>
      </template>
      <div class="license-panel"><h3>授权事件</h3><p v-if="eventsLoading" role="status">正在读取事件…</p><p v-if="eventsError" class="license-error" role="alert">{{ eventsError }} <button :disabled="eventsLoading" @click="loadEvents(events.page)">重试</button></p><ul v-else><li v-for="event in events.items" :key="event.id">{{ event.created_at }} · {{ event.kind }} · 版本 {{ event.version }} · 修订 {{ event.revision }}</li></ul><p v-if="!eventsLoading && !eventsError && !events.items.length">暂无授权事件。</p><div class="license-pagination"><button :disabled="eventsLoading || events.page <= 1" @click="loadEvents(events.page - 1)">上一页</button><span>第 {{ events.page }} 页 · 共 {{ events.total }} 条</span><button :disabled="eventsLoading || events.page * 20 >= events.total" @click="loadEvents(events.page + 1)">下一页</button></div></div>
    </template>
    <p v-else role="alert">无商业授权查看权限。</p>
    <RuntimeEnforcementView v-if="initialized" @toast="emit('toast', $event)" />
  </section>
</template>

<style scoped>
.commercial-license { display: grid; gap: 18px; color: var(--text-primary, #24334b); }
header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
h2, h3, h4 { margin: 0 0 12px; }
p { line-height: 1.6; }
.license-panel { background: var(--surface, white); border: 1px solid var(--border-color, #dfe5ee); padding: 22px; border-radius: 12px; }
label { display: block; margin: 12px 0; }
input:not([type=checkbox]), textarea { display: block; width: min(100%, 640px); padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
textarea { font-family: monospace; overflow-wrap: anywhere; }
button { padding: 9px 15px; border: 1px solid #b9c6d8; border-radius: 6px; background: #f8fafc; cursor: pointer; }
button:disabled { cursor: default; opacity: .55; }
dl { display: grid; grid-template-columns: 150px 1fr; gap: 10px; }
dd { margin: 0; overflow-wrap: anywhere; }
.license-table { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; white-space: nowrap; }
th, td { padding: 12px; border-bottom: 1px solid #e2e8f0; }
.license-error, .license-risk { color: #a52b24; background: #fff2ef; padding: 12px; border-radius: 6px; }
.license-preview { margin-top: 20px; padding-top: 20px; border-top: 1px solid #dfe5ee; }
li { margin: 8px 0; overflow-wrap: anywhere; }
.license-pagination { display: flex; gap: 12px; align-items: center; }
@media (max-width: 600px) { dl { grid-template-columns: 1fr; } .license-panel { padding: 14px; } header { align-items: flex-start; } }
</style>
