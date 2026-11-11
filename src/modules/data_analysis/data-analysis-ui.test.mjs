// 数据看板模块 UI/行为约定测试（node:test + 源码断言，对齐 contract_management/*-ui.test.mjs 模式）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const shell = await readFile(new URL('./views/DashboardShellView.vue', import.meta.url), 'utf8')
const native = await readFile(new URL('./views/NativeDashboardView.vue', import.meta.url), 'utf8')
const alerts = await readFile(new URL('./views/AlertsCenterView.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/dataAnalysis.js', import.meta.url), 'utf8')
const freshness = await readFile(new URL('./utils/freshness.js', import.meta.url), 'utf8')

test('看板 iframe 只经嵌入桥代理加载，不直连 Metabase', () => {
  assert.match(shell, /getEmbedToken\(code\)/)
  assert.match(shell, /isolatedEmbedUrl\(embedUrl, token, window.location.origin\)/)
  assert.doesNotMatch(shell, /https?:\/\/.*metabase/i) // 无 Metabase 直连 URL
  assert.match(shell, /sandbox="allow-scripts allow-same-origin"/) // 仅允许独立隔离的源；不允许表单、弹窗或顶层导航。
  assert.match(shell, /referrerpolicy="no-referrer"/)
  assert.match(shell, /expires_at: expiresAt/)
  assert.match(shell, /scheduleEmbedRenewal/)
  assert.match(shell, /visibilitychange/)
  assert.match(shell, /subscribeRelatedDataChanges/)
  assert.match(shell, /RELATED_DATA\.ORGANIZATIONS/)
})

test('看板 code 映射覆盖经营总览与 4 张业务看板', () => {
  for (const code of ['overview', 'contract', 'project', 'report', 'finance']) {
    assert.match(shell, new RegExp(`${code}: '${code}'`))
  }
})

test('预警中心实现 OPEN→ACK→CLOSED 闭环并按严重度排序', () => {
  assert.match(alerts, /getAlerts\(\{ page: page\.value, page_size: pageSize, severity: severityFilter\.value, status: statusFilter\.value \}\)/)
  assert.match(alerts, /getAlertSummary\(\)/)
  // 翻页不再由视图手写「上一页 / 下一页」按钮：页码与禁用语义交给 shared/components/PaginationBar.vue。
  assert.match(alerts, /import PaginationBar from "@\/modules\/shared\/components\/PaginationBar\.vue"/)
  assert.match(alerts, /<PaginationBar label="预警列表分页" :page="page" :total="total" :page-size="pageSize" :loading="loading" @change="changePage" \/>/)
  assert.doesNotMatch(alerts, />上一页<\/button>/)
  assert.doesNotMatch(alerts, />下一页<\/button>/)
  assert.match(alerts, /item\.status === 'OPEN'/)
  assert.match(alerts, /@click="onAck\(item\.id\)"/)
  assert.match(alerts, /@click="onClose\(item\.id\)"/)
  assert.match(alerts, /ackAlert\(id\)/)
  assert.match(alerts, /closeAlert\(id\)/)
  assert.match(alerts, /item\.severity\.toLowerCase\(\)/)
})

test('API 客户端使用看板子系统前缀与 HttpOnly Cookie 会话', () => {
  assert.ok(api.includes("'/data_analysis'"))
  assert.ok(api.includes("credentials: 'include'"))
  assert.ok(api.includes('startDataAnalysisLogin()'))
  assert.ok(api.includes("window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login`)"))
})

test('401 由 API 客户端触发 OIDC 登录跳转（fail-closed）', () => {
  assert.match(api, /if \(!suppressLoginRedirect && shouldStartSubsystemLogin\(error\)\) startDataAnalysisLogin\(\)/)
  assert.doesNotMatch(api, /if \(response\.status === 401\) startDataAnalysisLogin\(\)/)
})

test('接口路径与设计方案 §9 一致', () => {
  assert.ok(api.includes('/embed/'))
  assert.ok(api.includes('/alerts'))
  assert.ok(api.includes("'/alert-rules'"))
  assert.ok(api.includes("'/dictionary'"))
  assert.ok(api.includes("'/admin/sources'"))
  assert.ok(api.includes("'/auth/me'"))
})

test('合同和项目看板展示聚合库最新摘要', () => {
  assert.match(api, /getContractDashboardSummary\(\).*dashboard\/contract/s)
  assert.match(api, /getProjectDashboardSummary\(\).*dashboard\/project/s)
  assert.match(shell, /getContractDashboardSummary/)
  assert.match(shell, /getProjectDashboardSummary/)
  assert.match(native, /合同总数/)
  assert.match(native, /项目总数/)
  for (const field of ['total_amount_minor', 'total_contracts', 'approval_contracts', 'active_contracts', 'expired_contracts']) {
    assert.match(native, new RegExp(`contract\\.${field}`))
  }
  for (const field of ['project_count', 'in_flight_projects', 'risk_projects', 'service_items', 'status_counts']) {
    assert.match(native, new RegExp(`project(?:Summary)?[^\\n]*${field}|project\\.${field}`))
  }
  // 项目分区新增「整改中项目」卡：只读后端可选字段 report_stage_counts，缺失时显示未采集。
  assert.match(native, /report_stage_counts/)
  assert.match(native, /整改中项目/)
  assert.match(native, /未采集/)
  assert.match(native, /formatAmountMinor/)
  assert.match(native, /currency_totals/)
  assert.match(native, /dashboardFreshnessItems/)
  assert.match(native, /dashboardFreshnessStatus/)
  assert.match(native, /trendCurrencies/)
  assert.match(native, /barWidth\(item\.value\)/)
})

test('NativeDashboardView 模板可编译，时间口径面板可用于真实渲染', () => {
  const { descriptor, errors } = parse(native, { filename: 'NativeDashboardView.vue' })
  assert.deepEqual(errors, [])
  // 指标卡开关接入了更多响应式状态：脚本也要能编译，避免模板能过、脚本语法坏掉。
  const script = compileScript(descriptor, { id: 'native-dashboard' })
  assert.ok(script.content.includes('setup('))
  const compiled = compileTemplate({ source: descriptor.template.content, filename: 'NativeDashboardView.vue', id: 'native-dashboard', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(compiled.errors, [])
})

test('数析时间口径区分源更新、同步与查询时间并标记陈旧数据', () => {
  assert.match(native, /summaryFreshnessItems/)
  assert.match(native, /summaryFreshness\.stale/)
  assert.match(native, /summaryFreshness\.badge/)
  assert.match(freshness, /数据可能已过期/)
  assert.match(native, /本次查询时间不代表源数据更新时间/)
  assert.doesNotMatch(native, /数据更新时间 \{\{/)
  assert.match(freshness, /label: '源数据更新'/)
  assert.match(freshness, /label: '最近成功同步'/)
  assert.match(freshness, /label: '本次查询计算'/)
  assert.match(freshness, /staleReason/)
  assert.match(freshness, /legacySnapshotAt/)
})

test('经营总览无预警权限时静默跳过可选预警摘要', () => {
  assert.match(shell, /hasPermission\("alert\.view"\) \? getAlertSummary\(\) : Promise\.resolve\(null\)/)
  assert.doesNotMatch(shell, /hasPermission\("alert\.view"\) \? getAlertSummary\(\) : Promise\.reject/)
})

test('合同下钻明细将状态码转换为中文并保留未知状态原值', () => {
  assert.match(native, /const CONTRACT_STATUS_LABELS = \{/)
  assert.match(native, /PENDING: "待审批"/)
  assert.match(native, /DRAFT: "草稿"/)
  assert.match(native, /ACTIVE: "生效中"/)
  assert.match(native, /ARCHIVED: "已归档"/)
  assert.match(native, /function contractStatusLabel\(value\)/)
  assert.match(native, /contractStatusLabel\(item\.status\)/)
})

test('页面只展示后端真实支持的状态筛选，不保留无效时间、区域和角色控件', () => {
  assert.match(shell, /const statusOptions = computed/)
  assert.match(shell, /v-model="statusFilter"/)
  assert.match(shell, /:status-filter="statusFilter"/)
  assert.doesNotMatch(shell, /v-model="filters\.(?:period|region|role|status)"/)
  assert.match(native, /props\.statusFilter === "全部"/)
  assert.match(native, /items\.filter\(\(item\) => item\.label === props\.statusFilter\)/)
})

test('摘要和嵌入请求丢弃跨路由返回的旧响应', () => {
  assert.match(shell, /iframeRequestVersion/)
  assert.match(shell, /summaryRequestVersion/)
  assert.match(shell, /requestVersion !== iframeRequestVersion/)
  assert.match(shell, /requestVersion !== summaryRequestVersion/)
})

test('看板按权限控制角色可见分区并标示数据范围', () => {
  for (const code of ['overview', 'contract', 'project', 'report', 'finance']) {
    assert.match(shell, new RegExp(`${code}: "dashboard\\.${code}\\.view"`))
  }
  assert.match(shell, /visibleDashboardSections/)
  assert.match(shell, /SCOPE_MODE_LABELS/)
  assert.doesNotMatch(shell, /ROLE_SCOPE_LABELS/)
  assert.match(shell, /scope_mode/)
  assert.match(shell, /Promise\.allSettled/)
})

test('权限管理的子视图都接收会话 permissions，指标字典保留维护入口', () => {
  // 回归：2026-08-18 的只读字典版本挂载 DictionaryView 时未传 permissions，
  // 2026-10-08 给组件增加 dictionary.manage 编辑能力后外壳未同步传参，
  // 导致具备维护权限的管理员也看不到新建/编辑/启停/删除入口。
  for (const view of ['AlertsCenterView', 'DictionaryView', 'AdminSourcesView', 'AlertRulesView']) {
    assert.match(
      shell,
      new RegExp(`<${view}\\b[^>]*\\s:permissions="permissions"`),
      `${view} 挂载时必须传入当前会话 permissions`,
    )
  }
})

test('摘要无快照时仍展示合同指标卡，不依赖 Metabase 嵌入内容', () => {
  assert.match(native, /暂无(?:可用|明细)?快照/)
  assert.match(shell, /dashboardSummary/)
})

test('合同和项目页面不申请或渲染嵌入看板', () => {
  assert.match(shell, /EMBEDDED_DASHBOARD_SECTIONS = DASHBOARD_SECTIONS\.filter/) 
  assert.match(shell, /!\['contract', 'project'\]\.includes\(code\)/)
  assert.match(shell, /if \(dashboardEmbedEnabled\.value && EMBEDDED_DASHBOARD_SECTIONS\.includes\(value\)\)/)
  assert.match(shell, /v-if="dashboardEmbedEnabled && EMBEDDED_DASHBOARD_SECTIONS\.includes\(section\)" class="da-frame-panel"/)
  assert.match(shell, /v-if="DASHBOARD_SECTIONS\.includes\(section\)" class="da-button"/)
})

test('总览、报告和财务页面提供高保真本地内容兜底', () => {
  assert.match(shell, /NativeDashboardView/)
  assert.match(shell, /\['overview', 'contract', 'project', 'report', 'finance'\]\.includes\(section\)/)
  assert.match(shell, /overviewSummary\.contract/)
  assert.match(shell, /overviewSummary\.project/)
})

test('ensureDataAnalysisSession on plain 401 triggers OIDC login instead of silent null', () => {
  // 修复前：ensureDataAnalysisSession 对任何 401 都返回 null，不发起跳转 →
  // 用户点击看板卡片后路由守卫静默中止跳转、新标签页空白。
  // 修复后：必须复用 shouldStartSubsystemLogin 分类器，仅对 UNAUTHENTICATED
  // 发起 startDataAnalysisLogin()，OIDC_CLAIMS_INVALID 等特殊码仍按错误页处理。
  assert.match(api, /import \{ shouldStartSubsystemLogin \}/)
  assert.match(
    api,
    /shouldStartSubsystemLogin\(error\)\)\s*\{\s*startDataAnalysisLogin\(\)\s*;?\s*return null\s*;?\s*\}/,
  )
  assert.doesNotMatch(api, /if \(error\.status === 401\) return null/)
})
