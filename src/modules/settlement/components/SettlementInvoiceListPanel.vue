<script setup>
import { nextTick, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { formatSettlementError } from '@/modules/settlement/utils/errors.js'
import { INVOICE_REQUEST_FIELDS, validateForm, firstInvalidField, retainVisibleErrors } from '@/modules/settlement/utils/formFeedback.js'
import { invoiceStatusMeta, invoiceTypeLabel, money, redFlushStatusLabel } from '@/modules/settlement/utils/settlementDisplay'

// 「开票管理」区面板（治理批次 5 结算·第三步，模板自 SettlementView.vue 逐字提取；提取前片段 SSR golden 归档于
// .ai/qa/closure-20261025/goldens-settlement-panels/SettlementInvoiceListPanel/）。
// 申请 / 台账两路可见列表、可开票应收、保存态为只读 prop；invoiceForm / invoiceReview 由父级持有、表单按属性直改；can 为权限谓词 prop；
// 页签、申请编辑器与审核弹层开关、关键字与状态筛选为双向原始值（defineModel），模板内 v-model 与直接赋值原样保留；
// 刷新 / 提交申请 / 审核决定 / 重置筛选 / 批准 / 人工登记 / 失败复核 / 打开详情以事件回传父级。失败原因展示沿用 formatSettlementError。
// 提交申请前先按 utils/formFeedback.js 做应用级必填/金额/税率校验（novalidate 关闭原生气泡）：失败时字段红框 + 中文文案并聚焦首个错误字段，通过后才 emit submit-invoice；父级写接口不变。
const props = defineProps({
  visibleInvoiceRequests: { type: Array, required: true },
  visibleTaxInvoices: { type: Array, required: true },
  invoiceEligibleReceivables: { type: Array, required: true },
  saving: { type: Boolean, default: false },
  invoiceForm: { type: Object, required: true },
  invoiceReview: { type: Object, required: true },
  can: { type: Function, required: true },
})
const emit = defineEmits(['reload','submit-invoice','submit-review','reset-filters','approve','manual-issue','review-failure','open-detail','special-review'])
const invoiceTab = defineModel('invoiceTab')
const invoiceComposerOpen = defineModel('invoiceComposerOpen')
const invoiceReviewOpen = defineModel('invoiceReviewOpen')
const invoiceKeyword = defineModel('invoiceKeyword')
const invoiceStatusFilter = defineModel('invoiceStatusFilter')
// 表单反馈：关闭原生 required 气泡后由应用层给出字段级提示并聚焦首个错误字段（DEF-03）。
const invoiceErrors = ref({})
const invoiceFormElement = ref(null)
// 用途：提交前校验开票申请必填与金额/税率格式，校验不通过时不通知父级写入。
// 参数：无；读取父级持有的 invoiceForm。
// 返回值：无；通过后 emit submit-invoice。
async function submitInvoiceForm() {
  invoiceErrors.value = validateForm(INVOICE_REQUEST_FIELDS, props.invoiceForm)
  const first = firstInvalidField(INVOICE_REQUEST_FIELDS, invoiceErrors.value)
  if (first) {
    await nextTick()
    invoiceFormElement.value?.querySelector('[name="' + first.key + '"]')?.focus()
    return
  }
  emit('submit-invoice')
}
// 用途：用户修正字段后只保留仍失败的旧错误；关闭编辑器时清空反馈。
// 参数：无。
// 返回值：无。
watch(() => props.invoiceForm, () => {
  if (!Object.keys(invoiceErrors.value).length) return
  invoiceErrors.value = retainVisibleErrors(INVOICE_REQUEST_FIELDS, props.invoiceForm, invoiceErrors.value)
}, { deep: true })
watch(invoiceComposerOpen, (open) => { if (!open) invoiceErrors.value = {} })
</script>

<template>
  <section
    class="settlement-invoices"
  >
    <div class="settlement-section-head">
      <div>
        <p>关联合同发起开票申请，财务审核通过后驱动税控开票并回填。</p>
      </div>
      <div>
        <button class="console-button secondary" @click="$emit('reload')">
          <ConsoleIcon name="reset" />刷新</button
        ><button
          class="console-button"
          v-if="can('settlement.invoice.request')"
          @click="invoiceComposerOpen = true"
        >
          <ConsoleIcon name="account" />发起开票申请
        </button>
      </div>
    </div>
    <article
      v-if="invoiceComposerOpen && can('settlement.invoice.request')"
      class="settlement-panel settlement-invoice-composer"
    >
      <div class="settlement-panel-head">
        <div>
          <h2>发起开票申请</h2>
          <p>
            申请提交后将锁定对应应收的可开票余额，提交人不能审批本人申请。
          </p>
        </div>
        <button
          class="console-text-button"
          type="button"
          @click="invoiceComposerOpen = false"
        >
          收起
        </button>
      </div>
      <form ref="invoiceFormElement" class="settlement-form" novalidate @submit.prevent="submitInvoiceForm">
        <div class="settlement-field">
          <select
            v-model="invoiceForm.receivable_id"
            name="receivable_id"
            :aria-invalid="invoiceErrors.receivable_id ? 'true' : null"
            :aria-describedby="invoiceErrors.receivable_id ? 'invoice-receivable-error' : null"
            required
          >
            <option value="" disabled>
              {{
                invoiceEligibleReceivables.length
                  ? "选择可开票应收"
                  : "暂无可开票应收，请先确认应收计划"
              }}
            </option>
            <option
              v-for="item in invoiceEligibleReceivables"
              :key="item.id"
              :value="item.id"
            >
              {{ item.receivable_no }} ·
              {{ item.contract_no || "未关联合同" }} ·
              {{ item.customer_name }} ·
              {{ money(item.invoiceable_amount, item.currency) }}
            </option>
          </select>
          <small
            v-if="invoiceErrors.receivable_id"
            id="invoice-receivable-error"
            class="settlement-field-error"
            role="alert"
          >{{ invoiceErrors.receivable_id }}</small>
        </div>
        <div class="settlement-field">
          <input
            v-model.trim="invoiceForm.buyer_tax_no"
            name="buyer_tax_no"
            placeholder="购方税号"
            aria-label="购方税号"
            required
            maxlength="64"
            :aria-invalid="invoiceErrors.buyer_tax_no ? 'true' : null"
            :aria-describedby="invoiceErrors.buyer_tax_no ? 'invoice-buyer-tax-no-error' : null"
          />
          <small
            v-if="invoiceErrors.buyer_tax_no"
            id="invoice-buyer-tax-no-error"
            class="settlement-field-error"
            role="alert"
          >{{ invoiceErrors.buyer_tax_no }}</small>
        </div>
        <div class="settlement-field">
          <input
            v-model.trim="invoiceForm.item_name"
            name="item_name"
            placeholder="项目名称"
            aria-label="项目名称"
            required
            maxlength="255"
            :aria-invalid="invoiceErrors.item_name ? 'true' : null"
            :aria-describedby="invoiceErrors.item_name ? 'invoice-item-name-error' : null"
          />
          <small
            v-if="invoiceErrors.item_name"
            id="invoice-item-name-error"
            class="settlement-field-error"
            role="alert"
          >{{ invoiceErrors.item_name }}</small>
        </div>
        <div class="settlement-field">
          <input
            v-model.trim="invoiceForm.tax_classification_code"
            name="tax_classification_code"
            placeholder="税收分类编码"
            aria-label="税收分类编码"
            required
            maxlength="64"
            :aria-invalid="invoiceErrors.tax_classification_code ? 'true' : null"
            :aria-describedby="invoiceErrors.tax_classification_code ? 'invoice-tax-code-error' : null"
          />
          <small
            v-if="invoiceErrors.tax_classification_code"
            id="invoice-tax-code-error"
            class="settlement-field-error"
            role="alert"
          >{{ invoiceErrors.tax_classification_code }}</small>
        </div>
        <div class="settlement-field">
          <input
            v-model.trim="invoiceForm.amount_excl_tax"
            name="amount_excl_tax"
            placeholder="不含税金额"
            aria-label="不含税金额"
            required
            maxlength="18"
            :aria-invalid="invoiceErrors.amount_excl_tax ? 'true' : null"
            :aria-describedby="invoiceErrors.amount_excl_tax ? 'invoice-amount-excl-tax-error' : null"
          />
          <small
            v-if="invoiceErrors.amount_excl_tax"
            id="invoice-amount-excl-tax-error"
            class="settlement-field-error"
            role="alert"
          >{{ invoiceErrors.amount_excl_tax }}</small>
        </div>
        <div class="settlement-field">
          <input
            v-model.trim="invoiceForm.tax_rate"
            name="tax_rate"
            placeholder="税率，如 0.06"
            aria-label="税率"
            required
            maxlength="10"
            :aria-invalid="invoiceErrors.tax_rate ? 'true' : null"
            :aria-describedby="invoiceErrors.tax_rate ? 'invoice-tax-rate-error' : null"
          />
          <small
            v-if="invoiceErrors.tax_rate"
            id="invoice-tax-rate-error"
            class="settlement-field-error"
            role="alert"
          >{{ invoiceErrors.tax_rate }}</small>
        </div>
        <div class="settlement-field">
          <input
            v-model.trim="invoiceForm.tax_amount"
            name="tax_amount"
            placeholder="税额"
            aria-label="税额"
            required
            maxlength="18"
            :aria-invalid="invoiceErrors.tax_amount ? 'true' : null"
            :aria-describedby="invoiceErrors.tax_amount ? 'invoice-tax-amount-error' : null"
          />
          <small
            v-if="invoiceErrors.tax_amount"
            id="invoice-tax-amount-error"
            class="settlement-field-error"
            role="alert"
          >{{ invoiceErrors.tax_amount }}</small>
        </div>
        <div class="settlement-field">
          <input
            v-model.trim="invoiceForm.amount_incl_tax"
            name="amount_incl_tax"
            placeholder="价税合计"
            aria-label="价税合计"
            required
            maxlength="18"
            :aria-invalid="invoiceErrors.amount_incl_tax ? 'true' : null"
            :aria-describedby="invoiceErrors.amount_incl_tax ? 'invoice-amount-incl-tax-error' : null"
          />
          <small
            v-if="invoiceErrors.amount_incl_tax"
            id="invoice-amount-incl-tax-error"
            class="settlement-field-error"
            role="alert"
          >{{ invoiceErrors.amount_incl_tax }}</small>
        </div>
        <textarea v-model.trim="invoiceForm.special_reason" maxlength="1000" placeholder="特殊事项或折扣原因（填写后需总监加签）"></textarea><button :disabled="saving">提交申请</button>
      </form>
    </article>
    <article
      v-if="invoiceReviewOpen && can('settlement.invoice.approve')"
      class="settlement-panel settlement-operation-card"
    >
      <div class="settlement-panel-head">
        <div>
          <h2>审核开票申请</h2>
          <p>申请号 {{ invoiceReview.request_no }}</p>
        </div>
        <button
          type="button"
          class="console-text-button"
          @click="invoiceReviewOpen = false"
        >
          取消
        </button>
      </div>
      <label class="settlement-review-reason"
        ><span>审核意见 / 驳回原因</span
        ><textarea
          v-model.trim="invoiceReview.reason"
          rows="3"
          placeholder="驳回时必填；审批通过时可填写审核说明。"
         maxlength="500"></textarea>
      </label>
      <div class="settlement-operation-actions">
        <button
          type="button"
          class="console-button danger"
          :disabled="saving"
          @click="$emit('submit-review', 'reject')"
        >
          驳回申请
        </button>
        <button
          type="button"
          class="console-button"
          :disabled="saving"
          @click="$emit('submit-review', 'approve')"
        >
          审批通过
        </button>
      </div>
    </article>
    <div class="settlement-tabs" role="tablist" aria-label="开票数据">
      <button
        :class="{ active: invoiceTab === 'requests' }"
        @click="invoiceTab = 'requests'"
      >
        开票申请</button
      ><button
        :class="{ active: invoiceTab === 'ledger' }"
        @click="invoiceTab = 'ledger'"
      >
        发票台账
      </button>
    </div>
    <div class="settlement-filter-bar settlement-invoice-filters">
      <label
        ><ConsoleIcon name="search" /><input
          v-model.trim="invoiceKeyword"
          :placeholder="
            invoiceTab === 'requests'
              ? '搜索申请号 / 合同号 / 购方'
              : '搜索发票号码 / 合同号 / 购方'
          "  maxlength="100"/></label
      ><select v-model="invoiceStatusFilter">
        <option value="">全部状态</option>
        <option v-if="invoiceTab === 'requests'" value="SPECIAL_REVIEW">待总监加签</option>
        <option v-if="invoiceTab === 'requests'" value="SUBMITTED">
          待审核
        </option>
        <option v-if="invoiceTab === 'requests'" value="ISSUE_PENDING">
          待开具
        </option>
        <option v-if="invoiceTab === 'requests'" value="REJECTED">
          已驳回
        </option>
        <option value="ISSUED">已开票</option></select
      ><button
        class="console-button secondary"
        @click="$emit('reset-filters')"
      >
        重置
      </button>
    </div>
    <article
      v-if="invoiceTab === 'requests'"
      class="settlement-panel settlement-invoice-table"
    >
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>申请号</th>
              <th>合同号</th>
              <th>购方名称</th>
              <th>税号</th>
              <th>金额</th>
              <th>税率</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in visibleInvoiceRequests" :key="item.id">
              <td class="settlement-contract-cell">
                {{ item.request_no }}
              </td>
              <td>{{ item.contract_no || "—" }}</td>
              <td>{{ item.buyer_name || "—" }}</td>
              <td>{{ item.buyer_tax_no_masked || "—" }}</td>
              <td class="settlement-money">
                {{ money(item.amount_incl_tax) }}
              </td>
              <td>{{ item.tax_rate_display || "—" }}</td>
              <td>
                <span
                  class="settlement-badge"
                  :class="`tone-${invoiceStatusMeta(item.status).tone}`"
                  >{{ invoiceStatusMeta(item.status).label }}</span
                >
                <p v-if="item.status === 'ISSUE_FAILED'" class="settlement-muted">
                  {{ formatSettlementError({ code: item.failure_code, message: item.failure_message }, { fallback: "请核对税控回执后复核，禁止对结果未知的申请重开。" }) }}
                </p>
              </td>
              <td>
                <button v-if="item.status === 'SPECIAL_REVIEW' && can('settlement.invoice.special_approve')"
                  class="console-button small" :disabled="saving" @click="$emit('special-review', item)">总监加签</button>
                <button
                  v-if="item.status === 'SUBMITTED' && can('settlement.invoice.approve')"
                  class="console-button small"
                  :disabled="saving"
                  @click="$emit('approve', item)"
                >
                  审核</button
                ><button
                  v-else-if="item.status === 'ISSUE_PENDING' && item.issue_channel === 'MANUAL' && can('settlement.invoice.issue')"
                  class="console-button secondary small"
                  :disabled="saving"
                  @click="$emit('manual-issue', item)"
                >
                  登记发票</button
                ><button
                  v-else-if="item.status === 'ISSUE_FAILED' && can('settlement.invoice.approve')"
                  class="console-button secondary small"
                  :disabled="saving"
                  @click="$emit('review-failure', item)"
                >失败复核</button><span v-else class="settlement-muted">—</span>
              </td>
            </tr>
            <tr v-if="!visibleInvoiceRequests.length">
              <td colspan="8" class="settlement-table-empty">
                暂无匹配的开票申请
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article v-else class="settlement-panel settlement-invoice-table">
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>发票号码</th>
              <th>发票代码</th>
              <th>合同号</th>
              <th>购方名称</th>
              <th>开票日期</th>
              <th>价税合计</th>
              <th>类型</th>
              <th>状态</th>
              <th>红冲流程</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in visibleTaxInvoices" :key="item.id">
              <td class="settlement-contract-cell">
                {{ item.invoice_no }}
              </td>
              <td>{{ item.invoice_code }}</td>
              <td>{{ item.contract_no || "—" }}</td>
              <td>{{ item.buyer_name || "—" }}</td>
              <td>{{ item.issue_date }}</td>
              <td class="settlement-money">
                {{ money(item.amount_incl_tax) }}
              </td>
              <td>{{ invoiceTypeLabel(item.invoice_type) }}</td>
              <td>
                <span
                  class="settlement-badge"
                  :class="`tone-${invoiceStatusMeta(item.status).tone}`"
                  >{{ invoiceStatusMeta(item.status).label }}</span
                >
              </td>
              <td>{{ item.red_flush_status ? redFlushStatusLabel(item.red_flush_status) : "—" }}</td>
              <td>
                <button
                  class="console-text-button"
                  @click="$emit('open-detail', item)"
                >
                  查看
                </button>
              </td>
            </tr>
            <tr v-if="!visibleTaxInvoices.length">
              <td colspan="10" class="settlement-table-empty">
                暂无匹配的发票台账记录
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>
