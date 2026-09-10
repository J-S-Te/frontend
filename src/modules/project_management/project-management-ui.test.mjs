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

test('项目管理页面严格遵守 UniLab v1.0 设计规范', () => {
  const css = styles.replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = (property) =>
    [...css.matchAll(new RegExp(`(?<![-\\w])${property}\\s*:\\s*([^;}]+)`, 'g'))].map((match) => match[1].trim())
  const ruleBody = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
    assert.ok(match, `missing rule for ${selector}`)
    return match[1]
  }

  // §1 令牌层：规范取值必须原样落在令牌层，组件只引用令牌（换肤只改这一层）。
  const specTokens = {
    '--pm-primary': '#2563eb', '--pm-primary-d': '#1d4ed8',
    '--pm-primary-soft': '#eff6ff', '--pm-primary-border': '#bfdbfe',
    '--pm-ink': '#0f172a', '--pm-body': '#475569', '--pm-muted': '#64748b', '--pm-faint': '#94a3b8',
    '--pm-content': '#f1f5f9', '--pm-sunken': '#f8fafc',
    '--pm-line': '#e2e8f0', '--pm-line-soft': '#edf0f5', '--pm-line-strong': '#cbd5e1',
    '--pm-sidebar': '#0f172a', '--pm-sidebar-hover': '#1e293b', '--pm-sidebar-active': '#1e293b',
    '--pm-sidebar-text': '#cbd5e1', '--pm-sidebar-label': '#94a3b8', '--pm-sidebar-dot': '#334155',
    '--pm-green': '#16a34a', '--pm-green-soft': '#ecfdf5', '--pm-green-text': '#15803d',
    '--pm-amber': '#d97706', '--pm-amber-soft': '#fef3c7', '--pm-amber-text': '#b45309',
    '--pm-red': '#dc2626', '--pm-red-soft': '#fef2f2', '--pm-red-text': '#b91c1c',
    '--pm-sky': '#0ea5e9', '--pm-sky-soft': '#e0f2fe', '--pm-sky-text': '#0369a1',
    '--pm-violet': '#8b5cf6', '--pm-violet-soft': '#f5f3ff', '--pm-violet-text': '#6d28d9',
    '--pm-gray': '#64748b', '--pm-gray-soft': '#f1f5f9', '--pm-gray-text': '#475569',
    '--pm-blue-text': '#1d4ed8',
    '--pm-fs-display': '28px', '--pm-fs-title': '22px', '--pm-fs-subtitle': '16px',
    '--pm-fs-card': '15px', '--pm-fs-base': '14px', '--pm-fs-ui': '13.5px', '--pm-fs-sm': '13px',
    '--pm-fs-label': '12.5px', '--pm-fs-hint': '12px', '--pm-fs-micro': '11.5px', '--pm-fs-nano': '11px',
    '--pm-w-sidebar': '248px', '--pm-h-topbar': '64px',
    '--pm-w-drawer': '420px', '--pm-w-modal': '560px',
    '--pm-h-control': '32px', '--pm-h-button': '38px',
    '--pm-r-xs': '6px', '--pm-r-sm': '8px', '--pm-r-md': '10px',
    '--pm-r-lg': '12px', '--pm-r-xl': '14px', '--pm-r-full': '999px',
    '--pm-z-sticky': '20', '--pm-z-dropdown': '30', '--pm-z-mask': '40',
    '--pm-z-drawer': '41', '--pm-z-modal': '50', '--pm-z-toast': '60',
  }
  for (const [token, value] of Object.entries(specTokens)) {
    assert.match(css, new RegExp(`${token}:\\s*${value};`), `${token} must be ${value}`)
  }

  // §3~§5 骨架：侧栏 248 平涂深色、顶栏 64、内容区 24 内边距。
  const sidebar = ruleBody('.pm-sidebar')
  assert.match(sidebar, /width: var\(--pm-w-sidebar\);/)
  assert.match(sidebar, /background: var\(--pm-sidebar\);/)
  assert.match(ruleBody('.pm-topbar'), /min-height: var\(--pm-h-topbar\);/)
  assert.match(ruleBody('.pm-page'), /padding: var\(--pm-pad-page\)/)
  assert.match(ruleBody('.pm-page-head h1'), /font-size: var\(--pm-fs-title\);/)

  // §6 按钮：38 高、13.5 字号、8 圆角。
  const button = ruleBody('.pm-button')
  assert.match(button, /min-height: var\(--pm-h-button\);/)
  assert.match(button, /font-size: var\(--pm-fs-ui\);/)
  assert.match(button, /border-radius: var\(--pm-r-sm\);/)

  // §9 表格：正文 13.5、表头 12.5/600 + sunken 底。
  assert.match(ruleBody('.pm-table'), /font-size: var\(--pm-fs-ui\);/)
  const tableHead = ruleBody('.pm-table th')
  assert.match(tableHead, /font-size: var\(--pm-fs-label\);/)
  assert.match(tableHead, /font-weight: var\(--pm-fw-semibold\);/)
  assert.match(tableHead, /background: var\(--pm-sunken\);/)

  // §2 无障碍底线：焦点环、动效降级、屏幕阅读器文本、触控目标。
  assert.match(css, /:focus-visible \{[\s\S]*?outline: 2px solid var\(--pm-primary\);/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /@media \(pointer: coarse\)/)
  assert.ok(ruleBody('.pm-shell .sr-only'), 'screen-reader-only helper is required')

  // 禁止新增字号档位：所有 font-size 必须引用令牌。
  for (const value of declarations('font-size')) {
    assert.match(value, /^var\(--pm-fs-[a-z]+\)$/, `font-size ${value} is outside the UniLab type scale`)
  }

  // 禁止第七种色相：所有十六进制颜色必须来自规范调色板。
  const palette = new Set(
    Object.values(specTokens)
      .filter((value) => value.startsWith('#'))
      .map((value) => value.toLowerCase())
      .concat(['#ffffff', '#fff']),
  )
  for (const [hex] of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    assert.ok(palette.has(hex.toLowerCase()), `color ${hex} is not part of the UniLab palette`)
  }

  // 层级必须引用令牌，避免出现规范之外的层级。
  for (const value of declarations('z-index')) {
    assert.match(value, /^var\(--pm-z-[a-z]+\)$/, `z-index ${value} is outside the UniLab scale`)
  }
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
  assert.match(styles, /\.pm-panel-actions \{[\s\S]*?gap: var\(--pm-sp-2\);/)
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
  // 搜索图标必须被显式约束尺寸：否则 SVG 会撑满整行，操作台会变成一个巨大的圆圈。
  // 只锁定“同时声明了宽高”这一不变量，具体像素值由设计令牌决定。
  assert.match(styles, /\.pm-picker-search svg \{[^}]*width: \d+px; height: \d+px;/)
  // 选择器直接放在无内边距的 .pm-panel 里，必须自带内边距（规范间距令牌 = 16px 20px）。
  assert.match(styles, /\.pm-picker \{[^}]*padding: var\(--pm-sp-4\) var\(--pm-sp-5\);/)
  assert.doesNotMatch(styles, /\.pm-selection-list \{/)
})

test('项目管理系统的文本/底色组合满足 WCAG 2.1 AA 对比度', () => {
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (foreground, background) => {
    const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    return (high + 0.05) / (low + 0.05)
  }

  // 正文与标题必须在本模块出现的每一种表面上都达标。
  const surfaces = {
    '--pm-card': '#ffffff',
    '--pm-content': '#f1f5f9',
    '--pm-sunken': '#f8fafc',
    '--pm-primary-soft': '#eff6ff',
    '--pm-green-soft': '#ecfdf5',
    '--pm-amber-soft': '#fef3c7',
    '--pm-red-soft': '#fef2f2',
    '--pm-sky-soft': '#e0f2fe',
    '--pm-violet-soft': '#f5f3ff',
  }
  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    for (const [inkName, ink] of Object.entries({ '--pm-ink': '#0f172a', '--pm-body': '#475569' })) {
      assert.ok(
        contrast(ink, surface) >= 4.5,
        `${inkName} on ${surfaceName} is ${contrast(ink, surface).toFixed(2)}:1`,
      )
    }
  }

  // --pm-muted 在白底与下沉底上达标；在带色浅底上仅 4.2~4.4:1，不得承载正文。
  assert.ok(contrast('#64748b', '#ffffff') >= 4.5)
  assert.ok(contrast('#64748b', '#f8fafc') >= 4.5)
  for (const tinted of ['#f1f5f9', '#eff6ff', '#fef3c7', '#fef2f2', '#e0f2fe', '#f5f3ff']) {
    assert.ok(contrast('#64748b', tinted) < 4.5, `--pm-muted unexpectedly passes on ${tinted}`)
  }
  // 因此页面说明、抽屉导语、来源卡说明与选择器副标题必须使用 --pm-body。
  for (const selector of [
    '.pm-page-head > div > p:last-child',
    '.pm-drawer-hero p',
    '.pm-source-card p',
    '.pm-picker-body small',
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const body = styles.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
    assert.ok(body, `missing rule for ${selector}`)
    assert.match(body[1], /color: var\(--pm-body\);/)
  }

  // 小字号语义文本一律使用 -text 安全变体，并在各自的 soft 底上达标。
  for (const [text, soft] of [
    ['--pm-green-text', '--pm-green-soft'],
    ['--pm-amber-text', '--pm-amber-soft'],
    ['--pm-red-text', '--pm-red-soft'],
    ['--pm-sky-text', '--pm-sky-soft'],
    ['--pm-violet-text', '--pm-violet-soft'],
    ['--pm-blue-text', '--pm-primary-soft'],
  ]) {
    const value = (name) => styles.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`))[1]
    assert.ok(
      contrast(value(text), value(soft)) >= 4.5,
      `${text} on ${soft} is ${contrast(value(text), value(soft)).toFixed(2)}:1`,
    )
  }

  // 主按钮白字必须达标。
  assert.ok(contrast('#ffffff', '#2563eb') >= 4.5)
})

test('发布实施计划在提交前拦截未完成的前置步骤', () => {
  // 服务端对"发布实施计划"有前置状态强校验。界面必须提前说清楚还差哪一步，
  // 而不是让用户填完整张表单才收到一句笼统的"请求参数不合法"（规范原则④）。
  assert.match(source, /const planningBlocked = computed\(\(\) => \{/)
  assert.match(source, /请先在「任务分配」中指派项目经理/)
  assert.match(source, /请先在「任务分配」中完成能力校验/)
  assert.match(source, /技术总监复核后才能发布实施计划/)
  // 冲突用 red、还差一步用 amber，符合规范 §2.5 的语义映射。
  assert.match(source, /tone: 'danger'/)
  assert.match(source, /tone: 'warn'/)
  // 主按钮在拦截态下禁用，并给出可执行的替代动作。
  assert.match(source, /:disabled="saving \|\| !!planningBlocked"/)
  assert.match(source, /class="pm-blocker"/)
  assert.match(source, /前往任务分配/)
  assert.match(source, /@click="navigate\('allocation'\)"/)
  // 操作台是 div 而不是 <form>，浏览器 required 不生效，必须显式前置拦截。
  assert.match(source, /请填写计划开始与计划结束时间/)
  assert.match(source, /计划结束时间必须晚于计划开始时间/)
  assert.match(source, /请填写现场计划/)
  assert.match(source, /请补充渗透测试专项合规要素/)
  // 样式：amber 拦截 + red 冲突，均带描边与文案，不只靠颜色。
  assert.match(styles, /\.pm-blocker \{/)
  assert.match(styles, /\.pm-blocker\.danger \{/)
})

test('实施计划的时间在 RFC3339 与 datetime-local 之间正确往返', () => {
  // 后端存 RFC3339(UTC)，<input type="datetime-local"> 只接受本地 YYYY-MM-DDTHH:mm。
  // 直接把 ISO 串塞进输入框会被浏览器判为非法值并显示为空，再次编辑已有计划时时间会"丢失"。
  assert.match(source, /function toDateTimeLocal\(value\)/)
  assert.match(source, /plannedStart: toDateTimeLocal\(item\.planned_start \|\| plan\.planned_start\)/)
  assert.match(source, /plannedEnd: toDateTimeLocal\(item\.planned_end \|\| plan\.planned_end\)/)
  assert.match(source, /authStart: toDateTimeLocal\(plan\.auth_start\)/)
  assert.match(source, /authEnd: toDateTimeLocal\(plan\.auth_end\)/)
})

test('项目状态只由服务端派生，前端不再自行拼装状态集合', () => {
  // 服务端 domain.ProjectStatusNodes() 是唯一的顺序表；这里锁定前端的只读镜像，
  // 防止两侧各自演化后出现"筛选下拉有的状态列表里没有"这类漂移。
  assert.match(source, /const projectStatusNodes = \['待拆解确认', '待分配', '待制定计划', '待实施', '实施准备中', '实施中', '异常处理中', '现场实施完成', '报告编制', '已完成'\]/)
  assert.match(source, /const projectStatusCompleted = '已完成'/)
  // 状态筛选必须由节点表生成，而不是手写 option 列表。
  assert.match(source, /<option v-for="node in projectStatusNodes"/)
  // 看板泳道只做归类，卡片仍展示唯一的 project.status。
  assert.match(source, /statuses: \['待拆解确认', '待分配'\]/)
  assert.match(source, /statuses: \[projectStatusCompleted\]/)
  assert.match(source, /<span class="pm-badge neutral">\{\{ card\.status \}\}<\/span>/)
  // 不得再用"还有报告未归档"二次推断项目完成态。
  assert.doesNotMatch(source, /reportActiveProjectIDs/)
  assert.match(source, /project\.status === projectStatusCompleted/)
})
