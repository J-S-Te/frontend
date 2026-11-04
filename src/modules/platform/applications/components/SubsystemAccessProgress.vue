<script setup>
import { computed } from 'vue'
import {
  actionLabel,
  missingItems,
  operationStageRows,
  operationStatusLabel,
  stageLabel,
} from '../utils/subsystemAccessFlow.mjs'

const props = defineProps({
  operation: { type: Object, default: null },
  stages: { type: Array, default: () => [] },
  missing: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['resume'])

const rows = computed(() => operationStageRows(props.stages))
const pending = computed(() => missingItems(props.missing))
const status = computed(() => String(props.operation?.status || '').toUpperCase())
const canResume = computed(() => (status.value === 'WAITING' || status.value === 'FAILED') && !props.busy)
</script>

<template>
  <section class="subsystem-access-progress" aria-label="接入操作进度">
    <header class="subsystem-access-progress__header">
      <div>
        <p class="subsystem-access-progress__eyebrow">接入操作</p>
        <h3 class="subsystem-access-progress__title">{{ operation?.operation_id || '尚未创建操作' }}</h3>
      </div>
      <span class="subsystem-access-progress__status" :data-status="status">
        {{ operation ? operationStatusLabel(operation.status) : '—' }}
      </span>
    </header>

    <dl class="subsystem-access-progress__facts">
      <div><dt>动作</dt><dd>{{ operation ? actionLabel(operation.action) : '—' }}</dd></div>
      <div><dt>当前阶段</dt><dd>{{ operation ? stageLabel(operation.stage) : '—' }}</dd></div>
      <div><dt>尝试次数</dt><dd>{{ operation?.attempt_count ?? 0 }}</dd></div>
    </dl>

    <p v-if="operation?.error_code" class="subsystem-access-progress__error">
      错误编码：{{ operation.error_code }}
      <span v-if="operation?.error_message">· {{ operation.error_message }}</span>
    </p>
    <p v-if="operation?.result_ref" class="subsystem-access-progress__evidence">
      证据引用：{{ operation.result_ref }}
    </p>

    <div v-if="rows.length" class="subsystem-access-progress__table-scroll"
      role="region" aria-label="接入阶段明细" tabindex="0">
    <table class="subsystem-access-progress__stages">
      <caption class="subsystem-access-progress__caption">阶段结果（分项）</caption>
      <thead>
        <tr><th scope="col">阶段</th><th scope="col">状态</th><th scope="col">尝试</th><th scope="col">证据／错误</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.stage">
          <td>{{ row.label }}</td>
          <td>{{ row.statusLabel }}</td>
          <td>{{ row.attemptCount }}</td>
          <td>
            <span v-if="row.evidenceRef">{{ row.evidenceRef }}</span>
            <span v-else-if="row.errorCode">{{ row.errorCode }}</span>
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>
    </div>

    <div v-if="pending.length" class="subsystem-access-progress__pending">
      <h4>仍需处理</h4>
      <ul>
        <li v-for="item in pending" :key="item.code || item.message">
          <strong v-if="item.code">[{{ item.code }}]</strong>
          <span>{{ item.message }}</span>
          <small v-if="item.nextAction">下一步：{{ item.nextAction }}</small>
        </li>
      </ul>
    </div>

    <button
      v-if="canResume"
      type="button"
      class="subsystem-access-progress__resume"
      :disabled="busy"
      @click="emit('resume')"
    >
      继续恢复
    </button>
  </section>
</template>

<style scoped>
.subsystem-access-progress {
  display: grid;
  min-width: 0;
  gap: 12px;
  overflow-wrap: anywhere;
}
.subsystem-access-progress > *,
.subsystem-access-progress__header > div { min-width: 0; }
.subsystem-access-progress__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
}
.subsystem-access-progress__eyebrow,
.subsystem-access-progress__title,
.subsystem-access-progress__evidence,
.subsystem-access-progress__error { margin: 0; }
.subsystem-access-progress__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr));
  gap: 8px;
  margin: 0;
}
.subsystem-access-progress__facts > div { min-width: 0; }
.subsystem-access-progress__facts dd { margin: 4px 0 0; }
.subsystem-access-progress__table-scroll { max-width: 100%; overflow-x: auto; }
.subsystem-access-progress__stages {
  width: 100%;
  min-width: 480px;
  border-collapse: collapse;
  font-size: 13px;
}
.subsystem-access-progress__stages :is(th, td) {
  padding: 8px;
  border-bottom: 1px solid #e2e8f0;
  text-align: left;
  vertical-align: top;
}
/* 阶段、状态和次数保留短列，长证据在末列换行或局部滚动。 */
.subsystem-access-progress__stages :is(th, td):nth-child(-n + 3) { white-space: nowrap; }
</style>
