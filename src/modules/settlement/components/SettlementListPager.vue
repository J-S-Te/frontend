<script setup>
// 结算列表的「列表自己的」分页页脚。
//
// 改造前结算页有一条独立的「列表分页」面板，浮在所有列表上方，一个页面里同时给 4~5 个列表
// 配翻页按钮（应收计划 / 正式应收 / 回款 / 核销……），用户看不出哪一对按钮属于哪张表。
// 现在每个列表的分页条只出现在它自己那张表下面，并且带上列表名，
// 默认文案沿用原面板的「每页最多 50 条；筛选只作用于当前页」。
//
// 结算的列表接口是 limit/offset 分页、不返回总数，所以这里让 PaginationBar 走
// 「count + hasMore」模式：展示「第 N 页 · 本页 M 条」，不伪造总数。
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'

defineProps({
  // 形如 [{ index, label, page, count, hasMore }]，一个面板里可能有多张表。
  entries: { type: Array, default: () => [] },
  pageSize: { type: Number, default: 50 },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])
</script>

<template>
  <footer v-if="entries.length" class="settlement-panel settlement-list-pager">
    <span class="settlement-list-pager-hint">每页最多 {{ pageSize }} 条；筛选只作用于当前页，翻页可查看历史记录。</span>
    <div v-for="entry in entries" :key="entry.index" class="settlement-list-pager-row" :data-list="entry.label">
      <span class="settlement-list-pager-label">{{ entry.label }}</span>
      <PaginationBar
        :label="`${entry.label}分页`"
        :page="entry.page"
        :count="entry.count"
        :page-size="pageSize"
        :has-more="entry.hasMore"
        :loading="loading"
        :disabled="saving"
        @change="page => emit('change', { index: entry.index, page })"
      />
    </div>
  </footer>
</template>
