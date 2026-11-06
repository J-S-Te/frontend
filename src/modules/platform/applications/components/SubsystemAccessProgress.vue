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

// 错误提示只需要一个"这是什么状态"的标题，状态本身仍由徽章和徽章文字表达。
const alertTitle = computed(() => {
  if (status.value === 'FAILED') return '执行失败'
  if (status.value === 'WAITING') return '等待补齐条件'
  return '最近一次错误'
})
</script>

<template>
  <section class="subsystem-access-progress" aria-label="接入操作进度">
    <header class="subsystem-access-progress__head">
      <div class="subsystem-access-progress__identity">
        <p class="subsystem-access-progress__eyebrow">接入操作</p>
        <h3
          class="subsystem-access-progress__title"
          :title="operation?.operation_id || undefined"
        >
          {{ operation?.operation_id || '尚未创建操作' }}
        </h3>
      </div>
      <span class="subsystem-access-progress__status" :data-status="status">
        <span class="subsystem-access-progress__status-dot" aria-hidden="true"></span>
        {{ operation ? operationStatusLabel(operation.status) : '—' }}
      </span>
    </header>

    <div class="subsystem-access-progress__body">
      <dl class="subsystem-access-progress__facts">
        <div class="subsystem-access-progress__fact">
          <dt>动作</dt>
          <dd>{{ operation ? actionLabel(operation.action) : '—' }}</dd>
        </div>
        <div class="subsystem-access-progress__fact">
          <dt>当前阶段</dt>
          <dd>{{ operation ? stageLabel(operation.stage) : '—' }}</dd>
        </div>
        <div class="subsystem-access-progress__fact">
          <dt>尝试次数</dt>
          <dd>{{ operation?.attempt_count ?? 0 }}</dd>
        </div>
      </dl>

      <div
        v-if="operation?.error_code || operation?.error_message"
        class="subsystem-access-progress__alert"
        :data-status="status"
      >
        <p class="subsystem-access-progress__alert-head">
          <span class="subsystem-access-progress__alert-title">{{ alertTitle }}</span>
          <span v-if="operation?.error_code" class="subsystem-access-progress__alert-code-group">
            <span class="subsystem-access-progress__alert-code-label">错误编码</span>
            <code class="subsystem-access-progress__alert-code">{{ operation.error_code }}</code>
          </span>
        </p>
        <p v-if="operation?.error_message" class="subsystem-access-progress__alert-message">{{ operation.error_message }}</p>
      </div>

      <p v-if="operation?.result_ref" class="subsystem-access-progress__evidence">
        <span class="subsystem-access-progress__evidence-label">证据引用</span>
        <code class="subsystem-access-progress__evidence-ref" :title="operation.result_ref">{{ operation.result_ref }}</code>
      </p>

      <div v-if="rows.length" class="subsystem-access-progress__stages-block">
        <div class="subsystem-access-progress__section-head">
          <h4 id="subsystem-access-stage-title" class="subsystem-access-progress__section-title">阶段结果（分项）</h4>
          <span class="subsystem-access-progress__section-meta">{{ rows.length }} 个阶段</span>
        </div>
        <ol class="subsystem-access-progress__stages" aria-labelledby="subsystem-access-stage-title">
          <li
            v-for="(row, index) in rows"
            :key="row.stage"
            class="subsystem-access-progress__stage"
            :data-status="row.status"
          >
            <span class="subsystem-access-progress__stage-rail" aria-hidden="true">{{ index + 1 }}</span>
            <div class="subsystem-access-progress__stage-body">
              <p class="subsystem-access-progress__stage-head">
                <span class="subsystem-access-progress__stage-name">{{ row.label }}</span>
                <span class="subsystem-access-progress__stage-status" :data-status="row.status">{{ row.statusLabel }}</span>
                <span class="subsystem-access-progress__stage-attempt">尝试 {{ row.attemptCount }} 次</span>
              </p>
              <p
                v-if="row.evidenceRef"
                class="subsystem-access-progress__stage-note"
                :title="row.evidenceRef"
              >
                <span class="subsystem-access-progress__stage-note-label">证据</span>
                <code class="subsystem-access-progress__stage-ref">{{ row.evidenceRef }}</code>
              </p>
              <p
                v-else-if="row.errorCode"
                class="subsystem-access-progress__stage-note"
                data-tone="danger"
                :title="row.errorCode"
              >
                <span class="subsystem-access-progress__stage-note-label">错误</span>
                <code class="subsystem-access-progress__stage-ref">{{ row.errorCode }}</code>
              </p>
            </div>
          </li>
        </ol>
      </div>

      <div v-if="pending.length" class="subsystem-access-progress__pending">
        <div class="subsystem-access-progress__section-head">
          <h4 class="subsystem-access-progress__pending-title">仍需处理</h4>
          <span class="subsystem-access-progress__section-meta">{{ pending.length }} 项</span>
        </div>
        <ol class="subsystem-access-progress__pending-list">
          <li
            v-for="(item, index) in pending"
            :key="item.code || item.message || index"
            class="subsystem-access-progress__pending-item"
          >
            <p class="subsystem-access-progress__pending-head">
              <span class="subsystem-access-progress__pending-index" aria-hidden="true">{{ index + 1 }}</span>
              <code v-if="item.code" class="subsystem-access-progress__pending-code">{{ item.code }}</code>
              <span class="subsystem-access-progress__pending-message">{{ item.message }}</span>
            </p>
            <p v-if="item.nextAction" class="subsystem-access-progress__pending-next">
              <span class="subsystem-access-progress__pending-next-label">下一步</span>
              <span class="subsystem-access-progress__pending-next-text">{{ item.nextAction }}</span>
            </p>
          </li>
        </ol>
      </div>

      <div v-if="canResume" class="subsystem-access-progress__actions">
        <button
          type="button"
          class="subsystem-access-progress__resume"
          :disabled="busy"
          @click="emit('resume')"
        >
          继续恢复
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 面板令牌：结构沿用向导的 --sa-*（父级已定义、可继承），语义状态色走全局 token。
   两者都自带深色取值，因此这里不写死任何"只适合浅色"的颜色。 */
.subsystem-access-progress {
  --sap-border: var(--sa-border, #e2e8f0);
  --sap-surface: var(--sa-surface, #ffffff);
  --sap-surface-muted: var(--sa-surface-muted, #f8fafc);
  --sap-text: var(--sa-text, #0f172a);
  --sap-text-muted: var(--sa-text-muted, #64748b);
  --sap-radius: var(--sa-radius, 12px);
  --sap-accent: var(--sa-accent, #2563eb);
  --sap-accent-soft: var(--sa-accent-soft, rgba(37, 99, 235, 0.1));
  --sap-ok: var(--success-text, #15803d);
  --sap-ok-soft: var(--success-soft, #ecfdf5);
  --sap-ok-border: var(--success-border, #86c99a);
  --sap-warn: var(--sa-warn, #b45309);
  --sap-warn-soft: var(--sa-warn-soft, rgba(180, 83, 9, 0.1));
  --sap-warn-border: var(--warning-border, #fde68a);
  --sap-danger: var(--sa-danger, #b91c1c);
  --sap-danger-soft: var(--sa-danger-soft, rgba(185, 28, 28, 0.08));
  --sap-danger-border: var(--danger-border, #fecaca);
  --sap-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  display: grid;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--sap-border);
  border-radius: var(--sap-radius);
  background: var(--sap-surface);
  color: var(--sap-text);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* ---- 卡片头：操作 ID + 状态徽章 ---- */
.subsystem-access-progress__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--sap-border);
  background: var(--sap-surface-muted);
}
.subsystem-access-progress__identity {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.subsystem-access-progress__eyebrow {
  margin: 0;
  color: var(--sap-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.subsystem-access-progress__title {
  margin: 0;
  color: var(--sap-text);
  font-family: var(--sap-mono);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  letter-spacing: 0.01em;
}
.subsystem-access-progress__status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 9px;
  border: 1px solid var(--sap-border);
  border-radius: 999px;
  background: var(--sap-surface);
  color: var(--sap-text-muted);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.subsystem-access-progress__status-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: currentColor;
}

/* 状态语义色：徽章与阶段 chip 共用同一套，文字始终与颜色同时出现。 */
.subsystem-access-progress__status[data-status="SUCCEEDED"],
.subsystem-access-progress__stage-status[data-status="SUCCEEDED"] {
  border-color: var(--sap-ok-border);
  background: var(--sap-ok-soft);
  color: var(--sap-ok);
}
.subsystem-access-progress__status[data-status="FAILED"],
.subsystem-access-progress__stage-status[data-status="FAILED"] {
  border-color: var(--sap-danger-border);
  background: var(--sap-danger-soft);
  color: var(--sap-danger);
}
.subsystem-access-progress__status[data-status="WAITING"],
.subsystem-access-progress__stage-status[data-status="WAITING"] {
  border-color: var(--sap-warn-border);
  background: var(--sap-warn-soft);
  color: var(--sap-warn);
}
.subsystem-access-progress__status[data-status="RUNNING"],
.subsystem-access-progress__stage-status[data-status="RUNNING"] {
  border-color: var(--sap-accent);
  background: var(--sap-accent-soft);
  color: var(--sap-accent);
}
.subsystem-access-progress__status[data-status="RUNNING"] .subsystem-access-progress__status-dot {
  animation: sap-breathe 1.8s ease-in-out infinite;
}
@keyframes sap-breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.75); }
}

/* ---- 主体 ---- */
.subsystem-access-progress__body {
  display: grid;
  gap: 12px;
  padding: 13px 14px 14px;
}

/* ---- 事实卡：动作 / 当前阶段 / 尝试次数，窄屏自动换行 ---- */
.subsystem-access-progress__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 8px;
  margin: 0;
}
.subsystem-access-progress__fact {
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--sap-border);
  border-radius: 9px;
  background: var(--sap-surface-muted);
}
.subsystem-access-progress__fact dt {
  color: var(--sap-text-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.subsystem-access-progress__fact dd {
  margin: 0;
  color: var(--sap-text);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ---- 错误提示：现状 + 错误编码 + 错误说明 ---- */
.subsystem-access-progress__alert {
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid var(--sap-warn-border);
  border-left: 3px solid var(--sap-warn);
  border-radius: 9px;
  background: var(--sap-warn-soft);
}
.subsystem-access-progress__alert[data-status="FAILED"] {
  border-color: var(--sap-danger-border);
  border-left-color: var(--sap-danger);
  background: var(--sap-danger-soft);
}
.subsystem-access-progress__alert-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 0;
}
.subsystem-access-progress__alert-title {
  color: var(--sap-warn);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.subsystem-access-progress__alert[data-status="FAILED"] .subsystem-access-progress__alert-title {
  color: var(--sap-danger);
}
.subsystem-access-progress__alert-code-group {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  min-width: 0;
}
.subsystem-access-progress__alert-code-label {
  color: var(--sap-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.subsystem-access-progress__alert-message {
  margin: 0;
  color: var(--sap-text);
  font-size: 13px;
  line-height: 1.55;
}

/* 机器值（错误编码 / 证据引用 / 阶段引用）统一用等宽小片，和人工文案区分开。 */
.subsystem-access-progress__alert-code,
.subsystem-access-progress__evidence-ref,
.subsystem-access-progress__stage-ref,
.subsystem-access-progress__pending-code {
  max-width: 100%;
  padding: 1px 6px;
  border: 1px solid var(--sap-border);
  border-radius: 6px;
  background: var(--sap-surface);
  color: var(--sap-text);
  font-family: var(--sap-mono);
  font-size: 11px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* ---- 证据引用 ---- */
.subsystem-access-progress__evidence {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 4px 8px;
  margin: 0;
}
.subsystem-access-progress__evidence-label {
  color: var(--sap-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.subsystem-access-progress__evidence-ref {
  justify-self: start;
  font-weight: 500;
}

/* ---- 区块标题 ---- */
.subsystem-access-progress__section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 10px;
}
.subsystem-access-progress__section-title {
  margin: 0;
  color: var(--sap-text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.subsystem-access-progress__section-meta {
  color: var(--sap-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* ---- 阶段明细：带竖线的时间线列表（顺序与标签沿用阶段接口） ---- */
.subsystem-access-progress__stages-block {
  display: grid;
  gap: 8px;
}
.subsystem-access-progress__stages {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
  border: 1px solid var(--sap-border);
  border-radius: 10px;
  background: var(--sap-surface);
}
.subsystem-access-progress__stage {
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 4px 10px;
  padding: 9px 12px 9px 11px;
}
.subsystem-access-progress__stage + .subsystem-access-progress__stage {
  border-top: 1px solid var(--sap-border);
}
.subsystem-access-progress__stage::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 20px;
  width: 1px;
  background: var(--sap-border);
}
.subsystem-access-progress__stage:first-child::before { top: 18px; }
.subsystem-access-progress__stage:last-child::before { bottom: calc(100% - 18px); }
.subsystem-access-progress__stage-rail {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border: 1px solid var(--sap-border);
  border-radius: 50%;
  background: var(--sap-surface-muted);
  color: var(--sap-text-muted);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.subsystem-access-progress__stage[data-status="SUCCEEDED"] .subsystem-access-progress__stage-rail {
  border-color: var(--sap-ok-border);
  background: var(--sap-ok-soft);
  color: var(--sap-ok);
}
.subsystem-access-progress__stage[data-status="FAILED"] .subsystem-access-progress__stage-rail {
  border-color: var(--sap-danger-border);
  background: var(--sap-danger-soft);
  color: var(--sap-danger);
}
.subsystem-access-progress__stage[data-status="WAITING"] .subsystem-access-progress__stage-rail {
  border-color: var(--sap-warn-border);
  background: var(--sap-warn-soft);
  color: var(--sap-warn);
}
.subsystem-access-progress__stage[data-status="RUNNING"] .subsystem-access-progress__stage-rail {
  border-color: var(--sap-accent);
  background: var(--sap-accent-soft);
  color: var(--sap-accent);
}
.subsystem-access-progress__stage-body {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.subsystem-access-progress__stage-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  margin: 0;
}
.subsystem-access-progress__stage-name {
  color: var(--sap-text);
  font-size: 13px;
  font-weight: 600;
}
.subsystem-access-progress__stage-status {
  padding: 1px 8px;
  border: 1px solid var(--sap-border);
  border-radius: 999px;
  background: var(--sap-surface-muted);
  color: var(--sap-text-muted);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.subsystem-access-progress__stage-attempt {
  color: var(--sap-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.subsystem-access-progress__stage-note {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
  margin: 0;
}
.subsystem-access-progress__stage-note-label {
  color: var(--sap-text-muted);
  font-size: 11px;
}
.subsystem-access-progress__stage-ref {
  justify-self: start;
  font-weight: 500;
}
.subsystem-access-progress__stage-note[data-tone="danger"] .subsystem-access-progress__stage-note-label {
  color: var(--sap-danger);
}
.subsystem-access-progress__stage-note[data-tone="danger"] .subsystem-access-progress__stage-ref {
  border-color: var(--sap-danger-border);
  background: var(--sap-danger-soft);
  color: var(--sap-danger);
}

/* ---- 仍需处理：警示 callout，按 编码 / 说明 / 下一步 分层 ---- */
.subsystem-access-progress__pending {
  display: grid;
  gap: 8px;
  padding: 10px 12px 11px;
  border: 1px solid var(--sap-warn-border);
  border-left: 3px solid var(--sap-warn);
  border-radius: 9px;
  background: var(--sap-warn-soft);
}
.subsystem-access-progress__pending-title {
  margin: 0;
  color: var(--sap-warn);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.subsystem-access-progress__pending-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.subsystem-access-progress__pending-item {
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--sap-border);
  border-radius: 8px;
  background: var(--sap-surface);
}
.subsystem-access-progress__pending-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
  margin: 0;
}
.subsystem-access-progress__pending-index {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 50%;
  background: var(--sap-warn-soft);
  color: var(--sap-warn);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.subsystem-access-progress__pending-message {
  min-width: 0;
  color: var(--sap-text);
  font-size: 13px;
}
.subsystem-access-progress__pending-next {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 6px;
  margin: 0;
  color: var(--sap-text-muted);
  font-size: 12px;
}
.subsystem-access-progress__pending-next-label {
  padding: 0 7px;
  border-radius: 999px;
  background: var(--sap-accent-soft);
  color: var(--sap-accent);
  font-size: 11px;
  font-weight: 600;
}
.subsystem-access-progress__pending-next-text { min-width: 0; }

/* ---- 继续恢复：沿用向导主按钮体系 ---- */
.subsystem-access-progress__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.subsystem-access-progress__resume {
  padding: 9px 16px;
  border: 1px solid var(--primary, #2563eb);
  border-radius: 9px;
  background: var(--primary, #2563eb);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
}
.subsystem-access-progress__resume:hover:not(:disabled) {
  border-color: var(--primary-dark, #1d4ed8);
  background: var(--primary-dark, #1d4ed8);
}
.subsystem-access-progress__resume:active:not(:disabled) { transform: translateY(1px); }
.subsystem-access-progress__resume:disabled { opacity: 0.55; cursor: not-allowed; }
.subsystem-access-progress__resume:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--sap-accent-soft), 0 0 0 1px var(--primary, #2563eb);
}

/* 窄屏：事实卡从"三格并排"改成"标签 + 取值"的紧凑键值行，少占纵向空间。 */
@media (max-width: 520px) {
  .subsystem-access-progress__head { padding: 10px 12px; }
  .subsystem-access-progress__body { padding: 11px 12px 12px; }
  .subsystem-access-progress__facts { grid-template-columns: minmax(0, 1fr); }
  .subsystem-access-progress__fact {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    gap: 10px;
    padding: 7px 10px;
  }
  .subsystem-access-progress__fact dd { text-align: end; }
  .subsystem-access-progress__resume { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .subsystem-access-progress *,
  .subsystem-access-progress *::before,
  .subsystem-access-progress *::after {
    transition: none !important;
    animation: none !important;
  }
}

/* ---- 深色主题：只覆盖别名取值，不引入新的颜色字面量 ----
   向导的深色块已把 --sa-* 映射到全局深色 token；这里显式再声明一次，
   使面板在父级令牌缺失时同样保持正确对比度。 */
[data-theme="dark"] .subsystem-access-progress {
  --sap-border: var(--border);
  --sap-surface: var(--surface-card);
  --sap-surface-muted: var(--surface-muted);
  --sap-text: var(--text);
  --sap-text-muted: var(--text-muted);
  --sap-accent: var(--primary-ink);
  --sap-accent-soft: var(--primary-soft);
  --sap-ok: var(--success-text);
  --sap-ok-soft: var(--success-soft);
  --sap-ok-border: var(--success-border);
  --sap-warn: var(--warning-text);
  --sap-warn-soft: var(--warning-soft);
  --sap-warn-border: var(--warning-border);
  --sap-danger: var(--danger-text);
  --sap-danger-soft: var(--danger-soft);
  --sap-danger-border: var(--danger-border);
}
</style>
