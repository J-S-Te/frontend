<script setup>
import { computed, onMounted, ref } from 'vue'
import { deleteReadNotifications, getNotification, getUnreadCount, listInbox, markNotificationRead } from '@/modules/platform/notifications/api/notifications'
import { notificationTargetPath } from '@/modules/platform/notifications/target.js'
import { formatBusinessDateTime } from '@/modules/shared/utils/businessTime.js'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import ConfirmDialog from '@/modules/shared/components/ConfirmDialog.vue'
import { useConfirmDialog } from '@/modules/shared/composables/useConfirmDialog.js'

// 共享站内通知列表：平台统一收件箱按来源收窄，供各子系统铃铛内嵌。
// scope 固定为 all/local/cross 时隐藏页签，用于 CRM 的“跨系统”独立入口。
const props = defineProps({
  appCode: { type: String, required: true },
  scope: { type: String, default: '' },
  pageSize: { type: Number, default: 10 },
})
const emit = defineEmits(['unread-change'])
const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog()

const tab = ref('all')
const tabs = [{ key: 'all', label: '全部' }, { key: 'local', label: '本系统' }, { key: 'cross', label: '跨系统' }]
const items = ref([]), total = ref(0), page = ref(1), unread = ref(0)
const loading = ref(false), error = ref(''), detail = ref(null), busy = ref(false)
const activeScope = computed(() => props.scope || tab.value)
const pages = computed(() => Math.max(1, Math.ceil(total.value / props.pageSize)))
const hasRead = computed(() => items.value.some((item) => item.read_at))
// 详情里的业务入口只接受同源相对路径；目标页仍会重新校验对象权限。
const detailTarget = computed(() => notificationTargetPath(detail.value?.target_url))

function scopeParams() {
  if (activeScope.value === 'local') return { sourceApplication: props.appCode }
  if (activeScope.value === 'cross') return { excludeSourceApplication: props.appCode }
  return {}
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = { page: page.value, pageSize: props.pageSize, ...scopeParams() }
    // 未读数必须走专用计数接口，不能再用 pageSize=1 的列表总数反推：
    // 列表受分页/来源过滤影响，反推早晚会和徽标口径分叉。
    const [result, unreadResult] = await Promise.all([
      listInbox(params),
      getUnreadCount(scopeParams()),
    ])
    items.value = result?.items || []
    total.value = Number(result?.total || 0)
    unread.value = Number(unreadResult?.unread_count || 0)
    emit('unread-change', unread.value)
    if (page.value > pages.value) { page.value = pages.value; await load() }
  } catch (e) {
    items.value = []
    error.value = formatUserError(e, { fallback: '站内通知加载失败，请重试。' })
  } finally { loading.value = false }
}

function changeTab(next) {
  tab.value = next
  page.value = 1
  detail.value = null
  load()
}

function changePage(next) {
  page.value = next
  detail.value = null
  load()
}

async function open(item) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await getNotification(item.delivery_id)
    detail.value = result
    if (!result.read_at) {
      await markNotificationRead(item.delivery_id)
      detail.value = { ...result, read_at: new Date().toISOString() }
      await load()
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: '通知读取失败，请重试。' })
  } finally { busy.value = false }
}

async function deleteRead() {
  if (!hasRead.value || busy.value || loading.value) return
  const confirmed = await askConfirm({
    title: '删除全部已读站内信？',
    description: '确认删除当前账号的全部已读站内信？该操作只影响你的收件箱，删除后不可恢复。',
    confirmText: '删除已读',
    cancelText: '取消',
    danger: true,
  })
  if (!confirmed || !hasRead.value || busy.value || loading.value) return
  busy.value = true
  error.value = ''
  try {
    await deleteReadNotifications()
    await load()
  } catch (e) {
    error.value = formatUserError(e, { fallback: '删除已读通知失败，请重试。' })
  } finally { busy.value = false }
}

onMounted(load)
</script>

<template>
  <section class="shared-inbox" aria-label="站内通知">
    <nav v-if="!scope" class="shared-inbox-tabs" role="tablist">
      <button v-for="item in tabs" :key="item.key" type="button" :class="{ active: tab === item.key }" :disabled="busy" @click="changeTab(item.key)">{{ item.label }}</button>
    </nav>
    <div class="shared-inbox-actions">
      <span>未读 {{ unread }}</span>
      <button type="button" :disabled="!hasRead || busy || loading" @click="deleteRead">删除已读</button>
    </div>
    <p v-if="error" role="alert" class="shared-inbox-error">{{ error }}</p>
    <p v-else-if="loading" role="status">正在加载通知…</p>
    <p v-else-if="!items.length" class="shared-inbox-empty">暂无通知。</p>
    <ul v-else class="shared-inbox-list">
      <li v-for="item in items" :key="item.delivery_id" :class="{ unread: !item.read_at }">
        <button type="button" :disabled="busy" @click="open(item)">
          <strong>{{ item.title }}</strong>
          <small>{{ item.source_application }} · {{ formatBusinessDateTime(item.delivered_at) }}</small>
          <p>{{ item.content }}</p>
        </button>
      </li>
    </ul>
    <nav v-if="pages > 1" class="shared-inbox-pagination" aria-label="站内通知分页">
      <button type="button" :disabled="page <= 1 || busy" @click="changePage(page - 1)">上一页</button>
      <span>{{ page }} / {{ pages }}</span>
      <button type="button" :disabled="page >= pages || busy" @click="changePage(page + 1)">下一页</button>
    </nav>
    <ConfirmDialog :open="Boolean(confirmDialog)" v-bind="confirmDialog || {}" @confirm="acceptConfirm" @cancel="cancelConfirm" />
    <aside v-if="detail" class="shared-inbox-detail">
      <header><h3>{{ detail.title }}</h3><button type="button" @click="detail = null">关闭</button></header>
      <p>{{ detail.content }}</p>
      <small>来源：{{ detail.source_application }} · 送达：{{ formatBusinessDateTime(detail.delivered_at) }}</small>
      <a v-if="detailTarget" class="shared-inbox-target" :href="detailTarget">前往业务页面</a>
    </aside>
  </section>
</template>

<style scoped>
.shared-inbox{display:grid;gap:10px;min-width:0}
.shared-inbox-tabs{display:inline-flex;gap:4px}
.shared-inbox-tabs button,.shared-inbox-actions button,.shared-inbox-pagination button,.shared-inbox-detail button{padding:5px 9px;border:1px solid #e2e8f0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
.shared-inbox-tabs button.active{background:#2563eb;border-color:#2563eb;color:#fff}
.shared-inbox-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#64748b}
.shared-inbox-list{display:grid;gap:6px;margin:0;padding:0;list-style:none;max-height:320px;overflow:auto}
.shared-inbox-list li>button{display:grid;gap:4px;width:100%;padding:9px 10px;border:1px solid #e2e8f0;border-radius:9px;background:transparent;color:inherit;text-align:left;cursor:pointer}
.shared-inbox-list li.unread>button{border-left:3px solid #2563eb}
.shared-inbox-list strong{font-weight:600}.shared-inbox-list small{color:#64748b}.shared-inbox-list p{margin:0;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shared-inbox-empty,.shared-inbox-error{padding:12px 0;color:#64748b}.shared-inbox-error{color:#b91c1c}
.shared-inbox-pagination{display:flex;align-items:center;gap:8px;color:#64748b}
.shared-inbox-detail{padding:10px;border:1px solid #e2e8f0;border-radius:9px}
.shared-inbox-detail header{display:flex;align-items:center;justify-content:space-between;gap:8px}
.shared-inbox-detail h3{margin:0;font-size:14px}.shared-inbox-detail p{white-space:pre-wrap;overflow-wrap:anywhere;color:#475569}.shared-inbox-target{display:inline-flex;margin-top:6px;padding:5px 9px;border:1px solid #2563eb;border-radius:8px;color:#2563eb;text-decoration:none}
</style>
