<script setup>
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { money } from '@/modules/settlement/utils/settlementDisplay'
import { planCoverageGapLabel, planCoverageHint, planCoverageStateMeta, planCoverageTriggerLabels } from '@/modules/settlement/utils/planCoverage'

// 「计划差额」面板（SET-04）：展示服务端 GET /api/v1/plan-coverage 的只读差额视图。
// 数据由父级按结算读取权限装载（loadTargets + capabilities 登记），本组件只做展示与提示；
// 超阈值一律不自动重试写入，只提示需要结算财务 override 权限，避免页面把 409 当成可重试的临时故障。
defineProps({
  can: { type: Function, default: () => false },
  coverageItems: { type: Array, default: () => [] },
})
defineEmits(['reload'])
</script>

<template>
  <section class="settlement-plan-coverage">
    <div class="settlement-section-head">
      <div>
        <p>
          合同金额与计划合计的差额来自服务端只读口径；差额超过阈值时不会自动重试保存，需财务负责人 override 后重新提交。
        </p>
      </div>
      <div>
        <button class="console-button secondary" @click="$emit('reload')">
          <ConsoleIcon name="reset" />刷新
        </button>
      </div>
    </div>
    <article class="settlement-panel settlement-plan-coverage-table">
      <div class="settlement-panel-head">
        <div>
          <h2>计划差额（合同金额对计划合计）</h2>
          <p>
            差额为正＝合同金额高于计划合计（少计应收），为负＝计划超计。合同财务事件基线计划应等于合同金额，人工改动会留审计。
          </p>
        </div>
      </div>
      <p v-if="!coverageItems.length" class="settlement-muted" data-testid="plan-coverage-empty">
        当前没有计划合计与合同金额不一致的合同。
      </p>
      <div v-else class="settlement-table-scroll">
        <table>
          <thead>
            <tr>
              <th>合同编号</th>
              <th>合同金额</th>
              <th>计划合计</th>
              <th>差额</th>
              <th>差额比例</th>
              <th>判定</th>
              <th>触发原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in coverageItems" :key="item.contract_snapshot_id">
              <td class="settlement-contract-cell">{{ item.contract_no || "—" }}</td>
              <td class="settlement-money">{{ money(item.contract_amount) }}</td>
              <td class="settlement-money">{{ money(item.plan_total) }}</td>
              <td class="settlement-money">
                {{ money(item.gap) }}
                <small class="settlement-muted">{{ planCoverageGapLabel(item.gap) }}</small>
              </td>
              <td>{{ item.gap_percent ? `${item.gap_percent}%` : "—" }}</td>
              <td>
                <span
                  class="settlement-badge"
                  :class="`tone-${planCoverageStateMeta(item).tone}`"
                  >{{ planCoverageStateMeta(item).label }}</span
                >
                <p v-if="item.contract_event_plan" class="settlement-muted">
                  计划来自合同财务事件基线，差额需核对审计记录。
                </p>
              </td>
              <td>{{ planCoverageTriggerLabels(item.triggered).join("、") || "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-if="coverageItems.some((item) => item.exceeds_threshold)"
        class="settlement-muted"
        data-testid="plan-coverage-override-hint"
        role="alert"
      >
        {{ planCoverageHint(can("settlement.finance.override")) }}
      </p>
    </article>
  </section>
</template>
