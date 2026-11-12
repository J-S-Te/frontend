// 项目管理原型视觉证据（手工夹具，不进 CI）。
// 用真实 ProjectManagementView + 真实模块 CSS，路由与所有后端请求替换为隔离替身；
// 不连接业务服务、不写业务数据。按 1440/1024/768/390 多档视口与浅/深色输出截图，
// 结果写入 .ai/qa/pm-prototype-restyle-20261112/screenshots/results.json。
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const outputDir = process.env.PAGE_OUTPUT_DIR
  || fileURLToPath(new URL('../../../../.ai/qa/pm-prototype-restyle-20261112/screenshots/', import.meta.url))
const widthList = (process.env.PAGE_WIDTHS || '1440,390').split(',').map(Number)
const selectedCases = (process.env.PAGE_CASES || '').split(',').filter(Boolean)
const themes = (process.env.PAGE_THEMES || 'light,dark').split(',').filter(Boolean)
const componentStyles = new Map()

const cases = [
  { key: 'dashboard', section: 'dashboard' },
  { key: 'monitoring', section: 'monitoring' },
  { key: 'projects', section: 'projects' },
  { key: 'project-detail', section: 'project_detail', query: { project: 'PJ-2026-0823' } },
  { key: 'decomposition', section: 'decomposition' },
  { key: 'allocation', section: 'allocation' },
  { key: 'inbox', section: 'inbox' },
  { key: 'planning', section: 'planning' },
  { key: 'preparation', section: 'preparation' },
  { key: 'qualifications', section: 'qualifications' },
  { key: 'equipment', section: 'equipment' },
  { key: 'assignments', section: 'assignments' },
  { key: 'methods', section: 'methods' },
  { key: 'implementation', section: 'implementation' },
  { key: 'exceptions', section: 'exceptions' },
  { key: 'standards', section: 'standards' },
  { key: 'reports', section: 'reports' },
  { key: 'split-rules', section: 'split-rules' },
  { key: 'config-warning-rules', section: 'warning-rules' },
  { key: 'config-automations', section: 'automations' },
  { key: 'config-permissions', section: 'permissions' },
  { key: 'config-sla', section: 'sla' },
  { key: 'config-capability-codes', section: 'capability-codes' },
  { key: 'notifications', section: 'notifications' },
]

const routerStub = `import { h, reactive } from 'vue'
export const __route = reactive({ params: { section: 'dashboard' }, query: {} })
export function __setRoute(section, query = {}) {
  __route.params = { section }
  __route.query = query
  __route.fullPath = '/project_management/' + section
  __route.path = '/project_management/' + section
}
export function useRoute() { return __route }
export function useRouter() {
  return {
    push(to) {
      if (to?.name === 'project_management') __setRoute(to.params?.section || 'dashboard', to.query || {})
      else if (to?.params?.section) __setRoute(to.params.section, to.query || {})
      return Promise.resolve()
    },
    replace(to) {
      if (to?.name === 'project_management') __setRoute(to.params?.section || 'dashboard', to.query || {})
      else if (to?.params?.section) __setRoute(to.params.section, to.query || {})
      else __route.query = to?.query || __route.query
      return Promise.resolve()
    },
  }
}
export function onBeforeRouteLeave() {}
export const RouterLink = { props: ['to'], setup(_props, { slots }) { return () => h('a', {}, slots.default?.()) } }
`

const entry = `import { createApp } from 'vue'
import View from './src/modules/project_management/views/ProjectManagementView.vue'
import { __setRoute, RouterLink } from 'vue-router'
import './src/modules/platform/shared/styles/main.css'
import './src/modules/platform/shared/styles/state.css'
import './src/modules/shared/styles/global-ux.css'
import './src/modules/project_management/styles/project-management.css'
window.__mountPM = ({ section, query = {} }) => {
  __setRoute(section, query)
  const app = createApp(View)
  app.component('RouterLink', RouterLink)
  app.mount('#app')
  return app
}
`

const NOW = '2026-11-12T10:30:00+08:00'
const PEOPLE = {
  'u-lead-1': '李伟', 'u-lead-2': '周敏', 'u-pm-1': '张磊', 'u-pm-2': '王明', 'u-pm-3': '李娜',
  'u-eng-1': '陈静', 'u-eng-2': '赵磊', 'u-eng-3': '孙悦', 'u-eng-4': '刘洋', 'u-eng-5': '吴倩',
  'u-tech-1': '郑昊',
}
const session = {
  tenant_id: 'tenant-demo', identity_id: 'actor-pm', subject_id: 'actor-pm',
  username: '张磊', display_name: '张磊',
  roles: ['admin', 'business_admin', 'project_manager', 'technical_director', 'team_lead', 'engineer'],
  permissions: [
    'project.read', 'project.create', 'project.contract.import', 'project.decomposition.manage',
    'service_item.confirm', 'project.team.assign', 'project.team.revoke', 'project.execution.assign',
    'project.execution.revoke', 'project.implementation.plan', 'project.implementation.revoke',
    'project.field.execute', 'project.field.complete', 'project.deviation.report', 'project.deviation.review',
    'project.report.prepare', 'project.report.review', 'project.report.issue', 'project.report.archive',
    'project.report.correction.request', 'project.report.correction.approve',
    'project.special_method.review', 'project.resource.manage', 'project.resource.read',
    'project.device.manage', 'project.device.read', 'project_rule.manage', 'project.field_permission.manage',
    'project.capability_code.manage', 'project.rollback.request', 'project.rollback.approve',
    'project.native_scope.approve', 'project.expense_participant.manage', 'project.reimbursement_spend.read',
    'project.person_capacity.manage', 'project.equipment_capacity.manage', 'project.resource_usage.record',
    'project.resource_usage.confirm',
  ],
  data_scopes: [{ type: 'TENANT', id: 'tenant-demo' }],
  authorization_revision: 12, catalog_version: 'v2026.11', idle_timeout_seconds: 3600,
}

const projects = [
  { id: 'PJ-2026-0823', source_kind: 'CONTRACT', source_id: 'HT-2026-0408', scope_version: 2, owner_org_id: 'org-1',
    name: '某银行股份 2026 年度测评项目', customer: '某银行股份有限公司', customer_id: 'C-001', contract: 'HT-2026-0408',
    contract_id: 'contract-0408', contract_version: '3', services: 22, category: '等保测评 / 商用密码', team: '测评一组',
    manager: '张磊', status: '实施中', progress: 65, report_stage: '', due: '2026-08-15',
    created_at: '2026-05-10T09:00:00+08:00', updated_at: NOW, risk: false, version: 4 },
  { id: 'PJ-2026-0826', source_kind: 'CONTRACT', source_id: 'HT-2026-0410', scope_version: 1, owner_org_id: 'org-1',
    name: '某省政务云 2026 年度安全测评', customer: '某省政务云运营中心', customer_id: 'C-002', contract: 'HT-2026-0410',
    contract_id: 'contract-0410', contract_version: '2', services: 14, category: '渗透测试 / 应急响应', team: '渗透测试组',
    manager: '王明', status: '报告编制', progress: 88, report_stage: 'COMPILING', due: '2026-07-25',
    created_at: '2026-06-01T09:00:00+08:00', updated_at: NOW, risk: false, version: 6 },
  { id: 'PJ-2026-0841', source_kind: 'CONTRACT', source_id: 'HT-2026-0411', scope_version: 1, owner_org_id: 'org-1',
    name: '某市公积金核心系统测评', customer: '某市住房公积金管理中心', customer_id: 'C-003', contract: 'HT-2026-0411',
    contract_id: 'contract-0411', contract_version: '1', services: 8, category: '等保测评 / 商用密码 / 渗透测试', team: '测评二组',
    manager: '李娜', status: '待拆解确认', progress: 5, report_stage: '', due: '2026-09-30',
    created_at: '2026-07-15T10:23:11+08:00', updated_at: NOW, risk: false, version: 1 },
  { id: 'PJ-2026-0850', source_kind: 'CONTRACT', source_id: 'HT-2026-0402', scope_version: 3, owner_org_id: 'org-1',
    name: '某城商行系统安全测试', customer: '某城市商业银行', customer_id: 'C-004', contract: 'HT-2026-0402',
    contract_id: 'contract-0402', contract_version: '4', services: 9, category: '源代码审计 / 软件测试', team: '渗透测试组',
    manager: '陈静', status: '异常处理中', progress: 42, report_stage: '', due: '2026-07-10',
    created_at: '2026-04-20T09:00:00+08:00', updated_at: NOW, risk: true, version: 9 },
  { id: 'PJ-2026-0852', source_kind: 'CONTRACT', source_id: 'HT-2026-0414', scope_version: 1, owner_org_id: 'org-1',
    name: '某集团等保测评项目', customer: '某集团有限公司', customer_id: 'C-005', contract: 'HT-2026-0414',
    contract_id: 'contract-0414', contract_version: '1', services: 12, category: '等保测评', team: '测评二组',
    manager: '赵磊', status: '已完成', progress: 100, report_stage: 'ARCHIVED', due: '2026-06-30',
    created_at: '2026-03-02T09:00:00+08:00', updated_at: NOW, risk: false, version: 12 },
  { id: 'PJ-2026-0855', source_kind: 'CONTRACT', source_id: 'HT-2026-0405', scope_version: 1, owner_org_id: 'org-1',
    name: '某运营商商用密码评估', customer: '某通信运营商', customer_id: 'C-006', contract: 'HT-2026-0405',
    contract_id: 'contract-0405', contract_version: '2', services: 6, category: '等保测评 / 商用密码', team: '测评三组',
    manager: '孙悦', status: '待分配', progress: 10, report_stage: '', due: '2026-08-30',
    created_at: '2026-07-02T09:00:00+08:00', updated_at: NOW, risk: false, version: 2 },
  { id: 'PJ-2026-0860', source_kind: 'CONTRACT', source_id: 'HT-2026-0416', scope_version: 1, owner_org_id: 'org-1',
    name: '某省级医院信息系统测评', customer: '某省人民医院', customer_id: 'C-007', contract: 'HT-2026-0416',
    contract_id: 'contract-0416', contract_version: '1', services: 5, category: '等保测评 / 软件测试', team: '测评一组',
    manager: '张磊', status: '待实施', progress: 30, report_stage: '', due: '2026-09-15',
    created_at: '2026-07-20T09:00:00+08:00', updated_at: NOW, risk: false, version: 3 },
]

const plan = (start, end) => ({
  planned_start: start, planned_end: end, site_plan: '中心机房 + 灾备机房，需提前一个工作日预约门禁。',
  personnel: [
    { resource_type: 'PERSON', resource_id: 'R-PER-001', resource_name: '陈静', codes: ['CISP-PTE'], window_start: start, window_end: end, note: '主测' },
    { resource_type: 'PERSON', resource_id: 'R-PER-002', resource_name: '赵磊', codes: ['等保测评师'], window_start: start, window_end: end, note: '复核' },
  ],
  equipment: [
    { resource_type: 'EQUIPMENT', resource_id: 'EQ-PM-001', resource_name: '漏洞扫描设备 VS-01', codes: ['漏扫'], window_start: start, window_end: end, note: '' },
  ],
})

const serviceItems = [
  { id: 'SI-0823-01', project_id: 'PJ-2026-0823', batch: '第一批次', site: '某银行股份 - 中心机房', category: '等保测评（三级）',
    requirement: '核心业务系统 4 套，含 2 套三级系统物理部署 + 2 套云上系统，覆盖网络架构、主机安全、应用安全。', system: '核心业务系统',
    system_level: '三级', system_standard: 'ISO 27001', special: '否', test_mode: 'STANDARD', team_lead_id: 'u-lead-1',
    project_manager_id: 'u-pm-1', engineer_ids: ['u-eng-1', 'u-eng-2'], equipment_ids: ['EQ-PM-001'], required_codes: ['CISP-PTE'],
    planned_start: '2026-08-01', planned_end: '2026-08-15', conflict_status: 'PASSED', tech_review_status: 'NOT_REQUIRED',
    report_status: 'NONE', report_revision: 0, status: '实施中', implementation_plan: plan('2026-08-01', '2026-08-15'), version: 5 },
  { id: 'SI-0823-02', project_id: 'PJ-2026-0823', batch: '第一批次', site: '某银行股份 - 中心机房', category: '商用密码应用安全性评估',
    requirement: '核心支付系统商用密码应用合规性评估，覆盖物理、网络、设备、应用四个层面。', system: '支付系统',
    system_level: '三级', system_standard: '商用密码', special: '是', test_mode: 'STANDARD', team_lead_id: 'u-lead-1',
    project_manager_id: 'u-pm-1', engineer_ids: ['u-eng-3'], required_codes: ['商用密码评估'], planned_start: '2026-08-05',
    planned_end: '2026-08-20', conflict_status: 'PASSED', tech_review_status: 'PENDING', report_status: 'NONE', report_revision: 0,
    status: '待分配', version: 2 },
  { id: 'SI-0823-03', project_id: 'PJ-2026-0823', batch: '第二批次', site: '某银行股份 - 灾备机房', category: '等保测评（三级）',
    requirement: '灾备中心基础设施测评，含机房环境与网络边界。', system: '灾备系统', system_level: '三级',
    system_standard: 'ISO 27001', special: '否', test_mode: 'STANDARD', team_lead_id: 'u-lead-1', project_manager_id: 'u-pm-1',
    engineer_ids: ['u-eng-2'], planned_start: '2026-08-16', planned_end: '2026-08-28', conflict_status: 'CONFLICT',
    tech_review_status: 'NOT_REQUIRED', report_status: 'NONE', report_revision: 0, status: '待实施', version: 2 },
  { id: 'SI-0823-04', project_id: 'PJ-2026-0823', batch: '第二批次', site: '某银行股份 - 上海分行', category: '软件测试',
    requirement: '移动银行 APP 功能与安全测试，覆盖 12 个核心场景。', system: '移动银行 APP', system_level: '二级',
    system_standard: 'ISO 9001', special: '否', test_mode: 'STANDARD', team_lead_id: 'u-lead-1', project_manager_id: 'u-pm-1',
    engineer_ids: ['u-eng-4'], planned_start: '2026-08-18', planned_end: '2026-08-30', conflict_status: 'PASSED',
    tech_review_status: 'NOT_REQUIRED', report_status: 'COMPILING', report_revision: 1, status: '报告编制', version: 4 },
  { id: 'SI-0823-05', project_id: 'PJ-2026-0823', batch: '第三批次', site: '某银行股份 - 杭州分行', category: '渗透测试',
    requirement: '外网系统黑盒渗透测试，测试窗口 08-10 ~ 08-25。', system: '门户网站', system_level: '三级',
    system_standard: 'ISO 27001', special: '是', test_mode: 'PENETRATION', team_lead_id: 'u-lead-1', project_manager_id: 'u-pm-1',
    engineer_ids: ['u-eng-1'], planned_start: '2026-08-10', planned_end: '2026-08-25', conflict_status: 'PASSED',
    tech_review_status: 'APPROVED', tech_reviewed_at: '2026-08-08T16:20:00+08:00', tech_reviewed_by: '郑昊',
    tech_review_comment: '授权范围与回滚方案已确认。', report_status: 'NONE', report_revision: 0, status: '异常处理中', version: 6,
    penetration_work_package: { decision_status: 'REQUIRED', execution_stage: 'EXECUTING', report_status: 'NONE', version: 2 } },
  { id: 'SI-0823-06', project_id: 'PJ-2026-0823', batch: '第三批次', site: '某银行股份 - 南京分行', category: '漏洞扫描',
    requirement: '内网资产漏洞扫描与复测。', system: '办公网', system_level: '二级', system_standard: 'ISO 27001',
    special: '否', test_mode: 'STANDARD', team_lead_id: 'u-lead-1', project_manager_id: 'u-pm-1', engineer_ids: ['u-eng-3'],
    planned_start: '2026-08-20', planned_end: '2026-09-05', conflict_status: 'PASSED', tech_review_status: 'NOT_REQUIRED',
    report_status: 'NONE', report_revision: 0, status: '现场实施完成', version: 3 },
  { id: 'SI-0841-01', project_id: 'PJ-2026-0841', batch: '第一批次', site: '某市公积金 - 中心机房', category: '等保测评（三级）',
    requirement: '核心业务系统 4 套（公积金归集、提取、贷款、稽核），含 2 套三级系统物理部署。', system: '公积金核心系统',
    system_level: '三级', system_standard: 'ISO 27001', special: '否', test_mode: 'STANDARD', report_status: 'NONE',
    report_revision: 0, status: '待确认', version: 1 },
  { id: 'SI-0841-02', project_id: 'PJ-2026-0841', batch: '第一批次', site: '某市公积金 - 中心机房', category: '商用密码应用安全性评估',
    requirement: '密码应用方案与实现一致性评估。', system: '公积金核心系统', system_level: '三级', system_standard: '商用密码',
    special: '是', test_mode: 'STANDARD', report_status: 'NONE', report_revision: 0, status: '待确认', version: 1 },
  { id: 'SI-0841-03', project_id: 'PJ-2026-0841', batch: '第二批次', site: '某市公积金 - 异地灾备', category: '渗透测试',
    requirement: '互联网服务黑盒渗透测试。', system: '网上办事大厅', system_level: '三级', system_standard: 'ISO 27001',
    special: '是', test_mode: 'PENETRATION', report_status: 'NONE', report_revision: 0, status: '待确认', version: 1 },
  { id: 'SI-0850-01', project_id: 'PJ-2026-0850', batch: '第一批次', site: '某城商行 - 总行', category: '源代码审计',
    requirement: '手机银行 iOS/Android 客户端源码审计，覆盖 8 个模块。', system: '手机银行', system_level: '三级',
    system_standard: '等保 2.0', special: '否', test_mode: 'STANDARD', team_lead_id: 'u-lead-2', project_manager_id: 'u-pm-2',
    engineer_ids: ['u-eng-1'], planned_start: '2026-07-20', planned_end: '2026-08-02', conflict_status: 'PASSED',
    tech_review_status: 'NOT_REQUIRED', report_status: 'NONE', report_revision: 0, status: '实施中', version: 4 },
  { id: 'SI-0850-02', project_id: 'PJ-2026-0850', batch: '第二批次', site: '某城商行 - 总行', category: '软件测试',
    requirement: '信贷系统功能测试与性能抽测。', system: '信贷系统', system_level: '三级', system_standard: 'ISO 9001',
    special: '否', test_mode: 'STANDARD', team_lead_id: 'u-lead-2', project_manager_id: 'u-pm-2', engineer_ids: ['u-eng-2'],
    planned_start: '2026-08-03', planned_end: '2026-08-20', conflict_status: 'CONFLICT', tech_review_status: 'NOT_REQUIRED',
    report_status: 'RECTIFYING', report_revision: 2, status: '报告编制', version: 5 },
  { id: 'SI-0852-01', project_id: 'PJ-2026-0852', batch: '第一批次', site: '某集团 - 总部', category: '等保测评（三级）',
    requirement: '集团门户与 ERP 系统测评。', system: '集团门户', system_level: '三级', system_standard: 'ISO 27001',
    special: '否', test_mode: 'STANDARD', team_lead_id: 'u-lead-2', project_manager_id: 'u-pm-3', engineer_ids: ['u-eng-3'],
    planned_start: '2026-05-10', planned_end: '2026-06-20', conflict_status: 'PASSED', tech_review_status: 'NOT_REQUIRED',
    report_status: 'ARCHIVED', report_revision: 2, report_updated_at: '2026-06-28T10:00:00+08:00', status: '已完成', version: 9 },
  { id: 'SI-0855-01', project_id: 'PJ-2026-0855', batch: '第一批次', site: '某运营商 - 核心机房', category: '等保测评（三级）',
    requirement: '核心网元测评，含 6 套三级系统。', system: '核心网', system_level: '三级', system_standard: '等保 2.0',
    special: '否', test_mode: 'STANDARD', report_status: 'NONE', report_revision: 0, status: '待分配', version: 1 },
  { id: 'SI-0855-02', project_id: 'PJ-2026-0855', batch: '第一批次', site: '某运营商 - 核心机房', category: '商用密码应用安全性评估',
    requirement: '密码应用安全性评估。', system: '核心网', system_level: '三级', system_standard: '商用密码', special: '是',
    test_mode: 'STANDARD', report_status: 'NONE', report_revision: 0, status: '待分配', conflict_status: 'PASSED',
    tech_review_status: 'REJECTED', tech_review_comment: '补充授权范围与测试窗口后重新提交。', version: 2 },
  { id: 'SI-0855-03', project_id: 'PJ-2026-0855', batch: '第二批次', site: '某运营商 - 核心机房', category: '等保测评（三级）',
    requirement: '核心网测评，含 6 套三级系统。', system: '核心网', system_level: '三级', system_standard: '等保 2.0', special: '否',
    test_mode: 'STANDARD', team_lead_id: 'u-lead-1', project_manager_id: 'u-pm-1', engineer_ids: ['u-eng-1', 'u-eng-2'],
    planned_start: '2026-08-20', planned_end: '2026-09-05', conflict_status: 'PASSED', tech_review_status: 'NOT_REQUIRED',
    report_status: 'NONE', report_revision: 0, status: '待分配', version: 2 },
  { id: 'SI-0855-04', project_id: 'PJ-2026-0855', batch: '第二批次', site: '某运营商 - 核心机房', category: '漏洞扫描',
    requirement: '核心网资产漏洞扫描与复测。', system: '核心网', system_level: '三级', system_standard: 'ISO 27001', special: '否',
    test_mode: 'STANDARD', team_lead_id: 'u-lead-2', conflict_status: 'PASSED', tech_review_status: 'NOT_REQUIRED',
    report_status: 'NONE', report_revision: 0, status: '待分配', version: 1 },
  { id: 'SI-0855-05', project_id: 'PJ-2026-0855', batch: '第三批次', site: '某运营商 - 网管中心', category: '渗透测试',
    requirement: '网管支撑系统黑盒渗透测试。', system: '网管系统', system_level: '三级', system_standard: 'ISO 27001', special: '是',
    test_mode: 'PENETRATION', team_lead_id: 'u-lead-1', project_manager_id: 'u-pm-2', engineer_ids: ['u-eng-1'],
    planned_start: '2026-08-25', planned_end: '2026-09-10', conflict_status: 'CONFLICT', tech_review_status: 'PENDING',
    report_status: 'NONE', report_revision: 0, status: '待分配', version: 2 },
  { id: 'SI-0860-01', project_id: 'PJ-2026-0860', batch: '第一批次', site: '某省人民医院 - 数据中心', category: '等保测评（三级）',
    requirement: 'HIS 与电子病历系统测评，含 5 套三级系统。', system: 'HIS 核心系统', system_level: '三级', system_standard: 'ISO 27001',
    special: '否', test_mode: 'STANDARD', team_lead_id: 'u-lead-1', project_manager_id: 'u-pm-1', engineer_ids: ['u-eng-2'],
    planned_start: '2026-08-18', planned_end: '2026-09-02', conflict_status: 'PASSED', tech_review_status: 'NOT_REQUIRED',
    report_status: 'NONE', report_revision: 0, status: '待实施', version: 3 },
  { id: 'SI-0826-01', project_id: 'PJ-2026-0826', batch: '第一批次', site: '某省政务云 - 运营中心', category: '渗透测试',
    requirement: '政务云互联网边界渗透测试。', system: '政务云门户', system_level: '三级', system_standard: 'ISO 27001', special: '是',
    test_mode: 'PENETRATION', team_lead_id: 'u-lead-2', project_manager_id: 'u-pm-2', engineer_ids: ['u-eng-1'],
    planned_start: '2026-07-05', planned_end: '2026-07-20', conflict_status: 'PASSED', tech_review_status: 'APPROVED',
    report_status: 'COMPILING', report_revision: 1, status: '报告编制', version: 5 },
  { id: 'SI-0826-02', project_id: 'PJ-2026-0826', batch: '第二批次', site: '某省政务云 - 运营中心', category: '等保测评（三级）',
    requirement: '政务云平台等保测评。', system: '政务云平台', system_level: '三级', system_standard: '等保 2.0', special: '否',
    test_mode: 'STANDARD', team_lead_id: 'u-lead-2', project_manager_id: 'u-pm-2', engineer_ids: ['u-eng-3'],
    planned_start: '2026-07-01', planned_end: '2026-07-18', conflict_status: 'PASSED', tech_review_status: 'NOT_REQUIRED',
    report_status: 'RECTIFYING', report_revision: 2, status: '报告编制', version: 6 },
  { id: 'SI-0850-03', project_id: 'PJ-2026-0850', batch: '第二批次', site: '某城商行 - 总行', category: '渗透测试',
    requirement: '网上银行系统渗透测试。', system: '网上银行', system_level: '三级', system_standard: 'ISO 27001', special: '是',
    test_mode: 'PENETRATION', team_lead_id: 'u-lead-2', project_manager_id: 'u-pm-2', engineer_ids: ['u-eng-1'],
    planned_start: '2026-08-01', planned_end: '2026-08-12', conflict_status: 'PASSED', tech_review_status: 'APPROVED',
    report_status: 'NONE', report_revision: 0, status: '异常处理中', version: 4 },
]

const events = [
  { id: 'EV-1', project_id: 'PJ-2026-0823', service_item_id: 'SI-0823-01', type: 'TEAM_ASSIGNED', actor_user_id: 'u-tech-1', payload: { note: '按能力匹配' }, created_at: '2026-07-28T10:00:00+08:00' },
  { id: 'EV-2', project_id: 'PJ-2026-0823', service_item_id: 'SI-0823-01', type: 'IMPLEMENTATION_PLANNED', actor_user_id: 'u-pm-1', payload: {}, created_at: '2026-07-30T14:20:00+08:00' },
  { id: 'EV-3', project_id: 'PJ-2026-0823', service_item_id: 'SI-0823-01', type: 'FIELD_STARTED', actor_user_id: 'u-eng-1', payload: {}, created_at: '2026-08-01T09:10:00+08:00' },
  { id: 'EV-4', project_id: 'PJ-2026-0823', service_item_id: 'SI-0823-06', type: 'FIELD_COMPLETED', actor_user_id: 'u-eng-3', payload: {}, created_at: '2026-09-04T18:00:00+08:00' },
  { id: 'EV-5', project_id: 'PJ-2026-0823', service_item_id: 'SI-0823-05', type: 'DEVIATION_REPORTED', actor_user_id: 'u-eng-1',
    payload: { deviation_id: 'DV-2026-0078', description: '现场发现目标系统与授权范围不一致，暂停测试等待确认', severity: 'HIGH' },
    created_at: '2026-08-12T15:40:00+08:00' },
  { id: 'EV-6', project_id: 'PJ-2026-0850', service_item_id: 'SI-0850-01', type: 'FIELD_STARTED', actor_user_id: 'u-eng-1', payload: {}, created_at: '2026-07-21T09:00:00+08:00' },
  { id: 'EV-7', project_id: 'PJ-2026-0850', service_item_id: 'SI-0850-03', type: 'DEVIATION_REPORTED', actor_user_id: 'u-eng-1',
    payload: { deviation_id: 'DV-2026-0090', description: '目标系统存在未申报的互联网暴露面，暂停测试等待客户确认', severity: 'HIGH' },
    created_at: '2026-08-05T11:20:00+08:00' },
  { id: 'EV-8', project_id: 'PJ-2026-0860', service_item_id: 'SI-0860-01', type: 'PREPARATION_STARTED', actor_user_id: 'u-pm-1', payload: {}, created_at: '2026-08-12T09:00:00+08:00' },
  { id: 'EV-9', project_id: 'PJ-2026-0855', service_item_id: 'SI-0855-03', type: 'EXECUTION_TEAM_ASSIGNED', actor_user_id: 'u-lead-1', payload: {}, created_at: '2026-08-10T10:00:00+08:00' },
  { id: 'EV-10', project_id: 'PJ-2026-0826', service_item_id: 'SI-0826-01', type: 'REPORT_STATUS_UPDATED', actor_user_id: 'u-pm-2', payload: { report_status: 'COMPILING' }, created_at: '2026-07-22T16:00:00+08:00' },
]
const tasks = {
  'u-lead-1': [
    { resource_id: 'SI-0823-01', title: '核心系统测评', category: '等保测评', due: '2026-08-15', done: true },
    { resource_id: 'SI-0823-03', title: '灾备机房测评', category: '等保测评', due: '2026-08-28', done: false },
  ],
}
const capabilities = [
  { id: 'CAP-1', resource_type: 'PERSON', resource_id: 'R-PER-001', user_id: 'u-eng-1', resource_name: '陈静', codes: ['CISP-PTE', '等保测评师'],
    valid_from: '2025-01-01T00:00:00+08:00', valid_until: '2027-12-31T00:00:00+08:00', status: 'ACTIVE', effective_status: 'ACTIVE',
    usage_scope: 'ANY', identity_status: 'ACTIVE', updated_at: NOW },
  { id: 'CAP-2', resource_type: 'PERSON', resource_id: 'R-PER-002', user_id: 'u-eng-2', resource_name: '赵磊', codes: ['等保测评师'],
    valid_from: '2025-03-01T00:00:00+08:00', valid_until: '2026-12-31T00:00:00+08:00', status: 'ACTIVE', effective_status: 'ACTIVE',
    usage_scope: 'ANY', identity_status: 'ACTIVE', updated_at: NOW },
  { id: 'CAP-3', resource_type: 'PERSON', resource_id: 'R-PER-003', user_id: 'u-eng-3', resource_name: '孙悦', codes: ['商用密码评估'],
    valid_from: '2024-06-01T00:00:00+08:00', valid_until: '2026-05-31T00:00:00+08:00', status: 'ACTIVE', effective_status: 'EXPIRED',
    usage_scope: 'ANY', identity_status: 'MISSING', updated_at: NOW },
  { id: 'CAP-4', resource_type: 'PERSON', resource_id: 'R-PER-004', user_id: 'u-eng-4', resource_name: '刘洋', codes: ['软件评测师'],
    valid_from: '2025-01-01T00:00:00+08:00', valid_until: '2027-01-01T00:00:00+08:00', status: 'DISABLED', effective_status: 'DISABLED',
    usage_scope: 'ANY', identity_status: 'UNLINKED', updated_at: NOW },
  { id: 'CAP-5', resource_type: 'EQUIPMENT', resource_id: 'EQ-PM-001', resource_name: '漏洞扫描设备 VS-01', codes: ['漏扫'],
    valid_from: '2025-01-01T00:00:00+08:00', valid_until: '2026-12-31T00:00:00+08:00', status: 'ACTIVE', effective_status: 'ACTIVE',
    usage_scope: 'ANY', presence: 'IN_COMPANY', updated_at: NOW },
  { id: 'CAP-6', resource_type: 'EQUIPMENT', resource_id: 'EQ-PM-002', resource_name: '渗透测试笔记本 PT-02', codes: ['渗透'],
    valid_from: '2025-01-01T00:00:00+08:00', valid_until: '2026-11-30T00:00:00+08:00', status: 'ACTIVE', effective_status: 'ACTIVE',
    usage_scope: 'ANY', presence: 'OUT_OF_COMPANY', borrowed_by: 'PJ-2026-0823', borrowed_window: '08-10 ~ 08-25', updated_at: NOW },
  { id: 'CAP-7', resource_type: 'EQUIPMENT', resource_id: 'EQ-PM-003', resource_name: '密码测试工具 PT-03', codes: ['商密'],
    valid_from: '2025-01-01T00:00:00+08:00', valid_until: '2026-10-01T00:00:00+08:00', status: 'ACTIVE', effective_status: 'EXPIRED',
    usage_scope: 'COMPANY_ONLY', presence: 'IN_COMPANY', updated_at: NOW },
]
const personnel = [
  { user_id: 'u-lead-1', display_name: '李伟', role_code: 'team_lead', department: '测评一组' },
  { user_id: 'u-lead-2', display_name: '周敏', role_code: 'team_lead', department: '测评二组' },
  { user_id: 'u-pm-1', display_name: '张磊', role_code: 'project_manager', department: '测评一组' },
  { user_id: 'u-pm-2', display_name: '王明', role_code: 'project_manager', department: '渗透测试组' },
  { user_id: 'u-pm-3', display_name: '李娜', role_code: 'project_manager', department: '测评二组' },
  { user_id: 'u-eng-1', display_name: '陈静', role_code: 'engineer', department: '测评一组' },
  { user_id: 'u-eng-2', display_name: '赵磊', role_code: 'engineer', department: '测评二组' },
  { user_id: 'u-eng-3', display_name: '孙悦', role_code: 'engineer', department: '测评三组' },
  { user_id: 'u-eng-4', display_name: '刘洋', role_code: 'engineer', department: '测评二组' },
]
const detectionCategories = [
  { id: 1, category: '等保测评', system_standard: '等保 2.0', required_qualifications: '等级保护测评师（中级+）', required_codes: '等保测评师', special_method: 'NO', enabled: true, service_item_count: 124, updated: '2026-06-01' },
  { id: 2, category: '商用密码应用安全性评估', system_standard: '商用密码', required_qualifications: '商用密码评估人员', required_codes: '商用密码评估', special_method: 'MARKABLE', enabled: true, service_item_count: 32, updated: '2026-06-01' },
  { id: 3, category: '软件测试', system_standard: 'ISO 9001', required_qualifications: '软件评测师', required_codes: '软件评测师', special_method: 'NO', enabled: true, service_item_count: 48, updated: '2026-06-01' },
  { id: 4, category: '源代码审计', system_standard: '等保 2.0', required_qualifications: '等级保护测评师（中级+）', required_codes: '', special_method: 'NO', enabled: true, service_item_count: 18, updated: '2026-06-01' },
  { id: 5, category: '渗透测试', system_standard: 'ISO 27001', required_qualifications: 'CISP-PTE', required_codes: 'CISP-PTE', special_method: 'REQUIRED', enabled: true, service_item_count: 23, updated: '2026-06-01' },
  { id: 6, category: '漏洞扫描', system_standard: '', required_qualifications: '', required_codes: '', special_method: 'NO', enabled: true, service_item_count: 12, updated: '2026-06-01' },
  { id: 7, category: '上线测试', system_standard: '', required_qualifications: '', required_codes: '', special_method: 'NO', enabled: false, service_item_count: 5, updated: '2026-06-01' },
  { id: 8, category: '网络安全风险评估', system_standard: 'ISO 27001', required_qualifications: '', required_codes: '', special_method: 'NO', enabled: true, service_item_count: 15, updated: '2026-06-01' },
]
const rules = [
  { id: 1, kind: 'capability-codes', name: '等级保护测评师（中级+）', scope: '等保测评师', trigger: '', enabled: true, updated: '2026-06-01', check_type: 'PERSON' },
  { id: 2, kind: 'capability-codes', name: 'CISP-PTE', scope: 'CISP-PTE', trigger: '', enabled: true, updated: '2026-06-01', check_type: 'PERSON' },
  { id: 3, kind: 'capability-codes', name: '漏洞扫描设备', scope: '漏扫', trigger: '', enabled: true, updated: '2026-06-01', check_type: 'EQUIPMENT' },
  { id: 4, kind: 'warning-rules', name: '人员资质冲突阻断', scope: '全部项目', trigger: '指派保存', enabled: true, updated: '2026-06-01', check_type: 'PERSON', threshold: '1' },
  { id: 5, kind: 'warning-rules', name: '设备检定过期预警', scope: '全部项目', trigger: '指派保存', enabled: true, updated: '2026-06-01', check_type: 'EQUIPMENT', threshold: '0' },
  { id: 6, kind: 'automations', name: '团队分配站内通知', scope: '全部项目', trigger: 'TEAM_ASSIGNED', target: 'team_lead', enabled: true, updated: '2026-06-01' },
  { id: 7, kind: 'automations', name: '偏差上报通知技术总监', scope: '全部项目', trigger: 'DEVIATION_REPORTED', target: 'technical_director', enabled: true, updated: '2026-06-01' },
  { id: 8, kind: 'permissions', name: '项目客户字段脱敏', scope: '全部项目', trigger: '', enabled: true, updated: '2026-06-01', role_code: 'engineer', field_name: 'customer', access_level: 'MASKED' },
  { id: 9, kind: 'sla', name: '待分配 SLA', scope: '全部项目', trigger: '', enabled: true, updated: '2026-06-01', status: '待分配', deadline_hours: 48, remind_hours: 8 },
  { id: 10, kind: 'sla', name: '报告编制 SLA', scope: '全部项目', trigger: '', enabled: true, updated: '2026-06-01', status: '报告编制', deadline_hours: 72, remind_hours: 12 },
]
const splitPolicy = { id: 1, dimension_primary: 'batch', dimension_secondary: 'category', dimension_tertiary: '', default_status: '待确认',
  generate_requirement_summary: true, requirement_summary_locked: false, missing_rule_action: 'HUMAN_CONFIRM', scope_change_detection: true, enabled: true, updated: '2026-06-01' }
const splitOverrides = [
  { id: 1, match_conditions: { customer_contains: '某银行', max_service_items: 30 }, settings: { dimension_secondary: 'system_standard' }, enabled: true, updated: '2026-06-01' },
]
const monitoring = {
  items: [
    { project: projects[0], service_status_counts: { 实施中: 8, 待实施: 4, 报告编制: 2 }, categories: ['等保测评', '商用密码'],
      project_manager_ids: ['u-pm-1'], milestone: { current: '现场实施', next: '报告编制', done: 4, total: 7 },
      resources: { team_leads: 1, project_managers: 1, engineers: 3, equipment: 2, expired_equipment: 0, released_equipment: 0, conflict_items: 0 },
      sla_items: [], latest_event: events[2], planned_end: '2026-08-15' },
    { project: projects[2], service_status_counts: { 待确认: 8 }, categories: ['等保测评', '渗透测试'],
      project_manager_ids: [], milestone: { current: '拆解确认', next: '任务分配', done: 1, total: 7 },
      resources: { team_leads: 0, project_managers: 0, engineers: 0, equipment: 0, expired_equipment: 0, released_equipment: 0, conflict_items: 0 },
      sla_items: [{ id: 'SI-0841-01', kind: 'STATUS_DEADLINE_OVERDUE', overdue_hours: 30, rule_name: '待确认 SLA' }], planned_end: '2026-09-30' },
    { project: projects[3], service_status_counts: { 实施中: 2, 报告编制: 1, 已完成: 1 }, categories: ['源代码审计', '软件测试'],
      project_manager_ids: ['u-pm-2'], milestone: { current: '异常评审', next: '继续实施', done: 5, total: 7 },
      resources: { team_leads: 1, project_managers: 1, engineers: 2, equipment: 1, expired_equipment: 0, released_equipment: 0, conflict_items: 2 },
      sla_items: [{ id: 'SI-0850-02', kind: 'PLAN_END_OVERDUE', overdue_hours: 12 }], latest_event: events[5], planned_end: '2026-07-10' },
    { project: projects[1], service_status_counts: { 报告编制: 3, 已完成: 2, 现场实施完成: 1 }, categories: ['渗透测试', '应急响应'],
      project_manager_ids: ['u-pm-2'], milestone: { current: '报告编制', next: '审核签发', done: 6, total: 7 },
      resources: { team_leads: 1, project_managers: 1, engineers: 2, equipment: 1, expired_equipment: 0, released_equipment: 0, conflict_items: 0 },
      sla_items: [], latest_event: events[4], planned_end: '2026-07-25' },
  ],
  recent_events: events.slice(0, 4),
  status_counts: { 待拆解确认: 1, 待分配: 1, 实施中: 2, 异常处理中: 1, 报告编制: 1, 已完成: 1 },
  report_stage_counts: { RECTIFYING: 1, COMPILING: 1 },
  categories: ['等保测评', '商用密码', '渗透测试', '源代码审计', '软件测试'],
  teams: ['测评一组', '测评二组', '渗透测试组'],
  project_manager_ids: ['u-pm-1', 'u-pm-2', 'u-pm-3'],
  total: 4, page: 1, page_size: 20, server_time: NOW, snapshot_version: 'snap-1',
}
const dashboard = {
  project_count: projects.length, in_flight_projects: projects.filter((project) => project.status !== '已完成').length,
  risk_projects: projects.filter((project) => project.risk).length, pending_project_creation: 2,
  pending_project_creation_available: true, unknown_status_items: 0, service_items: serviceItems.length,
  status_counts: serviceItems.reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts }, {}),
  report_stage_counts: projects.reduce((counts, project) => { if (project.report_stage) counts[project.report_stage] = (counts[project.report_stage] || 0) + 1; return counts }, {}),
}
const notifications = [
  { delivery_id: 'd1', category: 'DEVIATION_REPORTED', title: '现场偏离待评审', content: 'SI-0823-05 渗透测试发现授权范围不一致，请尽快评审。', created_at: '2026-08-12T15:40:00+08:00', read_at: null },
  { delivery_id: 'd2', category: 'TEAM_ASSIGNED', title: '新的团队分配待办', content: 'SI-0841-01 已分配至测评一组，请指派项目经理与工程师。', created_at: '2026-08-11T10:00:00+08:00', read_at: null },
  { delivery_id: 'd3', category: 'SPLIT_RULE_MISSING', title: '拆解规则缺失', content: '检测类别「漏洞扫描」缺少分组规则，已标记待人工确认。', created_at: '2026-08-10T09:00:00+08:00', read_at: null },
]

function jsonResponse(value) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'OK', message: 'ok', request_id: 'harness', data: value }) }
}

// fixture 根据项目 API 路径返回隔离替身数据；未覆盖的只读路径返回空集合，
// 保证页面以“空态”渲染而不是请求真实后端。
function projectFixture(pathname, search) {
  const path = pathname.slice('/project_management/api/v1'.length)
  if (path === '/auth/me') return session
  if (path === '/navigation') return {
    roles: session.roles,
    sections: ['dashboard', 'monitoring', 'notifications', 'projects', 'decomposition', 'allocation', 'inbox', 'planning', 'preparation', 'qualifications', 'equipment', 'assignments', 'methods', 'implementation', 'exceptions', 'standards', 'reports', 'split-rules', 'configuration-center', 'capability-codes', 'warning-rules', 'automations', 'permissions', 'sla'],
    default_section: 'dashboard', authorization_revision: 12, catalog_version: 'v2026.11',
  }
  if (path === '/role-catalog') return { roles: [
    { code: 'admin', name: '超级管理员' }, { code: 'business_admin', name: '业务管理员' }, { code: 'project_manager', name: '项目经理' },
    { code: 'technical_director', name: '技术总监' }, { code: 'team_lead', name: '团队负责人' }, { code: 'engineer', name: '实施工程师' },
    { code: 'penetration_engineer', name: '渗透测试工程师' }, { code: 'quality_manager', name: '质量管理员' },
  ] }
  if (path === '/dashboard') return dashboard
  if (path.startsWith('/projects-monitoring')) return monitoring
  if (path === '/projects') {
    const stage = search.get('report_stage')
    const rows = stage ? projects.filter((project) => project.report_stage === stage) : projects
    return { items: rows, total: rows.length, page: 1, page_size: rows.length, truncated: false }
  }
  if (path === '/service-items') return { items: serviceItems, total: serviceItems.length, page: 1, page_size: serviceItems.length, truncated: false }
  if (path === '/delivery-events') return events
  if (path === '/delivery/sla-overdue') return [
    { id: 'SI-0850-02', project_id: 'PJ-2026-0850', site: '某城商行 - 总行', category: '软件测试', status: '报告编制', planned_end: '2026-08-20', overdue_hours: 12, kind: 'PLAN_END_OVERDUE' },
    { id: 'SI-0841-01', project_id: 'PJ-2026-0841', site: '某市公积金 - 中心机房', category: '等保测评（三级）', status: '待确认', overdue_hours: 30, kind: 'STATUS_DEADLINE_OVERDUE', rule_name: '待确认 SLA', deadline_hours: 24 },
  ]
  if (path === '/rules') return rules
  if (path === '/rule-configuration-catalog') return {
    automation_triggers: [
      { value: 'TEAM_ASSIGNED', label: '团队负责人已分配', description: '' },
      { value: 'DEVIATION_REPORTED', label: '现场偏离已上报', description: '' },
    ],
    sla_statuses: [{ value: '待分配', label: '待分配', description: '' }, { value: '报告编制', label: '报告编制', description: '' }],
  }
  if (path === '/split-policy') return splitPolicy
  if (path === '/split-overrides') return splitOverrides
  if (path === '/detection-categories') return { items: detectionCategories, total: detectionCategories.length }
  if (path === '/capabilities') return capabilities
  if (path === '/equipment') return { items: capabilities.filter((item) => item.resource_type === 'EQUIPMENT'), total: 3, page: 1, page_size: 20 }
  if (path === '/personnel') return { items: personnel, total: personnel.length, page: 1, page_size: personnel.length }
  if (path === '/qualified-personnel') return { items: personnel.filter((person) => person.role_code !== 'team_lead').map((person) => ({
    user_id: person.user_id, resource_id: 'R-' + person.user_id, display_name: person.display_name, codes: ['CISP-PTE'], identity_status: 'ACTIVE',
  })), total: 6, page: 1, page_size: 20 }
  if (path === '/personnel/names') return { names: PEOPLE }
  if (path === '/project-creation-capabilities') return { native_enabled: true }
  if (path.startsWith('/approved-contract-options')) return { contracts: [], next_after_id: '' }
  if (path.startsWith('/approved-contracts')) return []
  if (path.endsWith('/supplement-contracts')) return []
  if (path.endsWith('/native-scope')) return { status: 'DRAFT', version: 1, changes: [] }
  if (path.endsWith('/reimbursement-spend')) return { items: [], total: 0, cursor: '', total_minor: '0' }
  if (path.endsWith('/expense-participants')) return { items: [], total: 0 }
  if (path.endsWith('/field-evidence')) return { service_item_id: path.split('/')[2], gaps: [], missing: [], evidence: [], evidence_complete: true, state: 'READY', gate_policy: 'ENFORCE' }
  if (path.endsWith('/equipment-reservations')) return []
  if (path.endsWith('/report-revisions')) return []
  if (path.endsWith('/report-reviews') || path.endsWith('/report-reviews/current')) return { items: [] }
  if (path.endsWith('/penetration-work-package')) return { decision_status: 'REQUIRED', execution_stage: 'EXECUTING', report_status: 'NONE', version: 2, plan: {}, decisions: [], revisions: [] }
  if (path.startsWith('/projects/') && path.split('/').length === 3) return projects.find((project) => '/' + project.id === path) || projects[0]
  return { items: [], total: 0, page: 1 }
}

function platformFixture(pathname, search) {
  if (pathname === '/api/v1/notifications/inbox/unread-count') return { unread_count: 3 }
  if (pathname === '/api/v1/notifications/inbox') return { items: notifications, total: notifications.length, page: 1 }
  if (pathname.startsWith('/api/v1/notifications/inbox/') && !pathname.endsWith('/read') && pathname !== '/api/v1/notifications/inbox/unread-count') return notifications[0]
  if (pathname === '/api/v1/auth/me') return session
  return { items: [], total: 0 }
}

const stubPlugin = {
  name: 'project-management-page-stubs',
  setup(builder) {
    builder.onResolve({ filter: /^vue-router$/ }, () => ({ path: 'vue-router', namespace: 'stub' }))
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: routerStub, loader: 'js', resolveDir: root }))
    builder.onLoad({ filter: /vue$/ }, async ({ path }) => {
      const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
      const id = 'data-v-' + createHash('sha256').update(path).digest('hex').slice(0, 8)
      const script = compileScript(descriptor, { id, inlineTemplate: true,
        genDefaultAs: '__fixtureComponent', templateOptions: { compilerOptions: { scopeId: id } } })
      componentStyles.set(path, descriptor.styles.map(style => compileStyle({
        source: style.content, filename: path, id, scoped: style.scoped,
      }).code).join(String.fromCharCode(10)))
      return {
        contents: script.content + String.fromCharCode(10) + '__fixtureComponent.__scopeId=' + JSON.stringify(id) + ';export default __fixtureComponent;',
        loader: 'ts',
        resolveDir: fileURLToPath(new URL('.', 'file://' + path)),
      }
    })
  },
}

const result = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'project-management-page-entry.js' },
  bundle: true, write: false, format: 'iife', platform: 'browser', outdir: 'out',
  define: { 'import.meta.env': '{}' }, alias: { '@': root + 'src' },
  loader: { '.css': 'css' }, plugins: [stubPlugin],
})
const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text || ''
const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text || ''
const scopedCss = [...componentStyles.values()].join(String.fromCharCode(10))
if (!js || !css) throw new Error('page fixture bundle incomplete')

// 用本机回环静态页承载夹具：真实 secure origin 才能用 IndexedDB（离线现场队列）
// 与 document.visibilityState，避免 about:blank 下能力探测误报。
const shell = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<style>html,body{margin:0;background:#f0f2f5}' + css + scopedCss + '</style></head><body><div id="app"></div></body></html>'
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(shell)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const results = []
try {
  for (const width of widthList) {
    for (const theme of themes) {
      for (const item of cases.filter(row => !selectedCases.length || selectedCases.includes(row.key))) {
        const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          if (url.origin !== origin) return route.continue()
          if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: shell })
          const data = url.pathname.startsWith('/project_management/api/v1')
            ? projectFixture(url.pathname, url.searchParams)
            : platformFixture(url.pathname, url.searchParams)
          return route.fulfill(jsonResponse(data))
        })
        await page.goto(origin + '/', { waitUntil: 'load' })
        await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
        await page.addScriptTag({ content: js })
        await page.evaluate(({ item }) => {
          window.__mountPM({ section: item.section, query: item.query || {} })
        }, { item })
        await page.waitForTimeout(1200)
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          shell: Boolean(document.querySelector('.pm-shell')),
          ready: Boolean(document.querySelector('.pm-table, .pm-panel, .pm-kpi, .pm-operations, .pm-config')),
          theme: document.documentElement.dataset.theme || '',
        }))
        const file = path.join(outputDir, item.key + '-' + width + '-' + theme + '.png')
        await page.screenshot({ path: file })
        results.push({ case: item.key, width, theme, errors, metrics, file })
        await page.close()
      }
    }
  }
} finally {
  await browser.close()
  server.close()
}
await writeFile(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2))
const failures = results.filter(row => row.errors.length || !row.metrics.shell || row.metrics.scrollWidth > row.metrics.clientWidth + 1)
console.log(JSON.stringify({ cases: results.length, failures: failures.length, examples: failures.slice(0, 6).map(row => ({ case: row.case, width: row.width, theme: row.theme, errors: row.errors.slice(0, 3), metrics: row.metrics })) }, null, 2))
if (failures.length) process.exitCode = 1