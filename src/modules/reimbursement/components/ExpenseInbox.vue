<script setup>
import { onMounted,ref,computed } from 'vue'
import { deleteReadNotifications,listInbox,getNotification,getUnreadCount,markNotificationRead } from '../../platform/notifications/api/notifications.js'
import { safeNotificationPath } from '../workspace.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import ErrorState from '../../shared/components/ErrorState.vue'

const rows=ref([]),total=ref(0),page=ref(1),unreadOnly=ref(false),unread=ref(0)
const tab=ref('all'),tabs=[{key:'all',label:'全部'},{key:'local',label:'本系统'},{key:'cross',label:'跨系统'}]
const detail=ref(null),error=ref(''),busy=ref(false)
let sequence=0

// 用途：分页读取平台当前主体收件箱，不提交客户端用户标识。
// 参数：无。
// 返回值：无；依赖不可用或无权限时显示错误。
async function load() {
 const ticket=++sequence;busy.value=true;error.value=''
 try {
  const scope=tab.value==='local'?{sourceApplication:'reimbursement'}:tab.value==='cross'?{excludeSourceApplication:'reimbursement'}:{}
  const [value,count]=await Promise.all([listInbox({page:page.value,pageSize:20,unreadOnly:unreadOnly.value,...scope}),getUnreadCount()])
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
const hasReadItems=computed(()=>rows.value.some((row)=>row.read_at))
// deleteRead 软删除当前账号已读站内信；未读与其他收件人的消息不受影响。
async function deleteRead(){
 if(!hasReadItems.value||busy.value)return
 if(typeof window!=='undefined'&&!window.confirm('确认删除当前账号的全部已读消息？该操作只影响你的收件箱。'))return
 busy.value=true;error.value=''
 try{await deleteReadNotifications();await load()}
 catch(cause){error.value=cause.message}
 finally{busy.value=false}
}
function changeTab(next){tab.value=next;page.value=1;detail.value=null;load()}
onMounted(load)
</script>
<template>
 <section class="expense-panel">
  <header class="expense-card-head">
   <h2 class="expense-card-title">站内消息 <span class="expense-badge" :class="unread ? 'info' : 'gray'">未读 {{ unread }}</span></h2>
   <div class="expense-card-extra">
    <div class="expense-inbox-tabs" role="tablist"><button v-for="item in tabs" :key="item.key" type="button" :class="{active: tab===item.key}" @click="changeTab(item.key)">{{ item.label }}</button></div>
    <label><input v-model="unreadOnly" type="checkbox" @change="page=1;load()"> 只看未读</label>
    <button class="expense-button" :disabled="busy || !hasReadItems" @click="deleteRead">删除已读</button><button class="expense-button" :disabled="busy" @click="load">刷新消息</button>
   </div>
  </header>
  <p>平台统一收件箱；审批待办、催办等消息以平台实际接收结果为准。</p>
  <ErrorState v-if="error" compact title="站内消息未完成" :error="error" :retry="false" />
  <p v-if="busy">正在读取消息…</p><p v-else-if="!error && !rows.length">当前收件箱没有消息。</p>
  <ul v-else class="expense-message-list">
   <li v-for="row in rows" :key="row.delivery_id" class="expense-message">
    <span class="expense-message__main">
      <span class="expense-message__title">{{ row.title }} <span v-if="!row.read_at" class="expense-badge info">未读</span></span>
      <span class="expense-message__content">{{ row.content }}</span>
      <span class="expense-message__time">{{ formatBusinessDateTime(row.delivered_at) }}</span>
    </span>
    <button class="expense-button" @click="open(row)">查看消息</button>
   </li>
  </ul>
  <PaginationBar label="站内消息分页" :page="page" :total="total" :page-size="20" :loading="busy"
   @change="nextPage => { page = nextPage; load() }" />
  <aside v-if="detail" class="expense-item"><h3>{{ detail.title }}</h3><p>{{ detail.content }}</p>
   <a v-if="safeNotificationPath(detail.target_url)" :href="safeNotificationPath(detail.target_url)">查看关联业务（重新校验权限）</a>
   <button class="expense-button" @click="detail=null">关闭</button></aside>
 </section>
</template>

<style scoped>
.expense-inbox-tabs{display:inline-flex;gap:4px;margin-right:8px}
.expense-inbox-tabs button{padding:5px 9px;border:1px solid #e2e8f0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
.expense-inbox-tabs button.active{background:#2563eb;border-color:#2563eb;color:#fff}
</style>
