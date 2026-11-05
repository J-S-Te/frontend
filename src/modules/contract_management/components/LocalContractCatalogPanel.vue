<script setup>
import { computed, onMounted, ref } from 'vue'
import { listLocalContractCounterparties, listLocalContractCategories, saveLocalContractCounterparty, saveLocalContractCategory, listLocalCatalogGrantTargets, listLocalCatalogGrants, saveLocalCatalogGrant } from '../api/contract.js'
import { formatUserError } from '../../shared/utils/userError.js'

const props = defineProps({ permissions: { type: Array, default: () => [] } })
const kind = ref('counterparties')
const keyword = ref('')
const rows = ref([])
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const error = ref('')
const notice = ref('')
const grantEntry = ref(null)
const grantTargets = ref([])
const grants = ref([])
const grantTarget = ref('')
const grantLoading = ref(false)
const grantSaving = ref(false)
const grantError = ref('')
const grantTargetError = ref('')
const grantListError = ref('')
const grantNotice = ref('')
const editing = ref(null)
const draft = ref({ name: '', code: '', enabled: true })
const canManage = computed(() => props.permissions.includes('contract.catalog.manage'))
const canWrite = computed(() => canManage.value && !loading.value && !saving.value && !loadError.value)

// 用途：加载当前真实范围内的本地目录，读取失败阻止维护而不伪装空列表。
// 参数：无。
// 返回值：是否成功读取；不修改目录业务数据。
async function load() {
  if (loading.value || !canManage.value) return false
  loading.value = true
  loadError.value = ''
  try {
    rows.value = kind.value === 'counterparties' ? await listLocalContractCounterparties({ keyword: keyword.value }) : await listLocalContractCategories({ keyword: keyword.value })
    return true
  } catch (cause) {
    loadError.value = formatUserError(cause, { fallback: '本地目录读取失败，请刷新后重试。' })
    return false
  } finally {
    loading.value = false
  }
}

// 用途：打开当前目录的白名单编辑表单，不让角色名称代替管理权限。
// 参数：value为已读记录，省略时创建新记录。
// 返回值：无；保存版本保持为打开时版本。
function openEditor(value = null) {
  if (!canWrite.value || grantEntry.value) return
  editing.value = value ? { id: value.id, version: value.version } : { id: '', version: 0 }
  draft.value = { name: value?.name || '', code: value?.code || '', enabled: value?.enabled !== false }
  error.value = ''
  notice.value = ''
}

// 用途：切换维护目录，放弃编辑须先使用明确取消按钮。
// 参数：value为固定目录种类。
// 返回值：无；编辑中或提交中不切换。
async function changeKind(value) {
  if (editing.value || grantEntry.value || saving.value || loading.value) return
  kind.value = value
  await load()
}

// 用途：提交目录名称、稳定编码和启用状态，成功后读取服务端权威版本。
// 参数：无，使用当前表单和打开时的版本。
// 返回值：无；失败保留草稿，未知写入结果不自动重试。
async function save() {
  if (!canWrite.value || !editing.value) return
  if (!draft.value.name.trim()) { error.value = '请填写目录名称。'; return }
  if (kind.value === 'categories' && !/^[A-Z0-9][A-Z0-9_.-]{0,63}$/.test(draft.value.code)) { error.value = '类别编码须为1至64位大写字母、数字、下划线、点或横线。'; return }
  saving.value = true
  error.value = ''
  try {
    const payload = { name: draft.value.name.trim(), code: draft.value.code, enabled: draft.value.enabled, expected_version: editing.value.version }
    if (kind.value === 'counterparties') await saveLocalContractCounterparty(editing.value.id, payload)
    else await saveLocalContractCategory(editing.value.id, payload)
    editing.value = null
    notice.value = '本地目录已保存，已创建合同的快照保持不变。'
    if (!await load()) notice.value += ' 保存已完成，但列表刷新失败，请稍后刷新核对。'
  } catch (cause) {
    error.value = formatUserError(cause, { fallback: '目录保存未完成，请核对当前版本后重试。' })
  } finally {
    saving.value = false
  }
}

// 用途：在用户明确取消时关闭尚未提交的目录表单。
// 参数：无。
// 返回值：无；提交中保留表单。
function cancelEditor() {
  if (!saving.value) editing.value = null
}

// 用途：读取同一条目的真实授权历史和可授予目标，候选失败不妨碍撤销已知授权。
// 参数：无；条目种类和ID固定在当前授权面板。
// 返回值：是否读到授权历史；不把读取失败转为空列表。
async function reloadGrants() {
  if (!grantEntry.value || grantLoading.value) return false
  grantLoading.value = true
  grantListError.value = ''
  grantTargetError.value = ''
  try {
    const [targetsResult, grantsResult] = await Promise.allSettled([
      listLocalCatalogGrantTargets(),
      listLocalCatalogGrants(grantEntry.value.kind, grantEntry.value.id),
    ])
    if (targetsResult.status === 'fulfilled') grantTargets.value = targetsResult.value
    else { grantTargets.value = []; grantTargetError.value = formatUserError(targetsResult.reason, { fallback: '有效销售和组织读取失败' }) }
    if (grantsResult.status === 'fulfilled') { grants.value = grantsResult.value; return true }
    grantListError.value = formatUserError(grantsResult.reason, { fallback: '授权历史读取失败' })
    return false
  } finally { grantLoading.value = false }
}

// 用途：打开可管理条目的显式授权，不接受自由填写的主体ID。
// 参数：value为当前已读目录条目。
// 返回值：读取完成，不改变合同SELF或ORG范围。
async function openGrants(value) {
  if (!canWrite.value || editing.value || grantSaving.value || grantLoading.value) return
  grantEntry.value = { id: value.id, name: value.name, kind: kind.value }
  grantTarget.value = ''; grantError.value = ''; grantNotice.value = ''
  grants.value = []; grantTargets.value = []
  await reloadGrants()
}

// 用途：对当前有效候选提交显式授权，已有目标沿用真实CAS版本。
// 参数：无；选择值必须匹配刚读取的平台候选。
// 返回值：无；失败保留选择，成功刷新授权事实。
async function submitGrant() {
  if (!canWrite.value || !grantEntry.value || grantLoading.value || grantSaving.value || grantListError.value || grantTargetError.value) return
  const target = grantTargets.value.find(item => `${item.subject_type}:${item.subject_id}` === grantTarget.value)
  if (!target) { grantError.value = '请选择当前有效的销售或组织'; return }
  const current = grants.value.find(item => item.subject_type === target.subject_type && item.subject_id === target.subject_id)
  await writeGrant({ subject_type: target.subject_type, subject_id: target.subject_id, enabled: true, expected_version: current?.version || 0 })
}

// 用途：撤销真实历史授权，目标已停用或目录暂不可用时仍能受控撤销。
// 参数：value为当前已读授权行。
// 返回值：无；CAS版本来自已读事实，不删除历史。
async function revokeGrant(value) {
  if (!canWrite.value || !grantEntry.value || grantLoading.value || grantSaving.value || grantListError.value) return
  const current = grants.value.find(item => item.subject_type === value.subject_type && item.subject_id === value.subject_id)
  if (!current?.enabled) return
  await writeGrant({ subject_type: current.subject_type, subject_id: current.subject_id, enabled: false, expected_version: current.version })
}

// 用途：通过原安全transport保存一条稳定授权命令，未知结果不伪装已完成。
// 参数：input为经候选或真实历史核验的授权命令。
// 返回值：无；服务端失败保留面板与输入。
async function writeGrant(input) {
  grantSaving.value = true; grantError.value = ''; grantNotice.value = ''
  try {
    await saveLocalCatalogGrant(grantEntry.value.kind, grantEntry.value.id, input)
    grantNotice.value = input.enabled ? '目录可见性授权已保存' : '目录可见性授权已撤销，历史保留'
    if (!await reloadGrants()) grantNotice.value += '；刷新失败，请核对授权历史'
  } catch (cause) { grantError.value = formatUserError(cause, { fallback: '授权写入未确认，请刷新核对后重试' }) }
  finally { grantSaving.value = false }
}

// 用途：在没有在途读取或写入时关闭授权面板。
// 参数：无。
// 返回值：无。
function closeGrants() {
  if (!grantLoading.value && !grantSaving.value) grantEntry.value = null
}

onMounted(load)
</script>

<template>
  <section v-if="canManage" class="local-catalog-panel" aria-label="合同本地目录维护">
    <header><h3>合同本地目录</h3><p>仅保存交易对方名称和受控类别。目录变更采用版本校验，停用后不能被新合同选择，已有合同快照不回填。</p></header>
    <div class="local-catalog-actions"><label>检索<input v-model="keyword" maxlength="100" :disabled="saving || loading" @keydown.enter.prevent="load" /></label><button type="button" :disabled="saving || loading || !!editing" @click="changeKind('counterparties')">交易对方</button><button type="button" :disabled="saving || loading || !!editing" @click="changeKind('categories')">服务类别</button><button type="button" :disabled="saving || loading" @click="load">刷新</button><button type="button" :disabled="!canWrite || !!editing" @click="openEditor()">新增{{ kind === 'counterparties' ? '交易对方' : '类别' }}</button></div>
    <p v-if="loading" role="status">正在加载目录…</p><p v-if="loadError" role="alert">{{ loadError }}</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <form v-if="editing" @submit.prevent="save">
      <label v-if="kind === 'categories'">稳定类别编码<input v-model="draft.code" maxlength="64" :disabled="saving || !!editing.id" required /></label>
      <label>名称<input v-model="draft.name" :maxlength="kind === 'categories' ? 120 : 255" :disabled="saving" required /></label>
      <label><input v-model="draft.enabled" type="checkbox" :disabled="saving" />启用</label>
      <button type="submit" :disabled="!canWrite">{{ saving ? '保存中…' : '保存目录' }}</button><button type="button" :disabled="saving" @click="cancelEditor">取消编辑</button>
    </form>
    <div class="local-catalog-table"><table><thead><tr><th v-if="kind === 'categories'">编码</th><th>名称</th><th>状态</th><th>版本</th><th>操作</th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td v-if="kind === 'categories'">{{ item.code }}</td><td>{{ item.name }}</td><td>{{ item.enabled ? '已启用' : '已停用' }}</td><td>{{ item.version }}</td><td><button type="button" :disabled="!canWrite || !!editing" @click="openEditor(item)">编辑 / 停用</button><button type="button" :disabled="!canWrite || !!editing || grantLoading || grantSaving" @click="openGrants(item)">可见销售 / 组织</button></td></tr></tbody></table></div>
    <section v-if="grantEntry" class="catalog-grants" aria-label="目录可见性授权">
      <h4>{{ grantEntry.name }} · 可见销售 / 组织</h4>
      <p>条目Owner仍可读取。仅向下列有效销售或组织授权；合同本身的数据范围保持原规则。</p>
      <p v-if="grantTargetError" role="alert">{{ grantTargetError }}；可继续撤销已读授权。</p>
      <p v-if="grantListError" role="alert">{{ grantListError }}</p>
      <p v-if="grantError" role="alert">{{ grantError }}</p><p v-if="grantNotice" role="status">{{ grantNotice }}</p>
      <label>有效销售或组织<select v-model="grantTarget" :disabled="grantLoading || grantSaving || !!grantTargetError || !!grantListError">
        <option value="">请选择平台当前有效目标</option><option v-for="target in grantTargets"
          :key="`${target.subject_type}:${target.subject_id}`" :value="`${target.subject_type}:${target.subject_id}`">{{ target.subject_type === 'USER' ? '销售' : '组织' }} · {{ target.name }}</option>
      </select></label>
      <button type="button" :disabled="!canWrite || grantLoading || grantSaving || !!grantTargetError || !!grantListError || !grantTarget" @click="submitGrant">授予可见性</button>
      <button type="button" :disabled="grantLoading || grantSaving" @click="reloadGrants">刷新目标和授权</button>
      <ul><li v-for="grant in grants" :key="`${grant.subject_type}:${grant.subject_id}`">{{ grant.subject_type === 'USER' ? '销售' : '组织' }} · {{ grant.subject_name }} · {{ grant.enabled ? '已授权' : '已撤销' }} · 版本 {{ grant.version }}
        <button v-if="grant.enabled" type="button" :disabled="!canWrite || grantLoading || grantSaving || !!grantListError" @click="revokeGrant(grant)">撤销</button>
      </li></ul>
      <button type="button" :disabled="grantLoading || grantSaving" @click="closeGrants">关闭授权面板</button>
    </section>
    <p v-if="!loading && !loadError && !rows.length">当前数据范围内暂无记录。</p>
  </section>
</template>

<style scoped>
/* 深色主题：面板与表格分隔线走 token，浅色回退到原字面量。 */
.local-catalog-panel { padding: 18px; border: 1px solid var(--border-soft, #d5dfeb); border-radius: 10px; margin: 18px 0; background: var(--surface-card, #fff); }
.local-catalog-panel p { line-height: 1.6; }
.local-catalog-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.local-catalog-panel form { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; padding: 16px 0; }
.local-catalog-panel label { display: flex; flex-direction: column; gap: 6px; }
.local-catalog-panel input { max-width: 100%; min-height: 32px; }
.local-catalog-table { overflow-x: auto; margin-top: 16px; }
.local-catalog-panel table { width: 100%; border-collapse: collapse; }
.local-catalog-panel th, .local-catalog-panel td { padding: 10px; border-bottom: 1px solid var(--border-soft, #e5ebf1); text-align: left; }
</style>
