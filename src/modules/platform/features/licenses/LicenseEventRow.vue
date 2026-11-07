<script setup>
// 授权事件行：页内最近几条摘要与右侧抽屉共用同一个组件。
//
// 为什么是「单行摘要 + 内联详情」而不是表格行：
//   · 摘要行只放四件事：事件中文名、版本 / 修订、秒级时间、右侧 chevron；
//     原始 kind code 属于排查信息，移进详情，避免摘要行里两行文字互相挤压。
//   · 整行是一个可点按钮（不是 li 上的点击），键盘就是 Tab + Enter/Space，
//     aria-expanded / aria-controls 成对挂在按钮上。
//   · 桌面 48px、窄屏 64px（名+版本修订 / 时间 两行），高度由 CSS 定，不写死内联。
import { computed, onBeforeUnmount, ref } from 'vue'
import ConsoleIcon from '@/modules/shared/components/ConsoleIcon.vue'
import { copyTextToClipboard } from '@/modules/shared/utils/clipboard.js'
import { formatLicenseTime, licenseEventName, licenseEventTimestamp, shortenDigest } from './presentation.js'

const props = defineProps({
  event: { type: Object, required: true },
  // 同一事件可能同时出现在页内摘要和抽屉里，详情容器 id 必须带前缀才不重复。
  idPrefix: { type: String, default: 'license-event' },
})

const expanded = ref(false)
// 复制反馈走 aria-live：按钮本身只写“复制”，结果由 live region 播报。
const copyFeedback = ref('')
let feedbackTimer = 0

const kind = computed(() => String(props.event?.kind ?? '').trim())
// 已知类型给中文名；未知类型直接显示原 code（兜底成“未知事件”会让排查无从下手）。
const kindLabel = computed(() => (kind.value ? licenseEventName(kind.value) : '未记录事件类型'))
const rawTime = computed(() => props.event?.created_at ?? '')
const displayTime = computed(() => formatLicenseTime(rawTime.value))
// <time datetime> 要机器可读的原始 RFC3339；零值/本地时间不写 datetime，避免输出假时间。
const datetimeAttr = computed(() => licenseEventTimestamp(rawTime.value))
const digest = computed(() => (typeof props.event?.digest === 'string' ? props.event.digest.trim() : ''))
const digestPreview = computed(() => shortenDigest(digest.value))
const detailId = computed(() => `${props.idPrefix}-detail-${props.event?.id ?? 'unknown'}`)

function toggle() {
  expanded.value = !expanded.value
}

// copyDigest 用途：把完整 digest 复制到剪贴板，并在 live region 里播报结果。
// 参数：无。
// 返回值：无；失败时提示手动选择文本，不假装复制成功。
async function copyDigest() {
  if (!digest.value) return
  try {
    await copyTextToClipboard(digest.value)
    copyFeedback.value = '摘要已复制'
  } catch {
    copyFeedback.value = '复制失败，请手动选择文本'
  }
  clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { copyFeedback.value = '' }, 2600)
}

onBeforeUnmount(() => clearTimeout(feedbackTimer))
</script>

<template>
  <li class="license-event-row" :class="{ 'is-open': expanded }">
    <button type="button" class="license-event-summary" :aria-expanded="expanded" :aria-controls="detailId" @click="toggle">
      <strong class="license-event-name" :title="kind || undefined">{{ kindLabel }}</strong>
      <span class="license-event-meta">版本 {{ event.version ?? '—' }} · 修订 {{ event.revision ?? '—' }}</span>
      <time class="license-event-time" :datetime="datetimeAttr || undefined">{{ displayTime }}</time>
      <ConsoleIcon name="chevron" class="license-event-chevron" />
    </button>

    <div v-show="expanded" :id="detailId" class="license-event-detail">
      <dl class="license-event-fields">
        <div class="license-event-field">
          <dt>事件类型</dt>
          <dd>
            <span>{{ kindLabel }}</span>
            <code class="license-event-code">{{ kind || '—' }}</code>
          </dd>
        </div>
        <div class="license-event-field">
          <dt>发生时间</dt>
          <dd>
            <span>{{ displayTime }}（北京时间）</span>
            <code class="license-event-code">{{ rawTime || '—' }}</code>
          </dd>
        </div>
        <div class="license-event-field">
          <dt>许可证版本</dt>
          <dd>{{ event.version ?? '—' }}</dd>
        </div>
        <div class="license-event-field">
          <dt>状态修订</dt>
          <dd>
            <span>{{ event.revision ?? '—' }}</span>
            <small class="license-event-hint">授权状态修订号，不是事件序号。</small>
          </dd>
        </div>
        <div class="license-event-field">
          <dt>许可证摘要</dt>
          <dd>
            <template v-if="digest">
              <code class="license-event-code" :title="digest">{{ digestPreview }}</code>
              <button type="button" class="license-event-copy" @click="copyDigest">复制完整 digest</button>
            </template>
            <template v-else>
              <span>—</span>
              <small class="license-event-hint">服务端未记录</small>
            </template>
          </dd>
        </div>
        <div class="license-event-field">
          <dt>租户标识</dt>
          <dd>
            <span>{{ event.tenant_id || '—' }}</span>
            <small v-if="!event.tenant_id" class="license-event-hint">服务端未记录</small>
          </dd>
        </div>
        <div class="license-event-field">
          <dt>操作者</dt>
          <dd>
            <span>{{ event.user_id || '—' }}</span>
            <small v-if="!event.user_id" class="license-event-hint">服务端未记录</small>
          </dd>
        </div>
        <div class="license-event-field">
          <dt>事件 id</dt>
          <dd><code class="license-event-code">{{ event.id || '—' }}</code></dd>
        </div>
      </dl>
      <p class="license-event-copy-feedback" role="status" aria-live="polite">{{ copyFeedback }}</p>
    </div>
  </li>
</template>

<style scoped>
/* 只用 main.css 的全局 token：本组件既在许可页内渲染，也会被 Teleport 到 body 的
   抽屉渲染，.console-page / .license-page 上的别名在 body 下不存在。 */
.license-event-row {
  min-width: 0;
  border-top: 1px solid var(--line-soft);
}
.license-event-row:first-child {
  border-top: 0;
}
.license-event-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  min-height: 48px;
  padding: var(--space-1) var(--space-2);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-sm);
  text-align: left;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: background var(--duration-fast) ease;
}
.license-event-summary:hover {
  background: var(--surface-muted);
}
/* 展开态要一直看得出来：hover 只是辅助，离开指针后这一行仍保持底色。 */
.license-event-row.is-open .license-event-summary {
  background: var(--surface-muted);
}
.license-event-summary:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}
.license-event-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.license-event-meta {
  color: var(--text-muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
.license-event-time {
  color: var(--text-muted);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.license-event-chevron {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--text-faint);
  transition: transform var(--duration-fast) var(--ease-standard);
}
.license-event-row.is-open .license-event-chevron {
  color: var(--primary);
  transform: rotate(90deg);
}

.license-event-detail {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2) var(--space-4);
  border-top: 1px dashed var(--line-soft);
}
.license-event-fields {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}
.license-event-field {
  display: grid;
  grid-template-columns: minmax(72px, max-content) minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
  align-items: baseline;
}
.license-event-field dt {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
.license-event-field dd {
  display: grid;
  justify-items: start;
  gap: 2px;
  min-width: 0;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
.license-event-code {
  padding: 1px 5px;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-xs);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  /* 原始 code / digest 允许选中：排查时要能整段复制。 */
  user-select: text;
  overflow-wrap: anywhere;
}
.license-event-hint {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
.license-event-copy {
  padding: 2px 8px;
  color: var(--primary);
  font: inherit;
  font-size: var(--fs-xs);
  border: 1px solid var(--primary-border);
  border-radius: var(--radius-pill);
  background: var(--primary-soft);
  cursor: pointer;
}
.license-event-copy:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}
/* 深色下 --primary 当小字色对比不足（约 3:1），动作文字改用提亮的主色墨。 */
[data-theme="dark"] .license-event-copy {
  color: var(--primary-ink);
}
.license-event-copy-feedback {
  margin: 0;
  min-height: 18px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

/* 窄屏：摘要行变两行（名+版本修订 / 时间），行高 64px；详情字段改上下堆叠。 */
@media (max-width: 720px) {
  .license-event-summary {
    grid-template-areas:
      "name meta chevron"
      "time time chevron";
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-rows: auto auto;
    gap: 2px var(--space-2);
    min-height: 64px;
    padding: var(--space-2);
  }
  .license-event-name {
    grid-area: name;
  }
  .license-event-meta {
    grid-area: meta;
  }
  .license-event-time {
    grid-area: time;
  }
  .license-event-chevron {
    grid-area: chevron;
  }
  .license-event-field {
    grid-template-columns: minmax(0, 1fr);
  }
  /* 窄屏字段改上下堆叠后，字段之间要留出比桌面更大的间隔，否则标签会黏在上一段值上。 */
  .license-event-fields {
    gap: var(--space-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .license-event-summary,
  .license-event-chevron {
    transition: none;
  }
}
</style>
