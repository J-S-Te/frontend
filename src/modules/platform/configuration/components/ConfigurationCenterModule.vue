<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { hasPermission } from '@/modules/platform/auth/utils/principal'
import {
  ConfigurationError, createConfigItem, createNamespace, listConfigItems, listNamespaces,
  publishConfiguration, updateConfigItem,
} from '@/modules/platform/configuration/api/configuration'

const emit = defineEmits(['toast'])
const namespaces = ref([])
const items = ref([])
const selectedNamespace = ref('')
const loading = ref(false)
const error = ref('')
const namespaceForm = reactive({ application_code: '', code: '', name: '', description: '' })
const itemForm = reactive({ key: '', value_type: 'STRING', valueText: '', secret: false })

const canCreateNamespace = computed(() => hasPermission('platform:config-namespace:create'))
const canCreateItem = computed(() => hasPermission('platform:config-item:create'))
const canUpdateItem = computed(() => hasPermission('platform:config-item:update'))
const canPublish = computed(() => hasPermission('platform:config-release:publish'))
const selected = computed(() => namespaces.value.find((item) => item.namespace_id === selectedNamespace.value))

function message(err, fallback) { return err instanceof ConfigurationError ? err.message : fallback }
function decodeValue(text, type) {
  if (type === 'JSON') return JSON.parse(text)
  if (type === 'NUMBER') { const value = Number(text); if (!Number.isFinite(value)) throw new Error('数字格式不正确'); return value }
  if (type === 'BOOLEAN') { if (!['true', 'false'].includes(text.trim().toLowerCase())) throw new Error('布尔值只能是 true 或 false'); return text.trim().toLowerCase() === 'true' }
  return text
}
function encodeValue(value) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }

async function loadNamespaces() {
  loading.value = true; error.value = ''
  try {
    const result = await listNamespaces()
    namespaces.value = result?.items || []
    if (!selectedNamespace.value && namespaces.value.length) selectedNamespace.value = namespaces.value[0].namespace_id
  } catch (err) { error.value = message(err, '读取命名空间失败。') } finally { loading.value = false }
}
async function loadItems() {
  if (!selectedNamespace.value) { items.value = []; return }
  loading.value = true; error.value = ''
  try { const result = await listConfigItems({ namespaceId: selectedNamespace.value }); items.value = result?.items || [] }
  catch (err) { error.value = message(err, '读取配置项失败。') } finally { loading.value = false }
}
async function submitNamespace() {
  error.value = ''
  try {
    const created = await createNamespace({ ...namespaceForm })
    Object.assign(namespaceForm, { application_code: '', code: '', name: '', description: '' })
    await loadNamespaces(); selectedNamespace.value = created.namespace_id; emit('toast', '配置命名空间已创建。')
  } catch (err) { error.value = message(err, '创建命名空间失败。') }
}
async function submitItem() {
  error.value = ''
  try {
    await createConfigItem({ namespace_id: selectedNamespace.value, key: itemForm.key.trim(), value_type: itemForm.value_type, value: decodeValue(itemForm.valueText, itemForm.value_type), secret: false })
    Object.assign(itemForm, { key: '', value_type: 'STRING', valueText: '', secret: false }); await loadItems(); emit('toast', '配置草稿已创建。')
  } catch (err) { error.value = err instanceof SyntaxError ? 'JSON 配置值格式不正确。' : message(err, err.message || '创建配置项失败。') }
}
async function saveItem(item) {
  error.value = ''
  try {
    await updateConfigItem(item.item_id, { namespace_id: selectedNamespace.value, key: item.key, value_type: item.value_type, value: decodeValue(item.editValue, item.value_type), secret: false, version: item.version })
    await loadItems(); emit('toast', '配置草稿已更新。')
  } catch (err) { error.value = message(err, err.message || '更新配置项失败。') }
}
async function publish() {
  if (!items.value.length) return
  error.value = ''
  try {
    const release = await publishConfiguration({ namespace_id: selectedNamespace.value, item_versions: items.value.map((item) => ({ item_id: item.item_id, version: item.version })), comment: '从平台配置中心发布' })
    emit('toast', `配置版本 ${release.version_no || ''} 已发布。`)
  } catch (err) { error.value = message(err, '发布配置失败。') }
}

watch(selectedNamespace, loadItems)
watch(items, (rows) => rows.forEach((item) => { if (item.editValue === undefined) item.editValue = encodeValue(item.value) }), { deep: true })
onMounted(loadNamespaces)
</script>

<template>
  <section class="configuration-center">
    <header class="configuration-head"><div><span>VERSIONED CONFIG</span><h2>配置中心</h2><p>配置先保存为租户隔离草稿，再以不可变版本发布；密钥不得存入本模块。</p></div><button class="console-button ghost" :disabled="loading" @click="loadNamespaces">刷新</button></header>
    <p v-if="error" class="configuration-error">{{ error }}</p>
    <div v-if="canCreateNamespace" class="configuration-card"><h3>新建命名空间</h3><div class="configuration-grid"><input v-model="namespaceForm.application_code" placeholder="应用编码" /><input v-model="namespaceForm.code" placeholder="命名空间编码" /><input v-model="namespaceForm.name" placeholder="名称" /><input v-model="namespaceForm.description" placeholder="说明（可选）" /></div><button class="console-button primary small" @click="submitNamespace">创建</button></div>
    <div class="configuration-card"><header><div><h3>配置草稿</h3><p v-if="selected">{{ selected.application.name }} / {{ selected.name }}</p></div><select v-model="selectedNamespace"><option value="">请选择命名空间</option><option v-for="space in namespaces" :key="space.namespace_id" :value="space.namespace_id">{{ space.application.code }} / {{ space.code }}</option></select></header>
      <div v-if="canCreateItem && selectedNamespace" class="configuration-grid configuration-grid--item"><input v-model="itemForm.key" placeholder="配置键" /><select v-model="itemForm.value_type"><option>STRING</option><option>NUMBER</option><option>BOOLEAN</option><option>JSON</option></select><textarea v-model="itemForm.valueText" rows="2" placeholder="配置值" /><button class="console-button primary small" @click="submitItem">新增草稿</button></div>
      <div class="configuration-table"><table class="console-data-table"><thead><tr><th>键</th><th>类型</th><th>值</th><th>版本</th><th>操作</th></tr></thead><tbody><tr v-if="!items.length"><td colspan="5">暂无配置项。</td></tr><tr v-for="item in items" :key="item.item_id"><td><code>{{ item.key }}</code></td><td>{{ item.value_type }}</td><td><textarea v-model="item.editValue" rows="2" :disabled="!canUpdateItem" /></td><td>{{ item.version }}</td><td><button v-if="canUpdateItem" class="console-button ghost small" @click="saveItem(item)">保存</button></td></tr></tbody></table></div>
      <footer v-if="canPublish"><button class="console-button primary" :disabled="!items.length" @click="publish">发布当前草稿版本</button></footer>
    </div>
  </section>
</template>

<style scoped>
.configuration-center{padding:24px}.configuration-head,.configuration-card>header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.configuration-head span{font-size:11px;font-weight:800;color:#2563eb;letter-spacing:.08em}.configuration-head h2,.configuration-card h3{margin:6px 0}.configuration-head p,.configuration-card p{margin:0;color:#64748b}.configuration-card{margin-top:18px;padding:18px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}.configuration-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.configuration-grid--item{grid-template-columns:1fr 140px 2fr auto}.configuration-card input,.configuration-card select,.configuration-card textarea{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff}.configuration-table{overflow:auto}.configuration-table textarea{min-width:240px}.configuration-card footer{display:flex;justify-content:flex-end;margin-top:14px}.configuration-error{padding:10px 12px;color:#b91c1c;background:#fef2f2;border-radius:8px}@media(max-width:800px){.configuration-grid,.configuration-grid--item{grid-template-columns:1fr}}
</style>
