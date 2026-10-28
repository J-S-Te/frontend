<script setup>
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { collectionStatusLabel, confirmationState, dueState, money, receivableInvoiceStatusLabel } from '@/modules/settlement/utils/settlementDisplay'

// 「应收计划与应收单」区面板（治理批次 5 结算·第三步，模板自 SettlementView.vue 逐字提取；提取前片段 SSR golden 归档于
// .ai/qa/closure-20261025/goldens-settlement-panels/SettlementReceivablesPanel/）。
// 可见计划 / 正式应收 / 保存态为只读 prop；planEditor 由父级持有、表单按属性直改；
// 编辑器开关与三路筛选为双向原始值，以 defineModel 承接模板内的 v-model 与直接赋值（父级 v-model:xxx 绑定 composable 的 ref）；
// 刷新 / 提交确认 / 重置筛选 / 发起确认以事件回传。
defineProps({
  can: { type: Function, default: () => false },
  visiblePlans: { type: Array, required: true },
  receivables: { type: Array, required: true },
  saving: { type: Boolean, default: false },
  planEditor: { type: Object, required: true },
})
const planEditorOpen = defineModel('planEditorOpen')
const planKeyword = defineModel('planKeyword')
const planConfirmationFilter = defineModel('planConfirmationFilter')
const planMaturityFilter = defineModel('planMaturityFilter')
defineEmits(['reload','submit-plan','reset-filters','confirm-plan'])
</script>

<template>
  <section
    class="settlement-receivables"
  >
    <div class="settlement-section-head">
      <div>
        <p>
          合同生效后按付款节点自动生成应收计划，确认后纳入应收与催收口径。
        </p>
      </div>
      <div>
        <button class="console-button secondary" @click="$emit('reload')">
          <ConsoleIcon name="reset" />刷新
        </button>
      </div>
    </div>
    <article
      v-if="planEditorOpen && can('settlement.receivable.confirm')"
      class="settlement-panel settlement-operation-card"
    >
      <div class="settlement-panel-head">
        <div>
          <h2>收款计划确认</h2>
          <p>
            {{ planEditor.contract_no || "未关联合同" }} ·
            {{ planEditor.customer_name || "未命名客户" }}
          </p>
        </div>
        <button
          type="button"
          class="console-text-button"
          @click="planEditorOpen = false"
        >
          取消
        </button>
      </div>
      <form
        class="settlement-operation-form"
        @submit.prevent="$emit('submit-plan')"
      >
        <label
          ><span>计划收款日</span
          ><input v-model="planEditor.due_date" type="date" required
        /></label>
        <label
          ><span>计划金额</span
          ><input
            v-model.trim="planEditor.planned_amount"
            inputmode="decimal"
            required
         maxlength="18"/></label>
        <label class="wide"
          ><span>调整原因</span
          ><textarea
            v-model.trim="planEditor.reason"
            rows="3"
            placeholder="如调整日期或金额，此项必填；原值将保留在审计记录中。"
           maxlength="500"></textarea>
        </label>
        <div class="settlement-operation-actions wide">
          <button
            type="button"
            class="console-button secondary"
            @click="planEditorOpen = false"
          >
            取消
          </button>
          <button class="console-button" :disabled="saving">
            确认并生成应收
          </button>
        </div>
      </form>
    </article>
    <div class="settlement-filter-bar">
      <label
        ><ConsoleIcon name="search" /><input
          v-model.trim="planKeyword"
          placeholder="搜索合同号 / 客户 / 应收单号"  maxlength="100"/></label
      ><select v-model="planConfirmationFilter">
        <option value="">全部确认状态</option>
        <option>待确认</option>
        <option>已确认</option></select
      ><select v-model="planMaturityFilter">
        <option value="">全部状态</option>
        <option>未到期</option>
        <option>即将到期</option>
        <option>逾期</option></select
      ><button
        class="console-button secondary"
        @click="$emit('reset-filters')"
      >
        重置
      </button>
    </div>
    <article class="settlement-panel settlement-plan-table">
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>合同编号</th>
              <th>客户</th>
              <th>期次</th>
              <th>计划收款日</th>
              <th>计划金额</th>
              <th>确认状态</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in visiblePlans" :key="plan.id">
              <td class="settlement-contract-cell">
                {{ plan.contract_no || "—" }}
              </td>
              <td>{{ plan.customer_name || "—" }}</td>
              <td>第 {{ plan.installment_no || "—" }} 期</td>
              <td>{{ plan.due_date }}</td>
              <td class="settlement-money">
                {{ money(plan.planned_amount) }}
              </td>
              <td>
                <span
                  class="settlement-badge"
                  :class="`tone-${confirmationState(plan.status).tone}`"
                  >{{ confirmationState(plan.status).label }}</span
                >
              </td>
              <td>
                <span
                  class="settlement-badge"
                  :class="`tone-${dueState(plan.due_date).tone}`"
                  >{{ dueState(plan.due_date).label }}</span
                >
              </td>
              <td>
                <button
                  v-if="plan.status === 'PENDING_CONFIRMATION' && can('settlement.receivable.confirm')"
                  class="console-button secondary small"
                  :disabled="saving"
                  @click="$emit('confirm-plan', plan)"
                >
                  确认</button
                ><span v-else class="settlement-muted">—</span>
              </td>
            </tr>
            <tr v-if="!visiblePlans.length">
              <td colspan="8" class="settlement-table-empty">
                暂无匹配的应收计划
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="settlement-panel settlement-formal-receivables">
      <div class="settlement-panel-head">
        <div>
          <h2>正式应收 <small>已确认计划自动生成</small></h2>
          <p>确认后的应收单可用于开票、回款、核销与账龄催收。</p>
        </div>
      </div>
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>应收单号</th>
              <th>合同编号</th>
              <th>客户</th>
              <th>到期日</th>
              <th>应收金额</th>
              <th>未收余额</th>
              <th>收款状态</th>
              <th>开票状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in receivables" :key="item.id">
              <td class="settlement-contract-cell">
                {{ item.receivable_no }}
              </td>
              <td>{{ item.contract_no || "—" }}</td>
              <td>{{ item.customer_name }}</td>
              <td>{{ item.due_date }}</td>
              <td class="settlement-money">
                {{ money(item.original_amount) }}
              </td>
              <td class="settlement-money">
                {{ money(item.open_amount) }}
              </td>
              <td>{{ collectionStatusLabel(item.collection_status) }}</td>
              <td>{{ receivableInvoiceStatusLabel(item.invoice_status) }}</td>
            </tr>
            <tr v-if="!receivables.length">
              <td colspan="8" class="settlement-table-empty">
                暂无正式应收，确认收款计划后将在此展示。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>
