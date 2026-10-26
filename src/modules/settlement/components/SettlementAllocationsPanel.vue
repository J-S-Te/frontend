<script setup>
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { allocationStatusMeta, amountOf, money } from '@/modules/settlement/utils/settlementDisplay'

// 「核销与冲销」区面板（治理批次 5 结算·第三步，模板自 SettlementView.vue 逐字提取；提取前片段 SSR golden 归档于
// .ai/qa/closure-20261025/goldens-settlement-panels/SettlementAllocationsPanel/）。
// 核销单列表 / 可选回款 / 可核销应收 / 保存态为只读 prop；allocationForm / reversalForm 由父级持有、表单按属性直改；
// 页签与两个编辑器开关为双向原始值（defineModel），模板内直接赋值与「预填冲销表单后打开」的原语义原样保留；
// 刷新 / 提交核销 / 提交冲销以事件回传。
defineProps({
  allocations: { type: Array, required: true },
  receipts: { type: Array, default: () => [] },
  receivables: { type: Array, default: () => [] },
  saving: { type: Boolean, default: false },
  allocationForm: { type: Object, required: true },
  reversalForm: { type: Object, required: true },
})
const allocationTab = defineModel('allocationTab')
const allocationComposerOpen = defineModel('allocationComposerOpen')
const reversalComposerOpen = defineModel('reversalComposerOpen')
defineEmits(['reload','submit-allocation','submit-reversal'])
</script>

<template>
  <section
    class="settlement-allocations"
  >
    <div class="settlement-section-head">
      <div>
        <p>
          管理回款与应收的核销关系；如发现匹配错误，可按原核销单发起冲销并恢复余额。
        </p>
      </div>
      <div>
        <button class="console-button secondary" @click="$emit('reload')">
          <ConsoleIcon name="reset" />刷新</button
        ><button
          class="console-button"
          @click="allocationComposerOpen = true"
        >
          <ConsoleIcon name="save" />发起核销
        </button>
      </div>
    </div>
    <div class="settlement-tabs">
      <button
        :class="{ active: allocationTab === 'allocations' }"
        @click="allocationTab = 'allocations'"
      >
        全部核销单
      </button>
      <button
        :class="{ active: allocationTab === 'reversals' }"
        @click="allocationTab = 'reversals'"
      >
        已冲销核销单
      </button>
    </div>
    <article class="settlement-panel settlement-invoice-table">
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>核销单号</th>
              <th>回款号</th>
              <th>应收单号</th>
              <th>金额</th>
              <th>币种</th>
              <th>确认时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in allocations.filter((row) =>
                allocationTab === 'reversals'
                  ? row.status === 'REVERSED'
                  : row.status !== 'REVERSED',
              )"
              :key="item.id"
            >
              <td class="settlement-contract-cell">
                {{ item.allocation_no }}
              </td>
              <td>{{ item.receipt_no }}</td>
              <td>{{ item.receivable_no }}</td>
              <td class="settlement-money">
                {{ money(item.amount, item.currency) }}
              </td>
              <td>{{ item.currency }}</td>
              <td>{{ item.confirmed_at }}</td>
              <td>
                <span
                  class="settlement-badge"
                  :class="`tone-${allocationStatusMeta(item.status).tone}`"
                  >{{ allocationStatusMeta(item.status).label }}</span
                >
              </td>
              <td>
                <button
                  v-if="
                    allocationTab === 'allocations' &&
                    ['CONFIRMED', 'PARTIALLY_REVERSED'].includes(
                      item.status,
                    )
                  "
                  class="console-text-button"
                  @click="
                    reversalForm.allocation_id = item.id;
                    reversalComposerOpen = true;
                  "
                >
                  冲销
                </button>
                <span v-else class="settlement-muted">
                  {{
                    item.status === "REVERSED" ? "余额已全部恢复" : "—"
                  }}
                </span>
              </td>
            </tr>
            <tr
              v-if="
                !allocations.some((row) =>
                  allocationTab === 'reversals'
                    ? row.status === 'REVERSED'
                    : row.status !== 'REVERSED',
                )
              "
            >
              <td colspan="8" class="settlement-table-empty">
                {{
                  allocationTab === "reversals"
                    ? "暂无已冲销核销单"
                    : "暂无已确认的核销单"
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article
      v-if="allocationComposerOpen"
      class="settlement-panel settlement-invoice-composer"
    >
      <div class="settlement-panel-head">
        <div>
          <h2>发起核销</h2>
          <p>
            请选择一笔尚有余额的回款和应收，系统将校验客户、币种与金额。
          </p>
        </div>
        <button
          class="console-text-button"
          @click="allocationComposerOpen = false"
        >
          收起
        </button>
      </div>
      <form class="settlement-form" @submit.prevent="$emit('submit-allocation')">
        <select v-model="allocationForm.receipt_id" required>
          <option value="">选择待核销回款</option>
          <option
            v-for="item in receipts.filter(
              (row) => amountOf(row.unallocated_amount) > 0,
            )"
            :key="item.id"
            :value="item.id"
          >
            {{ item.receipt_no }} · {{ item.customer_name }} ·
            {{ money(item.unallocated_amount, item.currency) }}
          </option></select
        ><select v-model="allocationForm.receivable_id" required>
          <option value="">选择待核销应收</option>
          <option
            v-for="item in receivables.filter(
              (row) => amountOf(row.open_amount) > 0,
            )"
            :key="item.id"
            :value="item.id"
          >
            {{ item.receivable_no }} · {{ item.customer_name }} ·
            {{ money(item.open_amount, item.currency) }}
          </option></select
        ><input
          v-model.trim="allocationForm.amount"
          placeholder="本次核销金额"
          required
         maxlength="18"/><button :disabled="saving">确认核销</button>
      </form>
    </article>
    <article
      v-if="reversalComposerOpen"
      class="settlement-panel settlement-invoice-composer"
    >
      <div class="settlement-panel-head">
        <div>
          <h2>确认冲销</h2>
          <p>
            冲销后会恢复原回款的未分配余额和应收未收余额，请确认后提交。
          </p>
        </div>
        <button
          class="console-text-button"
          @click="reversalComposerOpen = false"
        >
          收起
        </button>
      </div>
      <form class="settlement-form" @submit.prevent="$emit('submit-reversal')">
        <select v-model="reversalForm.allocation_id" required>
          <option value="">选择需要冲销的核销单</option>
          <option
            v-for="item in allocations.filter((row) =>
              ['CONFIRMED', 'PARTIALLY_REVERSED'].includes(row.status),
            )"
            :key="item.id"
            :value="item.id"
          >
            {{ item.allocation_no }} ·
            {{ money(item.amount, item.currency) }}
          </option></select
        ><input
          v-model.trim="reversalForm.amount"
          placeholder="冲销金额"
          required
         maxlength="18"/><select v-model="reversalForm.reason_code" required>
          <option value="MATCH_ERROR">回款匹配错误</option>
          <option value="CUSTOMER_CORRECTION">客户归属修正</option>
          <option value="AMOUNT_ERROR">金额录入错误</option>
          <option value="DUPLICATE_ALLOCATION">重复核销</option>
          <option value="OTHER">其他原因</option>
        </select>
        <input
          v-model.trim="reversalForm.reason_detail"
          placeholder="补充说明冲销原因"
          required
         maxlength="500"/><button :disabled="saving">确认冲销</button>
      </form>
    </article>
  </section>
</template>
