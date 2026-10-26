<script setup>
import { ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import RedFlushDialog from '@/modules/settlement/components/RedFlushDialog.vue'
import SettlementTimeline from '@/modules/settlement/components/SettlementTimeline.vue'
import { canRequestRedFlush } from '@/modules/settlement/utils/invoiceStatus'
import { invoiceStatusMeta, invoiceTypeLabel, issueChannelLabel, money, redFlushStatusLabel } from '@/modules/settlement/utils/settlementDisplay'

// 「开票详情」区面板（治理批次 5 结算·第三步，模板自 SettlementView.vue 逐字提取；提取前片段 SSR golden 归档于
// .ai/qa/closure-20261025/goldens-settlement-panels/SettlementInvoiceDetailPanel/）。
// 发票详情 / 保存态 / 红冲表单 / 时间线事件为 prop；红冲申请开关为双向原始值（defineModel，红冲弹窗与取消赋值原样保留）；
// 电子发票文件输入（模板 ref）与其选择动作迁入本组件（DOM 归持有者），上传 / 下载 / 关闭详情 / 红冲复核 / 提交红冲以事件回传父级；
// RedFlushDialog 与 SettlementTimeline 子组件在此渲染。
defineProps({
  invoiceDetail: { type: Object, default: null },
  saving: { type: Boolean, default: false },
  redFlushForm: { type: Object, required: true },
  invoiceTimelineEvents: { type: Array, required: true },
})
const redFlushOpen = defineModel('redFlushOpen')
defineEmits(['close-detail','upload-document','download-document','review-red-flush','submit-red-flush'])
const invoiceDocumentInput = ref(null)
function chooseInvoiceDocument() {
  invoiceDocumentInput.value?.click()
}
</script>

<template>
  <section
    class="settlement-invoices"
  >
    <div v-if="invoiceDetail" class="settlement-invoice-detail">
      <button
        class="console-text-button settlement-back-link"
        @click="$emit('close-detail')"
      >
        ‹ 返回发票台账
      </button>
      <div class="settlement-section-head">
        <div>
          <h2>发票详情</h2>
          <p>电子发票交付与红冲管理</p>
        </div>
        <div>
          <input
            ref="invoiceDocumentInput"
            class="settlement-visually-hidden"
            type="file"
            accept=".pdf,.ofd,.xml,.png,.jpg,.jpeg"
            @change="$emit('upload-document', $event)"
          />
          <button
            class="console-button secondary"
            :disabled="saving"
            @click="chooseInvoiceDocument"
          >
            上传电子发票</button
          ><button
            class="console-button secondary"
            :disabled="saving || !canRequestRedFlush(invoiceDetail)"
            @click="redFlushOpen = true"
          >
            发起红冲</button
          ><button
            class="console-button"
            :disabled="!invoiceDetail.documents?.length"
            @click="$emit('download-document', invoiceDetail.documents?.[0])"
          >
            下载电子发票
          </button>
        </div>
      </div>
      <p
        v-if="invoiceDetail.red_flush_request"
        class="settlement-detail-notice"
      >
        红冲申请状态：{{ redFlushStatusLabel(invoiceDetail.red_flush_request.status) }}；原发票在收到有效税控回执前仍保持已开具状态。
        <template v-if="invoiceDetail.red_flush_request.review_reason">
          驳回原因：{{ invoiceDetail.red_flush_request.review_reason }}。
        </template>
      </p>
      <div
        v-if="invoiceDetail.red_flush_request?.can_review"
        class="settlement-operation-actions"
      >
        <button
          class="console-button secondary"
          :disabled="saving"
          @click="$emit('review-red-flush', false)"
        >
          驳回红冲
        </button>
        <button
          class="console-button danger"
          :disabled="saving"
          @click="$emit('review-red-flush', true)"
        >
          通过并提交税控
        </button>
      </div>
      <RedFlushDialog
        v-if="redFlushOpen"
        :form="redFlushForm"
        :saving="saving"
        @cancel="redFlushOpen = false"
        @submit="$emit('submit-red-flush')"
      />
      <div class="settlement-detail-kpis">
        <article class="tone-blue">
          <span>发票号码</span><b>{{ invoiceDetail.invoice_no }}</b>
        </article>
        <article class="tone-green">
          <span>价税合计</span
          ><b>{{ money(invoiceDetail.amount_incl_tax) }}</b>
        </article>
        <article class="tone-purple">
          <span>状态</span
          ><b>{{ invoiceStatusMeta(invoiceDetail.status).label }}</b>
        </article>
      </div>
      <div class="settlement-detail-grid">
        <article class="settlement-panel">
          <h2>发票信息</h2>
          <dl class="settlement-detail-list">
            <div>
              <dt>发票类型</dt>
              <dd>{{ invoiceTypeLabel(invoiceDetail.invoice_type) }}</dd>
            </div>
            <div>
              <dt>开票日期</dt>
              <dd>{{ invoiceDetail.issue_date }}</dd>
            </div>
            <div>
              <dt>发票代码</dt>
              <dd>{{ invoiceDetail.invoice_code }}</dd>
            </div>
            <div>
              <dt>不含税金额</dt>
              <dd>{{ money(invoiceDetail.amount_excl_tax) }}</dd>
            </div>
            <div>
              <dt>税额</dt>
              <dd>{{ money(invoiceDetail.tax_amount) }}</dd>
            </div>
            <div>
              <dt>开具渠道</dt>
              <dd>{{ issueChannelLabel(invoiceDetail.issued_by_channel) }}</dd>
            </div>
          </dl>
        </article>
        <article class="settlement-panel">
          <h2>购方信息</h2>
          <dl class="settlement-detail-list">
            <div>
              <dt>购方名称</dt>
              <dd>{{ invoiceDetail.buyer_name || "—" }}</dd>
            </div>
            <div>
              <dt>纳税人识别号</dt>
              <dd>{{ invoiceDetail.buyer_tax_no_masked || "—" }}</dd>
            </div>
            <div>
              <dt>关联合同</dt>
              <dd>{{ invoiceDetail.contract_no || "—" }}</dd>
            </div>
            <div>
              <dt>关联申请</dt>
              <dd>{{ invoiceDetail.request_no || "—" }}</dd>
            </div>
            <div>
              <dt>电子票附件</dt>
              <dd v-if="invoiceDetail.documents?.length">
                <button
                  v-for="document in invoiceDetail.documents"
                  :key="document.id"
                  class="console-text-button settlement-document-link"
                  @click="$emit('download-document', document)"
                >
                  {{ document.original_name }}
                </button>
              </dd>
              <dd v-else>尚未归档</dd>
            </div>
          </dl>
        </article>
        <article class="settlement-panel settlement-detail-items">
          <h2>票面明细</h2>
          <p
            v-if="invoiceDetail.items_source === 'REQUEST'"
            class="settlement-muted"
          >
            该发票为历史人工登记，未留存票面明细，以下展示开票申请明细。
          </p>
          <div class="settlement-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>税收分类编码</th>
                  <th>不含税金额</th>
                  <th>税率</th>
                  <th>税额</th>
                  <th>价税合计</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in invoiceDetail.items"
                  :key="item.line_no"
                >
                  <td>{{ item.item_name }}</td>
                  <td>{{ item.tax_classification_code }}</td>
                  <td>{{ money(item.amount_excl_tax) }}</td>
                  <td>{{ item.tax_rate_display }}</td>
                  <td>{{ money(item.tax_amount) }}</td>
                  <td>{{ money(item.amount_incl_tax) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
        <article
          v-if="
            invoiceDetail.items_source !== 'REQUEST' &&
            invoiceDetail.request_items?.length
          "
          class="settlement-panel settlement-detail-items"
        >
          <h2>申请依据</h2>
          <p class="settlement-muted">
            以下为开票申请明细，仅用于与票面明细核对，不作为已开具票面。
          </p>
          <div class="settlement-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>税收分类编码</th>
                  <th>不含税金额</th>
                  <th>税率</th>
                  <th>税额</th>
                  <th>价税合计</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in invoiceDetail.request_items"
                  :key="item.line_no"
                >
                  <td>{{ item.item_name }}</td>
                  <td>{{ item.tax_classification_code }}</td>
                  <td>{{ money(item.amount_excl_tax) }}</td>
                  <td>{{ item.tax_rate_display }}</td>
                  <td>{{ money(item.tax_amount) }}</td>
                  <td>{{ money(item.amount_incl_tax) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
        <article class="settlement-panel">
          <h2>开票记录</h2>
          <SettlementTimeline :events="invoiceTimelineEvents" empty-hint="暂无开票相关留痕。" />
          <p v-if="invoiceDetail.red_flush_request" class="settlement-timeline-hint">
            红冲流程中，原发票在收到有效税控回执前仍保持已开具状态。
          </p>
        </article>
      </div>
    </div>
    <div v-else class="settlement-empty">
      <ConsoleIcon name="account" /><strong>未找到发票详情</strong
      ><span>该发票可能不存在，或当前账号无权访问。</span
      ><button
        class="console-button secondary"
        @click="$emit('close-detail')"
      >
        返回发票台账
      </button>
    </div>
  </section>
</template>
