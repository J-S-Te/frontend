<script setup>
import { onMounted,ref } from 'vue'
import { listInbox,getNotification,getUnreadCount,markNotificationRead } from '../../platform/notifications/api/notifications.js'
import { safeNotificationPath } from '../workspace.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import ErrorState from '../../shared/components/ErrorState.vue'

const rows=ref([]),total=ref(0),page=ref(1),unreadOnly=ref(false),unread=ref(0)
const detail=ref(null),error=ref(''),busy=ref(false)
let sequence=0

// 用途：分页读取平台当前主体收件箱，不提交客户端用户标识。
// 参数：无。
// 返回值：无；依赖不可用或无权限时显示错误。
async function load() {
 const ticket=++sequence;busy.value=true;error.value=''
 try {
  const [value,count]=await Promise.all([listInbox({page:page.value,pageSize:20,unreadOnly:unreadOnly.value}),getUnreadCount()])
  if(ticket!==sequence)return
  rows.value=value.items;total.value=value.total;unread.value=count.unread_count
 } catch(cause) {if(ticket===sequence)error.value=cause.message}
 finally {if(ticket===sequence)busy.value=false}
}

// 用途：读取并标记本人的消息已读，目标应用仍重验业务权限。
// 参数：row为平台已授权的消息摘要。
// 返回值：无；失败保留消息坐标供重试。
async function open(row) {
 try {
  detail.value=await getNotification(row.delivery_id)
  if(!row.read_at)await markNotificationRead(row.delivery_id)
  await load()
 } catch(cause) {error.value=cause.message}
}
onMounted(load)
</script>
<template>
 <section class="expense-panel">
  <h2>站内消息</h2><p>平台统一收件箱；审批待办、催办等消息以平台实际接收结果为准。未读 {{ unread }}</p>
  <ErrorState v-if="error" compact title="站内消息未完成" :error="error" :retry="false" />
  <label><input v-model="unreadOnly" type="checkbox" @change="page=1;load()">只看未读</label>
  <button class="expense-button" :disabled="busy" @click="load">刷新消息</button>
  <p v-if="busy">正在读取消息…</p><p v-else-if="!error && !rows.length">当前收件箱没有消息。</p>
  <article v-for="row in rows" :key="row.delivery_id" class="expense-item">
   <h3>{{ row.title }} <span v-if="!row.read_at" class="expense-flag">未读</span></h3>
   <p>{{ row.content }}</p><p>{{ formatBusinessDateTime(row.delivered_at) }}</p>
   <button class="expense-button" @click="open(row)">查看消息</button>
  </article>
  <PaginationBar label="站内消息分页" :page="page" :total="total" :page-size="20" :loading="busy"
   @change="nextPage => { page = nextPage; load() }" />
  <aside v-if="detail" class="expense-item"><h3>{{ detail.title }}</h3><p>{{ detail.content }}</p>
   <a v-if="safeNotificationPath(detail.target_url)" :href="safeNotificationPath(detail.target_url)">查看关联业务（重新校验权限）</a>
   <button class="expense-button" @click="detail=null">关闭</button></aside>
 </section>
</template>
