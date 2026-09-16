import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import projectManagementModule from './module.js'

const source = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('./styles/project-management.css', import.meta.url), 'utf8')
const pickerSource = await readFile(new URL('./components/ServiceItemPicker.vue', import.meta.url), 'utf8')
const searchableSelectSource = await readFile(new URL('./components/SearchableSelect.vue', import.meta.url), 'utf8')
const pmApiSource = await readFile(new URL('./api/projectManagement.js', import.meta.url), 'utf8')
const workflowNodeSource = await readFile(new URL('./workflowNode.js', import.meta.url), 'utf8')

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
  for (const operation of ['assignTeam', 'assignExecutionTeam', 'planImplementation', 'startImplementationPreparation', 'submitFieldRecord', 'reportDeviation', 'reviewDeviation', 'completeServiceItemField']) {
    assert.match(source, new RegExp(`runOperation[\\s\\S]*${operation}`))
  }
  assert.match(source, /asRFC3339\(form\.plannedStart\)/)
  assert.match(source, /service_items:/)
  assert.match(source, /listDeliveryEvents\(\)/)
  assert.match(source, /listCapabilities\(\)/)
  assert.match(source, /DEVIATION_REPORTED/)
})

test('系统配置侧边栏合并为一个规则配置中心并保留细粒度权限与深链接', () => {
  // 五类规则已经在页面内以标签切换，侧栏不再重复铺开五个入口。
  assert.match(source, /const configurationCenterSections = Object\.freeze\(\[\s*'capability-codes',\s*'warning-rules',\s*'automations',\s*'permissions',\s*'sla',\s*\]\)/)
  assert.match(source, /\{ key: 'configuration-center', label: '规则配置中心', icon: 'shield', sectionKeys: configurationCenterSections \}/)
  assert.doesNotMatch(source, /\{ key: 'warning-rules', label: '冲突预警规则', icon:/)
  assert.doesNotMatch(source, /\{ key: 'automations', label: '自动化触发', icon:/)
  assert.doesNotMatch(source, /\{ key: 'permissions', label: '字段级权限', icon:/)
  assert.doesNotMatch(source, /\{ key: 'sla', label: '状态 SLA 配置', icon:/)
  // 服务端仍返回细粒度栏目；合并入口取当前用户首个获授权栏目作为落点，
  // 任一子栏目激活时侧栏入口都保持选中。
  assert.match(source, /item\.sectionKeys\?\.find\(\(section\) => allowed\.has\(section\)\)/)
  assert.match(source, /item\.sectionKeys\.some\(\(section\) => allowed\.has\(section\)\)/)
  assert.match(source, /item\.sectionKeys\.includes\(activeSection\.value\)/)
  assert.match(source, /@click="navigateNavItem\(item\)"/)
  // 合同拆解规则仍是独立入口。
  assert.match(source, /\{ key: 'split-rules', label: '合同拆解规则', icon: 'settings' \}/)
})

test('项目管理的弹层与菜单支持一致的 Esc 关闭逻辑，保存中不会被误关闭', () => {
  assert.match(source, /function closeActiveOverlay\(\)/)
  assert.match(source, /if \(saving\.value\) return/)
  assert.match(source, /if \(openMulti\.value\) \{ openMulti\.value = ''; return true \}/)
  assert.match(source, /function onGlobalKeydown\(event\)/)
  assert.match(source, /if \(event\.key !== 'Escape'\) return/)
  assert.match(source, /document\.addEventListener\('keydown', onGlobalKeydown\)/)
  assert.match(source, /document\.removeEventListener\('keydown', onGlobalKeydown\)/)
  assert.match(styles, /\.pm-button:focus-visible, \.pm-icon-button:focus-visible, \.pm-link:focus-visible/)
  assert.match(styles, /\.pm-overlay \{[\s\S]*?backdrop-filter: blur\(3px\);/)
})

test('项目管理页面不再渲染原型模拟业务数据', () => {
  for (const mockValue of ['87.4', '92.1', '96.8', 'PJ-2026-0817', '某证券交易所', '王晓飞', 'GB/T 28448-2019']) {
    assert.doesNotMatch(source, new RegExp(mockValue.replaceAll('.', '\\.')))
  }
  assert.match(source, /getDashboard\(\)/)
  assert.match(source, /getProjectSession\(\)/)
  assert.match(source, /standards: \[\]/)
  assert.match(source, /projectEvents\(detailProject\.value\)/)
})

test('项目列表 KPI、趋势图、资质筛选与空态不发生视觉回归', () => {
  // 颜色工具类只能作用于实际色块，不能覆盖 KPI 卡片的白色背景。
  assert.doesNotMatch(styles, /\.pm-shell \.(?:slate|violet|amber|blue|green)\s*\{\s*background:/)
  for (const tone of ['slate', 'violet', 'amber', 'blue', 'green']) {
    assert.match(styles, new RegExp(`\\.pm-legend i\\.${tone},[\\s\\S]*?\\.pm-kanban header i\\.${tone},[\\s\\S]*?\\.pm-bar-fill\\.${tone} \\{ background:`))
  }
  assert.match(styles, /\.pm-kpi\.amber\s*\{ border-top-color: var\(--pm-amber\); \}/)
  assert.match(styles, /\.pm-kpi\.blue\s*\{ border-top-color: var\(--pm-primary\); \}/)
  assert.match(styles, /\.pm-kpi\.green\s*\{ border-top-color: var\(--pm-green\); \}/)

  // 柱高由模板中的 rate 百分比驱动，不允许 flex 再把每根柱子撑满。
  assert.match(source, /class="pm-trend-bar"[\s\S]*?:style="\{ height: `\$\{week\.rate\}%` \}"/)
  assert.match(styles, /\.pm-trend-bar i \{[^}]*flex: 0 0 auto;/)
  assert.doesNotMatch(styles, /\.pm-trend-bar i \{[^}]*flex: 1;/)

  // CJK 筛选标签不能在狭窄空间逐字折行。
  assert.match(styles, /\.pm-qualification-filter span \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/)

  // 无数据与筛选无结果都必须在项目列表表体内给出明确反馈。
  assert.match(source, /<tr v-if="!pagedProjects\.length"><td colspan="10" class="pm-empty-mini">\{\{ projects\.length \? '暂无符合当前筛选条件的项目' : '暂无项目，请先新建项目' \}\}<\/td><\/tr>/)
})

test('高密度工作台在桌面与窄屏下保持可导航和可理解', () => {
  // 侧栏默认只展开当前分组，分组标题是真实按钮并暴露展开状态。
  assert.match(source, /const collapsedNavGroups = ref\(new Set\(\)\)/)
  assert.match(source, /groups\.filter\(\(group\) => !navGroupContainsActiveItem\(group\)\)/)
  assert.match(source, /class="pm-nav-label" :aria-expanded="!isNavGroupCollapsed\(group\)" @click="toggleNavGroup\(group\)"/)
  assert.match(source, /v-show="!isNavGroupCollapsed\(group\)" class="pm-nav-group-items"/)
  assert.match(styles, /\.pm-nav-label\[aria-expanded="false"\] i \{ transform: rotate\(-45deg\); \}/)

  // 单面板页面只保留页级标题，工具栏和业务表单不再重复同名 H2。
  assert.doesNotMatch(source, /<h2>资质与能力管理<\/h2>/)
  assert.doesNotMatch(source, /<h2>设备能力维护<\/h2>/)
  assert.match(source, /<header class="pm-section-toolbar"><div class="pm-panel-actions">/)
  assert.match(styles, /\.pm-panel > header\.pm-section-toolbar \{ justify-content: flex-end; \}/)

  // 拆解页无数据时给出引导，同时确认与调整按钮都必须有数据门禁。
  assert.match(source, /const canConfirmCurrentDecomposition = computed/)
  assert.match(source, /:disabled="saving \|\| !canConfirmCurrentDecomposition"/)
  assert.match(source, /:disabled="saving \|\| !decompositionProject" @click="openDecompositionAdjust"/)
  assert.match(source, /v-if="!decompositionProject" class="pm-empty pm-decomposition-empty"[\s\S]*?暂无待拆解合同/)
  assert.match(styles, /\.pm-kanban-body \{[^}]*min-height: 96px;[^}]*max-height: min\(48vh, 430px\);[^}]*overflow-y: auto;/)

  // 用户界面不暴露数据库表名或后端派生实现术语，也不重复空列表计数。
  assert.doesNotMatch(source, /风险口径:|服务端口径：|（pm_sla 规则）|以服务端状态为准/)
  assert.match(source, /<footer v-if="inFlightProjects\.length" class="pm-table-footer">/)

  // 静态列宽归入 CSS；项目列表在 760px 以下转换为带字段标签的卡片。
  assert.doesNotMatch(source, /style="width: 90px; min-width: 90px;"/)
  assert.match(styles, /\.pm-col-actions \{ width: 90px; min-width: 90px; text-align: right; \}/)
  assert.match(source, /class="pm-table pm-responsive-list"/)
  assert.match(source, /data-label="项目 \/ 客户"/)
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.pm-responsive-list tbody tr \{ display: grid;/)

  // 仪表盘 KPI 最多保留标签、数值、说明三层。
  assert.doesNotMatch(source, /pm-kpi-corner|pm-kpi-note/)
})

test('服务项拆解项目切换器并入合同概览，避免脱离上下文的单独表单条', () => {
  assert.match(source, /class="pm-source-card pm-decomposition-source-card"/)
  assert.match(source, /class="pm-source-actions">\s*<label v-if="decompositionProjects\.length > 1" class="pm-decomposition-switcher"/)
  assert.match(source, /class="pm-decomposition-switcher-label">当前拆解项目<\/span>/)
  assert.match(source, /class="pm-decomposition-select-shell">/)
  assert.match(source, /aria-label="选择当前拆解项目"/)
  assert.doesNotMatch(source, /v-if="decompositionProjects\.length > 1" class="pm-panel"><label><span>当前拆解项目<\/span>/)
  assert.match(styles, /\.pm-decomposition-switcher select \{[\s\S]*?appearance: none;/)
  assert.match(styles, /\.pm-decomposition-select-shell::after \{[\s\S]*?transform: translateY\(-70%\) rotate\(45deg\);/)
  assert.match(styles, /\.pm-decomposition-switcher:focus-within \{[\s\S]*?box-shadow: 0 0 0 3px var\(--pm-focus-ring\);/)
})

test('项目系统侧边栏返回门户，用户控件负责撤销应用会话', () => {
  assert.match(source, /logoutCurrentSession\(\)/)
  assert.match(source, /router\.replace\(\{ name: 'login', query: \{ reason: 'session-ended' \} \}\)/)
  assert.equal((source.match(/@click="logoutSystem"/g) || []).length, 1)
  assert.equal((source.match(/@click="returnToUnifiedPortal"/g) || []).length, 1)
  assert.match(source, /返回子系统门户/)
  assert.match(source, /aria-label="退出应用系统"/)
})

test('顶栏右上角只剩通知铃铛与账号头像，账号名与退出入口移到侧栏底部', () => {
  // 对齐客户与商机系统：顶栏右上角不再出现账号名、角色列表与退出按钮；
  // 原先那串角色码（admin / business_admin / …）在顶栏横铺一行，既不是导航也不是操作。
  const topTools = source.match(/<div class="pm-top-tools">([\s\S]*?)<\/div>/)
  assert.ok(topTools, '顶栏工具区应存在')
  assert.match(topTools[1], /class="pm-icon-button pm-notification-button"/)
  assert.match(topTools[1], /class="pm-topbar-avatar" aria-hidden="true">\{\{ currentUserInitial \}\}/)
  assert.doesNotMatch(topTools[1], /class="pm-user"/)
  assert.doesNotMatch(topTools[1], /logoutSystem|currentUserName|currentUserRoleLabel/)
  // 账号行落在侧栏底部，结构与客户与商机系统一致：头像 + 账号名 + 角色名 + 退出按钮。
  assert.match(source, /<div class="pm-sidebar-user">\s*<span class="pm-avatar" aria-hidden="true">\{\{ currentUserInitial \}\}<\/span>\s*<span class="pm-user-copy"><strong :title="currentUserName">\{\{ currentUserName \}\}<\/strong><small :title="currentUserRoleLabel">\{\{ currentUserRoleLabel \}\}<\/small><\/span>\s*<button class="pm-logout" type="button" :disabled="isLoggingOut" aria-label="退出应用系统" @click="logoutSystem"><ConsoleIcon name="logout" \/><\/button>\s*<\/div>/)
  // 账号行必须是侧栏的最后一个元素（离开侧栏之前），否则又会被顶栏那类信息挤上去。
  assert.match(source, /<button class="pm-logout"[\s\S]*?<\/div>\s*<\/aside>/)
  // 角色名取服务端角色目录（不硬编码角色码），目录未就绪时退回角色码，不出现空白。
  assert.match(source, /const currentUserInitial = computed\(\(\) => \{/)
  assert.match(source, /const currentUserRoleLabel = computed\(\(\) => \{/)
  assert.match(source, /const names = new Map\(applicationRoles\.value\.map\(\(role\) => \[role\.code, role\.name\]\)\)/)
  assert.match(source, /new Set\(roles\.map\(\(role\) => names\.get\(role\) \|\| role\)\.filter\(Boolean\)\)\]\.join\('、'\) \|\| '未分配角色'/)
  // 目录是静态清单：随工作区加载预热（不 await，失败只影响副标题文案，不阻塞首屏）。
  const loadWorkspaceBody = source.match(/async function loadWorkspace\(\)[\s\S]*?\n\}/)
  assert.ok(loadWorkspaceBody, '工作区加载函数应存在')
  assert.match(loadWorkspaceBody[0], /^\s*loadApplicationRoles\(\)$/m)
  // 样式：新头像/账号行存在，旧顶栏用户块彻底移除（避免留下死规则）。
  assert.match(styles, /\.pm-topbar-avatar,\s*\n\.pm-avatar \{/)
  assert.match(styles, /\.pm-sidebar-user \{/)
  assert.match(styles, /\.pm-logout \{/)
  assert.doesNotMatch(styles, /\.pm-user-return/)
  assert.doesNotMatch(styles, /\.pm-user \{/)
  // 通知面板原为顶栏账号块预留 110px，去掉该块后必须重新对齐到铃铛。
  assert.doesNotMatch(styles, /right: 110px/)
  assert.match(styles, /\.pm-notifications \{[\s\S]*?right: calc\(var\(--pm-pad-page\) \+ 43px\);/)
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

test('服务项操作台的负责人从人员资质库选择而不是填写用户 ID', () => {
  assert.match(source, /listQualifiedPersonnel\(\{/)
  assert.match(source, /<SearchableSelect v-model="operationForm\.teamLeadID"[^>]*:options="teamLeadOptions"/)
  assert.match(source, /<SearchableSelect v-model="operationForm\.projectManagerID"[^>]*:options="projectManagerOptions"/)
  assert.match(source, /<SearchableSelect v-model="engineerSelection"[^>]*:options="engineerOptions"[^>]*multiple/)
  assert.match(source, /const engineerSelection = computed/)
  assert.doesNotMatch(source, /v-model\.trim="operationForm\.teamLeadID"/)
  assert.doesNotMatch(source, /placeholder="至少一个用户 ID"/)
})

test('待分配阶段支持带原因的受控撤销，且只向具备撤销权限的角色显示入口', () => {
  assert.match(source, /const canRevokeTeam = computed\(\(\) => permissionSet\.value\.has\('project\.team\.revoke'\)\)/)
  assert.match(source, /const canRevokeExecution = computed\(\(\) => permissionSet\.value\.has\('project\.execution\.revoke'\)\)/)
  assert.match(source, /async function revokeSelectedAssignment\(kind\)/)
  assert.match(source, /item\.status === '待分配'/)
  assert.match(source, /请输入撤销\$\{label\}的原因/)
  assert.match(source, /expected_version: Number\(item\.version\) \|\| 0/)
  assert.match(source, /await revokeTeamAssignment\(item\.id, payload\)/)
  assert.match(source, /await revokeExecutionAssignment\(item\.id, payload\)/)
  assert.match(source, /v-if="canRevokeExecution"[\s\S]*撤销执行团队/)
  assert.match(source, /v-if="canRevokeTeam"[\s\S]*撤销团队负责人/)
  assert.match(pmApiSource, /service-items\/\$\{encodeURIComponent\(itemID\)\}\/team-assignment\/revoke/)
  assert.match(pmApiSource, /service-items\/\$\{encodeURIComponent\(itemID\)\}\/execution-assignment\/revoke/)
})

test('待分配服务项可按拆解管理权限退回拆解确认', () => {
  assert.match(source, /^\s+returnServiceItemToDecomposition,$/m)
  assert.match(source, /async function returnSelectedToDecomposition\(\)/)
  assert.match(source, /item\.status !== '待分配'/)
  assert.match(source, /请输入退回拆解确认的原因/)
  assert.match(source, /returnServiceItemToDecomposition\(item\.id, \{ reason: String\(reason\)\.trim\(\), expected_version: Number\(item\.version\) \|\| 0 \}\)/)
  assert.match(source, /v-if="canManageDecomposition"[^>]*@click="returnSelectedToDecomposition"[^>]*>退回拆解确认/)
  assert.match(source, /DECOMPOSITION_RETURNED: '服务项已退回拆解确认'/)
  assert.match(pmApiSource, /service-items\/\$\{encodeURIComponent\(itemID\)\}\/decomposition-return/)
})

test('退回拆解确认的项目整体退出任务分配列表', () => {
  assert.match(source, /const projectStatusForItem = \(item\) => projectByID\.value\.get\(item\?\.project_id\)\?\.status \|\| ''/)
  assert.match(source, /const allocationItems = computed\(\(\) => serviceItems\.value\.filter\(\(item\) => item\.status === '待分配' && projectAllowsNode\(item, 'allocation'\)\)\)/)
  assert.match(source, /allocation: allocationItems\.value\.map/)
  assert.match(source, /activeSection === 'allocation'" :items="allocationItems"/)
  assert.match(source, /watch\(\[activeSection, activeNodeItems\],[\s\S]*selectedServiceItemIDs\.value = selectedServiceItemIDs\.value\.filter/)
})

test('所有业务节点只展示当前归属项目并在回退后清除原节点选择', () => {
  assert.match(source, /const latestWorkflowEventByItem = computed/)
  assert.match(source, /IMPLEMENTATION_PLAN_REVOKED/)
  assert.match(source, /PREPARATION_REVOKED/)
  assert.match(source, /event\.payload\?\.kind === 'FIELD_TO_PREPARATION'/)
  assert.match(source, /import \{ implementationPlanReady, projectAllowsWorkflowNode \} from '@\/modules\/project_management\/workflowNode'/)
  assert.match(workflowNodeSource, /export function implementationPlanReady\(item\)/)
  assert.match(workflowNodeSource, /Boolean\(item\.team_lead_id && item\.project_manager_id && \(item\.engineer_ids \|\| \[\]\)\.length\)/)
  assert.match(workflowNodeSource, /item\.conflict_status === 'PASSED'/)
  assert.match(source, /projectAllowsNode\(item, 'planning'\) && implementationPlanReady\(item\)/)
  assert.match(source, /const exceptionItems = computed\(\(\) => serviceItems\.value\.filter\(\(item\) => item\.status === '异常处理中' && projectAllowsNode\(item, 'exceptions'\)\)\)/)
  assert.match(source, /exceptionItemIDs\.value\.has\(event\.service_item_id\)/)
  assert.match(source, /const activeNodeItems = computed\(\(\) => \(\{/)
  for (const node of ['allocation', 'inbox', 'planning', 'preparation', 'assignments', 'methods', 'exceptions', 'reports', 'implementation']) {
    assert.match(source, new RegExp(`${node}: \\w+Items\\.value`))
  }
  assert.match(source, /ServiceItemPicker :items="implementationItems"/)
  assert.match(source, /ServiceItemPicker v-else :items="activeNodeItems"/)
  assert.match(source, /watch\(\[activeSection, activeNodeItems\],[\s\S]*selectedServiceItemIDs\.value = selectedServiceItemIDs\.value\.filter/)
  assert.match(source, /\['现场实施完成', '报告编制', '已完成'\]\.includes\(projectStatus\)/)
  // 现场实施页面不得再渲染包含拆解、分配、报告和完成态的全生命周期看板。
  assert.match(source, /const implementationKanbanColumns = computed/)
  assert.match(source, /const projectIDs = new Set\(implementationItems\.value/)
  assert.match(source, /const cards = projects\.value\.filter\(\(project\) => projectIDs\.has\(project\.id\)\)/)
  assert.match(source, /v-for="column in implementationKanbanColumns"/)
  assert.doesNotMatch(source, /v-for="column in kanbanColumns"/)
  assert.match(source, /当前节点项目/)
})

test('独立人员查询区已移除，三个下拉按对应角色读取完整人员资质库', () => {
  assert.match(source, /teamLead: 'team_lead'/)
  assert.match(source, /projectManager: 'project_manager'/)
  assert.match(source, /engineer: 'engineer'/)
  const assignmentPersonnelLoader = source.match(/async function loadPersonnel\(\) \{[\s\S]*?\n\}\n\n\/\/ 人员资质只能/)
  assert.ok(assignmentPersonnelLoader, '缺少任务分配人员资质加载函数')
  assert.match(assignmentPersonnelLoader[0], /role_code: roleCode/)
  assert.match(source, /listQualifiedPersonnel\(\{ role_code: roleCode, page: 1, page_size: 50 \}\)/)
  assert.match(source, /Promise\.all\(Array\.from\(\{ length: pageCount - 1 \}/)
  assert.match(source, /byRole\[roleCode\] = \[\.\.\.personnelByID\.values\(\)\]/)
  assert.match(pmApiSource, /request\(`\/qualified-personnel\$\{query \? `\?\$\{query\}` : ''\}`\)/)
  assert.doesNotMatch(source, /查找人员资质/)
  assert.doesNotMatch(source, /personnelSearchPerformed|personnelSearchResults|searchPersonnel|selectPersonnelForRole/)
  assert.doesNotMatch(styles, /\.pm-personnel-(?:lookup|search|results|result-grid|result-card)/)
  assert.match(source, /const teamLeadOptions = computed/)
  assert.match(source, /const projectManagerOptions = computed/)
  assert.match(source, /const engineerOptions = computed/)
  assert.match(source, /:options="teamLeadOptions"/)
  assert.match(source, /:options="projectManagerOptions"/)
  assert.match(source, /:options="engineerOptions"/)
  assert.match(source, /search-placeholder="搜索姓名、资质编号或资质编码"/)
  assert.doesNotMatch(source, /personnelOptions/)
})

test('服务项操作台统一使用带模糊搜索的下拉组件', () => {
  assert.match(source, /import SearchableSelect from '@\/modules\/project_management\/components\/SearchableSelect\.vue'/)
  assert.match(source, /<SearchableSelect v-model="operationForm\.severity"[^>]*:options="deviationSeverityOptions"/)
  assert.match(source, /<SearchableSelect v-model="operationForm\.decision"[^>]*:options="deviationDecisionOptions"/)
  assert.doesNotMatch(source, /<select v-model="operationForm\./)
  assert.match(searchableSelectSource, /filterSearchableOptions\(props\.options, keyword\.value\)/)
  assert.match(searchableSelectSource, /type="search"/)
  assert.match(searchableSelectSource, /role="combobox"/)
  assert.match(styles, /\.pm-multi-trigger \{[^}]*padding: 9px 26px 9px 11px;/)
  assert.match(styles, /\.pm-multi-trigger \{[^}]*url\("data:image\/svg\+xml;charset=utf-8,[^"]*stroke='%230f172a'/)
  // 箭头尺寸与内缩需与原生箭头实测一致（headless Chrome 实测：原生 10x6、右缘距边框 4px）。
  assert.match(styles, /\.pm-multi-trigger \{[^}]*no-repeat right 2px center\/14px;/)
  assert.match(styles, /\.pm-multi-trigger \{[^}]*border: 1px solid var\(--pm-line\);/)
  assert.match(styles, /\.pm-multi-trigger \{[^}]*border-radius: var\(--pm-r-sm\);/)
  assert.match(styles, /\.pm-multi-caret \{ display: none; \}/)
  assert.match(source, /function toggleMulti\(/)
  assert.doesNotMatch(source, /<select[^>]*multiple/)
  assert.doesNotMatch(source, /按住 ⌘ \/ Ctrl 可多选/)
  // 设备与能力码已从任务分配移除：设备清单在「实施准备」阶段登记。
  assert.doesNotMatch(source, /const equipmentSelection = computed/)
  assert.doesNotMatch(source, /const equipmentOptions = computed/)
  assert.doesNotMatch(source, /capabilityCodesForEquipment/)
  assert.doesNotMatch(source, /capabilityCodeList/)
  assert.doesNotMatch(source, /operationForm\.equipmentIDs/)
  assert.doesNotMatch(source, /operationForm\.requiredCodes/)
  assert.match(source, /设备清单在「实施准备」阶段确定/)
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

test('新建人员资质从基础平台人员目录单选，设备仍使用资源名称输入', () => {
  assert.match(source, /async function loadCapabilityPersonnel\(\)/)
  assert.match(source, /await listPersonnel\(\{ page: 1, page_size: 50 \}\)/)
  assert.match(source, /const capabilityPersonOptions = computed/)
  assert.match(source, /人员名称 <em>\*<\/em><\/span><select v-model="capabilityDialog\.user_id"/)
  assert.match(source, /v-for="person in capabilityPersonOptions"/)
  assert.match(source, /@change="onCapabilityPersonChange"/)
  assert.match(source, /<label v-else><span>资源名称 <em>\*<\/em><\/span><input v-model\.trim="capabilityDialog\.resource_name" required placeholder="例如 基站A"/)
  assert.match(source, /user_id: form\.resource_type === 'PERSON' \? form\.user_id : ''/)
})

test('资质与能力编码由系统配置目录统一管理并按类型多选', () => {
  assert.match(source, /'capability-codes'/)
  assert.match(source, /'capability-codes': \['资质 \/ 能力编码配置'/)
  assert.match(source, /kind: 'capability-codes'[\s\S]*key: 'scope', label: '编码'[\s\S]*key: 'check_type', label: '适用类型'/)
  assert.match(source, /value: 'PERSON', label: '人员资质'/)
  assert.match(source, /value: 'EQUIPMENT', label: '设备能力'/)
  assert.match(source, /function decorateRule\(rule\) \{[\s\S]*resource_type_label: rule\.check_type === 'PERSON' \? '人员资质' : rule\.check_type === 'EQUIPMENT' \? '设备能力'/)
  assert.match(source, /rules\.value = ruleRows\.map\(decorateRule\)/)
  // 分表自增 ID 可重复，配置保存回填必须同时比对 kind。
  assert.match(source, /findIndex\(\(rule\) => rule\.kind === saved\.kind && rule\.id === saved\.id\)/)
  // 人员与设备各取对应类型的启用目录，两个入口均不再自由输入编码。
  assert.match(source, /capabilityCodeOptions\('EQUIPMENT', equipmentCodeSelection\.value\)/)
  assert.match(source, /capabilityCodeOptions\(capabilityDialog\.value\?\.resource_type \|\| 'PERSON', capabilityCodeSelection\.value\)/)
  assert.match(source, /openMulti === 'equipmentCodes'/)
  assert.match(source, /v-model="capabilityCodeSelection"[\s\S]*:options="capabilityDialogCodeOptions"[\s\S]*value-key="code"[\s\S]*multiple/)
  assert.match(source, /search-placeholder="搜索编码或名称"/)
  assert.match(source, /menu-z-index="calc\(var\(--pm-z-modal, 50\) \+ 1\)"/)
  assert.doesNotMatch(source, /openMulti === 'capabilityCodes'/)
  assert.doesNotMatch(source, /onCapabilityCodesKeydown|toggleCapabilityCode/)
  assert.doesNotMatch(source, /v-model\.trim="equipmentForm\.codes"/)
  assert.doesNotMatch(source, /v-model\.trim="capabilityDialog\.codes"/)
  assert.match(source, /codes: \[\.\.\.equipmentCodeSelection\.value\]/)
  assert.match(source, /codes: \[\.\.\.capabilityCodeSelection\.value\]/)
  // 空目录明确引导到系统配置；历史停用/删除值标记后保留。
  assert.match(source, /请先到「系统配置 → 资质 \/ 能力编码」/)
  assert.match(source, /不在当前编码目录/)
  assert.match(source, /仅保留历史引用/)
  assert.match(source, /validateCapabilityCodes\('EQUIPMENT', equipmentCodeSelection\.value, equipmentForm\.value\.originalCodes \|\| \[\]\)/)
  assert.match(source, /const original = new Set\(originalCodes\.map\(capabilityCodeKey\)\)/)
})

test('执行总览新增准时交付率趋势、检测类别分布与团队资源利用率三卡，数据由真实记录推导', () => {
  assert.match(source, /pm-dashboard-grid-3/)
  assert.match(source, /近 12 周准时交付率趋势/)
  assert.match(source, /检测类别分布（占比）/)
  assert.match(source, /团队资源利用率/)
  assert.match(source, /const weeklyDeliveryTrend = computed/)
  // 趋势卡按后端真实发出的事件名过滤：此前断言的是不存在的
  // FIELD_IMPLEMENTATION_COMPLETED，恰好把「趋势恒空」这个缺陷固化成了绿测。
  assert.match(source, /const completedDeliveryEvents = computed\(\(\) => deliveryEvents\.value\.filter\(\(event\) => event\.type === 'FIELD_COMPLETED'\)\)/)
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
  assert.doesNotMatch(source, /请填写现场计划/)
  assert.doesNotMatch(source, /site_plan: form\.sitePlan/)
  assert.match(styles, /textarea\[placeholder="现场实施步骤和窗口"\]/)
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
  assert.match(source, /const projectStatusNodes = \['待拆解确认', '待分配', '待实施', '实施准备中', '实施中', '异常处理中', '现场实施完成', '报告编制', '已完成'\]/)
  assert.match(source, /const projectStatusFilters = \[\.\.\.projectStatusNodes, '补充协议处理中', '已终止'\]/)
  assert.match(source, /const projectStatusCompleted = '已完成'/)
  // 状态筛选必须由节点表生成，而不是手写 option 列表。
  assert.match(source, /<option v-for="node in projectStatusFilters"/)
  // 现场看板只消费服务端返回的当前现场状态，不再把全生命周期项目复制进来。
  assert.match(source, /statuses: \['实施准备中'\]/)
  assert.match(source, /statuses: \['实施中'\]/)
  assert.doesNotMatch(source, /statuses: \['待拆解确认', '待分配'\]/)
  assert.doesNotMatch(source, /statuses: \[projectStatusCompleted, '补充协议处理中', '已终止'\]/)
  assert.match(source, /:class="statusTone\(card\.status\)"/)
  // 不得再用"还有报告未归档"二次推断项目完成态。
  assert.doesNotMatch(source, /reportActiveProjectIDs/)
  assert.match(source, /project\.status === projectStatusCompleted/)
})

test('新建项目入口仅向超级管理员和业务管理员开放', () => {
  // 服务端 POST /projects 除 project.create 外还校验角色，前端保持同一可见性口径。
  assert.match(source, /const projectCreationRoles = new Set\(\['admin', 'business_admin'\]\)/)
  assert.match(source, /session\.value\.permissions\.includes\('project\.create'\)/)
  assert.match(source, /roles\.some\(\(role\) => projectCreationRoles\.has\(role\)\)/)
  assert.match(source, /v-if="activeSection === 'projects' && canCreateProject"/)
  // 入口按钮不得再以「只看 section」的方式无条件渲染。
  assert.doesNotMatch(source, /v-if="activeSection === 'projects'" class="pm-button primary" @click="openCreateProject"/)
})

test('团队负责人、项目经理、工程师显示姓名而不是平台 ID', () => {
  // 服务端批量解析 user_id → 姓名，前端缓存映射并在工作区加载后补齐。
  assert.match(source, /^\s+resolvePersonnelNames,$/m)
  assert.match(source, /const personnelNameByID = ref\(new Map\(\)\)/)
  assert.match(source, /function personLabel\(userID, fallback = '待指派'\)/)
  assert.match(source, /function personListLabel\(ids, fallback = '未指派'\)/)
  assert.match(source, /async function loadPersonnelNames\(/)
  assert.match(source, /await loadPersonnelNames\(\)/)
  // 解析不到时显示占位符，绝不回退成对业务用户无意义的 ULID。
  assert.match(source, /personnelNameByID\.value\.get\(id\) \|\| '—'/)
  assert.doesNotMatch(source, /name: `\$\{id\}（当前值）`/)
  assert.doesNotMatch(source, /person\.display_name \|\| person\.user_id/)
  // 列表与详情一律走姓名渲染：每个 owner 值都必须是姓名渲染（或本来就是姓名的字段），
  // 不得再出现 owner: xxx_id 这种直接渲染平台 ID 的写法。
  const ownerValues = [...source.matchAll(/owner: (personLabel\(|personListLabel\(|p\.manager|c\.resource_type)/g)]
  const ownerTotal = [...source.matchAll(/owner: /g)]
  assert.equal(ownerValues.length, ownerTotal.length, 'every owner value must render a person name or a name field')
  assert.match(source, /\{ label: '团队负责人', value: personLabel\(record\.team_lead_id, '待分配'\) \}/)
  assert.match(source, /\{ label: '项目经理', value: personLabel\(record\.project_manager_id, '待指派'\) \}/)
  assert.match(source, /\{ label: '工程师', value: personListLabel\(record\.engineer_ids\) \}/)
})

test('新建项目入口只向获准角色显示', () => {
  // 即使错误授予 project.create，非 admin/business_admin 也不显示入口。
  assert.match(source, /const projectCreationRoles = new Set\(\['admin', 'business_admin'\]\)/)
  assert.match(source, /roles\.some\(\(role\) => projectCreationRoles\.has\(role\)\)/)
  assert.match(source, /v-if="activeSection === 'projects' && canCreateProject"/)
  assert.doesNotMatch(source, /v-if="activeSection === 'projects'" class="pm-button primary" @click="openCreateProject"/)
})

test('项目页通过项目后端机器集成读取已审批合同', () => {
  // 浏览器只持有项目会话；合同系统鉴权由项目后端的机器身份完成。
  assert.match(pmApiSource, /export async function listApprovedContracts\(params = \{\}\)/)
  assert.match(pmApiSource, /request\(`\/approved-contracts\$\{search \? `\?\$\{search\}` : ''\}`\)/)
  assert.match(source, /listApprovedContracts\(\{ limit: 200 \}\)/)
  assert.doesNotMatch(source, /suppressLoginRedirect/)
})

test('新建项目合同编号由合同管理系统自动带入且提交时不可伪造', () => {
  assert.match(source, /createForm\.value\.contract = contract\.contract_number \|\| ''/)
  assert.match(source, /<span>合同编号<\/span><input :value="createForm\.contract" readonly aria-readonly="true" \/>/)
  assert.match(source, /以合同管理系统中的合同编号为准，不支持手工修改/)

  const saveCreate = source.slice(source.indexOf('async function saveCreate()'), source.indexOf('function exportProjects()'))
  assert.match(saveCreate, /contract_id: createForm\.value\.contractID/)
  assert.doesNotMatch(saveCreate, /contract: createForm\.value\.contract/)
  assert.doesNotMatch(saveCreate, /customer: createForm\.value\.customer/)
  assert.doesNotMatch(saveCreate, /contract_version: createForm\.value\.contractVersion/)
})

test('新建项目不依赖合同系统浏览器会话', () => {
  assert.match(source, /listApprovedContracts,[\s\S]*from '@\/modules\/project_management\/api\/projectManagement'/)
  assert.doesNotMatch(source, /modules\/contract_management\/api\/contract/)
  assert.doesNotMatch(source, /当前合同系统会话或权限不可用/)
  assert.doesNotMatch(source, /openContractAuthorizationInNewTab/)
})

test('项目健康度字段已移除，风险项目改由服务端派生口径统计', () => {
  // 健康度字段已从领域模型与接口中删除，前端不得再引用 project.health 或健康度样式。
  assert.doesNotMatch(source, /health/i)
  assert.doesNotMatch(styles, /health/i)
  assert.doesNotMatch(source, /健康度/)
  // 风险口径由服务端统一派生（domain.IsRiskProject）：派生状态风险，或存在已终止服务项。
  // 前端不得再复刻该规则——前后端各写一遍会在口径调整时出现不一致。
  assert.match(source, /const isRiskProject = \(project\) => Boolean\(project && project\.risk\)/)
  assert.match(source, /const riskProjectCount = computed\(\(\) => projects\.value\.filter\(isRiskProject\)\.length\)/)
  assert.match(source, /risk: project\.risk/)
  assert.doesNotMatch(source, /riskProjectStatuses/)
})

test('业务管理员项目列表展示合同流程完成但尚未建项目的准确统计', () => {
  assert.match(source, /pending_project_creation: 0, pending_project_creation_available: false/)
  assert.match(source, /v-if="canCreateProject" type="button" class="pm-kpi red" @click="openCreateProject"/)
  assert.match(source, /<span>待新建项目<\/span>/)
  assert.match(source, /dashboard\.pending_project_creation_available \? dashboard\.pending_project_creation : '—'/)
  assert.match(source, /合同流程已完成 · 尚未建项目/)
  // 非项目创建角色仍保留原风险入口，避免改变项目经理等角色的列表能力。
  assert.match(source, /v-else type="button" class="pm-kpi red" @click="navigate\('monitoring'\)"/)
})

test('实施计划提交人员清单，设备清单在实施准备登记并校验占用', () => {
  // 计划只提交人员：设备与使用时段随实施准备提交。
  assert.match(source, /personnel: form\.personnel\.map\(\(row\) => \(\{ resource_type: 'PERSON', resource_id: row\.resourceID, window_start: row\.windowStart, window_end: row\.windowEnd, note: row\.note \}\)\)/)
  assert.match(source, /function planPersonnelFor\(/)
  assert.match(source, /function planPersonnelRows\(/)
  // 至少一名人员与服务端同口径，先给即时提示。
  assert.match(source, /if \(!personRows\.length\) \{ showToast\('请至少添加一名实施人员', 'warning'\); return \}/)
  // 实施准备：设备清单必填、提交时带上使用时段。
  assert.match(source, /if \(!form\.equipment\.length\) \{ showToast\('请至少选择一台实施设备', 'warning'\); return \}/)
  assert.match(source, /equipment: form\.equipment\.map\(\(row\) => \(\{ resource_type: 'EQUIPMENT', resource_id: row\.resourceID, window_start: row\.windowStart, window_end: row\.windowEnd, note: row\.note \}\)\)/)
  assert.match(source, /function planEquipmentFor\(/)
  // 添加设备只能从设备目录挑选，不调用设备维护接口（设备档案由设备管理员维护）。
  assert.match(source, /function addPlanEquipment\(equipmentItem\)/)
  assert.match(source, /const planEquipmentFiltered = computed/)
  assert.match(source, /@click="openEquipmentPicker">＋ 添加设备</)
  assert.match(source, /class="pm-plan-window"/)
  // 已占用设备置灰并显示占用方与日期。
  assert.match(source, /function equipmentReservationLabel\(resourceID\)/)
  assert.match(source, /listEquipmentReservations\(item\.id\)/)
  assert.match(source, /已被占用/)
  assert.match(source, /pm-dialog-wide/)
})

test('设备在位状态与使用范围在设备能力维护中维护，借出中可归还', () => {
  // 使用范围（可借出 / 仅在公司使用）随设备档案保存。
  assert.match(source, /usage_scope: equipmentForm\.value\.usageScope/)
  assert.match(source, /<option value="COMPANY_ONLY">仅在公司使用（不可借出）<\/option>/)
  // 在位状态由占用时段派生，列表显示借出中的占用方与时段，并提供归还。
  assert.match(source, /function equipmentPresenceLabel\(item\)/)
  assert.match(source, /不在公司（借出中）/)
  assert.match(source, /async function returnEquipment\(item\)/)
  assert.match(source, /returnServiceItemEquipment\(serviceItemID, item\.resource_id\)/)
  // 选择器按原因置灰：仅在公司使用 > 当前不在公司 > 时段已被占用。
  assert.match(source, /function equipmentUnavailableReason\(item\)/)
  assert.match(source, /仅在公司使用 · 不可借出/)
  assert.match(source, /当前不在公司/)
  assert.match(source, /function equipmentPickerState\(item\)/)
  // 已过检定到期日的设备不进入实施准备选择器；接口侧仍会二次校验，避免绕过前端。
  assert.match(source, /function isEquipmentValidForPreparation\(item\)/)
  assert.match(source, /planned_start/)
  assert.match(source, /planned_end/)
  assert.match(source, /validFrom <= usageStart/)
  assert.match(source, /validUntil >= usageEnd/)
  assert.match(source, /const planEquipmentOptions = computed\(\(\) => equipment\.value\.filter\(isEquipmentValidForPreparation\)\)/)
})

test('人员资质不受日期限制且有效期只约束设备', () => {
  assert.match(source, /item\.resource_type === 'EQUIPMENT' && item\.valid_until/)
  assert.match(source, /capabilityDialog\.resource_type === 'EQUIPMENT'[^>]*><span>检定开始/)
  assert.match(source, /capabilityDialog\.resource_type === 'EQUIPMENT'[^>]*><span>检定到期/)
  assert.match(source, /人员资质不限制有效期；停用资质或人员身份失效后将不能参与项目分配/)
  assert.match(source, /form\.resource_type === 'EQUIPMENT' && form\.valid_from/)
  assert.match(source, /form\.resource_type === 'EQUIPMENT' && form\.valid_until/)
  assert.match(source, /if \(capability\?\.resource_type === 'PERSON' \|\| row\.resourceType === 'PERSON'\) return '不限制'/)
})

test('已有设备的使用范围在资质与能力、设备维护两处都可修改且不会被重置', () => {
  // 资质与能力对话框：设备行显示使用范围，编辑既有记录时带回原值，保存时提交。
  assert.match(source, /capabilityDialog\.resource_type === 'EQUIPMENT'[\s\S]{0,60}capabilityDialog\.usage_scope/)
  assert.match(source, /usage_scope: item\.usage_scope \|\| 'ANY'/)
  assert.match(source, /usage_scope: form\.usage_scope \|\| 'ANY'/)
  // 设备能力维护表单：编辑既有设备同样带回原值。
  assert.match(source, /usageScope: item\.usage_scope \|\| 'ANY'/)
  assert.match(source, /<option value="COMPANY_ONLY">仅在公司使用（不可借出）<\/option>/)
})

test('设备选择器与清单表不再被两列表单栅格挤窄', () => {
  // 选择器用宽弹窗 + 专用可滚动主体，表格不再放进 .pm-form 的两列栅格。
  assert.match(source, /class="pm-dialog pm-dialog-wide"/)
  assert.match(source, /class="pm-dialog-body"/)
  // 弹窗自身不得再用两列表单栅格：抽出弹窗片段做精确断言。
  const pickerStart = source.indexOf('planEquipmentPickerOpen" class="pm-overlay')
  const pickerEnd = source.indexOf('</aside>', pickerStart)
  assert.ok(pickerStart !== -1 && pickerEnd > pickerStart, '未找到设备选择器弹窗')
  assert.doesNotMatch(source.slice(pickerStart, pickerEnd), /class="pm-form"/)
  assert.match(styles, /\.pm-dialog-wide \{ width: min\(920px, 94vw\); \}/)
  assert.match(styles, /\.pm-plan-resources \{[^}]*grid-column: 1 \/ -1;/)
  assert.match(styles, /\.pm-table-picker \{ min-width: 640px; \}/)
  // 弹窗内层级必须走 UniLab 令牌（表头吸顶）。
  assert.match(styles, /\.pm-table-picker th \{ position: sticky; top: 0; z-index: var\(--pm-z-sticky\); \}/)
})

test('实施准备不再要求设备申领单，设备清单本身就是申领依据', () => {
  assert.doesNotMatch(source, /设备申领单/)
  assert.doesNotMatch(source, /equipmentRequestID/)
  assert.doesNotMatch(source, /equipment_request_id/)
  // 行程预订单仍然必填，并随准备事件提交；设备清单一起提交。
  assert.match(source, /<label><span>行程预订单 <em>\*<\/em><\/span>/)
  // 实施准备提交时带上服务项版本：服务端据此判定"我基于的是不是最新一版"（不匹配即 409）。
  assert.match(source, /startImplementationPreparation\(item\.id, \{ expected_version: Number\(item\.version\) \|\| 0, travel_request_id: form\.travelRequestID/)
  assert.match(source, /equipment: form\.equipment\.map\(/)
})

test('人员资质档案展示并复核基础平台身份状态', () => {
  // 资质在本系统维护，但"这个人是否仍在职"只能由基础平台回答：
  // 界面必须展示复核结果，并提供回平台复核的入口。
  assert.match(source, /^\s+syncPersonnelIdentities,$/m)
  assert.match(source, /async function syncIdentities\(\)/)
  assert.match(source, /const result = await syncPersonnelIdentities\(\)/)
  assert.match(source, /function identityStatusLabel\(status\)/)
  assert.match(source, /已离职\/查无此人/)
  assert.match(source, /@click="syncIdentities"/)
  assert.match(source, /<th>人员状态<\/th>/)
  assert.match(source, /statusTone\(item\.identity_status\)/)
})

test('项目表提供真实分页控件', () => {
  assert.match(source, /const projectPage = ref\(1\)/)
  assert.match(source, /const projectPageCount = computed/)
  assert.match(source, /const pagedProjects = computed/)
  assert.match(source, /v-for="project in pagedProjects"/)
  // 筛选变化后回到第一页，避免停在越界页码看到空表。
  assert.match(source, /watch\(\[keyword, statusFilter, categoryFilter, teamFilter\], \(\) => \{ projectPage\.value = 1 \}\)/)
  assert.match(source, /:disabled="projectPage <= 1" @click="gotoProjectPage\(projectPage - 1\)"/)
  assert.match(source, /:disabled="projectPage >= projectPageCount" @click="gotoProjectPage\(projectPage \+ 1\)"/)
})

test('站点档案下线后新建项目直接使用实施场所文本', () => {
  assert.doesNotMatch(source, /^\s+listSites,$/m)
  assert.doesNotMatch(source, /^\s+upsertSite,$/m)
  assert.doesNotMatch(source, /^\s+deleteSite,$/m)
  assert.doesNotMatch(source, /\{ key: 'sites', label: '站点档案'/)
  assert.doesNotMatch(source, /activeSection === 'sites'/)
  assert.doesNotMatch(source, /实施场所必须与一个启用的站点档案名称一致/)
  assert.doesNotMatch(source, /const linkedSite =/)
  assert.doesNotMatch(source, /site_code: createForm\.value\.siteCode/)
  assert.match(source, /<input v-model\.trim="createForm\.site" required placeholder="例如 杭州机房" \/>/)
  assert.match(source, /site: createForm\.value\.site, category: link\.category/)
})

test('每个写操作入口都按服务端同款权限码门控', () => {
  // 只门控少数几个权限码时，其余角色会看到自己无权执行的按钮，点击必然 403。
  for (const guard of [
    "canAssignTeam = computed(() => permissionSet.value.has('project.team.assign'))",
    "canPlanImplementation = computed(() => permissionSet.value.has('project.implementation.plan'))",
    "canExecuteField = computed(() => permissionSet.value.has('project.field.execute'))",
    "canCompleteField = computed(() => permissionSet.value.has('project.field.complete'))",
    "canReportDeviation = computed(() => permissionSet.value.has('project.deviation.report'))",
    "canReviewDeviation = computed(() => permissionSet.value.has('project.deviation.review'))",
    "canManageRules = computed(() => permissionSet.value.has('project_rule.manage'))",
    "canManageFieldPermissions = computed(() => permissionSet.value.has('project.field_permission.manage'))",
    "canConfirmDecomposition = computed(() => permissionSet.value.has('service_item.confirm'))",
  ]) {
    assert.ok(source.includes(guard), `缺少权限守卫：${guard}`)
  }
  // 各按钮必须挂上对应守卫，而不是无条件渲染。
  assert.match(source, /v-if="canSubmitAllocation" class="pm-button primary" :disabled="saving" @click="runOperation\('allocation'\)"/)
  // 确认拆解走 POST /service-items/confirm（服务端要求 service_item.confirm），与
  // 调整拆解的 project.decomposition.manage 是两个权限码，不能共用同一个守卫。
  assert.match(source, /v-if="activeSection === 'decomposition' && canConfirmDecomposition"[^>]*@click="confirmDecomposition"/)
  assert.match(source, /v-if="canPlanImplementation" class="pm-button primary" :disabled="saving \|\| !!planningBlocked"/)
  assert.match(source, /v-if="selectedServiceItem && canExecuteField" class="pm-form pm-operation-form"/)
  assert.match(source, /canCompleteField" class="pm-button" :disabled="saving" @click="runOperation\('complete'\)"/)
  assert.match(source, /v-if="canReportDeviation" class="pm-button primary" :disabled="saving" @click="runOperation\('exception-report'\)"/)
  assert.match(source, /v-if="canReviewDeviation" class="pm-button" :disabled="saving" @click="runOperation\('exception-review'\)"/)
  assert.match(source, /v-if="canReviewSpecialMethod" class="pm-form-row"/)
  assert.match(source, /v-if="canManageResource" class="pm-link" @click="openCapabilityDialog\(item\)"/)
  assert.match(source, /v-if="canManageRules" class="pm-switch"/)
  // 报告推进按编制、审核、签发、归档四类职责分别授权。
  assert.match(source, /canAdvanceReportPhase\(reportPhaseNext\[item\.report_status\]\)/)
  for (const permission of ['project.report.prepare', 'project.report.review', 'project.report.issue', 'project.report.archive']) {
    assert.ok(source.includes(permission), `缺少报告阶段权限：${permission}`)
  }
  // 字段级权限页签只对持有该权限的角色可见，避免"能打开、提交必 403"。
  assert.match(source, /configKindsMeta\.filter\(\(meta\) => meta\.kind !== 'permissions' \|\| canManageFieldPermissions\.value\)/)
  // 页签隐藏后配置面板与「新建规则」不能仍按 activeSection 渲染：否则表头取回退后的
  // 首个可见配置、列表按被隐藏的 kind 过滤，得到标题与内容不符的空表。
  assert.match(source, /const isVisibleConfigSection = computed\(\(\) => visibleConfigKinds\.value\.some\(\(meta\) => meta\.kind === activeSection\.value\)\)/)
  assert.match(source, /v-else-if="isVisibleConfigSection"/)
  assert.match(source, /v-if="canManageRules && isVisibleConfigSection"/)
})

test('交付事件名与后端常量逐字一致', () => {
  // 后端只发 FIELD_COMPLETED；曾写成 FIELD_IMPLEMENTATION_COMPLETED，导致趋势图恒空。
  assert.match(source, /event\.type === 'FIELD_COMPLETED'/)
  assert.doesNotMatch(source, /FIELD_IMPLEMENTATION_COMPLETED/)
  assert.match(source, /FIELD_COMPLETED: '现场实施已完成'/)
})

test('拆解调整入口按 project.decomposition.manage 门控并调用真实接口', () => {
  // 业务管理员持有 project.decomposition.manage，此前前端没有任何入口调用该端点，
  // 拆解调整能力完全埋没；入口必须与能力一起补齐，并按同一权限码门控。
  assert.ok(source.includes("canManageDecomposition = computed(() => permissionSet.value.has('project.decomposition.manage'))"))
  assert.match(source, /v-if="activeSection === 'decomposition' && canManageDecomposition"[^>]*@click="openDecompositionAdjust"/)
  assert.match(source, /await adjustDecomposition\(project\.id, \{ reason: adjustForm\.value\.reason, supplement_contract_id: adjustForm\.value\.supplementContractID, items \}\)/)
  assert.match(source, /showToast\('拆解已调整，项目进入补充协议处理中'\)/)
  // 一次提交会替换该项目的全部服务项，对话框必须显示将被替换的目标项目，避免误操作。
  assert.match(source, /目标项目：<b>\{\{ decompositionProject \?/)
  // 服务端在同一事务里替换全部服务项，提交前必须校验前端必填项。
  assert.match(source, /每个服务项都要填写场所、批次与检测类别/)
  // API 客户端必须走真实端点而不是本地模拟。
  assert.match(pmApiSource, /export function adjustDecomposition\(projectID, payload\)/)
  assert.match(pmApiSource, /decomposition-adjustments/)
})

test('多选下拉对齐统一交互基线：aria 语义、键盘导航与已选 chip 回显', () => {
  // 服务项操作台由统一组件负责 aria、键盘搜索和多选 chip。
  assert.match(searchableSelectSource, /aria-haspopup="listbox"/)
  assert.match(searchableSelectSource, /:aria-expanded="open"/)
  assert.match(searchableSelectSource, /role="listbox"/)
  assert.match(searchableSelectSource, /role="option"/)
  assert.match(searchableSelectSource, /:aria-selected="isSelected\(option\)"/)
  // 键盘：↑↓ 移动高亮、Enter 勾选、Esc 关闭，选项支持禁用态。
  assert.match(searchableSelectSource, /event\.key === 'Escape'/)
  assert.match(searchableSelectSource, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/)
  assert.match(searchableSelectSource, /option\.disabled/)
  // 已选人员以 chip 回显并支持单个移除。
  assert.match(searchableSelectSource, /class="pm-search-select-chips"/)
  assert.match(searchableSelectSource, /@click\.stop="remove\(optionValue\(option\)\)"/)
  // 筛选栏下拉统一走 pm-filter-select（对齐原型 filter-select 形态）。
  assert.match(styles, /\.pm-filter-select \{/)
  assert.match(source, /class="pm-filter-select"/)
})

test('字段级权限的角色是服务端目录驱动的多选下拉，多选即每个角色各一条规则', () => {
  // 角色选项只能来自服务端角色目录：角色码写错时规则接口不会报错，但规则永远不会命中
  // 任何主体（field_permission 按 role_code 精确比对），属于只在运行期静默失效的错误。
  assert.match(source, /listApplicationRoles/)
  assert.match(pmApiSource, /export async function listApplicationRoles\(\) \{\n  const data = await request\('\/role-catalog'\)/)
  assert.match(source, /applicationRolesError/)
  assert.match(source, /applicationRolesRequest = listApplicationRoles\(\)/)
  // 配置元数据里「角色」不再是自由文本输入，而是多选下拉字段。
  assert.match(source, /\{ key: 'role_codes', label: '角色', field: 'roles', required: true \}/)
  assert.doesNotMatch(source, /key: 'role_code', label: '角色', field: 'text'/)
  assert.match(source, /v-if="field\.field === 'roles'" class="pm-field pm-span-full"/)
  // 默认多选：新建时选中值为数组，不要求按住 ⌘/Ctrl 加选。
  assert.match(source, /field\.field === 'roles' \? \[\] :/)
  assert.match(source, /<SearchableSelect v-model="configForm\.role_codes" :options="configRoleOptions" value-key="code" label-key="name"/)
  assert.match(source, /placeholder="请选择角色（可多选）" search-placeholder="搜索角色名称或编码"/)
  assert.match(source, /aria-label="选择字段级权限角色" menu-z-index="calc\(var\(--pm-z-modal, 50\) \+ 1\)" multiple required/)
  // 复用统一选择器：只在点击或键盘明确触发时展开，Teleport 菜单会按视口空间动态定位。
  assert.match(searchableSelectSource, /@click\.stop="toggle"/)
  assert.match(searchableSelectSource, /calculateSearchableSelectLayout/)
  assert.match(searchableSelectSource, /<Teleport to="body">/)
  assert.doesNotMatch(source, /openMulti === 'configRoles'|onConfigRolesKeydown|toggleConfigRole|configRoleChipOptions/)
  // 编辑既有规则时回填当前角色；已不在目录内的历史角色码要显式标注而不是静默改写。
  assert.match(source, /configForm\.value\.role_codes = rule\.role_code \? \[rule\.role_code\] : \[\]/)
  assert.match(source, /（不在角色目录中）/)
  // 服务端一条规则只承载一个角色，多选必须落成「每个角色各一条」，并明确提示条数。
  assert.match(source, /for \(const \[index, roleCode\] of roleCodes\.entries\(\)\)/)
  assert.match(source, /const body = \{ \.\.\.payload, role_code: roleCode \}/)
  assert.match(source, /已选 \{\{ configRoleSelection\.length \}\} 个角色，保存后每个角色各生成一条规则。/)
  assert.match(source, /已保存 \$\{created\.length\} 条配置（每个角色一条）/)
  assert.match(source, /showToast\('请至少选择一个角色', 'warning'\)/)
  // 逐条回填列表：中途失败也能看到已生效的规则，重试不会留下看不到的重复规则。
  assert.match(source, /applySavedRule\(saved\)\n        created\.push\(saved\)/)
})

test('字段级权限只能从有效字段白名单选择且仅开放真实生效的隐藏级别', () => {
  const supportedFields = [
    'name', 'customer', 'contract', 'category', 'team', 'manager', 'due',
    'batch', 'site', 'requirement', 'system', 'system_level', 'special', 'test_mode',
    'source_service_id', 'team_lead_id', 'project_manager_id', 'engineer_ids',
  ]
  assert.match(source, /const fieldPermissionFieldOptions = Object\.freeze\(\[/)
  for (const field of supportedFields) {
    assert.match(source, new RegExp(`\\{ value: '${field}', label:`), `missing field permission option ${field}`)
  }
  assert.match(source, /key: 'field_name', label: '字段', field: 'permission-field', required: true, options: fieldPermissionFieldOptions/)
  assert.match(source, /field\.field === 'permission-field'/)
  assert.match(source, /<SearchableSelect v-model="configForm\[field\.key\]" :options="field\.options"/)
  assert.match(source, /search-placeholder="搜索字段名称或编码"/)
  assert.doesNotMatch(source, /placeholder: '例如 report_revenue'/)

  const permissionMeta = source.slice(source.indexOf("{ kind: 'permissions'"), source.indexOf("{ kind: 'sla'"))
  assert.match(permissionMeta, /options: \[\{ value: 'hidden', label: '隐藏（接口返回 \*\*\*）' \}\]/)
  assert.doesNotMatch(permissionMeta, /value: 'view'|value: 'edit'/)
  assert.match(source, /field\.key === 'access_level' \? 'hidden' : ''/)
  assert.match(source, /configForm\.value\.access_level = 'hidden'/)
})

test('系统配置的规则可以删除：二次确认、按 kind 定位、删除后从列表移除', () => {
  // 以前配置规则只能新建/编辑/启停，配置错了或重复堆积无法清理。
  assert.match(source, /async function removeConfigRule\(rule\)/)
  // 停用开关本身可逆，删除不可恢复：必须先确认，且提示可逆替代手段。
  assert.match(source, /window\.confirm\(`确认删除配置「\$\{rule\.name \|\| rule\.id\}」？删除后无法恢复，如需临时停用请使用状态开关。`\)/)
  // kind 必填：六套配置表主键各自自增，只按 id 删会命中别的配置类型。
  assert.match(source, /const kind = rule\.kind \|\| activeSection\.value/)
  assert.match(source, /await deleteRule\(rule\.id, kind\)/)
  assert.match(source, /const index = rules\.value\.indexOf\(rule\)/)
  assert.match(source, /if \(index >= 0\) rules\.value\.splice\(index, 1\)/)
  assert.match(source, /showToast\(`配置「\$\{removed\?\.name \|\| rule\.name \|\| rule\.id\}」已删除`\)/)
  // 入口与新建、编辑同权限门控，避免"能建不能删"。
  assert.match(source, /class="pm-link pm-text-danger" :disabled="saving" @click="removeConfigRule\(rule\)">删除</)
  // API 客户端走真实端点，kind 作为查询串（与启停接口一致）。
  assert.match(pmApiSource, /export function deleteRule\(id, kind\) \{/)
  assert.match(pmApiSource, /return request\(`\/rules\/\$\{encodeURIComponent\(id\)\}\?kind=\$\{encodeURIComponent\(kind \|\| ''\)\}`\, \{ method: 'DELETE' \}\)/)
})

test('设备维护入口按 project.device.manage 门控，创建项目后提示拆解确认', () => {
  // 站点、资质、规则都按各自权限码门控入口，设备此前漏了：设备模块一旦对更多角色可见
  // 就会变成「能点必 403」，表单也只能填不能存。
  assert.match(source, /const canManageDevice = computed\(\(\) => Array\.isArray\(session\.value\?\.permissions\) && session\.value\.permissions\.includes\('project\.device\.manage'\)\)/)
  assert.match(source, /<form v-if="canManageDevice" class="pm-form pm-equipment-form" @submit\.prevent="saveEquipment">/)
  assert.match(source, /<button v-if="canManageDevice" class="pm-link" :disabled="saving" @click="editEquipment\(item\)">/)
  assert.match(source, /async function removeEquipment\(item\)/)
  assert.match(source, /@click="removeEquipment\(item\)">删除</)
  assert.match(pmApiSource, /export function deleteEquipment\(resourceID\) \{[\s\S]*method: 'DELETE'/)
  assert.match(source, /v-if="item\.presence === 'OUT_OF_COMPANY' && \(canManageDevice \|\| canPlanImplementation\)"/)
  // 只读角色要明确告知原因，而不是留一张静默无按钮的表单。
  assert.match(source, /当前角色只能查看设备台账；维护设备需要「设备维护」权限。/)
  // 手动创建的项目必须进入拆解确认，提示里写明下一步。
  assert.match(source, /showToast\(`项目 \$\{created\.id\} 已创建，服务项待拆解确认`\)/)
})

test('合同拆解规则配置按原型 PG-CFG-01 做成三段式，口径完全由服务端判定', () => {
  // 旧实现是两个自由文本框（名称 + 适用范围），表达不了原型的分组维度、检测类别域与覆盖规则。
  assert.doesNotMatch(source, /key: 'split-rules', label: '拆解规则', columns/)
  assert.match(source, /\{ key: 'split-rules', label: '合同拆解规则', icon: 'settings' \}/)
  // 新手引导先解释生效时机和三步顺序，并允许一键填入安全推荐值（仍需人工保存）。
  assert.match(source, /<h2 id="split-guide-title">3 步完成合同自动拆解<\/h2>/)
  assert.match(source, /已有项目不会被自动重算，可以放心先从推荐配置开始/)
  assert.match(source, /:disabled="splitConfigLoading \|\| splitPolicySaving" @click="applyRecommendedSplitPolicy">使用安全推荐配置<\/button>/)
  assert.match(source, /决定怎么分组/)
  assert.match(source, /补全类别要求/)
  assert.match(source, /处理特殊合同/)
  assert.match(source, /const splitPolicySummary = computed/)
  assert.match(source, /当前规则会怎样执行/)
  // ① 默认分组规则：分组维度 1/2 + 可选第三维、默认进入状态、摘要与缺规则处理。
  assert.match(source, /<h2>① 默认分组规则<\/h2>/)
  assert.match(source, /分组维度 1<\/span><select v-model="splitPolicy\.dimension_primary"/)
  assert.match(source, /分组维度 2<\/span><select v-model="splitPolicy\.dimension_secondary"/)
  assert.match(source, /分组维度 3（可选）<\/span><select v-model="splitPolicy\.dimension_tertiary"/)
  assert.match(source, /默认进入状态<\/span><select v-model="splitPolicy\.default_status"/)
  assert.match(source, /是否生成「技术要求摘要」/)
  assert.match(source, /分组规则缺失时<\/span><select v-model="splitPolicy\.missing_rule_action"/)
  assert.match(source, /范围变更检测<\/span><select v-model="splitPolicy\.scope_change_detection"/)
  assert.match(source, /启用自动拆解规则/)
  assert.match(source, /停用并回退到安全默认/)
  assert.match(source, /自定义规则已停用。后续合同将回退到/)
  // 保存前即时发现重复维度和无效摘要组合；有改动时才允许提交，也可撤销未保存修改。
  assert.match(source, /const splitPolicyIssues = computed/)
  assert.match(source, /分组维度不能重复/)
  assert.match(source, /未生成技术要求摘要时，不能锁定摘要字段/)
  assert.match(source, /splitPolicySaving \|\| !splitPolicyDirty \|\| splitPolicyIssues\.length > 0/)
  assert.match(source, /@click="resetSplitPolicyChanges">撤销修改<\/button>/)
  assert.match(source, /保存并用于后续合同/)
  // ② 检测类别域：原型的六列（类别/体系要求/必备资质/特殊方法/关联服务项/操作）。
  assert.match(source, /<h2>② 检测类别与人员要求<\/h2>/)
  for (const column of ['检测类别', '默认体系要求', '必备资质（默认）', '是否特殊方法', '关联服务项']) {
    assert.ok(source.includes(`<th>${column}</th>`), `检测类别域缺少列：${column}`)
  }
  assert.match(source, /specialMethodLabel\[item\.special_method\]/)
  assert.match(source, /\{\{ item\.service_item_count \|\| 0 \}\} 项/)
  // ③ 覆盖规则：名称/匹配条件/覆盖设置/优先级/状态/操作。
  assert.match(source, /<h2>③ 特殊合同覆盖规则 <span class="pm-badge neutral">可选<\/span><\/h2>/)
  assert.match(source, /数字越小优先级越高，命中第一条后停止继续匹配/)
  assert.match(source, /\{\{ overrideMatchText\(item\) \}\}/)
  assert.match(source, /\{\{ overrideSettingsText\(item\) \}\}/)
  // 维度与特殊方法的取值必须与后端常量一致（写错会被服务端判非法取值）。
  for (const value of ["'batch'", "'site'", "'customer'", "'contract'", "'category'", "'system_standard'", "'test_mode'", "'HUMAN_CONFIRM'", "'DEFAULT_RULE'", "'REQUIRED'", "'MARKABLE'"]) {
    assert.ok(source.includes(value), `缺少取值 ${value}`)
  }
  // 空字符串代表"不覆盖"：提交前必须剔除，否则服务端会判非法维度取值。
  assert.match(source, /function compactOverrideSettings\(settings\)/)
  assert.match(source, /function compactOverrideMatch\(match\)/)
  // 配置读写走独立接口，页面不再让用户手填适用范围。
  for (const fn of ['getSplitPolicy', 'saveSplitPolicy', 'listDetectionCategories', 'saveDetectionCategory', 'deleteDetectionCategory', 'listSplitOverrides', 'saveSplitOverride', 'deleteSplitOverride']) {
    assert.ok(pmApiSource.includes(fn), `API 客户端缺少 ${fn}`)
  }
  assert.match(pmApiSource, /request\('\/split-policy', \{ method: 'PUT', body: JSON\.stringify\(payload\) \}\)/)
  assert.match(pmApiSource, /request\(`\/split-overrides\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'DELETE' \}\)/)
  // 首帧兜底：接口未返回前表单也必须可渲染（对 null 取属性会直接白屏）。
  assert.match(source, /const splitPolicy = ref\(\{\s*\n\s*dimension_primary: 'batch',/)
  assert.match(source, /missing_rule_action: 'HUMAN_CONFIRM',/)
  // 检测类别域的必检能力码仅用于工程师校验，因此从 PERSON 编码目录多选；保存仍兼容后端逗号字符串。
  assert.match(source, /const detectionRequiredCodeOptions = computed\(\(\) => capabilityCodeOptions\('PERSON', detectionRequiredCodeSelection\.value\)\)/)
  assert.match(source, /openMulti === 'detectionRequiredCodes'/)
  assert.match(source, /required_codes: detectionRequiredCodeSelection\.value\.join\(','\)/)
  assert.doesNotMatch(source, /v-model\.trim="categoryDialog\.required_codes"/)
  assert.match(source, /按该类别拆解出的服务项会带上这些人员资质编码，分配工程师时据此校验/)
  // 导出/导入与原型页头一致：导出在浏览器侧生成 CSV，导入走批量接口并回显逐行原因。
  assert.match(source, /@click="downloadDetectionCategories">导出</)
  assert.match(source, /@click="detectionCategoryFileInput\.click\(\)">导入</)
  assert.match(source, /async function importDetectionCategoryFile\(event\)/)
  assert.match(source, /const rows = parseDetectionCategoryCSV\(await file\.text\(\)\)/)
  assert.match(source, /const result = await importDetectionCategories\(rows\)/)
  assert.match(source, /导入跳过原因：\$\{result\.errors\.slice\(0, 3\)\.join\('；'\)\}/)
  // CSV 解析必须容忍中文表头与中文枚举值。
  assert.match(source, /const hasHeader = header\.includes\('检测类别'\)/)
  assert.match(source, /否: 'NO', 可标记: 'MARKABLE', 必为特殊方法: 'REQUIRED'/)
  assert.match(pmApiSource, /export function importDetectionCategories\(items\)/)
  assert.match(pmApiSource, /request\('\/detection-categories\/import', \{ method: 'POST', body: JSON\.stringify\(\{ items \}\) \}\)/)
  // 进入页签时按需加载，不影响其它工作区首屏。
  assert.match(source, /if \(section === 'split-rules'\) loadSplitConfig\(\)/)
})

test('已建项目的合同在新建弹窗里直接标注并禁用，不再提交后才报错', () => {
  // 同一 (合同号, 版本) 在服务端是唯一键：已有项目时再选它必然冲突，
  // 所以要在选择阶段就把它挡掉（服务端 409 仍是最终兜底）。
  assert.match(source, /const builtContractKeys = computed\(\(\) => \{/)
  assert.match(source, /function contractOptionLabel\(contract\) \{/)
  assert.match(source, /function contractOptionDisabled\(contract\) \{/)
  assert.match(source, /\（已建项目 \$\{built\.id\}）/)
  assert.match(source, /<option v-for="contract in approvedContracts" :key="contract\.id" :value="contract\.id" :disabled="contractOptionDisabled\(contract\)">\{\{ contractOptionLabel\(contract\) \}\}<\/option>/)
})

test('轻提示按结果切换语义色，错误不再是绿色对勾', () => {
  assert.match(source, /function showToast\(message, type = 'success'\)/)
  assert.match(source, /:class="toastType"/)
  for (const tone of ['success', 'error', 'warning', 'info']) {
    assert.match(styles, new RegExp(`\\.pm-toast\\.${tone} span \\{ background: var\\(--pm-[a-z]+\\); \\}`))
  }
  assert.match(source, /showToast\(error\?\.message \|\| '[^']*', 'error'\)/)
  assert.match(source, /, 'warning'\); return \}/)
})

test('按 V1.1 原型还原：详情页、步骤条、审批流、状态分布条、矩阵与甘特', () => {
  // 项目详情是独立下钻页（原型 PG-PRJ-02），带摘要卡、计数标签页、甘特与时间线。
  assert.match(source, /project_detail: \['项目详情',/)
  assert.match(source, /activeSection === 'project_detail'/)
  assert.match(source, /class="pm-detail-summary"/)
  assert.match(source, /pm-detail-tabs/)
  assert.match(source, /const detailGantt = computed/)
  assert.match(source, /class="pm-gantt"/)
  assert.match(styles, /\.pm-gantt \{/)
  assert.match(styles, /\.pm-gantt-bar \{/)
  // 实施计划七步交付链与报告四阶段链（原型 stepper）。
  assert.match(source, /const operationSteps = computed/)
  assert.match(source, /const reportSteps = computed/)
  assert.match(source, /class="pm-stepper"/)
  assert.match(styles, /\.pm-stepper \{/)
  // 异常评审审批流（原型 approval-flow）。
  assert.match(source, /const exceptionFlow = computed/)
  assert.match(source, /class="pm-approval"/)
  assert.match(styles, /\.pm-approval \{/)
  assert.match(styles, /@keyframes pm-approval-pulse/)
  // 监控页状态分布条与胶囊筛选（口径为派生状态，不使用已删除字段）。
  assert.match(source, /const monitoredStatusMix = computed/)
  assert.match(source, /class="pm-statusbar"/)
  assert.match(styles, /\.pm-statusbar \{/)
  assert.match(source, /const monitorFilter = ref\(''\)/)
  // 字段级权限矩阵（原型 matrix）。
  assert.match(source, /const permissionMatrix = computed/)
  assert.match(source, /class="pm-matrix"/)
  assert.match(styles, /\.pm-matrix \{/)
  // 列表页指标概览行与原型搜索栏。
  assert.match(source, /class="pm-kpi-row"/)
  assert.match(source, /class="pm-search-bar"/)
  assert.match(styles, /\.pm-kpi-row \{/)
  assert.match(styles, /\.pm-search-bar \{/)
  // 资质页体系与编码、到期提醒标签页（真实台账聚合，不引入静态映射）。
  assert.match(source, /const capabilityCodeRows = computed/)
  assert.match(source, /const expiringCapabilities = computed/)
  assert.match(source, /const capabilityTab = ref\('all'\)/)
  // 配置页 KPI 与 SLA 口径说明。
  assert.match(source, /const configStats = computed/)
  assert.match(source, /SLA 口径说明/)
  // 导航角标由工作区数据派生。
  assert.match(source, /const navBadges = computed/)
  // 看板卡片使用左色条增强样式，并保留风险行标记。
  assert.match(styles, /\.pm-kanban-card \{/)
  assert.match(styles, /\.pm-kanban-card\.risk \{/)
})

test('样式表修掉信息提示、卡片角标与残留样式三处缺陷', () => {
  // SLA 口径说明用 .pm-alert.info，但样式表此前只定义了 .pm-alert.warn，
  // 该面板完全没有布局与配色；现在布局由基类承担，颜色由 warn/info 变体决定。
  assert.match(styles, /\.pm-alert \{ display: flex;/)
  assert.match(styles, /\.pm-alert\.info \{ border-color: var\(--pm-sky\)/)
  assert.match(styles, /\.pm-alert\.info i \{ background: var\(--pm-sky\); \}/)
  // KPI 已收敛为标签、数值、说明三层，装饰角标及其专用样式不再保留。
  assert.doesNotMatch(source, /pm-kpi-corner/)
  assert.doesNotMatch(styles, /pm-kpi-corner/)
  // .pm-kpi.green/.red 的 ::before 没有任何基础规则，只设 background 属死规则，不得残留。
  assert.doesNotMatch(styles, /\.pm-kpi\.green::before/)
  assert.doesNotMatch(styles, /\.pm-kpi\.red::before/)
  // v2：卡片本体保持纯白、留白优先，语义色只走顶部 3px 色条 + 标签徽标底色，
  // 旧名（green/red/blue/amber）保留为别名，因此断言的是别名仍映射到语义色令牌。
  assert.match(styles, /\.pm-kpi\.green\s*\{[^}]*border-top-color: var\(--pm-green\);/)
  assert.match(styles, /\.pm-kpi\.red\s*\{[^}]*border-top-color: var\(--pm-red\);/)
  assert.match(styles, /\.pm-kpi\.amber\s*\{[^}]*border-top-color: var\(--pm-amber\);/)
  // 统计条已被看板 KPI 行取代，其样式不得再残留。
  assert.doesNotMatch(styles, /pm-summary-strip/)
})

test('状态字段统一为语义化胶囊标签（statusTone 单一映射）', () => {
  // 映射表覆盖项目/服务项/报告/复核/台账全部状态，未命中回退 neutral。
  assert.match(source, /const statusToneMap = \{/)
  assert.match(source, /function statusTone\(status\) \{ return statusToneMap\[String\(status \?\? ''\)\.trim\(\)\] \|\| 'neutral' \}/)
  // 原先恒为灰底的 neutral 状态徽章全部改为语义色调。
  assert.doesNotMatch(source, /<span class="pm-badge neutral">\{\{ (card|project)\.status \}\}<\/span>/)
  assert.match(source, /:class="statusTone\(project\.status\)"/)
  assert.match(source, /:class="statusTone\(item\.status\)"/)
  assert.match(source, /:class="statusTone\(flow\.key\)"/)
  assert.match(source, /:class="statusTone\(row\.state\)"/)
  assert.match(source, /:class="statusTone\(item\.identity_status\)"/)
  // 纯文本状态（操作台当前项 / 复核状态 / 当前报告阶段）收口为胶囊。
  assert.match(source, /:class="statusTone\(selectedServiceItem\.status\)"/)
  assert.match(source, /<b class="pm-badge" :class="statusTone\(item && reportTechReviewLabel\(item\.tech_review_status\)\)"/)
  assert.match(source, /<b class="pm-badge" :class="statusTone\(reportStatusLabel\[item\.report_status\] \|\| item\.report_status\)"/)
  // 修复未定义的 warning 色调：设备在位改 amber，使用范围改关注，CSS 提供兼容别名。
  assert.match(source, /item\.presence === 'OUT_OF_COMPANY' \? 'amber' : 'normal'/)
  assert.match(source, /item\.usage_scope === 'COMPANY_ONLY' \? '关注' : 'neutral'/)
  assert.match(styles, /\.pm-badge\.warning \{/)
  // 状态胶囊的语义色调类必须全部存在。
  for (const tone of ['normal', 'amber', '风险', 'neutral', 'violet', 'blue', 'green', 'warning']) {
    assert.match(styles, new RegExp(`\\.pm-badge\\.${tone}`))
  }
})

test('现场证据通过统一文件网关上传并以回执提交', () => {
  assert.match(source, /uploadServiceItemEvidence\(item\.id, 'FIELD', form\.fieldEvidenceFile\)/)
  assert.match(source, /evidence_files: \[evidence\]/)
  assert.match(source, /请上传至少一份现场证据/)
  assert.doesNotMatch(source, /evidence_urls: \[\]/)
})

test('报告编制版本先上传网关文件再进入审核', () => {
  assert.match(source, /uploadServiceItemEvidence\(item\.id, 'REPORT', file\)/)
  assert.match(source, /registerReportArtifact\(item\.id, Number\(item\.report_revision\) \|\| 0, artifact\)/)
  assert.match(source, /审核人与编制人必须不同/)
})
