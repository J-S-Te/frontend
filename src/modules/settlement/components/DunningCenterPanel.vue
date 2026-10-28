<script setup>
import { computed } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { dunningActionStatusLabel, dunningCaseStatusLabel, formatSettlementAmount } from '@/modules/settlement/utils/settlementDisplay'

// 账龄与催收区面板（治理批次 5 结算·第三步，模板自 SettlementView.vue 催收区逐字提取；
// 提取前片段 SSR golden 与用例归档于 .ai/qa/closure-20261025/goldens-dunning-center/）。
// 数据经 prop 注入；policyForm 由父组件持有（表单 v-model 按属性直改字段），收件人账号的 USER: 前缀联动随表单迁入本组件。
// 动作以事件回传父级：export-aging / download-export(id) / reload / complete-action(item) / submit-policy。
// 完成跟进的 PromptDialog 仍由父级与其他弹窗并列挂载。
const props = defineProps({
  can: { type: Function, default: () => false },
  saving: { type: Boolean, default: false },
  exportJob: { type: Object, default: null },
  dunningOverview: { type: Object, default: () => ({}) },
  dunningCoverage: { type: Object, default: () => ({ policies: [], gaps: [] }) },
  dunningKpis: { type: Array, default: () => [] },
  agingRows: { type: Array, default: () => [] },
  dunningCases: { type: Array, default: () => [] },
  dunningActions: { type: Array, default: () => [] },
  dunningRecipients: { type: Array, default: () => [] },
  dunningRecipientsLoading: { type: Boolean, default: false },
  dunningRecipientsError: { type: String, default: '' },
  policyForm: { type: Object, required: true },
  canCompleteDunningAction: { type: Function, required: true },
})
defineEmits(['export-aging', 'download-export', 'reload', 'complete-action', 'submit-policy'])
const policyRecipientAccount = computed({
  get: () => props.policyForm.recipient_rule.replace(/^USER:/, ''),
  set: (value) => {
    props.policyForm.recipient_rule = `USER:${String(value || '').trim()}`
  },
})
</script>

<template>
  <section class="settlement-dunning">
    <div class="settlement-section-head">
      <div>
        <p>
          按账龄区间识别未结清应收；逾期提醒和升级状态以催收案件与动作记录为准。
        </p>
      </div>
      <div>
        <button
          v-if="can('settlement.report.export')"
          class="console-button secondary"
          :disabled="saving"
          @click="
            exportJob?.status === 'READY' &&
            exportJob?.report_type === 'AGING_RECEIVABLES_CSV'
              ? $emit('download-export', exportJob.id)
              : $emit('export-aging')
          "
        >
          {{
            exportJob?.status === "READY" &&
            exportJob?.report_type === "AGING_RECEIVABLES_CSV"
              ? "下载账龄表"
              : saving
                ? "生成账龄表中…"
                : "导出账龄表"
          }}</button
        ><button class="console-button secondary" @click="$emit('reload')">
          <ConsoleIcon name="reset" />刷新
        </button>
      </div>
    </div>
    <p v-if="can('settlement.dunning.manage')" class="settlement-detail-notice">
      页面金额与笔数基于服务端全量催收汇总；导出的账龄表由服务端重新查询当前租户全部未结清应收生成。
    </p>
    <p
      v-if="can('settlement.dunning.manage') && Number(dunningOverview.uncovered_overdue_count || 0) > 0"
      class="settlement-detail-notice"
      role="status"
    >
      有 {{ dunningOverview.uncovered_overdue_count }} 笔逾期应收没有匹配的催收策略，请补充覆盖对应账龄区间的规则。
    </p>
    <div v-if="can('settlement.dunning.manage') && dunningCoverage.gaps.length" class="settlement-detail-notice" role="status">
      <strong>策略覆盖巡检：</strong>
      <span v-for="(gap, index) in dunningCoverage.gaps" :key="`${gap.from_days}-${gap.to_days}-${gap.open_ended}`">
        {{ index ? '、' : '' }}{{ gap.open_ended ? `≥${gap.from_days} 天` : `${gap.from_days}–${gap.to_days} 天` }}
      </span>
      未配置启用策略；系统只提示，不自动生成策略。
    </div>
    <section v-if="can('settlement.dunning.manage')" class="settlement-cards settlement-dunning-cards">
      <article
        v-for="item in dunningKpis"
        :key="item.label"
        :class="`tone-${item.tone}`"
      >
        <span>{{ item.label }}</span
        ><b>{{ item.value }}</b
        ><small>{{ item.note }}</small>
      </article>
    </section>
    <article v-if="can('settlement.report.read')" class="settlement-panel settlement-aging-report">
      <div class="settlement-panel-head">
        <div>
          <h2>账龄区间报表</h2>
          <p>当前已加载未结清应收的账龄辅助统计。</p>
        </div>
        <span class="settlement-muted">单位：元</span>
      </div>
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>账龄区间</th>
              <th>金额</th>
              <th>占比</th>
              <th>笔数</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in agingRows" :key="item.label">
              <td>{{ item.label }}</td>
              <td class="settlement-money">{{ formatSettlementAmount(item.amount) }}</td>
              <td>{{ item.percent }}%</td>
              <td>{{ item.count }}</td>
              <td>
                <span
                  class="settlement-badge"
                  :class="`tone-${index === 0 ? 'info' : index === 1 ? 'info' : index === 2 ? 'warning' : 'danger'}`"
                  >{{
                    index === 0
                      ? "正常"
                      : index === 1
                        ? "关注"
                        : index === 2
                          ? "预警"
                          : "逾期"
                  }}</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="settlement-panel settlement-aging-report">
      <div class="settlement-panel-head">
        <div>
          <h2>催收案件</h2>
          <p>按应收和策略版本建立；结清自动关闭，再次逾期会重新打开。</p>
        </div>
      </div>
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>案件 ID</th>
              <th>应收单号</th>
              <th>客户</th>
              <th>逾期天数</th>
              <th>未结金额</th>
              <th>升级级别</th>
              <th>状态</th>
              <th>下次跟进</th>
              <th>当前负责人</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in dunningCases" :key="item.id">
              <td class="settlement-contract-cell">{{ item.id }}</td>
              <td>{{ item.receivable_no }}</td>
              <td>{{ item.customer_name }}</td>
              <td>{{ item.aging_days }} 天</td>
              <td class="settlement-money">{{ formatSettlementAmount(item.open_amount) }}</td>
              <td>{{ item.level || 0 }} 级</td>
              <td>
                <span class="settlement-badge" :class="`tone-${item.status === 'ACTIVE' ? 'warning' : 'info'}`">{{ dunningCaseStatusLabel(item.status) }}</span>
              </td>
              <td>{{ item.next_action_at || "—" }}</td>
              <td>{{ item.recipient_user_id || "—" }}</td>
            </tr>
            <tr v-if="!dunningCases.length">
              <td colspan="9" class="settlement-table-empty">暂无催收案件</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="settlement-panel settlement-aging-report">
      <div class="settlement-panel-head">
        <div>
          <h2>催收动作记录</h2>
          <p>
            仅展示已生成的真实催收动作；普通提醒留在本系统，高优先级事件由
            Outbox 异步投递基础平台。
          </p>
        </div>
      </div>
      <div class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>记录 ID</th>
              <th>应收单号</th>
              <th>渠道</th>
              <th>创建时间</th>
              <th>接收人</th>
              <th>升级标记</th>
              <th>状态</th>
              <th>完成时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in dunningActions" :key="item.id">
              <td class="settlement-contract-cell">{{ item.id }}</td>
              <td>{{ item.receivable_no }}</td>
              <td>{{ item.channel }}</td>
              <td>{{ item.created_at }}</td>
              <td>{{ item.recipient_user_id }}</td>
              <td>
                <span
                  v-if="Number(item.escalation_level) > 1"
                  class="settlement-badge tone-warning"
                  >已升级</span
                ><span v-else class="settlement-muted">—</span>
              </td>
              <td>
                <span class="settlement-badge" :class="`tone-${item.status === 'PENDING' ? 'warning' : item.status === 'COMPLETED' ? 'info' : 'danger'}`">{{ dunningActionStatusLabel(item.status) }}</span>
              </td>
              <td>{{ item.completed_at || "—" }}</td>
              <td>
                <button
                  v-if="canCompleteDunningAction(item)"
                  class="console-text-button"
                  :disabled="saving"
                  @click="$emit('complete-action', item)"
                >完成跟进</button>
                <span v-else class="settlement-muted">—</span>
              </td>
            </tr>
            <tr v-if="!dunningActions.length">
              <td colspan="9" class="settlement-table-empty">
                暂无已生成的催收动作记录
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <details v-if="can('settlement.dunning.manage')" class="settlement-panel settlement-policy-settings">
      <summary>
        <span>逾期提醒规则</span
        ><small>仅催收专员和管理员可新建或查看策略</small>
      </summary>
      <div class="settlement-policy-intro">
        <ConsoleIcon name="bell" />
        <p>
          系统每天检查未结清应收；逾期进入指定范围后，将创建内部跟进提醒并通知指定业务人员，不会向客户直接发送消息。
        </p>
      </div>
      <form
        class="settlement-policy-form"
        @submit.prevent="$emit('submit-policy')"
      >
        <label
          class="settlement-policy-field settlement-policy-field-wide"
        >
          <span>策略名称</span>
          <input
            v-model.trim="policyForm.name"
            placeholder="例如：逾期 1–30 天销售跟进"
            required
           maxlength="255"/>
          <small>方便团队识别这条提醒的适用场景。</small>
        </label>
        <div class="settlement-policy-field">
          <span>逾期多久开始提醒</span>
          <div class="settlement-policy-range">
            <input
              v-model.number="policyForm.aging_from_days"
              type="number"
              min="1"
              required
            />
            <b>至</b>
            <input
              v-model.number="policyForm.aging_to_days"
              type="number"
              min="1"
              required
            />
            <em>天</em>
          </div>
          <small>例如 1 至 30 天，表示从逾期第 1 天起提醒。</small>
        </div>
        <label class="settlement-policy-field">
          <span>提醒哪位业务人员</span>
          <select
            v-model="policyRecipientAccount"
            :disabled="dunningRecipientsLoading || !dunningRecipients.length"
            required
          >
            <option value="">
              {{ dunningRecipientsLoading ? "正在读取催收人员…" : "请选择催收业务人员" }}
            </option>
            <option
              v-for="item in dunningRecipients"
              :key="item.user_id || item.id"
              :value="item.user_id || item.id"
            >
              {{ item.display_name || item.username || item.user_id || item.id }}
              <template v-if="item.username || item.account">
                · {{ item.username || item.account }}
              </template>
            </option>
          </select>
          <small v-if="dunningRecipientsError" class="settlement-field-error">
            {{ dunningRecipientsError }}
            <button type="button" class="console-text-button" @click="$emit('reload')">重新加载</button>
          </small>
          <small v-else-if="!dunningRecipientsLoading && !dunningRecipients.length">
            当前没有同时具备本系统权限和催收角色的有效人员，请先在基础平台配置。
          </small>
          <small v-else>仅展示当前租户内拥有结算权限且属于催收角色的有效人员。</small>
        </label>
        <label class="settlement-policy-field">
          <span>下次跟进提醒间隔</span>
          <select v-model.number="policyForm.repeat_interval_days">
            <option :value="1">每天提醒一次</option>
            <option :value="3">每 3 天提醒一次</option>
            <option :value="7">每周提醒一次</option>
            <option :value="14">每两周提醒一次</option>
          </select>
          <small
            >用于安排后续跟进时间，避免同一笔应收被过度打扰。</small
          >
        </label>
        <label class="settlement-policy-field">
          <span>提醒级别</span>
          <select v-model="policyForm.priority">
            <option value="NORMAL">普通提醒</option>
            <option value="HIGH">重点关注</option>
            <option value="CRITICAL">紧急升级</option>
          </select>
          <small>重点和紧急提醒会自动同步基础平台通知中心。</small>
        </label>
        <label class="settlement-policy-field">
          <span>提醒范围</span>
          <select v-model="policyForm.channel">
            <option value="LOCAL">仅在结算系统内提醒</option>
            <option value="PLATFORM">同步到基础平台通知中心</option>
          </select>
          <small
            >普通跟进建议仅在系统内提醒；重点和紧急提醒仍会同步基础平台。</small
          >
        </label>
        <div class="settlement-policy-submit">
          <span>保存后立即启用，并保留操作审计记录。</span>
          <button :disabled="saving">
            <ConsoleIcon name="save" />保存并启用规则
          </button>
        </div>
      </form>
    </details>
  </section>
</template>
