<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { useOperationInbox } from '@/modules/shared/composables/useOperationInbox.js'

const props = defineProps({ serverTasks: { type: Boolean, default: false } })
const emit = defineEmits(['open-server-tasks'])
const { records, clear, remove } = useOperationInbox()
const open = ref(false)
const root = ref(null)

function toggle() { open.value = !open.value }
function close() { open.value = false }
function onDocumentClick(event) {
  if (open.value && root.value && !root.value.contains(event.target)) close()
}
function onKeydown(event) {
  if (event.key === 'Escape' && open.value) close()
}
function timeLabel(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false })
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="operation-inbox">
    <button type="button" class="operation-inbox-trigger" :aria-expanded="open" aria-haspopup="dialog" aria-controls="operation-inbox-panel" aria-label="操作记录" @click.stop="toggle">
      <ConsoleIcon name="audit" />
      <span v-if="records.length" class="operation-inbox-count">{{ records.length > 99 ? '99+' : records.length }}</span>
    </button>
    <section v-if="open" id="operation-inbox-panel" class="operation-inbox-panel" role="dialog" aria-label="操作记录">
      <header>
        <div><strong>操作记录</strong><small>本浏览器会话内的重要结果</small></div>
        <div class="operation-inbox-actions">
          <button v-if="records.length" type="button" @click="clear">清空</button>
          <button type="button" aria-label="关闭操作记录" @click="close">×</button>
        </div>
      </header>
      <div v-if="!records.length" class="operation-inbox-empty">暂无可回看的操作结果</div>
      <ol v-else>
        <li v-for="record in records" :key="record.id">
          <div class="operation-inbox-item-head">
            <strong>{{ record.title }}</strong>
            <button type="button" aria-label="移除记录" @click="remove(record.id)">×</button>
          </div>
          <p v-if="record.message">{{ record.message }}</p>
          <dl>
            <template v-if="record.reference"><div><dt>业务编号</dt><dd>{{ record.reference }}</dd></div></template>
            <template v-if="record.nextAction"><div><dt>下一步</dt><dd>{{ record.nextAction }}</dd></div></template>
            <div><dt>完成时间</dt><dd>{{ timeLabel(record.savedAt) }}</dd></div>
          </dl>
        </li>
      </ol>
      <footer v-if="props.serverTasks" class="operation-inbox-footer">
        <button type="button" @click="emit('open-server-tasks'); close()">查看服务端异步任务</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.operation-inbox-panel :is(strong, p, dd) { min-width: 0; overflow-wrap: anywhere; }
.operation-inbox-item-head > strong { flex: 1; }
.operation-inbox { position: relative; }
.operation-inbox-trigger { position: relative; display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: inherit; cursor: pointer; }
.operation-inbox-trigger:hover { border-color: var(--line-1, #dbe3ef); background: var(--bg-soft, #f6f8fb); }
.operation-inbox-count { position: absolute; top: 1px; right: 0; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 9px; background: #b42318; color: #fff; font-size: 10px; line-height: 16px; text-align: center; }
.operation-inbox-panel { position: absolute; top: calc(100% + 8px); right: 0; z-index: 40; width: min(380px, calc(100vw - 24px)); max-height: min(540px, 70vh); overflow: auto; border: 1px solid #dbe3ef; border-radius: 14px; background: #fff; box-shadow: 0 16px 40px rgba(15, 23, 42, .18); }
.operation-inbox-panel > header { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #eef2f7; background: #fff; }
.operation-inbox-panel > header strong { display: block; color: #1f2937; }
.operation-inbox-panel > header small { color: #64748b; font-size: 11px; }
.operation-inbox-actions { display: flex; align-items: center; gap: 4px; }
.operation-inbox-actions button { border: 0; background: transparent; color: #475569; cursor: pointer; font-size: 12px; padding: 4px; }
.operation-inbox-actions button:last-child { font-size: 20px; line-height: 1; }
.operation-inbox-footer { position: sticky; bottom: 0; padding: 10px 16px; border-top: 1px solid #eef2f7; background: #fff; }
.operation-inbox-footer button { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; color: #235fcb; padding: 8px; font: inherit; font-size: 12px; cursor: pointer; }
.operation-inbox-empty { padding: 28px 16px; color: #64748b; text-align: center; }
.operation-inbox-panel ol { margin: 0; padding: 0; list-style: none; }
.operation-inbox-panel li { padding: 14px 16px; border-bottom: 1px solid #eef2f7; }
.operation-inbox-panel li:last-child { border-bottom: 0; }
.operation-inbox-item-head { display: flex; justify-content: space-between; gap: 8px; }
.operation-inbox-item-head strong { color: #1f2937; font-size: 13px; }
.operation-inbox-item-head button { border: 0; background: transparent; color: #94a3b8; font-size: 17px; line-height: 1; cursor: pointer; }
.operation-inbox-panel p { margin: 4px 0 0; color: #475569; font-size: 12px; line-height: 1.6; }
.operation-inbox-panel dl { margin: 8px 0 0; display: grid; gap: 4px; }
.operation-inbox-panel dl div { display: flex; gap: 6px; }
.operation-inbox-panel dt { flex: 0 0 auto; color: #64748b; font-size: 11px; }
.operation-inbox-panel dd { margin: 0; color: #334155; font-size: 11px; overflow-wrap: anywhere; }
@media (max-width: 560px) { .operation-inbox-panel { position: fixed; top: 64px; right: 12px; left: 12px; width: auto; } }
</style>
