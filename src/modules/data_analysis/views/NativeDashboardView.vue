<script setup>
// 高保真模型的本地兜底视图：没有 Metabase 或业务摘要时，仍提供清晰的指标层级与数据状态。
const props = defineProps({
  section: { type: String, required: true },
  contractSummary: { type: Object, default: null },
  projectSummary: { type: Object, default: null },
  canViewContract: { type: Boolean, default: true },
  canViewProject: { type: Boolean, default: true },
})

const sectionMeta = {
  overview: { title: "经营总览", description: "集团经营指标与目标达成态势" },
  contract: { title: "合同看板", description: "合同签约、执行与回款全景" },
  project: { title: "项目执行看板", description: "项目交付、进度与质量全景" },
  report: { title: "报告与质量看板", description: "报告编制、复核与签发效率" },
  finance: { title: "财务与经营看板", description: "收入、成本与利润口径分析" },
}

const metric = (label, value, suffix = "", tone = "") => ({ label, value, suffix, tone })

function metricsForSection() {
  const contract = props.contractSummary || {}
  const project = props.projectSummary || {}
  if (props.section === "overview") {
    const metrics = []
    if (props.canViewContract) {
      metrics.push(metric("合同总数", contract.available ? contract.total_contracts : "—", "份"))
      metrics.push(metric("合同金额", contract.available ? contract.total_amount_minor : "—", "分"))
    }
    if (props.canViewProject) {
      metrics.push(metric("项目总数", project.available ? project.project_count : "—", "个"))
      metrics.push(metric("进行中项目", project.available ? project.in_flight_projects : "—", "个"))
      metrics.push(metric("风险项目", project.available ? project.risk_projects : "—", "个", "danger"))
      metrics.push(metric("服务项", project.available ? project.service_items : "—", "项"))
    }
    return metrics
  }
  if (props.section === "contract") {
    return [
      metric("签约金额（本月）", "—", "万"),
      metric("商机→合同转化率", "—", "%"),
      metric("平均折扣率", "—", "%"),
      metric("续签到期（60天内）", "—", "单", "danger"),
    ]
  }
  if (props.section === "project") {
    return [
      metric("项目周期均值（签订→归档）", "—", "天"),
      metric("项目周期 P50", "—", "天"),
      metric("项目周期 P90", "—", "天", "danger"),
      metric("在执项目数", project.available ? project.in_flight_projects : "—", "个"),
    ]
  }
  if (props.section === "report") {
    return [metric("报告周期 P50", "—", "天"), metric("首次通过率", "—", "%"), metric("未关闭投诉", "—", "项", "danger")]
  }
  return [metric("回款率", "—", "%"), metric("90 天以上应收", "—", "分", "danger"), metric("本月收入", "—", "分"), metric("部门成本", "—", "分")]
}
</script>

<template>
  <section class="da-native-dashboard">
    <div class="da-native-heading">
      <div>
        <p class="da-panel-kicker">{{ sectionMeta[section].title }}</p>
        <h2>{{ sectionMeta[section].description }}</h2>
      </div>
      <span class="da-badge neutral">数据状态：{{ section === 'overview' ? '聚合快照' : '数据源待接入' }}</span>
    </div>

    <div class="da-native-metrics">
      <article v-for="item in metricsForSection()" :key="item.label" class="da-native-metric" :class="item.tone">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong><small>{{ item.suffix }}</small>
      </article>
    </div>

    <div class="da-native-columns">
      <article class="da-native-panel">
        <header><b>{{ section === 'overview' ? '签约与项目趋势' : section === 'contract' ? '签约金额趋势' : section === 'project' ? '项目状态分布' : section === 'report' ? '质量效率分析' : '经营回款分析' }}</b><span>{{ section === 'contract' ? '同比/环比 · 含税万元' : section === 'project' ? 'T+1 快照' : 'T+1 · 指标口径见字典' }}</span></header>
        <div class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>{{ section === 'overview' ? '等待完整趋势快照' : '该主题数据源尚未接入' }}</b><p>当前先展示指标结构，接入对应聚合事实表后会自动填充。</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>{{ section === 'overview' ? '预警聚合' : section === 'contract' ? '区域分布' : section === 'project' ? '交付周期（天）· 维度：团队/项目经理' : section === 'report' ? '退回原因分布' : '应收账款账龄' }}</b><span>{{ section === 'contract' ? '金额 ↔ 数量可切换' : '只读' }}</span></header>
        <div class="da-native-bars">
          <div v-for="label in (section === 'overview' ? ['合同到期', '回款逾期', '交付延期'] : section === 'contract' ? ['华东', '华南', '华北', '未知区域'] : section === 'project' ? ['平均', 'P50', 'P90'] : section === 'report' ? ['技术问题', '客户补充', '流程校验'] : ['0-30 天', '31-90 天', '>90 天'])" :key="label" class="da-native-bar-row">
            <span>{{ label }}</span><i><em></em></i><small>—</small>
          </div>
        </div>
        <p class="da-native-note">暂无可用快照，不使用演示数据填充业务指标。</p>
      </article>
    </div>
    <div v-if="section === 'contract' || section === 'project'" class="da-native-columns da-native-secondary">
      <article class="da-native-panel">
        <header><b>{{ section === 'contract' ? '商机→合同转化率漏斗' : '返工率（报告退回+现场重测）' }}</b><span>聚合级</span></header>
        <div class="da-native-empty"><span class="da-native-empty-icon">⌁</span><b>暂无明细快照</b><p>接入对应事实表后展示分布与下钻数据。</p></div>
      </article>
      <article class="da-native-panel">
        <header><b>{{ section === 'contract' ? '折扣分析（区间分布）' : '人员 / 设备利用率（本月）' }}</b><span>只读</span></header>
        <div class="da-native-bars">
          <div v-for="label in (section === 'contract' ? ['0%', '1-5%', '5-10%', '>10%'] : ['人员利用率', '设备利用率'])" :key="label" class="da-native-bar-row"><span>{{ label }}</span><i><em></em></i><small>—</small></div>
        </div>
        <p class="da-native-note">暂无可用快照，不使用演示数据填充业务指标。</p>
      </article>
    </div>
    <div v-if="section === 'contract' || section === 'project'" class="da-native-panel da-native-table-panel">
      <header><b>{{ section === 'contract' ? '合同列表（下钻明细）' : '项目执行明细' }}</b><span>聚合级 · 不含敏感字段</span></header>
      <div class="da-native-empty"><b>暂无明细数据</b><p>当前租户没有可展示的{{ section === 'contract' ? '合同' : '项目' }}记录。</p></div>
    </div>
  </section>
</template>
