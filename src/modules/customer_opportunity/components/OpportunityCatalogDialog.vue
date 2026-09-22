<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { createIdempotencyKey } from '../api/client.js'
import {
  createOpportunityCatalogItem,
  deleteOpportunityCatalogItem,
  listOpportunityCatalogItems,
  updateOpportunityCatalogItem,
} from '../api/opportunity.js'

const emit = defineEmits(['close', 'changed', 'notice', 'error'])
const activeKind = ref('TYPE')
const items = ref([])
const loading = ref(false)
const savingID = ref(0)
const form = reactive({ name: '', sort_order: 10 })
const drafts = reactive({})
const pendingDelete = ref(null)
const deleteReason = ref('')
const deleteError = ref('')
const blockedItemID = ref(0)
const mutationKeys = new Map()
const kindLabel = computed(() => activeKind.value === 'TYPE' ? '商机类型' : '商机来源')
const enabledCount = computed(() => items.value.filter((item) => item.enabled).length)

function mutationKey(operation, payload) {
  const signature = `${operation}:${JSON.stringify(payload)}`
  if (!mutationKeys.has(signature)) mutationKeys.set(signature, createIdempotencyKey())
  return { signature, key: mutationKeys.get(signature) }
}

function syncDrafts(rows) {
  for (const item of rows) drafts[item.id] = { name: item.name, sort_order: Number(item.sort_order || 0) }
}

async function load() {
  loading.value = true
  blockedItemID.value = 0
  try {
    const value = await listOpportunityCatalogItems(activeKind.value, { includeDisabled: true })
    items.value = Array.isArray(value) ? value : []
    syncDrafts(items.value)
  } catch (value) {
    emit('error', value?.message || `${kindLabel.value}加载失败。`)
  } finally {
    loading.value = false
  }
}

async function switchKind(kind) {
  if (loading.value || activeKind.value === kind) return
  activeKind.value = kind
  form.name = ''
  await load()
}

async function createItem() {
  const name = form.name.trim()
  if (!name) return
  loading.value = true
  try {
    const payload = { kind: activeKind.value, name, sort_order: Number(form.sort_order || 0) }
    const retry = mutationKey('CREATE', payload)
    await createOpportunityCatalogItem(payload, retry.key)
    mutationKeys.delete(retry.signature)
    form.name = ''
    emit('notice', `${kindLabel.value}已新增。`)
    emit('changed')
    await load()
  } catch (value) {
    emit('error', value?.code === 'CRM_OPPORTUNITY_CATALOG_DUPLICATE' ? '同名配置已存在。' : (value?.message || '新增失败。'))
    loading.value = false
  }
}

async function saveItem(item, enabled = item.enabled) {
  const draft = drafts[item.id]
  if (!draft?.name?.trim()) return
  savingID.value = item.id
  try {
    await updateOpportunityCatalogItem(item.id, {
      name: draft.name.trim(), sort_order: Number(draft.sort_order || 0), enabled,
      version: item.version, reason: enabled === item.enabled ? '更新商机基础数据配置' : (enabled ? '启用商机基础数据配置' : '停用商机基础数据配置'),
    })
    emit('notice', enabled === item.enabled ? '配置已保存。' : `配置已${enabled ? '启用' : '停用'}。`)
    emit('changed')
    await load()
  } catch (value) {
    emit('error', value?.code === 'CRM_OPPORTUNITY_CATALOG_DUPLICATE' ? '同名配置已存在。' : (value?.message || '保存失败。'))
  } finally {
    savingID.value = 0
  }
}

function askDelete(item) {
  pendingDelete.value = item
  deleteReason.value = ''
  deleteError.value = ''
}

function closeDeleteConfirm() {
  if (savingID.value) return
  pendingDelete.value = null
  deleteReason.value = ''
  deleteError.value = ''
}

async function confirmDelete() {
  const item = pendingDelete.value
  const reason = deleteReason.value.trim()
  if (!item || !reason) {
    deleteError.value = '删除原因不能为空。'
    return
  }
  // Confirm & Auto Close：提交确认后先关闭二次确认层，结果回到配置窗口反馈。
  pendingDelete.value = null
  deleteError.value = ''
  savingID.value = item.id
  try {
    const payload = { version: item.version, reason }
    const retry = mutationKey(`DELETE:${item.id}`, payload)
    await deleteOpportunityCatalogItem(item.id, payload, retry.key)
    mutationKeys.delete(retry.signature)
    emit('notice', `“${item.name}”已删除。`)
    emit('changed')
    await load()
  } catch (value) {
    if (value?.code === 'CRM_OPPORTUNITY_CATALOG_IN_USE') {
      blockedItemID.value = item.id
      const count = Number(value?.details?.reference_count || item.reference_count || 0)
      emit('error', `该配置已被 ${count} 个商机使用，不能删除，可改为停用。`)
    } else {
      emit('error', value?.message || '删除失败。')
    }
  } finally {
    savingID.value = 0
  }
}

onMounted(load)
</script>

<template>
  <div class="console-modal-backdrop nested" role="presentation" @click.self="emit('close')">
    <article class="console-detail-modal crm-catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-catalog-title">
      <header class="crm-catalog-header">
        <div class="crm-catalog-heading-icon" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="crm-catalog-heading-copy">
          <p class="console-modal-eyebrow">商机基础数据</p>
          <h2 id="crm-catalog-title">基础数据配置</h2>
          <p>统一维护商机创建时可选择的类型和来源，确保业务数据口径一致。</p>
        </div>
        <button class="console-modal-close" type="button" aria-label="关闭基础数据配置" @click="emit('close')">×</button>
      </header>

      <div class="crm-catalog-body">
        <nav class="crm-catalog-tabs" aria-label="配置类别">
          <button type="button" :class="{ active: activeKind === 'TYPE' }" :aria-current="activeKind === 'TYPE' ? 'page' : undefined" @click="switchKind('TYPE')"><span>商机类型</span><small>业务分类</small></button>
          <button type="button" :class="{ active: activeKind === 'SOURCE' }" :aria-current="activeKind === 'SOURCE' ? 'page' : undefined" @click="switchKind('SOURCE')"><span>商机来源</span><small>获客渠道</small></button>
        </nav>

        <section class="crm-catalog-create-panel" aria-labelledby="crm-catalog-create-title">
          <div class="crm-catalog-section-heading"><div><span class="crm-catalog-section-index">01</span><div><h3 id="crm-catalog-create-title">新增{{ kindLabel }}</h3><p>名称不可重复，数字越小排序越靠前。</p></div></div></div>
          <form class="crm-catalog-create" @submit.prevent="createItem">
            <label><span>{{ kindLabel }}名称</span><input v-model="form.name" required maxlength="64" autocomplete="off" :placeholder="`请输入${kindLabel}名称`"></label>
            <label><span>显示顺序</span><input v-model.number="form.sort_order" type="number" min="0" inputmode="numeric"></label>
            <button class="console-button primary crm-catalog-create-button" :disabled="loading"><span aria-hidden="true">＋</span>{{ loading ? '处理中…' : `新增${kindLabel}` }}</button>
          </form>
        </section>

        <section class="crm-catalog-manage" aria-labelledby="crm-catalog-manage-title">
          <div class="crm-catalog-section-heading">
            <div><span class="crm-catalog-section-index">02</span><div><h3 id="crm-catalog-manage-title">管理{{ kindLabel }}</h3><p>停用后不可用于新商机，历史商机仍保留原值。</p></div></div>
            <div class="crm-catalog-summary" aria-live="polite"><strong>{{ items.length }}</strong> 项配置<span></span><strong>{{ enabledCount }}</strong> 项启用</div>
          </div>
          <div v-if="loading && !items.length" class="crm-catalog-loading" role="status"><span aria-hidden="true"></span><p>正在加载{{ kindLabel }}配置…</p></div>
          <div v-else class="crm-catalog-list" :aria-busy="loading">
            <article v-for="(item, index) in items" :key="item.id" :class="['crm-catalog-item', { disabled: !item.enabled, blocked: blockedItemID === item.id }]">
              <div class="crm-catalog-item-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</div>
              <div class="crm-catalog-item-content">
                <div class="crm-catalog-fields"><label><span>名称</span><input v-model="drafts[item.id].name" maxlength="64"></label><label><span>排序</span><input v-model.number="drafts[item.id].sort_order" type="number" min="0" inputmode="numeric"></label></div>
                <div class="crm-catalog-meta"><span :class="['crm-catalog-status', item.enabled ? 'enabled' : 'disabled']"><i aria-hidden="true"></i>{{ item.enabled ? '已启用' : '已停用' }}</span><span>已关联 {{ item.reference_count }} 个商机</span><span>版本 {{ item.version }}</span></div>
              </div>
              <div class="crm-catalog-actions"><button class="crm-catalog-save" type="button" :disabled="savingID === item.id" @click="saveItem(item)">{{ savingID === item.id ? '保存中…' : '保存' }}</button><button type="button" :disabled="savingID === item.id" @click="saveItem(item, !item.enabled)">{{ item.enabled ? '停用' : '启用' }}</button><button class="danger" type="button" :disabled="savingID === item.id" @click="askDelete(item)">删除</button></div>
              <p v-if="blockedItemID === item.id" class="crm-alert warning">该配置已被商机引用，不能删除。可使用“停用”保留历史数据。</p>
            </article>
            <div v-if="!items.length" class="crm-catalog-empty"><span aria-hidden="true">＋</span><strong>暂无{{ kindLabel }}配置</strong><p>请在上方填写名称和显示顺序后新增。</p></div>
          </div>
        </section>
      </div>
      <footer class="crm-catalog-footer"><p><span aria-hidden="true">i</span>仅未被商机引用的配置可以永久删除</p><button class="console-button ghost" type="button" @click="emit('close')">完成</button></footer>
    </article>
    <div v-if="pendingDelete" class="crm-modal nested crm-catalog-delete-confirm" role="dialog" aria-modal="true" aria-labelledby="crm-catalog-delete-title">
      <form @submit.prevent="confirmDelete"><h2 id="crm-catalog-delete-title">删除“{{ pendingDelete.name }}”</h2><p class="crm-note">仅未被任何商机使用的配置可删除。已使用配置应改为停用，历史商机不会被修改。</p><label>删除原因 *<textarea v-model.trim="deleteReason" required maxlength="500" rows="3"></textarea></label><p v-if="deleteError" class="crm-alert error" role="alert">{{ deleteError }}</p><div class="crm-actions"><button type="button" @click="closeDeleteConfirm">取消</button><button class="danger" type="submit">确认删除</button></div></form>
    </div>
  </div>
</template>
