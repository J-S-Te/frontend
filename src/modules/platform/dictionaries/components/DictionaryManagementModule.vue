<script setup>
import { computed, reactive, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  DictionaryError,
  createDictionary,
  createDictionaryItem,
  listDictionaries,
  listDictionaryItems,
  updateDictionary,
  updateDictionaryItem,
} from '@/modules/platform/dictionaries/api/dictionaries'
import { hasPermission } from '@/modules/platform/auth/utils/principal'
import { DICTIONARY_PERMISSIONS } from '@/modules/platform/dictionaries/utils/dictionaryPermissions'
import '@/modules/platform/dictionaries/styles/dictionary-management.css'

const emit = defineEmits(['toast'])

const dictionaries = ref([])
const dictionaryTotal = ref(0)
const dictionaryPage = ref(1)
const dictionaryPageSize = 20
const dictionaryKeyword = ref('')
const dictionaryStatus = ref('')
const selectedDictionaryId = ref('')
const dictionaryLoading = ref(false)
const dictionaryError = ref('')

const items = ref([])
const itemTotal = ref(0)
const itemPage = ref(1)
const itemPageSize = 20
const itemKeyword = ref('')
const itemStatus = ref('')
const itemLoading = ref(false)
const itemError = ref('')

const dictionaryEditorOpen = ref(false)
const editingDictionary = ref(null)
const dictionarySubmitting = ref(false)
const dictionaryFormError = ref('')
const dictionaryForm = reactive(emptyDictionaryForm())

const itemEditorOpen = ref(false)
const editingItem = ref(null)
const itemSubmitting = ref(false)
const itemFormError = ref('')
const itemForm = reactive(emptyItemForm())

const canReadDictionaries = computed(() => hasPermission(DICTIONARY_PERMISSIONS.dictionaryRead))
const canCreateDictionary = computed(() => hasPermission(DICTIONARY_PERMISSIONS.dictionaryCreate))
const canUpdateDictionary = computed(() => hasPermission(DICTIONARY_PERMISSIONS.dictionaryUpdate))
const canReadItems = computed(() => hasPermission(DICTIONARY_PERMISSIONS.itemRead))
const canCreateItem = computed(() => hasPermission(DICTIONARY_PERMISSIONS.itemCreate))
const canUpdateItem = computed(() => hasPermission(DICTIONARY_PERMISSIONS.itemUpdate))
const selectedDictionary = computed(() => dictionaries.value.find((entry) => dictionaryID(entry) === selectedDictionaryId.value) || null)
const dictionaryTotalPages = computed(() => Math.max(1, Math.ceil(dictionaryTotal.value / dictionaryPageSize)))
const itemTotalPages = computed(() => Math.max(1, Math.ceil(itemTotal.value / itemPageSize)))
const activeDictionaryCount = computed(() => dictionaries.value.filter((entry) => entry.status === 'ACTIVE').length)
const activeItemCount = computed(() => items.value.filter((entry) => entry.status === 'ACTIVE').length)

function emptyDictionaryForm() {
  return { code: '', name: '', description: '', status: 'ACTIVE', version: 0 }
}

function emptyItemForm() {
  return { code: '', label: '', value: '', sortOrder: 0, status: 'ACTIVE', version: 0 }
}

function dictionaryID(dictionary) {
  return dictionary?.dictionary_id || dictionary?.id || ''
}

function itemID(item) {
  return item?.item_id || item?.id || ''
}

function normalizedPage(payload) {
  if (Array.isArray(payload)) return { items: payload, total: payload.length }
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    total: Number(payload?.total || 0),
  }
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function userMessage(error, fallback) {
  if (!(error instanceof DictionaryError)) return fallback
  if (error.status === 403) return '当前账号没有字典管理权限。'
  if (error.status === 409 && error.code === 'VERSION_CONFLICT') return '数据已被其他管理员修改，请刷新后重试。'
  if (error.status === 409) return '编码已经存在，或当前数据状态不允许该操作。'
  if (error.status === 422) return '参数不符合要求，请检查编码、名称和状态。'
  return error.message || fallback
}

function showToast(message) {
  emit('toast', message)
}

async function loadDictionaries({ preserveSelection = true } = {}) {
  if (!canReadDictionaries.value) {
    dictionaries.value = []
    dictionaryTotal.value = 0
    selectedDictionaryId.value = ''
    dictionaryError.value = ''
    return
  }
  dictionaryLoading.value = true
  dictionaryError.value = ''
  const previousSelection = preserveSelection ? selectedDictionaryId.value : ''
  try {
    const payload = await listDictionaries({
      page: dictionaryPage.value,
      pageSize: dictionaryPageSize,
      keyword: dictionaryKeyword.value,
      status: dictionaryStatus.value,
    })
    const page = normalizedPage(payload)
    dictionaries.value = page.items
    dictionaryTotal.value = page.total

    if (dictionaryPage.value > dictionaryTotalPages.value) {
      dictionaryPage.value = dictionaryTotalPages.value
      await loadDictionaries({ preserveSelection })
      return
    }

    const stillVisible = page.items.some((entry) => dictionaryID(entry) === previousSelection)
    selectedDictionaryId.value = stillVisible ? previousSelection : dictionaryID(page.items[0])
  } catch (error) {
    dictionaries.value = []
    dictionaryTotal.value = 0
    selectedDictionaryId.value = ''
    dictionaryError.value = userMessage(error, '读取业务字典失败。')
  } finally {
    dictionaryLoading.value = false
  }
}

async function loadItems() {
  if (!selectedDictionaryId.value || !canReadItems.value) {
    items.value = []
    itemTotal.value = 0
    itemError.value = ''
    return
  }

  itemLoading.value = true
  itemError.value = ''
  try {
    const payload = await listDictionaryItems({
      dictionaryId: selectedDictionaryId.value,
      page: itemPage.value,
      pageSize: itemPageSize,
      keyword: itemKeyword.value,
      status: itemStatus.value,
    })
    const page = normalizedPage(payload)
    items.value = page.items
    itemTotal.value = page.total
    if (itemPage.value > itemTotalPages.value) {
      itemPage.value = itemTotalPages.value
      await loadItems()
    }
  } catch (error) {
    items.value = []
    itemTotal.value = 0
    itemError.value = userMessage(error, '读取字典项失败。')
  } finally {
    itemLoading.value = false
  }
}

function applyDictionaryFilter() {
  dictionaryPage.value = 1
  loadDictionaries({ preserveSelection: false })
}

function resetDictionaryFilter() {
  dictionaryKeyword.value = ''
  dictionaryStatus.value = ''
  dictionaryPage.value = 1
  loadDictionaries({ preserveSelection: false })
}

function setDictionaryPage(nextPage) {
  if (nextPage < 1 || nextPage > dictionaryTotalPages.value || dictionaryLoading.value) return
  dictionaryPage.value = nextPage
  loadDictionaries({ preserveSelection: false })
}

function selectDictionary(dictionary) {
  const id = dictionaryID(dictionary)
  if (!id || id === selectedDictionaryId.value) return
  selectedDictionaryId.value = id
}

function applyItemFilter() {
  itemPage.value = 1
  loadItems()
}

function resetItemFilter() {
  itemKeyword.value = ''
  itemStatus.value = ''
  itemPage.value = 1
  loadItems()
}

function setItemPage(nextPage) {
  if (nextPage < 1 || nextPage > itemTotalPages.value || itemLoading.value) return
  itemPage.value = nextPage
  loadItems()
}

function openCreateDictionary() {
  if (!canCreateDictionary.value) return
  editingDictionary.value = null
  dictionaryFormError.value = ''
  Object.assign(dictionaryForm, emptyDictionaryForm())
  dictionaryEditorOpen.value = true
}

function openEditDictionary(dictionary) {
  if (!canUpdateDictionary.value) return
  editingDictionary.value = dictionary
  dictionaryFormError.value = ''
  Object.assign(dictionaryForm, {
    code: dictionary.code || '',
    name: dictionary.name || '',
    description: dictionary.description || '',
    status: dictionary.status || 'ACTIVE',
    version: Number(dictionary.version || 0),
  })
  dictionaryEditorOpen.value = true
}

function closeDictionaryEditor() {
  if (dictionarySubmitting.value) return
  dictionaryEditorOpen.value = false
  editingDictionary.value = null
  dictionaryFormError.value = ''
  Object.assign(dictionaryForm, emptyDictionaryForm())
}

async function submitDictionary() {
  if (dictionarySubmitting.value) return
  if (editingDictionary.value ? !canUpdateDictionary.value : !canCreateDictionary.value) return
  dictionarySubmitting.value = true
  dictionaryFormError.value = ''
  try {
    let saved
    if (editingDictionary.value) {
      saved = await updateDictionary({
        dictionaryId: dictionaryID(editingDictionary.value),
        code: dictionaryForm.code.trim(),
        name: dictionaryForm.name.trim(),
        description: dictionaryForm.description.trim(),
        status: dictionaryForm.status,
        version: dictionaryForm.version,
      })
    } else {
      saved = await createDictionary({
        code: dictionaryForm.code.trim(),
        name: dictionaryForm.name.trim(),
        description: dictionaryForm.description.trim(),
        status: dictionaryForm.status,
      })
    }

    const savedID = dictionaryID(saved) || dictionaryID(editingDictionary.value)
    dictionaryEditorOpen.value = false
    editingDictionary.value = null
    if (canReadDictionaries.value) await loadDictionaries()
    if (savedID && dictionaries.value.some((entry) => dictionaryID(entry) === savedID)) selectedDictionaryId.value = savedID
    showToast(`字典已${dictionaryForm.version ? '更新' : '创建'}。`)
    Object.assign(dictionaryForm, emptyDictionaryForm())
  } catch (error) {
    dictionaryFormError.value = userMessage(error, '保存字典失败。')
  } finally {
    dictionarySubmitting.value = false
  }
}

function openCreateItem() {
  if (!selectedDictionary.value || !canCreateItem.value) return
  editingItem.value = null
  itemFormError.value = ''
  Object.assign(itemForm, emptyItemForm())
  itemEditorOpen.value = true
}

function openEditItem(item) {
  if (!canUpdateItem.value) return
  editingItem.value = item
  itemFormError.value = ''
  Object.assign(itemForm, {
    code: item.code || '',
    label: item.label || '',
    value: item.value || '',
    sortOrder: Number(item.sort_order || 0),
    status: item.status || 'ACTIVE',
    version: Number(item.version || 0),
  })
  itemEditorOpen.value = true
}

function closeItemEditor() {
  if (itemSubmitting.value) return
  itemEditorOpen.value = false
  editingItem.value = null
  itemFormError.value = ''
  Object.assign(itemForm, emptyItemForm())
}

async function submitItem() {
  if (!selectedDictionary.value || itemSubmitting.value) return
  if (editingItem.value ? !canUpdateItem.value : !canCreateItem.value) return
  itemSubmitting.value = true
  itemFormError.value = ''
  try {
    if (editingItem.value) {
      await updateDictionaryItem({
        dictionaryId: selectedDictionaryId.value,
        itemId: itemID(editingItem.value),
        code: itemForm.code.trim(),
        label: itemForm.label.trim(),
        value: itemForm.value.trim(),
        sortOrder: itemForm.sortOrder,
        status: itemForm.status,
        version: itemForm.version,
      })
    } else {
      await createDictionaryItem({
        dictionaryId: selectedDictionaryId.value,
        code: itemForm.code.trim(),
        label: itemForm.label.trim(),
        value: itemForm.value.trim(),
        sortOrder: itemForm.sortOrder,
        status: itemForm.status,
      })
    }

    const action = itemForm.version ? '更新' : '创建'
    itemEditorOpen.value = false
    editingItem.value = null
    await Promise.all([
      canReadItems.value ? loadItems() : Promise.resolve(),
      canReadDictionaries.value ? loadDictionaries() : Promise.resolve(),
    ])
    showToast(`字典项已${action}。`)
    Object.assign(itemForm, emptyItemForm())
  } catch (error) {
    itemFormError.value = userMessage(error, '保存字典项失败。')
  } finally {
    itemSubmitting.value = false
  }
}

watch(selectedDictionaryId, () => {
  itemPage.value = 1
  itemKeyword.value = ''
  itemStatus.value = ''
  loadItems()
})

// 路由进入后 principal 异步填充；组件若早于 /auth/me 返回就挂载，需监听权限授予后再加载，
// 否则会永久显示空目录。
watch(canReadDictionaries, (granted, previouslyGranted) => {
  if (granted && !previouslyGranted) {
    loadDictionaries()
    return
  }
  if (!granted) {
    dictionaries.value = []
    dictionaryTotal.value = 0
    selectedDictionaryId.value = ''
  }
}, { immediate: true })
</script>

<template>
  <section class="dictionary-module" aria-labelledby="dictionary-heading">
    <div class="so-summary-grid" aria-label="字典统计">
      <article class="so-summary-card blue"><span><ConsoleIcon name="dashboard" /></span><div><small>字典总数</small><strong>{{ dictionaryTotal }}</strong><p>当前租户的业务字典</p></div></article>
      <article class="so-summary-card violet"><span><ConsoleIcon name="info" /></span><div><small>当前页启用</small><strong>{{ activeDictionaryCount }}</strong><p>本页已启用字典</p></div></article>
      <article class="so-summary-card orange"><span><ConsoleIcon name="settings" /></span><div><small>当前字典项</small><strong>{{ itemTotal }}</strong><p>{{ selectedDictionary?.name || '尚未选择字典' }}</p></div></article>
      <article class="so-summary-card green"><span><ConsoleIcon name="shield" /></span><div><small>当前页启用项</small><strong>{{ activeItemCount }}</strong><p>历史值建议停用而非删除</p></div></article>
    </div>

    <section class="so-content">
      <header class="so-panel-head dictionary-panel-head">
        <div><h2 id="dictionary-heading">字典管理</h2><p>集中维护稳定编码、中文名称和可选值；业务保存 value，界面展示 label。</p></div>
        <button v-if="canCreateDictionary" class="console-button primary" type="button" @click="openCreateDictionary"><ConsoleIcon name="info" />新建字典</button>
      </header>

      <div class="dictionary-workspace">
        <aside class="so-card dictionary-catalog" aria-label="字典目录">
          <header class="dictionary-section-head"><div><h3>字典目录</h3><p>选择字典后维护对应选项</p></div><span class="so-status">{{ dictionaryTotal }} 个</span></header>
          <div v-if="canReadDictionaries" class="console-filter-bar dictionary-catalog__toolbar">
            <label class="console-search-field"><ConsoleIcon name="search" /><input v-model="dictionaryKeyword" type="search" maxlength="100" placeholder="编码 / 名称 / 描述" @keyup.enter="applyDictionaryFilter" /></label>
            <label class="console-select-field"><select v-model="dictionaryStatus" aria-label="字典状态" @change="applyDictionaryFilter"><option value="">全部状态</option><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
            <button class="console-button ghost small" type="button" :disabled="dictionaryLoading" @click="applyDictionaryFilter">查询</button>
            <button class="console-button ghost small" type="button" :disabled="dictionaryLoading" @click="resetDictionaryFilter"><ConsoleIcon name="reset" />重置</button>
          </div>

          <p v-if="dictionaryError" class="dictionary-module__error" role="alert">{{ dictionaryError }}</p>
          <div class="dictionary-catalog__list">
            <div v-if="dictionaryLoading" class="dictionary-module__empty">正在读取业务字典…</div>
            <div v-else-if="!canReadDictionaries" class="dictionary-module__empty"><ConsoleIcon name="shield" /><strong>没有字典读取权限</strong><span v-if="canCreateDictionary">你仍可新建字典。</span><span v-else>请联系平台管理员授予字典读取权限。</span></div>
            <div v-else-if="!dictionaries.length" class="dictionary-module__empty"><ConsoleIcon name="info" /><strong>暂无业务字典</strong><span v-if="canCreateDictionary">点击“新建字典”开始维护统一选项。</span><span v-else>当前租户尚未配置业务字典。</span></div>
            <button v-for="dictionary in dictionaries" v-else :key="dictionaryID(dictionary)" class="dictionary-card" :class="{ active: selectedDictionaryId === dictionaryID(dictionary) }" type="button" @click="selectDictionary(dictionary)">
              <span class="dictionary-card__top"><code>{{ dictionary.code }}</code><span class="console-badge" :class="dictionary.status === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ dictionary.status === 'ACTIVE' ? '启用' : '停用' }}</span></span>
              <strong>{{ dictionary.name }}</strong>
              <small>{{ dictionary.description || '暂无说明' }}</small>
              <span class="dictionary-card__meta"><b>{{ dictionary.item_count || 0 }} 项</b><time>{{ formatDate(dictionary.updated_at) }}</time></span>
            </button>
          </div>
          <footer v-if="canReadDictionaries" class="console-table-footer dictionary-pagination"><span>共 {{ dictionaryTotal }} 个</span><div><button class="console-button ghost small" type="button" :disabled="dictionaryPage <= 1 || dictionaryLoading" @click="setDictionaryPage(dictionaryPage - 1)">上一页</button><b>{{ dictionaryPage }} / {{ dictionaryTotalPages }}</b><button class="console-button ghost small" type="button" :disabled="dictionaryPage >= dictionaryTotalPages || dictionaryLoading" @click="setDictionaryPage(dictionaryPage + 1)">下一页</button></div></footer>
        </aside>

        <article class="so-card dictionary-items-panel">
          <template v-if="selectedDictionary">
            <header class="dictionary-items-panel__head">
              <div><span>当前字典</span><h3>{{ selectedDictionary.name }}</h3><p><code>{{ selectedDictionary.code }}</code> · {{ selectedDictionary.description || '暂无说明' }}</p></div>
              <div class="dictionary-header-actions"><button v-if="canUpdateDictionary" class="console-button ghost" type="button" @click="openEditDictionary(selectedDictionary)">编辑字典</button><button v-if="canCreateItem" class="console-button primary" type="button" @click="openCreateItem">新增字典项</button></div>
            </header>

            <div v-if="canReadItems" class="console-filter-bar dictionary-items-toolbar">
              <label class="console-search-field"><ConsoleIcon name="search" /><input v-model="itemKeyword" type="search" maxlength="100" placeholder="项编码 / 名称 / 值" @keyup.enter="applyItemFilter" /></label>
              <label class="console-select-field"><select v-model="itemStatus" aria-label="字典项状态" @change="applyItemFilter"><option value="">全部状态</option><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
              <button class="console-button ghost small" type="button" :disabled="itemLoading" @click="applyItemFilter">查询</button>
              <button class="console-button ghost small" type="button" :disabled="itemLoading" @click="resetItemFilter"><ConsoleIcon name="reset" />重置</button>
            </div>

            <p v-if="itemError" class="dictionary-module__error" role="alert">{{ itemError }}</p>
            <div v-if="canReadItems" class="console-table-scroll dictionary-table-wrap">
              <table class="console-data-table dictionary-items-table">
                <thead><tr><th>显示名称</th><th>项编码</th><th>实际值</th><th>排序</th><th>状态</th><th>更新时间</th><th class="console-actions-cell">操作</th></tr></thead>
                <tbody>
                  <tr v-if="itemLoading"><td colspan="7" class="console-empty">正在读取字典项…</td></tr>
                  <tr v-else-if="!items.length"><td colspan="7" class="console-empty">当前字典暂无符合条件的字典项。</td></tr>
                  <tr v-for="item in items" v-else :key="itemID(item)">
                    <td><strong class="console-entity-name">{{ item.label }}</strong></td><td class="console-mono">{{ item.code }}</td><td class="console-mono">{{ item.value }}</td><td>{{ item.sort_order }}</td>
                    <td><span class="console-badge" :class="item.status === 'ACTIVE' ? 'status-active' : 'status-disabled'">{{ item.status === 'ACTIVE' ? '启用' : '停用' }}</span></td>
                    <td>{{ formatDate(item.updated_at) }}</td><td class="console-actions-cell"><button v-if="canUpdateItem" class="console-text-button" type="button" @click="openEditItem(item)">编辑</button><span v-else>—</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <footer v-if="canReadItems" class="console-table-footer dictionary-pagination"><span>共 {{ itemTotal }} 项</span><div><button class="console-button ghost small" type="button" :disabled="itemPage <= 1 || itemLoading" @click="setItemPage(itemPage - 1)">上一页</button><b>{{ itemPage }} / {{ itemTotalPages }}</b><button class="console-button ghost small" type="button" :disabled="itemPage >= itemTotalPages || itemLoading" @click="setItemPage(itemPage + 1)">下一页</button></div></footer>
            <div v-else class="dictionary-items-panel__placeholder"><ConsoleIcon name="shield" /><h3>没有字典项读取权限</h3><p v-if="canCreateItem">你仍可向当前字典新增选项。</p><p v-else>请联系平台管理员授予字典项读取权限。</p></div>
          </template>
          <div v-else class="dictionary-items-panel__placeholder"><ConsoleIcon name="dashboard" /><h3>请选择一个字典</h3><p>选择左侧字典后，可以维护其字典项、排序和启停状态。</p></div>
        </article>
      </div>
    </section>

    <div v-if="dictionaryEditorOpen" class="console-modal-backdrop" role="presentation" @click.self="closeDictionaryEditor">
      <form class="console-detail-modal dictionary-dialog" role="dialog" aria-modal="true" :aria-label="editingDictionary ? '编辑字典' : '新建字典'" @submit.prevent="submitDictionary">
        <header><div><p class="console-modal-eyebrow">字典定义</p><h2>{{ editingDictionary ? '编辑字典' : '新建字典' }}</h2></div><button class="console-modal-close" type="button" aria-label="关闭" @click="closeDictionaryEditor"><ConsoleIcon name="close" /></button></header>
        <div class="console-form-grid dictionary-dialog__body">
          <label class="console-form-item"><span>字典编码 *</span><input v-model="dictionaryForm.code" required maxlength="64" pattern="[A-Za-z0-9_.-]+" autocomplete="off" placeholder="例如 AUDIT_ACTION_TYPE" /><small>仅允许字母、数字、下划线、点和短横线。</small></label>
          <label class="console-form-item"><span>字典名称 *</span><input v-model="dictionaryForm.name" required maxlength="100" autocomplete="off" placeholder="例如 审计操作类型" /></label>
          <label class="console-form-item full"><span>说明</span><textarea v-model="dictionaryForm.description" maxlength="500" rows="3" placeholder="说明这个字典由哪些业务模块使用"></textarea><small>{{ dictionaryForm.description.length }} / 500</small></label>
          <label class="console-form-item full"><span>状态 *</span><select v-model="dictionaryForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select><small>停用后，按编码查询可选项的业务接口将返回空列表。</small></label>
        </div>
        <p v-if="dictionaryFormError" class="dictionary-module__error dictionary-dialog__error" role="alert">{{ dictionaryFormError }}</p>
        <footer><button class="console-button ghost" type="button" :disabled="dictionarySubmitting" @click="closeDictionaryEditor">取消</button><button class="console-button primary" type="submit" :disabled="dictionarySubmitting"><ConsoleIcon name="save" />{{ dictionarySubmitting ? '保存中…' : '保存' }}</button></footer>
      </form>
    </div>

    <div v-if="itemEditorOpen" class="console-modal-backdrop" role="presentation" @click.self="closeItemEditor">
      <form class="console-detail-modal dictionary-dialog" role="dialog" aria-modal="true" :aria-label="editingItem ? '编辑字典项' : '新增字典项'" @submit.prevent="submitItem">
        <header><div><p class="console-modal-eyebrow">字典项 · {{ selectedDictionary?.name }}</p><h2>{{ editingItem ? '编辑字典项' : '新增字典项' }}</h2></div><button class="console-modal-close" type="button" aria-label="关闭" @click="closeItemEditor"><ConsoleIcon name="close" /></button></header>
        <div class="console-form-grid dictionary-dialog__body">
          <label class="console-form-item"><span>字典项编码 *</span><input v-model="itemForm.code" required maxlength="64" pattern="[A-Za-z0-9_.-]+" autocomplete="off" placeholder="例如 LOGIN" /></label>
          <label class="console-form-item"><span>显示名称 *</span><input v-model="itemForm.label" required maxlength="100" autocomplete="off" placeholder="例如 登录" /></label>
          <label class="console-form-item"><span>实际值 *</span><input v-model="itemForm.value" required maxlength="255" autocomplete="off" placeholder="例如 LOGIN" /><small>业务接口和数据库实际保存的值。</small></label>
          <label class="console-form-item"><span>排序</span><input v-model.number="itemForm.sortOrder" type="number" min="0" step="1" /><small>数值越小越靠前。</small></label>
          <label class="console-form-item full"><span>状态 *</span><select v-model="itemForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
        </div>
        <p v-if="itemFormError" class="dictionary-module__error dictionary-dialog__error" role="alert">{{ itemFormError }}</p>
        <footer><button class="console-button ghost" type="button" :disabled="itemSubmitting" @click="closeItemEditor">取消</button><button class="console-button primary" type="submit" :disabled="itemSubmitting"><ConsoleIcon name="save" />{{ itemSubmitting ? '保存中…' : '保存' }}</button></footer>
      </form>
    </div>
  </section>
</template>
