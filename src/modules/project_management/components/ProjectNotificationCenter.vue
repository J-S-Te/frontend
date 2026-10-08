<script setup>
import { computed, onMounted, ref } from 'vue'
import { getNotification, listInbox, markNotificationRead } from '@/modules/platform/notifications/api/notifications'

const emit = defineEmits(['read'])
const items = ref([]), total = ref(0), page = ref(1), unreadOnly = ref(false)
const loading = ref(false), error = ref(''), detail = ref(null), actionID = ref('')
const pageSize = 20
let loadSequence = 0
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const formatDate = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'

// Notification targets are optional. Never convert arbitrary URLs/categories
// into project routes or bypass the target page's own authorization checks.
const projectTarget = computed(() => {
  if (!detail.value?.target_url) return ''
  try {
    const url = new URL(detail.value.target_url, window.location.origin)
    return url.origin === window.location.origin && url.pathname.startsWith('/project_management/')
      ? `${url.pathname}${url.search}${url.hash}` : ''
  } catch { return '' }
})

async function load() {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const result = await listInbox({ page: page.value, pageSize, unreadOnly: unreadOnly.value })
    if (sequence !== loadSequence) return
    if (!Array.isArray(result?.items) || !Number.isFinite(Number(result.total))) throw new Error('通知列表响应异常，请重试。')
    items.value = result.items
    total.value = Number(result.total)
    if (page.value > pages.value) { page.value = pages.value; await load() }
  } catch (value) {
    if (sequence !== loadSequence) return
    items.value = []
    error.value = value?.message || '个人通知加载失败，请重试。'
  } finally { if (sequence === loadSequence) loading.value = false }
}
function changeFilter() { page.value = 1; detail.value = null; load() }
function changePage(next) { page.value = next; load() }
async function open(item) {
  if (actionID.value) return
  actionID.value = item.delivery_id
  error.value = ''
  try {
    const result = await getNotification(item.delivery_id)
    detail.value = result
    if (!result.read_at) {
      await markNotificationRead(item.delivery_id)
      detail.value = { ...result, read_at: new Date().toISOString() }
      emit('read')
      await load()
    }
  } catch (value) { error.value = value?.message || '通知读取失败，请重试。' }
  finally { actionID.value = '' }
}
onMounted(load)
</script>

<template>
  <section class="pm-panel pm-personal-notifications" aria-label="个人通知中心">
    <header><div><h2>我的通知</h2><p>查看统一站内信中发送给你的业务通知。</p></div><div class="pm-actions"><label><input v-model="unreadOnly" type="checkbox" :disabled="!!actionID" @change="changeFilter"> 仅看未读</label><button type="button" class="pm-button" :disabled="loading || !!actionID" @click="load">刷新</button></div></header>
    <div v-if="error" role="alert" class="pm-notification-error"><p>{{ error }}</p><button class="pm-button" :disabled="loading || !!actionID" @click="load">重新加载</button></div>
    <p v-if="loading" role="status">正在加载通知…</p>
    <template v-else-if="!error">
      <p v-if="!items.length" class="pm-personal-empty">{{ unreadOnly ? '暂无未读通知' : '暂无个人通知' }}</p>
      <div v-else class="pm-personal-list"><button v-for="item in items" :key="item.delivery_id" type="button" :class="{ unread: !item.read_at }" :disabled="!!actionID" @click="open(item)"><span class="pm-personal-title">{{ item.title }}<small>{{ item.read_at ? '已读' : '未读' }}</small></span><span class="pm-personal-content">{{ item.content }}</span><time>{{ formatDate(item.delivered_at) }}</time></button></div>
      <footer class="pm-personal-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="pm-actions"><button class="pm-button" :disabled="page <= 1 || !!actionID" @click="changePage(page - 1)">上一页</button><button class="pm-button" :disabled="page >= pages || !!actionID" @click="changePage(page + 1)">下一页</button></div></footer>
    </template>
    <aside v-if="detail" class="pm-personal-detail" aria-label="通知详情"><header><h3>{{ detail.title }}</h3><button type="button" class="pm-button" @click="detail = null">关闭详情</button></header><p>{{ detail.content }}</p><small>送达时间：{{ formatDate(detail.delivered_at) }}</small><a v-if="projectTarget" class="pm-button" :href="projectTarget">查看项目关联内容</a></aside>
  </section>
</template>

<style scoped>
.pm-personal-notifications>header,.pm-personal-detail>header,.pm-personal-pagination{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.pm-personal-notifications h2,.pm-personal-detail h3{margin:0}.pm-personal-notifications header p,.pm-personal-pagination,.pm-personal-list time{color:var(--pm-muted,#64748b)}.pm-personal-list{display:grid;gap:10px;margin:20px 0}.pm-personal-list>button{display:grid;gap:8px;text-align:left;padding:18px;border:1px solid var(--pm-border,#e2e8f0);border-radius:12px;background:transparent;color:inherit;cursor:pointer}.pm-personal-list>button.unread{border-left:4px solid #2563eb}.pm-personal-title{display:flex;justify-content:space-between;gap:16px;font-weight:600}.pm-personal-title small{font-weight:400;color:#64748b}.pm-personal-content{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pm-personal-empty{padding:64px 20px;text-align:center;color:#64748b}.pm-personal-detail{margin-top:24px;padding:20px;border:1px solid var(--pm-border,#e2e8f0);border-radius:12px}.pm-personal-detail p{white-space:pre-wrap;overflow-wrap:anywhere}.pm-personal-detail a{display:inline-flex;margin:12px}.pm-notification-error{color:#b91c1c}
</style>
