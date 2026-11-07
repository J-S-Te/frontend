<script setup>
// 统一分页条：「上一页 / 页码 / 第 N 页，共 M 条 / 下一页」，服务端返回 total 时
// 额外提供页码按钮、跳页输入与每页条数选择（20 / 50 / 100）。
//
// 设计取舍（跨模块统一时必须同时满足的几条）：
//   1) 只有一页且没有任何记录时不渲染——空列表下方不留一条全禁用的分页；
//      但页码 > 1 时即使当前页为空也必须保留，否则用户无法回到上一页。
//   2) 有记录一定展示总数：后端给 total 时读作「共 M 条」；只支持 offset 分页、
//      不返回总数的接口（结算明细）用 count 展示「第 N 页 · 本页 M 条」，不伪造总数。
//      total 未知时同理不渲染页码 / 跳页 / 页大小：这些控件依赖真实总页数。
//   3) 加载中不展示页码，改为占位文案，避免翻页时先闪一下「第 1 页，共 0 条」。
//   4) 禁用语义沿用各模块原值：首页禁用上一页；末页或无下一页时禁用下一页；
//      loading / disabled 时所有翻页控件都禁用。
//   5) 无障碍：根节点是带 aria-label 的 nav，所有按钮均为 type="button"，
//      当前页按钮带 aria-current="page"，同页多列表并存时用 label 区分。
//   6) 「每页」下拉是显式 opt-in：组件默认不渲染它。绝大多数页面后端只接受固定
//      页大小、也没有 change-page-size 处理器，渲染下拉会变成点了没反应的死控件。
//      只有确实会按新页大小重载列表的调用方传 pageSizeOptions 并监听
//      change-page-size，才出现该控件。
import { computed, ref, watch } from 'vue'

const props = defineProps({
  // 当前页，从 1 开始。
  page: { type: Number, default: 1 },
  // 服务端返回的记录总数；接口不返回总数时传 null，由 count 承担展示与翻页判断。
  total: { type: Number, default: null },
  // 当前页实际条数；仅当 total 未知时使用。
  count: { type: Number, default: null },
  // 每页条数；用于由 total 推导是否还有下一页，也是页大小下拉的当前值。
  pageSize: { type: Number, default: 20 },
  // 页大小候选。默认 null = 不渲染「每页」控件：只有真正支持切换页大小并会重载
  // 列表的页面才传入候选（20 / 50 / 100），否则下拉会变成没有处理器的死控件。
  pageSizeOptions: { type: Array, default: null },
  // 是否有下一页：null 表示由 total/pageSize 推导；offset 分页由调用方给出真实值。
  hasMore: { type: Boolean, default: null },
  loading: { type: Boolean, default: false },
  // 调用方自己的互斥态（如保存中不允许翻页）。
  disabled: { type: Boolean, default: false },
  // 无障碍名，同时用于区分同一页面上并存的多个列表。
  label: { type: String, default: '列表分页' },
  prevText: { type: String, default: '上一页' },
  nextText: { type: String, default: '下一页' },
  loadingText: { type: String, default: '正在加载…' },
})

const emit = defineEmits(['change', 'change-page-size'])

const pageNumber = computed(() => {
  const value = Math.trunc(Number(props.page))
  return Number.isFinite(value) && value > 0 ? value : 1
})

const hasTotal = computed(() => props.total !== null && props.total !== undefined && Number.isFinite(Number(props.total)))
const knownTotal = computed(() => (hasTotal.value ? Math.max(0, Math.trunc(Number(props.total))) : 0))
const knownCount = computed(() => (
  props.count === null || props.count === undefined || !Number.isFinite(Number(props.count))
    ? null
    : Math.max(0, Math.trunc(Number(props.count)))
))

const safePageSize = computed(() => Math.max(1, Math.trunc(Number(props.pageSize)) || 1))
const totalPages = computed(() => (hasTotal.value ? Math.max(1, Math.ceil(knownTotal.value / safePageSize.value)) : 0))

// 无记录且只有一页时不渲染：空列表不该出现一条全禁用的分页。
const visible = computed(() => knownTotal.value > 0 || (knownCount.value ?? 0) > 0 || pageNumber.value > 1)

const hasNextPage = computed(() => {
  if (props.hasMore !== null && props.hasMore !== undefined) return Boolean(props.hasMore)
  if (hasTotal.value) return pageNumber.value * safePageSize.value < knownTotal.value
  return false
})

const prevDisabled = computed(() => props.disabled || props.loading || pageNumber.value <= 1)
const nextDisabled = computed(() => props.disabled || props.loading || !hasNextPage.value)
const controlsDisabled = computed(() => props.disabled || props.loading)

// 页码窗口：总页数不超过 7 时全部展示；否则固定首尾页、当前页及左右一页，
// 中间用省略号占位，既保留全貌又不让页码条无限增长。
const pageItems = computed(() => {
  const count = totalPages.value
  if (!hasTotal.value || count <= 0) return []
  if (count <= 7) return Array.from({ length: count }, (_, index) => ({ type: 'page', value: index + 1 }))
  const keep = new Set([1, count, pageNumber.value - 1, pageNumber.value, pageNumber.value + 1]
    .filter((value) => value >= 1 && value <= count))
  const items = []
  let previous = 0
  for (const value of [...keep].sort((a, b) => a - b)) {
    if (previous && value - previous > 1) items.push({ type: 'gap', value: `${previous}-${value}` })
    items.push({ type: 'page', value })
    previous = value
  }
  return items
})

const pageSizeChoices = computed(() => {
  // 只有传了候选才启用的显式 opt-in（见 props 注释）：默认空数组表示页面不支持
  // 切换页大小，模板据此不渲染「每页」控件。
  if (!Array.isArray(props.pageSizeOptions) || !props.pageSizeOptions.length) return []
  const values = props.pageSizeOptions
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0)
  const unique = [...new Set(values)]
  if (!unique.includes(safePageSize.value)) unique.push(safePageSize.value)
  return unique.sort((a, b) => a - b)
})

// 页大小切换是 opt-in：没有候选就没有下拉，也不允许 emit（防止未来误接线）。
const pageSizeSwitchable = computed(() => pageSizeChoices.value.length > 0)

// 跳页输入只保存草稿，提交时才校验并 emit；翻页成功后清空，避免残留旧目标。
const jumpDraft = ref('')
watch(() => props.page, () => { jumpDraft.value = '' })

// 加载中优先展示占位文案，其余情况按「有总数 → 共 M 条」「无总数 → 本页 M 条」逐级降级。
const statusText = computed(() => {
  if (props.loading) return props.loadingText
  if (hasTotal.value) return `第 ${pageNumber.value} 页，共 ${knownTotal.value} 条`
  if (knownCount.value !== null) return `第 ${pageNumber.value} 页 · ${knownCount.value} 条`
  return `第 ${pageNumber.value} 页`
})

function goTo(target) {
  const next = Math.max(1, Math.trunc(Number(target) || 1))
  if (next === pageNumber.value) return
  emit('change', next)
}

function goPrev() {
  if (prevDisabled.value) return
  goTo(pageNumber.value - 1)
}

function goNext() {
  if (nextDisabled.value) return
  goTo(pageNumber.value + 1)
}

function goToPage(target) {
  if (controlsDisabled.value) return
  const next = Math.min(Math.max(1, Math.trunc(Number(target) || 1)), totalPages.value || 1)
  goTo(next)
}

function submitJump() {
  if (controlsDisabled.value) return
  if (String(jumpDraft.value).trim() === '') return
  const parsed = Math.trunc(Number(jumpDraft.value))
  if (!Number.isFinite(parsed)) return
  jumpDraft.value = ''
  goToPage(parsed)
}

function changePageSize(event) {
  if (!pageSizeSwitchable.value) return
  if (controlsDisabled.value) return
  const next = Math.trunc(Number(event?.target?.value))
  if (!Number.isFinite(next) || next <= 0 || next === safePageSize.value) return
  emit('change-page-size', next)
}
</script>

<template>
  <nav v-if="visible" class="ui-pager" :aria-label="label">
    <div class="ui-pager__pages">
      <button type="button" class="ui-pager__button" :disabled="prevDisabled" @click="goPrev">{{ prevText }}</button>
      <template v-if="hasTotal">
        <button
          v-for="item in pageItems"
          :key="item.value"
          type="button"
          class="ui-pager__page"
          :class="{ 'is-active': item.type === 'page' && item.value === pageNumber, 'is-gap': item.type === 'gap' }"
          :disabled="controlsDisabled || item.type === 'gap'"
          :aria-current="item.type === 'page' && item.value === pageNumber ? 'page' : undefined"
          :aria-label="item.type === 'page' ? `第 ${item.value} 页` : undefined"
          @click="item.type === 'page' && goToPage(item.value)"
        >{{ item.type === 'gap' ? '…' : item.value }}</button>
      </template>
      <button type="button" class="ui-pager__button" :disabled="nextDisabled" @click="goNext">{{ nextText }}</button>
    </div>
    <span class="ui-pager__status" :class="{ 'is-loading': loading }" aria-live="polite" aria-atomic="true">{{ statusText }}</span>
    <div v-if="hasTotal" class="ui-pager__extra">
      <div class="ui-pager__group">
        <label class="ui-pager__field">
          <span class="ui-pager__label">跳至</span>
          <input
            v-model="jumpDraft"
            class="ui-pager__jump"
            type="number"
            inputmode="numeric"
            min="1"
            :max="totalPages"
            :disabled="controlsDisabled"
            :aria-label="`跳转页码（共 ${totalPages} 页）`"
            @keyup.enter="submitJump"
          />
          <span class="ui-pager__unit">页</span>
        </label>
        <button type="button" class="ui-pager__button ui-pager__button--small" :disabled="controlsDisabled || !jumpDraft" @click="submitJump">跳转</button>
      </div>
      <label v-if="pageSizeSwitchable" class="ui-pager__field">
        <span class="ui-pager__label">每页</span>
        <select class="ui-pager__size" :value="safePageSize" :disabled="controlsDisabled" :aria-label="`每页条数（当前 ${safePageSize} 条）`" @change="changePageSize">
          <option v-for="size in pageSizeChoices" :key="size" :value="size">{{ size }}</option>
        </select>
        <span class="ui-pager__unit">条</span>
      </label>
    </div>
  </nav>
</template>

<style scoped>
/* ==========================================================================
   统一分页条（唯一权威样式）
   --------------------------------------------------------------------------
   为什么不把内部控件样式留在全局 state.css：各模块都有自己的「通用按钮 /
   输入框」规则（例如 .crm-content button、.settlement-panel button、
   .contract-table-footer button），它们按懒加载顺序会改写分页条内部控件的
   高度、内边距与宽度，导致「跳至 / 每页 / 跳转」与页大小下拉错位、按钮换行。
   这里用「双写根类名 + scoped 属性」取得足够的优先级，使组件在任何模块里
   尺寸一致；模块侧只负责给根节点留外距，不再写 .ui-pager 内部样式。

   布局契约：
   · 桌面：单行右对齐（上一页 / 页码 / 下一页 / 总数 / 跳至页 / 每页条数）；
   · 窄屏：整体换行、左对齐，组内不拆行（「跳至 [输入] 页 跳转」始终连在一起），
     状态文案与标签禁止折行，不出现孤字；
   · 控件统一 30px 高（粗指针 44px）；主按钮只有「当前页」，其余为次按钮；
     禁用态统一为半透明 + 禁用光标且不响应 hover。
   ========================================================================== */
.ui-pager.ui-pager {
  display: flex;
  /* 兜底：页面/模块规则（例如 .login-target-module__pagination 在 ≤720px 的
     flex-direction: column 分组）不能把分页条改成纵向堆叠。 */
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 10px;
  box-sizing: border-box;
  /* 作为页脚 flex 子项时允许收缩：模块常写 flex: 0 0 auto，max-content 宽度会撑破页脚。 */
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  padding: 0;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--fs-sm);
}

/* 上一页 / 页码 / 下一页作为一个整体参与换行，避免「上一页」孤零零留在上一行。 */
.ui-pager.ui-pager .ui-pager__pages {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

/* 翻页与页码按钮：同一套尺寸、边框、字号与三态。 */
.ui-pager.ui-pager .ui-pager__button,
.ui-pager.ui-pager .ui-pager__page {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex: 0 0 auto;
  width: auto;
  min-width: 30px;
  min-height: 30px;
  height: auto;
  margin: 0;
  padding: 4px 10px;
  color: var(--text);
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  transition: border-color var(--duration-fast) ease, color var(--duration-fast) ease, background var(--duration-fast) ease;
}

.ui-pager.ui-pager .ui-pager__button:hover:not(:disabled),
.ui-pager.ui-pager .ui-pager__page:hover:not(:disabled):not(.is-active) {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft);
}

.ui-pager.ui-pager .ui-pager__button:focus-visible,
.ui-pager.ui-pager .ui-pager__page:focus-visible,
.ui-pager.ui-pager .ui-pager__jump:focus-visible,
.ui-pager.ui-pager .ui-pager__size:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}

/* 当前页是唯一主按钮；即使加载中处于 disabled 也保持实心，不变成灰色半透明。 */
.ui-pager.ui-pager .ui-pager__page.is-active,
.ui-pager.ui-pager .ui-pager__page.is-active:disabled {
  color: var(--on-primary);
  border-color: var(--primary);
  background: var(--primary);
  cursor: default;
  opacity: 1;
}

/* 省略号是占位不是操作，不参与主次与禁用视觉。 */
.ui-pager.ui-pager .ui-pager__page.is-gap,
.ui-pager.ui-pager .ui-pager__page.is-gap:disabled {
  color: var(--text-faint);
  border-color: transparent;
  background: transparent;
  cursor: default;
  opacity: 1;
}

.ui-pager.ui-pager .ui-pager__button:disabled,
.ui-pager.ui-pager .ui-pager__page:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ui-pager.ui-pager .ui-pager__status {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
  white-space: nowrap;
}

.ui-pager.ui-pager .ui-pager__status.is-loading {
  color: var(--text-faint);
}

/* 跳至页 / 每页条数：整组换行，组内标签、输入与单位不拆行。 */
.ui-pager.ui-pager .ui-pager__extra {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px 10px;
  min-width: 0;
}

.ui-pager.ui-pager .ui-pager__group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}

.ui-pager.ui-pager .ui-pager__field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: 1.4;
  white-space: nowrap;
}

.ui-pager.ui-pager .ui-pager__label,
.ui-pager.ui-pager .ui-pager__unit {
  flex: 0 0 auto;
  white-space: nowrap;
}

/* 输入框与下拉固定高度和宽度：模块的 width: 100% / height 覆盖在这里失效。 */
.ui-pager.ui-pager .ui-pager__jump,
.ui-pager.ui-pager .ui-pager__size {
  box-sizing: border-box;
  height: 30px;
  min-height: 30px;
  margin: 0;
  padding: 0 6px;
  color: var(--text);
  font: inherit;
  font-size: var(--fs-sm);
  line-height: 1.4;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
}

.ui-pager.ui-pager .ui-pager__jump {
  width: 60px;
  min-width: 60px;
  max-width: 60px;
  text-align: center;
  appearance: textfield;
  -moz-appearance: textfield;
}

/* 去掉数字输入框的上下箭头：60px 宽度下箭头会挤压数字，且各浏览器宽度不一致。 */
.ui-pager.ui-pager .ui-pager__jump::-webkit-outer-spin-button,
.ui-pager.ui-pager .ui-pager__jump::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}

.ui-pager.ui-pager .ui-pager__size {
  width: auto;
  min-width: 68px;
  max-width: 88px;
  cursor: pointer;
}

.ui-pager.ui-pager .ui-pager__size:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 跳转按钮比翻页按钮略紧凑，但与输入框同高，避免「按钮高、下拉矮」的错位。 */
.ui-pager.ui-pager .ui-pager__button--small {
  padding: 4px 9px;
}

/* 窄屏：整体换行并改为左对齐；组内不拆行，标签不折字。 */
@media (max-width: 720px) {
  .ui-pager.ui-pager,
  .ui-pager.ui-pager .ui-pager__pages,
  .ui-pager.ui-pager .ui-pager__extra {
    justify-content: flex-start;
  }
}

/* 小屏再收一档：390px 视口下 7 个页码 + 上一页 / 下一页 仍能排成一行，
   避免「下一页」被单独甩到下一行成为孤立按钮。 */
@media (max-width: 480px) {
  .ui-pager.ui-pager {
    gap: 5px 8px;
  }

  .ui-pager.ui-pager .ui-pager__pages {
    gap: 5px;
  }

  .ui-pager.ui-pager .ui-pager__button,
  .ui-pager.ui-pager .ui-pager__page {
    min-width: 28px;
    padding: 4px 6px;
  }
}

/* 触控目标 ≥44px（规范 §7.2）：只在粗指针设备放大，不牺牲桌面信息密度。 */
@media (pointer: coarse) {
  .ui-pager.ui-pager .ui-pager__button,
  .ui-pager.ui-pager .ui-pager__page,
  .ui-pager.ui-pager .ui-pager__jump,
  .ui-pager.ui-pager .ui-pager__size {
    min-height: 44px;
  }

  .ui-pager.ui-pager .ui-pager__jump,
  .ui-pager.ui-pager .ui-pager__size {
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-pager.ui-pager .ui-pager__button,
  .ui-pager.ui-pager .ui-pager__page {
    transition: none;
  }
}
</style>
