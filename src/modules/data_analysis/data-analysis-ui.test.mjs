// 数据看板模块 UI/行为约定测试（node:test + 源码断言，对齐 contract_management/*-ui.test.mjs 模式）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const shell = await readFile(new URL('./views/DashboardShellView.vue', import.meta.url), 'utf8')
const native = await readFile(new URL('./views/NativeDashboardView.vue', import.meta.url), 'utf8')
const alerts = await readFile(new URL('./views/AlertsCenterView.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/dataAnalysis.js', import.meta.url), 'utf8')

test('看板 iframe 只经嵌入桥代理加载，不直连 Metabase', () => {
  assert.match(shell, /getEmbedToken\(code\)/)
  assert.match(shell, /embed-proxy/)
  assert.doesNotMatch(shell, /https?:\/\/.*metabase/i) // 无 Metabase 直连 URL
  assert.match(shell, /sandbox="allow-scripts allow-forms allow-popups"/) // 无 allow-same-origin，iframe 内容视为 opaque origin
  assert.match(shell, /referrerpolicy="no-referrer"/)
})

test('看板 code 映射覆盖经营总览与 4 张业务看板', () => {
  for (const code of ['overview', 'contract', 'project', 'report', 'finance']) {
    assert.match(shell, new RegExp(`${code}: '${code}'`))
  }
})

test('预警中心实现 OPEN→ACK→CLOSED 闭环并按严重度排序', () => {
  assert.match(alerts, /getAlerts\(\{ sort: 'severity,due_date', direction: 'desc,asc' \}\)/)
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
  assert.match(api, /response\.status === 401/)
  assert.match(api, /if \(response\.status === 401\) startDataAnalysisLogin\(\)/)
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
  assert.match(native, /formatAmountMinor/)
  assert.match(native, /formatSnapshotAt/)
  assert.match(native, /barWidth\(item\.value\)/)
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
  assert.match(shell, /ROLE_SCOPE_LABELS/)
  assert.match(shell, /本人及下属组织/)
  assert.match(shell, /管辖团队/)
  assert.match(shell, /Promise\.allSettled/)
})

test('摘要无快照时仍展示合同指标卡，不依赖 Metabase 嵌入内容', () => {
  assert.match(native, /暂无(?:可用|明细)?快照/)
  assert.match(shell, /dashboardSummary/)
})

test('合同和项目页面不申请或渲染嵌入看板', () => {
  assert.match(shell, /EMBEDDED_DASHBOARD_SECTIONS = DASHBOARD_SECTIONS\.filter/) 
  assert.match(shell, /!\['contract', 'project'\]\.includes\(code\)/)
  assert.match(shell, /if \(EMBEDDED_DASHBOARD_SECTIONS\.includes\(value\)\)/)
  assert.match(shell, /v-if="EMBEDDED_DASHBOARD_SECTIONS\.includes\(section\)" class="da-frame-panel"/)
  assert.match(shell, /v-if="DASHBOARD_SECTIONS\.includes\(section\)" class="da-button"/)
})

test('总览、报告和财务页面提供高保真本地内容兜底', () => {
  assert.match(shell, /NativeDashboardView/)
  assert.match(shell, /\['overview', 'contract', 'project', 'report', 'finance'\]\.includes\(section\)/)
  assert.match(shell, /overviewSummary\.contract/)
  assert.match(shell, /overviewSummary\.project/)
})
