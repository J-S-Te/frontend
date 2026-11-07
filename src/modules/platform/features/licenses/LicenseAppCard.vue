<script setup>
// 单个业务系统的授权卡片：许可层面（签名许可证）与运行执行层面（运行时登记与确认）
// 始终分两块呈现，互不推断结论；卡片只负责呈现，动作统一 emit 给页面处理。
import { computed } from 'vue'
import { expiryMeta, formatLicenseTime } from './presentation.js'
import { reasonHintOf } from './license-state.js'

const props = defineProps({
  row: { type: Object, required: true },
  busy: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
})
defineEmits(['action'])

const titleId = computed(() => `license-app-title-${props.row.code}`)
const kindLabel = computed(() => props.row.application?.kind === 'TRIAL' ? '试用授权' : '正式授权')
const expiresAt = computed(() => props.row.application?.expires_at)
// 卡片正文只写 MM-DD HH:mm；秒级完整时间放 title，避免一行里塞年份与秒。
const expiresFull = computed(() => formatLicenseTime(expiresAt.value))
const shortTime = value => {
  const full = formatLicenseTime(value)
  return full === '—' ? full : full.slice(5, 16)
}
const expiresShort = computed(() => shortTime(expiresAt.value))
const remaining = computed(() => expiryMeta(expiresAt.value))
// 原因码只解释“为什么”，不参与状态与颜色推导；整行保留完整文本，视觉上只占一行。
const reasonFull = computed(() => props.row.reasonCode ? `原因：${reasonHintOf(props.row.reasonCode)} ${props.row.reasonCode}` : '')
// 只有真的读到执行事实时才展示修订/准备/确认计数，未登记或未知不刷 0/0 噪音。
const counters = computed(() => props.row.showEnforcementCounters ? props.row.summary : null)
const acknowledgedFull = computed(() => formatLicenseTime(counters.value?.latestAckAt))
const acknowledgedLabel = computed(() => acknowledgedFull.value === '—' ? '尚未确认当前修订' : `确认 ${shortTime(counters.value?.latestAckAt)}`)
const acknowledgedTitle = computed(() => {
  if (acknowledgedFull.value === '—') return '尚未确认当前修订'
  const prepared = formatLicenseTime(counters.value?.latestReadyAt)
  return prepared === '—' ? `确认 ${acknowledgedFull.value}` : `确认 ${acknowledgedFull.value} · 最近准备 ${prepared}`
})
</script>

<template>
  <li class="license-app-card" :data-tone="row.tone" :aria-labelledby="titleId">
    <div class="license-app-head">
      <h4 :id="titleId" class="license-app-title">{{ row.name }}</h4>
      <code class="license-app-code" :title="row.code">{{ row.code }}</code>
    </div>

    <dl class="license-app-section">
      <dt class="license-app-section-label">许可层面</dt>
      <dd class="license-app-section-body">
        <div class="license-app-status">
          <span class="license-badge" :data-tone="row.license.tone">{{ row.license.label }}</span>
          <span class="license-app-meta" :title="`到期 ${expiresFull}`">{{ kindLabel }} · 到期 {{ expiresShort }}</span>
        </div>
        <p class="license-app-meta" :data-tone="remaining.tone">{{ remaining.label }}</p>
        <p v-if="row.reasonCode" class="license-app-meta license-app-reason" :title="reasonFull">
          <span class="license-app-reason-text">原因：{{ reasonHintOf(row.reasonCode) }}</span>
          <code class="license-app-reason-code">{{ row.reasonCode }}</code>
        </p>
      </dd>
    </dl>

    <dl class="license-app-section">
      <dt class="license-app-section-label">运行执行</dt>
      <dd class="license-app-section-body">
        <div class="license-app-status">
          <span class="license-badge" :data-tone="row.enforcement.tone">{{ row.enforcement.label }}</span>
        </div>
        <template v-if="counters">
          <p class="license-app-counter">修订 {{ counters.revision }} · 部署 {{ counters.deploymentRevision }}</p>
          <p class="license-app-counter">准备 {{ counters.ready }}/{{ counters.memberCount }} · 确认 {{ counters.acknowledged }}/{{ counters.memberCount }}</p>
          <p class="license-app-meta" :title="acknowledgedTitle">{{ acknowledgedLabel }}</p>
        </template>
        <p v-if="row.enforcement.note" class="license-app-meta license-app-note" :title="row.enforcement.note">{{ row.enforcement.note }}</p>
      </dd>
    </dl>

    <footer class="license-app-action">
      <button
        v-if="row.action.target !== 'none'"
        type="button"
        class="console-button ghost small"
        :aria-label="`${row.name} · ${row.action.label}`"
        :disabled="loading || busy"
        @click="$emit('action', row)"
      >{{ row.action.label }}<span aria-hidden="true">→</span></button>
      <span v-else class="license-app-meta">{{ row.action.hint }}</span>
    </footer>
  </li>
</template>

<style scoped>
/* --------------------------------------------------------------------------
   逐应用卡片
   颜色一律取共享 token（深色主题由 token 覆盖，禁止写死十六进制）；
   字号只在组件内定义一次，避免散落 px 字面量。卡片本身不做内部滚动，
   内容超长时靠 title 与两行截断保留完整语义。
   -------------------------------------------------------------------------- */
.license-app-card {
  --license-card-title-size: 15px;
  --license-card-meta-size: 11.5px;
  --license-card-mono-size: 11px;
  --row-tone: var(--license-border, var(--border));
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  align-content: start;
  gap: 8px;
  aspect-ratio: 1 / 1;
  min-width: 0;
  /* 1:1 只是期望高度：写死 min-height 会关掉内容自动下限，长内容会溢出到边框外，
     所以下限取“216px 与内容高度中较大的一个”，卡片随之长高而不是漏字。 */
  min-height: max(216px, min-content);
  padding: 16px;
  border: 1px solid var(--license-border, var(--border));
  border-left: 3px solid var(--row-tone);
  border-radius: var(--radius-xl);
  background: var(--surface-card);
  box-shadow: var(--shadow-card);
  color: var(--text);
  transition: box-shadow .15s var(--ease-standard);
}
.license-app-card:hover { box-shadow: var(--shadow-raised); }
.license-app-card:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
.license-app-card[data-tone="success"] { --row-tone: var(--success); }
.license-app-card[data-tone="info"] { --row-tone: var(--primary); }
.license-app-card[data-tone="warning"] { --row-tone: var(--warning); }
.license-app-card[data-tone="danger"] { --row-tone: var(--danger); }
.license-app-card[data-tone="neutral"] { --row-tone: var(--line-strong); }

/* 标题区：系统名不截断，编码单行省略并保留完整值 */
.license-app-head { display: grid; gap: 2px; min-width: 0; }
.license-app-title { margin: 0; color: var(--text); font-size: var(--license-card-title-size); font-weight: 650; line-height: 1.35; letter-spacing: -.1px; overflow-wrap: anywhere; }
.license-app-code { display: block; max-width: 100%; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--license-card-mono-size); line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 两层事实：标签在上，事实在下，两层结构完全一致，避免视觉上被读成一块 */
.license-app-section { display: grid; align-content: start; gap: 3px; margin: 0; min-width: 0; }
.license-app-section-label { color: var(--text-muted); font-size: var(--license-card-mono-size); font-weight: 600; letter-spacing: .04em; }
.license-app-section-body { display: grid; align-content: start; gap: 3px; margin: 0; min-width: 0; }
.license-app-status { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }

.license-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: var(--radius-pill); color: var(--text-secondary); background: var(--surface-muted); font-size: var(--license-card-mono-size); font-weight: 650; line-height: 1.5; white-space: nowrap; }
.license-badge[data-tone="success"] { color: var(--success-text); background: var(--success-soft); }
.license-badge[data-tone="info"] { color: var(--primary-ink, var(--primary-dark)); background: var(--primary-soft); }
.license-badge[data-tone="warning"] { color: var(--warning-text); background: var(--warning-soft); }
.license-badge[data-tone="danger"] { color: var(--danger-text); background: var(--danger-soft); }
.license-badge[data-tone="neutral"] { color: var(--text-secondary); background: var(--surface-muted); }

.license-app-meta { margin: 0; color: var(--text-muted); font-size: var(--license-card-meta-size); line-height: 1.45; overflow-wrap: anywhere; }
.license-app-meta[data-tone="ok"] { color: var(--success-text); }
.license-app-meta[data-tone="soon"] { color: var(--warning-text); }
.license-app-meta[data-tone="expired"] { color: var(--danger-text); }
.license-app-counter { margin: 0; color: var(--text-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--license-card-mono-size); line-height: 1.45; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 原因一行、note 两行：完整文本保留在 DOM 与 title 里 */
.license-app-reason { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.license-app-reason-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.license-app-reason-code { flex: 0 0 auto; max-width: 42%; padding: 0 4px; border-radius: var(--radius-sm); background: var(--surface-muted); color: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--license-card-mono-size); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.license-app-note { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }

/* 每张卡只有一个动作；没有动作时给纯文字提示，不留禁用按钮 */
.license-app-action { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }

@media (max-width: 720px) {
  .license-app-card { aspect-ratio: auto; min-height: 200px; padding: 14px; }
}
</style>
