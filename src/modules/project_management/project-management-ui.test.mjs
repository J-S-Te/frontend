import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import projectManagementModule from './module.js'

const source = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('./styles/project-management.css', import.meta.url), 'utf8')
const pickerSource = await readFile(new URL('./components/ServiceItemPicker.vue', import.meta.url), 'utf8')

test('项目管理模块暴露统一前端路由', () => {
  assert.deepEqual(projectManagementModule.route, {
    name: 'project_management',
    params: { section: 'dashboard' },
  })
})

test('项目管理页面覆盖原型的五个业务域与核心交互', () => {
  for (const label of ['执行总览', '项目管理', '资源分配', '现场实施', '系统配置']) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /function confirmDecomposition\(\)/)
  assert.match(source, /function exportProjects\(\)/)
  assert.match(source, /class="pm-kanban"/)
  assert.match(source, /class="pm-drawer"/)
  assert.match(source, /onMounted\(loadWorkspace\)/)
  assert.match(source, /await confirmServiceItemsRequest\(ids\)/)
  assert.match(source, /await setRuleEnabled\(rule\.id, rule\.kind \|\| activeSection\.value, next\)/)
  for (const operation of ['assignTeam', 'assignExecutionTeam', 'planImplementation', 'startImplementationPreparation', 'fieldCheckIn', 'submitFieldRecord', 'reportDeviation', 'reviewDeviation', 'completeFieldImplementation']) {
    assert.match(source, new RegExp(`runOperation[\\s\\S]*${operation}`))
  }
  assert.match(source, /asRFC3339\(form\.plannedStart\)/)
  assert.match(source, /service_items:/)
  assert.match(source, /listDeliveryEvents\(\)/)
  assert.match(source, /listCapabilities\(\)/)
  assert.match(source, /DEVIATION_REPORTED/)
})

test('项目管理页面不再渲染原型模拟业务数据', () => {
  for (const mockValue of ['87.4', '92.1', '96.8', 'PJ-2026-0817', '某证券交易所', '王晓飞', 'GB/T 28448-2019']) {
    assert.doesNotMatch(source, new RegExp(mockValue.replaceAll('.', '\\.')))
  }
  assert.match(source, /getDashboard\(\)/)
  assert.match(source, /getProjectSession\(\)/)
  assert.match(source, /standards: \[\]/)
  assert.match(source, /projectEvents\(drawerProject\)/)
})

test('项目系统侧边栏返回门户，用户控件负责撤销应用会话', () => {
  assert.match(source, /logoutCurrentSession\(\)/)
  assert.match(source, /router\.replace\(\{ name: 'login', query: \{ reason: 'session-ended' \} \}\)/)
  assert.equal((source.match(/@click="logoutSystem"/g) || []).length, 1)
  assert.equal((source.match(/@click="returnToUnifiedPortal"/g) || []).length, 1)
  assert.match(source, /返回子系统门户/)
  assert.match(source, /aria-label="退出应用系统"/)
})

test('项目管理页面对齐合同系统 UniLab UI 设计规范', () => {
  for (const token of [
    '--pm-ink: #0f172a',
    '--pm-body: #475569',
    '--pm-muted: #64748b',
    '--pm-blue: #2563eb',
    '--pm-green-text: #15803d',
    '--pm-amber-text: #b45309',
    '--pm-red-text: #b91c1c',
  ]) {
    assert.match(styles, new RegExp(token))
  }
  assert.match(styles, /\.pm-sidebar \{[\s\S]*?width: 248px;[\s\S]*?background: #0f172a;/)
  assert.match(styles, /\.pm-button \{[\s\S]*?min-height: 38px;[\s\S]*?font-size: 13\.5px;/)
  assert.match(styles, /\.pm-table \{ font-size: 13\.5px; \}/)
  assert.match(styles, /\.pm-table th \{[\s\S]*?font-size: 12\.5px;/)
  assert.match(styles, /:focus-visible \{[\s\S]*?outline: 2px solid var\(--pm-blue\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test('关联服务项在新建对话框中占满整行，输入框不会被压窄截断', () => {
  assert.match(styles, /\.pm-service-links \{[^}]*grid-column: 1 \/ -1;/)
  assert.match(styles, /\.pm-service-link-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1fr\) auto;/)
  const baseIndex = styles.indexOf('.pm-service-link-row { display: grid;')
  const narrowIndex = styles.indexOf('.pm-service-link-row { grid-template-columns: minmax(0, 1fr); }')
  assert.ok(baseIndex !== -1, '缺少关联服务项行基础样式')
  assert.ok(narrowIndex > baseIndex, '窄屏堆叠规则必须位于基础规则之后，否则同优先级下会被覆盖')
})

test('新建对话框限制高度并可滚动，内容不会被视口裁切', () => {
  assert.match(styles, /\.pm-dialog \{[^}]*max-height: calc\(100vh - 32px\);/)
  assert.match(styles, /\.pm-dialog > \.pm-form \{[^}]*overflow-y: auto;/)
})

test('服务项操作台的团队负责人从基础平台人员目录选择而不是填写用户 ID', () => {
  assert.match(source, /listPersonnel\(\{/)
  assert.match(source, /const personnelOptions = computed/)
  assert.match(source, /<select v-model="operationForm\.teamLeadID"/)
  assert.match(source, /<select v-model="operationForm\.projectManagerID"/)
  assert.match(source, /class="pm-multi-dropdown"/)
  assert.match(source, /multiSummary\(engineerSelection, personnelOptions/)
  assert.match(source, /const engineerSelection = computed/)
  assert.doesNotMatch(source, /v-model\.trim="operationForm\.teamLeadID"/)
  assert.doesNotMatch(source, /placeholder="至少一个用户 ID"/)
})

test('服务项操作台的工程师与设备改为下拉多选，能力码按所选设备自动汇总', () => {
  assert.match(source, /const equipmentOptions = computed/)
  assert.match(source, /const equipmentSelection = computed/)
  assert.match(source, /function capabilityCodesForEquipment\(/)
  assert.match(source, /const capabilityCodeList = computed/)
  assert.match(source, /item\.status !== 'DISABLED'/)
  // 多选走下拉菜单逐项勾选，样式与团队负责人/项目经理一致，不要求按住 ⌘/Ctrl。
  assert.match(source, /class="pm-multi-dropdown"/)
  assert.match(source, /class="pm-multi-trigger"/)
  assert.match(source, /function toggleMulti\(/)
  assert.match(source, /function toggleEngineer\(/)
  assert.match(source, /function toggleEquipment\(/)
  assert.match(source, /:checked="engineerSelection\.includes\(option\.id\)"/)
  assert.match(source, /:checked="equipmentSelection\.includes\(option\.id\)"/)
  assert.match(source, /选择设备后自动汇总，无需填写/)
  assert.doesNotMatch(source, /<select[^>]*multiple/)
  assert.doesNotMatch(source, /按住 ⌘ \/ Ctrl 可多选/)
  assert.doesNotMatch(source, /v-model\.trim="operationForm\.equipmentIDs"/)
  assert.doesNotMatch(source, /v-model\.trim="operationForm\.requiredCodes"/)
})

test('操作台各区块的查看按钮真实打开详情抽屉而不是只提示已打开', () => {
  assert.match(source, /function openOperationDetail\(/)
  assert.match(source, /const operationDetailFields = computed/)
  assert.match(source, /@click="openOperationDetail\(row\)"/)
  assert.match(source, /operationSectionLabel\(operationDetail\.section\)/)
  assert.doesNotMatch(source, /@click="showToast\(`已打开：\$\{row\.name\}`\)"/)
})

test('资质与能力管理提供新建、CSV 导入导出与类型状态筛选', () => {
  assert.match(source, /activeSection === 'qualifications'/)
  assert.match(source, /function openCapabilityDialog\(/)
  assert.match(source, /await upsertCapability\(/)
  assert.match(source, /await importCapabilities\(file\)/)
  assert.match(source, /await exportCapabilities\(capabilityTypeFilter\.value\)/)
  assert.match(source, /canManageResource/)
  assert.match(source, /导入 CSV/)
  assert.match(source, /导出 CSV/)
  assert.match(source, /＋ 新建资质/)
  assert.match(source, /v-model="capabilityTypeFilter"/)
  assert.match(source, /v-model="capabilityStatusFilter"/)
  assert.match(source, /pm-file-input/)
  assert.match(styles, /\.pm-panel-actions \{[\s\S]*?gap: 8px;/)
})

test('资质与能力管理的人员/设备编号由系统按类型自动生成', () => {
  assert.match(source, /function resourceIDPrefix\(resourceType\)/)
  assert.match(source, /resourceType === 'EQUIPMENT' \? 'EQ-' : 'P-'/)
  assert.match(source, /function nextResourceID\(resourceType\)/)
  assert.match(source, /function onCapabilityTypeChange\(/)
  assert.match(source, /capabilityAutoID/)
  assert.match(source, /@change="onCapabilityTypeChange"/)
  assert.match(source, /:readonly="capabilityAutoID"/)
  assert.match(source, /capabilityDialog\.resource_type === 'EQUIPMENT' \? '设备编号' : '人员编号'/)
  assert.doesNotMatch(source, /placeholder="例如 P-001 或 EQ-001"/)
})

test('执行总览新增准时交付率趋势、检测类别分布与团队资源利用率三卡，数据由真实记录推导', () => {
  assert.match(source, /pm-dashboard-grid-3/)
  assert.match(source, /近 12 周准时交付率趋势/)
  assert.match(source, /检测类别分布（占比）/)
  assert.match(source, /团队资源利用率/)
  assert.match(source, /const weeklyDeliveryTrend = computed/)
  assert.match(source, /FIELD_IMPLEMENTATION_COMPLETED/)
  assert.match(source, /const categoryDist = computed/)
  assert.match(source, /const categoryDonutStyle = computed/)
  assert.match(source, /const teamUtilization = computed/)
  assert.match(source, /const concentratedTeam = computed/)
  assert.match(source, /concentratedTeam\.name/)
  assert.doesNotMatch(source, /const overloadedTeam = computed/)
  assert.match(source, /week\.scheduled/)
  assert.doesNotMatch(source, /const max = Math\.max\(\.\.\.entries\.map/)
  assert.match(source, /按当前在途服务项统计/)
  assert.match(styles, /\.pm-dashboard-grid-3 \{/)
  assert.match(styles, /\.pm-trend-chart \{/)
  assert.match(styles, /\.pm-status-libar \{/)
  assert.doesNotMatch(source, /测评一组/)
  assert.doesNotMatch(source, /渗透测试组/)
})

test('服务项操作台使用可搜索的服务项卡片选择器而不是原生下拉框', () => {
  assert.match(source, /import ServiceItemPicker from '@\/modules\/project_management\/components\/ServiceItemPicker\.vue'/)
  assert.match(source, /<ServiceItemPicker/)
  assert.match(source, /@select="selectServiceItem"/)
  assert.match(source, /@toggle="toggleServiceItem"/)
  assert.match(source, /:selected-ids="selectedServiceItemIDs"/)
  // 旧的原生下拉框与朴素复选框列表必须被替换掉。
  assert.doesNotMatch(source, /<select :value="selectedServiceItem\?\.id/)
  assert.doesNotMatch(source, /class="pm-selection-list"/)
  assert.doesNotMatch(source, /class="pm-selection-row"/)
  // 选择器自身提供搜索、卡片与选中态。
  assert.match(pickerSource, /class="pm-picker-search"/)
  assert.match(pickerSource, /class="pm-picker-card"/)
  assert.match(pickerSource, /:class="\{ selected: isSelected\(item\) \}"/)
  assert.match(pickerSource, /role="option"/)
  assert.match(pickerSource, /aria-multiselectable/)
  assert.match(styles, /\.pm-picker-card \{/)
  assert.match(styles, /\.pm-picker-card\.selected \{/)
  assert.match(styles, /\.pm-picker-search \{/)
  // 搜索图标必须被约束尺寸：否则 SVG 会撑满整行，操作台会变成一个巨大的圆圈。
  assert.match(styles, /\.pm-picker-search svg \{[^}]*width: 14px; height: 14px;/)
  // 选择器直接放在无内边距的 .pm-panel 里，必须自带内边距。
  assert.match(styles, /\.pm-picker \{[^}]*padding: 16px 20px;/)
  assert.doesNotMatch(styles, /\.pm-selection-list \{/)
})
