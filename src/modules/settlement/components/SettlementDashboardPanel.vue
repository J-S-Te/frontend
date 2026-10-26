<script setup>
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { formatSettlementAmount, money, receivableInvoiceStatusLabel } from '@/modules/settlement/utils/settlementDisplay'

// 结算总览区面板（治理批次 5 结算·第三步，模板自 SettlementView.vue 逐字提取；提取前片段 SSR golden 归档于
// .ai/qa/closure-20261025/goldens-settlement-panels/SettlementDashboardPanel/）。KPI / 待办 / 账龄 / TOP10 均为父级派生数据注入；
// 全部跳转以 navigate(section) 回传父级路由。
defineProps({
  dashboardKpis: { type: Array, required: true },
  workItems: { type: Array, required: true },
  agingRows: { type: Array, required: true },
  invoicedReceivableTop10: { type: Object, required: true },
})
defineEmits(['navigate'])
</script>

<template>
  <section class="settlement-dashboard">
    <section class="settlement-cards">
      <article
        v-for="item in dashboardKpis"
        :key="item.label"
        :class="`tone-${item.tone}`"
      >
        <span>{{ item.label }}</span
        ><b>{{ item.value }}</b
        ><small>{{ item.note }}</small>
      </article>
    </section>
    <section class="settlement-dashboard-grid">
      <div>
        <article class="settlement-panel settlement-workbench">
          <div class="settlement-panel-head">
            <div>
              <h2>待办事项 <small>需我处理</small></h2>
              <p>
                收款计划、开票审核和核销任务按真实业务状态自动汇总。
              </p>
            </div>
            <button class="console-text-button" @click="$emit('navigate', 'tasks')">
              查看全部
            </button>
          </div>
          <div v-if="workItems.length" class="settlement-todo-list">
            <div
              v-for="item in workItems"
              :key="item.section"
              class="settlement-todo"
            >
              <span
                class="settlement-todo-icon"
                :class="`tone-${item.tone}`"
                ><ConsoleIcon :name="item.icon"
              /></span>
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.description }}</p>
              </div>
              <button
                class="console-text-button"
                @click="$emit('navigate', item.section)"
              >
                {{ item.action }}
              </button>
            </div>
          </div>
          <div v-else class="settlement-empty">
            <ConsoleIcon name="organization" /><strong
              >当前没有待处理事项</strong
            ><span>应收确认、开票审批和催收任务将自动汇总。</span>
          </div>
        </article>
        <article class="settlement-panel settlement-aging">
          <div class="settlement-panel-head">
            <div>
              <h2>
                应收账款账龄分布 <small>服务端全量按币种聚合</small>
              </h2>
              <p>
                按应收单到期日计算，用于辅助识别逾期风险；权威催收状态以催收中心为准。
              </p>
            </div>
            <button class="console-text-button" @click="$emit('navigate', 'dunning')">
              查看催收
            </button>
          </div>
          <div class="settlement-aging-list">
            <div
              v-for="item in agingRows"
              :key="item.key"
              class="settlement-aging-row"
            >
              <span>{{ item.label }}</span
              ><i
                ><b
                  :class="`tone-${item.tone}`"
                  :style="{ width: `${item.percent}%` }" /></i
              ><strong>{{ formatSettlementAmount(item.amount, item.currency) }}</strong
              ><em>{{ item.percent }}%</em>
            </div>
          </div>
        </article>
      </div>
      <article class="settlement-panel settlement-top10">
        <div class="settlement-panel-head">
          <div>
            <h2>
              已开票未回款应收 TOP10 <small>服务端权威排序</small>
            </h2>
            <p>按币种内剩余未回款金额排序，仅展示已进入开票流程的应收单。</p>
          </div>
          <button
            class="console-text-button"
            @click="$emit('navigate', 'receivables')"
          >
            查看应收
          </button>
        </div>
        <div
          v-if="invoicedReceivableTop10.items?.length"
          class="settlement-table-scroll"
        >
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>客户</th>
                <th>合同</th>
                <th>应收单</th>
                <th>未回款金额</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, index) in invoicedReceivableTop10.items"
                :key="item.id"
              >
                <td>
                  <span
                    class="settlement-rank"
                    :class="{ top: index < 3 }"
                    >{{ index + 1 }}</span
                  >
                </td>
                <td>{{ item.customer_name }}</td>
                <td>{{ item.contract_no || "—" }}</td>
                <td>{{ item.receivable_no }}</td>
                <td class="settlement-money">
                  {{ money(item.open_amount, item.currency) }}
                </td>
                <td>{{ receivableInvoiceStatusLabel(item.invoice_status) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="settlement-empty">
          <ConsoleIcon name="account" /><strong
            >暂无开票未回款应收</strong
          ><span>开票申请进入流程后，将按未回款金额自动排序展示。</span>
        </div>
      </article>
      <article class="settlement-panel settlement-guide">
        <h2>业务快捷入口</h2>
        <p>从应收、回款、核销到开票，形成完整且可追溯的资金闭环。</p>
        <div>
          <button class="console-button" @click="$emit('navigate', 'receivables')">
            查看应收</button
          ><button
            class="console-button secondary"
            @click="$emit('navigate', 'invoices')"
          >
            发起开票</button
          ><button
            class="console-button secondary"
            @click="$emit('navigate', 'receipts')"
          >
            登记回款
          </button>
        </div>
      </article>
    </section>
  </section>
</template>
