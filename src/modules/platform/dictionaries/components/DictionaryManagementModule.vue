<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
  if (!selectedDictionaryId.value) {
    items.value = []
    itemTotal.value = 0
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
  editingDictionary.value = null
  dictionaryFormError.value = ''
  Object.assign(dictionaryForm, emptyDictionaryForm())
  dictionaryEditorOpen.value = true
}

function openEditDictionary(dictionary) {
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
    await loadDictionaries()
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
  if (!selectedDictionary.value) return
  editingItem.value = null
  itemFormError.value = ''
  Object.assign(itemForm, emptyItemForm())
  itemEditorOpen.value = true
}

function openEditItem(item) {
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
    await Promise.all([loadItems(), loadDictionaries()])
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

onMounted(() => loadDictionaries())
</script>

<template>
  <section class="dictionary-module">
    <header class="dictionary-module__head">
      <div>
        <span class="dictionary-module__eyebrow"><ConsoleIcon name="dashboard" />BUSINESS DICTIONARY</span>
        <h2>字典管理</h2>
        <p>集中维护稳定编码、中文名称和可选值。业务代码保存 value，界面展示 label；历史值应优先停用而不是删除。</p>
      </div>
      <button class="console-button primary" type="button" @click="openCreateDictionary"><ConsoleIcon name="info" /> 新建字典</button>
    </header>

    <div class="dictionary-module__summary" aria-label="字典统计">
      <div><span>当前页字典</span><strong>{{ dictionaries.length }}</strong><small>其中 {{ activeDictionaryCount }} 个启用</small></div>
      <div><span>所选字典项</span><strong>{{ itemTotal }}</strong><small>当前页 {{ activeItemCount }} 个启用</small></div>
      <div><span>数据边界</span><strong>租户级</strong><small>不同租户数据相互隔离</small></div>
    </div>

    <div class="dictionary-module__layout">
      <aside class="dictionary-catalog">
        <div class="dictionary-catalog__toolbar">
          <label class="dictionary-search"><ConsoleIcon name="search" /><input v-model="dictionaryKeyword" type="search" maxlength="100" placeholder="编码 / 名称 / 描述" @keyup.enter="applyDictionaryFilter" /></label>
          <select v-model="dictionaryStatus" aria-label="字典状态" @change="applyDictionaryFilter">
            <option value="">全部状态</option>
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">停用</option>
          </select>
          <button class="dictionary-icon-button" type="button" aria-label="查询字典" :disabled="dictionaryLoading" @click="applyDictionaryFilter"><ConsoleIcon name="search" /></button>
          <button class="dictionary-icon-button" type="button" aria-label="清空字典筛选" :disabled="dictionaryLoading" @click="resetDictionaryFilter"><ConsoleIcon name="reset" /></button>
        </div>

        <p v-if="dictionaryError" class="dictionary-module__error" role="alert">{{ dictionaryError }}</p>
        <div class="dictionary-catalog__list">
          <div v-if="dictionaryLoading" class="dictionary-module__empty">正在读取业务字典…</div>
          <div v-else-if="!dictionaries.length" class="dictionary-module__empty"><ConsoleIcon name="info" /><strong>暂无业务字典</strong><span>点击“新建字典”开始维护统一选项。</span></div>
          <button v-for="dictionary in dictionaries" v-else :key="dictionaryID(dictionary)" class="dictionary-card" :class="{ active: selectedDictionaryId === dictionaryID(dictionary) }" type="button" @click="selectDictionary(dictionary)">
            <span class="dictionary-card__top"><code>{{ dictionary.code }}</code><em :class="`is-${String(dictionary.status || '').toLowerCase()}`">{{ dictionary.status === 'ACTIVE' ? '启用' : '停用' }}</em></span>
            <strong>{{ dictionary.name }}</strong>
            <small>{{ dictionary.description || '暂无说明' }}</small>
            <span class="dictionary-card__meta"><b>{{ dictionary.item_count || 0 }} 项</b><time>{{ formatDate(dictionary.updated_at) }}</time></span>
          </button>
        </div>
        <footer class="dictionary-pagination">
          <span>共 {{ dictionaryTotal }} 个</span>
          <div><button type="button" :disabled="dictionaryPage <= 1 || dictionaryLoading" @click="setDictionaryPage(dictionaryPage - 1)">上一页</button><b>{{ dictionaryPage }} / {{ dictionaryTotalPages }}</b><button type="button" :disabled="dictionaryPage >= dictionaryTotalPages || dictionaryLoading" @click="setDictionaryPage(dictionaryPage + 1)">下一页</button></div>
        </footer>
      </aside>

      <main class="dictionary-items-panel">
        <template v-if="selectedDictionary">
          <header class="dictionary-items-panel__head">
            <div><span>当前字典</span><h3>{{ selectedDictionary.name }}</h3><p><code>{{ selectedDictionary.code }}</code> · {{ selectedDictionary.description || '暂无说明' }}</p></div>
            <div><button class="console-button ghost" type="button" @click="openEditDictionary(selectedDictionary)">编辑字典</button><button class="console-button primary" type="button" @click="openCreateItem">新增字典项</button></div>
          </header>

          <div class="dictionary-items-toolbar">
            <label class="dictionary-search"><ConsoleIcon name="search" /><input v-model="itemKeyword" type="search" maxlength="100" placeholder="项编码 / 名称 / 值" @keyup.enter="applyItemFilter" /></label>
            <select v-model="itemStatus" aria-label="字典项状态" @change="applyItemFilter"><option value="">全部状态</option><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select>
            <button class="console-button ghost small" type="button" :disabled="itemLoading" @click="applyItemFilter">查询</button>
            <button class="console-button ghost small" type="button" :disabled="itemLoading" @click="resetItemFilter"><ConsoleIcon name="reset" /> 重置</button>
          </div>

          <p v-if="itemError" class="dictionary-module__error" role="alert">{{ itemError }}</p>
          <div class="dictionary-table-wrap">
            <table class="dictionary-table">
              <thead><tr><th>显示名称</th><th>项编码</th><th>实际值</th><th>排序</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-if="itemLoading"><td colspan="7" class="dictionary-table__state">正在读取字典项…</td></tr>
                <tr v-else-if="!items.length"><td colspan="7" class="dictionary-table__state">当前字典暂无符合条件的字典项。</td></tr>
                <tr v-for="item in items" v-else :key="itemID(item)">
                  <td><strong>{{ item.label }}</strong></td><td><code>{{ item.code }}</code></td><td><code>{{ item.value }}</code></td><td>{{ item.sort_order }}</td>
                  <td><span class="dictionary-status" :class="`is-${String(item.status || '').toLowerCase()}`">{{ item.status === 'ACTIVE' ? '启用' : '停用' }}</span></td>
                  <td>{{ formatDate(item.updated_at) }}</td><td><button class="dictionary-text-button" type="button" @click="openEditItem(item)">编辑</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer class="dictionary-pagination is-items"><span>共 {{ itemTotal }} 项</span><div><button type="button" :disabled="itemPage <= 1 || itemLoading" @click="setItemPage(itemPage - 1)">上一页</button><b>{{ itemPage }} / {{ itemTotalPages }}</b><button type="button" :disabled="itemPage >= itemTotalPages || itemLoading" @click="setItemPage(itemPage + 1)">下一页</button></div></footer>
        </template>
        <div v-else class="dictionary-items-panel__placeholder"><ConsoleIcon name="dashboard" /><h3>请选择一个字典</h3><p>选择左侧字典后，可以维护其字典项、排序和启停状态。</p></div>
      </main>
    </div>

    <div v-if="dictionaryEditorOpen" class="dictionary-dialog-backdrop" @click.self="closeDictionaryEditor">
      <form class="dictionary-dialog" @submit.prevent="submitDictionary">
        <header><div><span>DICTIONARY DEFINITION</span><h3>{{ editingDictionary ? '编辑字典' : '新建字典' }}</h3></div><button type="button" aria-label="关闭" @click="closeDictionaryEditor"><ConsoleIcon name="close" /></button></header>
        <label><span>字典编码 *</span><input v-model="dictionaryForm.code" required maxlength="64" pattern="[A-Za-z0-9_.-]+" autocomplete="off" placeholder="例如 AUDIT_ACTION_TYPE" /><small>1–64 位，只允许字母、数字、下划线、点和短横线；业务代码会通过它查询字典项。</small></label>
        <label><span>字典名称 *</span><input v-model="dictionaryForm.name" required maxlength="100" autocomplete="off" placeholder="例如 审计操作类型" /></label>
        <label><span>说明</span><textarea v-model="dictionaryForm.description" maxlength="500" rows="3" placeholder="说明这个字典由哪些业务模块使用"></textarea><small>{{ dictionaryForm.description.length }} / 500</small></label>
        <label><span>状态 *</span><select v-model="dictionaryForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select><small>停用后，按编码查询可选项的业务接口将返回空列表。</small></label>
        <p v-if="dictionaryFormError" class="dictionary-module__error" role="alert">{{ dictionaryFormError }}</p>
        <footer><button class="console-button ghost" type="button" :disabled="dictionarySubmitting" @click="closeDictionaryEditor">取消</button><button class="console-button primary" type="submit" :disabled="dictionarySubmitting"><ConsoleIcon name="save" />{{ dictionarySubmitting ? '保存中…' : '保存' }}</button></footer>
      </form>
    </div>

    <div v-if="itemEditorOpen" class="dictionary-dialog-backdrop" @click.self="closeItemEditor">
      <form class="dictionary-dialog" @submit.prevent="submitItem">
        <header><div><span>DICTIONARY ITEM</span><h3>{{ editingItem ? '编辑字典项' : '新增字典项' }}</h3><p>{{ selectedDictionary?.name }}</p></div><button type="button" aria-label="关闭" @click="closeItemEditor"><ConsoleIcon name="close" /></button></header>
        <div class="dictionary-dialog__grid">
          <label><span>字典项编码 *</span><input v-model="itemForm.code" required maxlength="64" pattern="[A-Za-z0-9_.-]+" autocomplete="off" placeholder="例如 LOGIN" /></label>
          <label><span>显示名称 *</span><input v-model="itemForm.label" required maxlength="100" autocomplete="off" placeholder="例如 登录" /></label>
          <label><span>实际值 *</span><input v-model="itemForm.value" required maxlength="255" autocomplete="off" placeholder="例如 LOGIN" /><small>业务接口和数据库实际保存的值。</small></label>
          <label><span>排序</span><input v-model.number="itemForm.sortOrder" type="number" min="0" step="1" /><small>数值越小越靠前。</small></label>
          <label><span>状态 *</span><select v-model="itemForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
        </div>
        <p v-if="itemFormError" class="dictionary-module__error" role="alert">{{ itemFormError }}</p>
        <footer><button class="console-button ghost" type="button" :disabled="itemSubmitting" @click="closeItemEditor">取消</button><button class="console-button primary" type="submit" :disabled="itemSubmitting"><ConsoleIcon name="save" />{{ itemSubmitting ? '保存中…' : '保存' }}</button></footer>
      </form>
    </div>
  </section>
</template>
