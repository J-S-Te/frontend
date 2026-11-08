<script setup>
// 批量导入预览表格（纯展示 + 勾选交互）。
//
// 职责边界（分页改造后必须守住）：
//   1) 只接收「当前页」的行切片，自身不持有整批记录，也不做筛选 / 分页计算；
//      统计、校验、提交、错误报告全部留在父组件基于完整批次完成。
//   2) 表头复选框语义是「全选全部有效行」——跨筛选、跨页。这里只把 checked /
//      indeterminate 状态与 change 事件交给父组件，真正的遍历发生在父组件的
//      完整 rows 上，避免退化成「全选当前页」。
//   3) 每行保留原始行 ID（key）、原始行号（data-line / 展示列）、错误信息与
//      勾选状态；翻页只是切换传入的切片，行对象本身不被重建。
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'

const props = defineProps({
  // 当前页行切片。
  rows: { type: Array, default: () => [] },
  // 整批「全部有效行是否已勾选」与「部分勾选」：由父组件基于完整 rows 计算。
  allSelected: { type: Boolean, default: false },
  someSelected: { type: Boolean, default: false },
  // 是否已有任何记录；没有记录时表头复选框禁用。
  hasRows: { type: Boolean, default: false },
  // 错误定位命中的原始行号（0 = 无）；用于翻页定位后的高亮。
  highlightedLineNo: { type: Number, default: 0 },
  emptyText: { type: String, default: '当前筛选下没有数据行。' },
})

const emit = defineEmits(['toggle-all'])
</script>

<template>
  <table class="iam-batch-import-table">
    <thead>
      <tr>
        <th class="col-check">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate.prop="someSelected"
            :disabled="!hasRows"
            aria-label="全选全部有效行（跨筛选、跨页生效）"
            title="全选全部有效行（跨筛选、跨页生效）"
            @change="(event) => emit('toggle-all', event.target.checked)"
          />
        </th>
        <th class="col-line">行</th>
        <th>姓名</th>
        <th>邮箱</th>
        <th>手机</th>
        <th>状态</th>
        <th>组织</th>
        <th>岗位</th>
        <th>应用角色 / 权限来源</th>
        <th class="col-status">校验</th>
      </tr>
    </thead>
    <tbody>
      <tr v-if="!props.rows.length">
        <td colspan="10" class="empty">{{ emptyText }}</td>
      </tr>
      <tr
        v-for="row in props.rows"
        :key="row.id"
        class="iam-batch-import-row"
        :class="{
          invalid: !row.valid,
          success: row.submitStatus === 'success',
          failed: row.submitStatus === 'failed',
          'is-located': highlightedLineNo === row.lineNo,
        }"
        :data-line="row.lineNo"
      >
        <td class="col-check">
          <input
            type="checkbox"
            v-model="row.selected"
            :disabled="!row.valid"
            :aria-label="`第 ${row.lineNo} 行`"
          />
        </td>
        <td class="col-line">{{ row.lineNo }}</td>
        <td>{{ row.displayName || '—' }}</td>
        <td>{{ row.email || '—' }}</td>
        <td>{{ row.mobile || '—' }}</td>
        <td>{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</td>
        <td>{{ row.organizationName || '—' }}</td>
        <td>{{ row.positionName || '—' }}</td>
        <td class="col-roles">
          <code v-if="row.rawApplicationRoles">{{ row.rawApplicationRoles }}</code>
          <span v-else class="role-inherited"><ConsoleIcon name="shield" />继承岗位授权模板</span>
          <small v-if="row.rawApplicationRoles" class="role-source">{{ row.authorizationSource }}</small>
        </td>
        <td class="col-status">
          <span v-if="row.submitStatus === 'success'" class="badge ok">
            <ConsoleIcon name="save" />已创建
          </span>
          <span v-else-if="row.submitStatus === 'failed'" class="badge bad" :title="row.submitMessage">
            <ConsoleIcon name="close" />失败
          </span>
          <span v-else-if="row.valid" class="badge ok">
            <ConsoleIcon name="save" />合法
          </span>
          <span v-else class="badge bad" :title="row.errors.join('；')">
            <ConsoleIcon name="close" />{{ row.errors[0] }}
            <small v-if="row.errors.length > 1">等 {{ row.errors.length }} 项</small>
          </span>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
/* 表格样式随组件一起迁移：父组件的 scoped 样式作用不到子组件内部节点，
   因此这里保留同一套类名与取值，父组件只保留第三步（初始凭据表）需要的
   基础表格规则，避免两处互相覆盖。 */
.iam-batch-import-table {
  /* 粘性表头层级：与本弹窗内既有表格表头同一档，集中成变量后不再散落硬编码数字。 */
  --iam-import-sticky-layer: 1;
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.iam-batch-import-table thead th {
  position: sticky;
  top: 0;
  z-index: var(--iam-import-sticky-layer);
  background: #f5f8fc;
  text-align: left;
  font-weight: 600;
  color: var(--ink-2, #374151);
  padding: 11px 12px;
  border-bottom: 1px solid var(--line-1, #e6e9ef);
  white-space: nowrap;
}
.iam-batch-import-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-2, #e5e7eb);
  color: var(--ink-2, #374151);
  vertical-align: middle;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.iam-batch-import-table tbody tr { transition: background 140ms; }
.iam-batch-import-table tbody tr:hover:not(.invalid):not(.failed) { background: #f8fbff; }
.iam-batch-import-table tbody tr:last-child td { border-bottom: 0; }
.iam-batch-import-table tbody tr.invalid { background: #fff8f8; }
.iam-batch-import-table tbody tr.success { background: #f0fdf4; }
.iam-batch-import-table tbody tr.failed { background: #fff8f8; }
/* 错误定位：翻到目标行所在页后给 1.6s 的描边 + 底色提示（沿用
   PositionAuthorizationTemplates 的定位高亮时长），让用户一眼找到原始行。 */
.iam-batch-import-table tbody tr.is-located {
  animation: iam-batch-import-row-locate 1600ms ease-out;
}
@keyframes iam-batch-import-row-locate {
  0%, 55% {
    background: #dbeafe;
    box-shadow: inset 3px 0 0 #2563eb;
  }
  100% {
    background: transparent;
    box-shadow: inset 3px 0 0 transparent;
  }
}
.iam-batch-import-table tbody td.empty { text-align: center; color: var(--ink-3, #6b7280); padding: 18px; }
.iam-batch-import-table .col-check { width: 36px; text-align: center; }
.iam-batch-import-table .col-line { width: 50px; color: var(--ink-3, #6b7280); }
.iam-batch-import-table .col-roles { min-width: 170px; }
.iam-batch-import-table .col-roles code { display: block; white-space: normal; }
.iam-batch-import-table .role-inherited {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
}
.iam-batch-import-table .role-inherited svg { width: 14px; height: 14px; }
.iam-batch-import-table .role-source { display: block; margin-top: 4px; color: #64748b; font-size: 11px; }
.iam-batch-import-table .col-status { width: 200px; }
.iam-batch-import-table .badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 999px;
}
.iam-batch-import-table .badge svg { width: 12px; height: 12px; }
.iam-batch-import-table .badge.ok { background: #dcfce7; color: #15803d; }
.iam-batch-import-table .badge.bad { background: #fee2e2; color: #b91c1c; }
.iam-batch-import-table .badge small { font-weight: 500; opacity: 0.85; margin-left: 2px; }

@media (max-width: 760px) {
  .iam-batch-import-table .col-status { width: auto; }
}

/* 深色主题：与父组件同一套 token 映射（--ink-* / --line-*），只补本组件范围内
   的表格规则；深色规则里不引入新的十六进制颜色。 */
[data-theme="dark"] .iam-batch-import-table thead th {
  border-bottom-color: var(--border);
  background: var(--surface-head);
}
[data-theme="dark"] .iam-batch-import-table tbody td {
  border-bottom-color: var(--line-soft);
}
[data-theme="dark"] .iam-batch-import-table tbody tr:hover:not(.invalid):not(.failed) {
  background: var(--surface-hover);
}
[data-theme="dark"] .iam-batch-import-table tbody tr.invalid,
[data-theme="dark"] .iam-batch-import-table tbody tr.failed {
  background: var(--danger-soft);
}
[data-theme="dark"] .iam-batch-import-table tbody tr.success {
  background: var(--success-soft);
}
[data-theme="dark"] .iam-batch-import-table tbody tr.is-located {
  animation-name: iam-batch-import-row-locate-dark;
}
[data-theme="dark"] .iam-batch-import-table .role-inherited {
  color: var(--primary-ink);
}
[data-theme="dark"] .iam-batch-import-table .role-source {
  color: var(--text-muted);
}
[data-theme="dark"] .iam-batch-import-table .badge.ok {
  background: var(--success-soft-strong);
  color: var(--success-text);
}
[data-theme="dark"] .iam-batch-import-table .badge.bad {
  background: var(--danger-soft-strong);
  color: var(--danger-text);
}

@keyframes iam-batch-import-row-locate-dark {
  0%, 55% {
    background: var(--primary-soft);
    box-shadow: inset 3px 0 0 var(--primary);
  }
  100% {
    background: transparent;
    box-shadow: inset 3px 0 0 transparent;
  }
}
</style>
