<script setup>
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { amountOf, money, receiptStatusMeta } from '@/modules/settlement/utils/settlementDisplay'

// 「回款核销」区面板（治理批次 5 结算·第三步，模板自 SettlementView.vue 逐字提取；提取前片段 SSR golden 归档于
// .ai/qa/closure-20261025/goldens-settlement-panels/SettlementReceiptsPanel/）。根节点沿用原视图的 settlement-allocations 类名（逐字保留）。
// 回款列表 / 客户下拉 / 保存态为只读 prop；receiptForm 由父级持有、表单按属性直改；can 为权限谓词 prop；
// 登记编辑器开关、匹配建议所属回款与建议列表为双向原始值（defineModel），模板内直接赋值原样保留；
// 刷新 / 提交登记 / 客户联动 / 选择建议 / 去核销以事件回传。
defineProps({
  receipts: { type: Array, required: true },
  receiptCustomers: { type: Array, required: true },
  saving: { type: Boolean, default: false },
  receiptForm: { type: Object, required: true },
  can: { type: Function, required: true },
})
const receiptComposerOpen = defineModel('receiptComposerOpen')
const receiptMatchFor = defineModel('receiptMatchFor')
const receiptMatches = defineModel('receiptMatches')
defineEmits(['reload','submit-receipt','sync-customer','select-match','navigate'])
</script>

<template>
  <section
    class="settlement-allocations"
  >
    <div class="settlement-section-head">
      <div>
        <p>
          会计录入回款，系统按客户、合同与金额匹配生成核销单，确认后生效。
        </p>
      </div>
      <div>
        <button class="console-button secondary" @click="$emit('reload')">
          <ConsoleIcon name="reset" />刷新</button
        ><button
          v-if="can('settlement.invoice.request')"
          class="console-button"
          @click="receiptComposerOpen = true"
        >
          <ConsoleIcon name="save" />登记回款
        </button>
      </div>
    </div>
    <article
      v-if="receiptComposerOpen"
      class="settlement-panel settlement-invoice-composer"
    >
      <div class="settlement-panel-head">
        <div>
          <h2>登记回款</h2>
          <p>银行凭证号用于回款去重与后续审计追溯。</p>
        </div>
        <button
          class="console-text-button"
          @click="receiptComposerOpen = false"
        >
          收起
        </button>
      </div>
      <form class="settlement-form" @submit.prevent="$emit('submit-receipt')">
        <select
          v-model="receiptForm.customer_id"
          required
          @change="$emit('sync-customer')"
        >
          <option value="" disabled>
            {{
              receiptCustomers.length
                ? "选择回款客户"
                : "暂无正式应收客户"
            }}
          </option>
          <option
            v-for="customer in receiptCustomers"
            :key="customer.id"
            :value="customer.id"
          >
            {{ customer.name }}
          </option></select
        ><input
          v-model.trim="receiptForm.amount"
          placeholder="金额"
          required
         maxlength="18"/><input
          v-model="receiptForm.receipt_date"
          type="date"
          required
        /><select v-model="receiptForm.payment_method">
          <option value="TRANSFER">电汇</option>
          <option value="BANK_ACCEPTANCE">银行承兑</option>
          <option value="CHEQUE">支票</option>
          <option value="CASH">现金</option></select
        ><input
          v-model.trim="receiptForm.bank_transaction_reference"
          placeholder="银行凭证号"
          required
         maxlength="128"/><button :disabled="saving">确认登记</button>
      </form>
    </article>
    <article
      v-if="receiptMatchFor"
      class="settlement-panel settlement-match-panel"
    >
      <div class="settlement-panel-head">
        <div>
          <h2>回款匹配建议</h2>
          <p>仅展示同租户、同客户、同币种且仍有余额的正式应收。</p>
        </div>
        <button
          class="console-text-button"
          @click="receiptMatchFor = ''; receiptMatches = []"
        >
          关闭
        </button>
      </div>
      <div v-if="receiptMatches.length" class="settlement-match-list">
        <button
          v-for="match in receiptMatches"
          :key="match.receivable_id"
          type="button"
          @click="$emit('select-match', match)"
        >
          <span
            ><strong>{{ match.receivable_no }}</strong
            ><small
              >{{ match.contract_no || "未关联合同" }} · 到期
              {{ match.due_date }}</small
            ></span
          ><span
            ><strong>{{ money(match.suggested_amount) }}</strong
            ><small>匹配度 {{ match.score }}</small></span
          >
        </button>
      </div>
      <div v-else class="settlement-empty compact">
        暂无可匹配应收，可在核销页手动选择。
      </div>
    </article>
    <article class="settlement-panel settlement-invoice-table">
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>回款号</th>
              <th>客户</th>
              <th>金额</th>
              <th>回款日期</th>
              <th>方式</th>
              <th>银行凭证号</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in receipts" :key="item.id">
              <td class="settlement-contract-cell">
                {{ item.receipt_no }}
              </td>
              <td>{{ item.customer_name }}</td>
              <td class="settlement-money">
                {{ money(item.amount, item.currency) }}
              </td>
              <td>{{ item.receipt_date }}</td>
              <td>
                {{
                  item.payment_method === "TRANSFER"
                    ? "电汇"
                    : item.payment_method === "BANK_ACCEPTANCE"
                      ? "银行承兑"
                      : item.payment_method === "CHEQUE"
                        ? "支票"
                        : item.payment_method === "CASH"
                          ? "现金"
                          : item.payment_method
                }}
              </td>
              <td>{{ item.bank_transaction_reference }}</td>
              <td>
                <span
                  class="settlement-badge"
                  :class="`tone-${receiptStatusMeta(item).tone}`"
                  >{{ receiptStatusMeta(item).label }}</span
                >
              </td>
              <td>
                <button
                  v-if="amountOf(item.unallocated_amount) > 0"
                  class="console-text-button"
                  @click="$emit('navigate', 'allocations')"
                >
                  发起核销</button
                ><button
                  v-else
                  class="console-text-button"
                  @click="$emit('navigate', 'allocations')"
                >
                  查看核销结果
                </button>
              </td>
            </tr>
            <tr v-if="!receipts.length">
              <td colspan="8" class="settlement-table-empty">
                暂无回款记录
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>
