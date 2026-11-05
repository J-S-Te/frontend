import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { effectScope, nextTick, ref } from 'vue'
import {
  kpiColumnCount,
  kpiHiddenStorageKey,
  normalizeHiddenKpiKeys,
  readHiddenKpiKeys,
  rectifyingProjectCount,
  useProjectKpiVisibility,
  visibleProjectKpiCards,
  writeHiddenKpiKeys,
} from './composables/useProjectKpiVisibility.js'

const source = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const visibilitySource = await readFile(new URL('./composables/useProjectKpiVisibility.js', import.meta.url), 'utf8')
const styles = await readFile(new URL('./styles/project-management.css', import.meta.url), 'utf8')

// 与 report-stage-ui.test.mjs 同款：从 SFC 源码中提取函数体，在独立上下文里验证行为。
function extractFunction(name, context) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
  assert.ok(start >= 0, `missing ${name}`)
  const body = source.slice(start, source.indexOf('\n}', start) + 2)
  return vm.runInNewContext(`${body}\n({${name}})`, context)[name]
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) },
    dump: () => Object.fromEntries(data),
  }
}

const availableCards = [
  { key: 'all_projects', label: '全部项目' },
  { key: 'in_flight', label: '在途项目' },
  { key: 'rectifying', label: '整改中项目' },
  { key: 'completed', label: '已完成项目' },
  { key: 'risk', label: '风险项目' },
]

test('整改中计数按 report_stage 归一化，大小写与空格容错，旧后端缺字段不报错', () => {
  const projects = [
    { id: 'PJ-1', report_stage: 'RECTIFYING' },
    { id: 'PJ-2', report_stage: ' rectifying ' },
    { id: 'PJ-3', report_stage: 'Compiling' },
    { id: 'PJ-4', report_stage: '' },
    { id: 'PJ-5' },
    { id: 'PJ-6', report_stage: null },
  ]
  assert.equal(rectifyingProjectCount(projects), 2)
  // 旧后端完全不返回 report_stage：计数为 0，不抛错也不伪造数据。
  assert.equal(rectifyingProjectCount([{ id: 'PJ-OLD' }]), 0)
  assert.equal(rectifyingProjectCount([]), 0)
  assert.equal(rectifyingProjectCount(undefined), 0)
})

test('项目指标卡新增整改中卡片，并加入各角色布局', () => {
  assert.match(source, /rectifying: \{ key: 'rectifying', label: '整改中项目', value: rectifyingProjectCount\(projects\.value\), suffix: '个', meta: '报告整改阶段', tone: 'amber', action: 'rectifying' \}/)
  for (const layout of [
    "'pending_decomposition', 'in_flight', 'rectifying', 'pending_creation'",
    "'all_projects', 'all_service_items', 'allocation_pending', 'in_flight', 'rectifying', 'risk', 'pending_creation'",
    "'all_projects', 'in_flight', 'rectifying', 'completed', 'risk'",
    "'all_projects', 'all_service_items', 'rectifying', 'risk'",
  ]) {
    assert.ok(source.includes(layout), `布局缺少整改中卡片：${layout}`)
  }
  // 管理员 9 张、技术总监 7 张等 5 张以上的布局继续沿用两行拆分。
  assert.match(source, /layouts\[projectCardRole\.value\]\.map\(\(key\) => catalog\[key\]\)/)
})

test('点击整改中卡片设置 report_stage 筛选并清空状态与卡片范围筛选', () => {
  const context = {
    ref,
    reportStageFilter: ref('COMPILING'),
    statusFilter: ref('已完成'),
    projectCardFilter: ref('risk'),
    projectStatusCompleted: '已完成',
    openCreateProject: () => {},
    navigate: () => {},
  }
  const activate = extractFunction('activateProjectKpi', context)

  activate({ action: 'rectifying' })
  assert.equal(context.reportStageFilter.value, 'RECTIFYING')
  assert.equal(context.statusFilter.value, '')
  assert.equal(context.projectCardFilter.value, '')

  // 其它指标卡仍遵守“切换项目范围时清报告阶段筛选”的既有行为。
  context.reportStageFilter.value = 'RECTIFYING'
  context.statusFilter.value = '已完成'
  activate({ action: 'all' })
  assert.equal(context.reportStageFilter.value, '')
  assert.equal(context.statusFilter.value, '')
  assert.equal(context.projectCardFilter.value, '')

  context.reportStageFilter.value = 'RECTIFYING'
  activate({ action: 'decomposition' })
  assert.equal(context.reportStageFilter.value, '')
  assert.equal(context.statusFilter.value, '待拆解确认')

  context.reportStageFilter.value = 'RECTIFYING'
  activate({ action: 'risk' })
  assert.equal(context.reportStageFilter.value, '')
  assert.equal(context.projectCardFilter.value, 'risk')
})

test('隐藏集合按租户 + 用户读写，未知 key 被忽略，恢复默认清空存储项', () => {
  const tenantID = 'T1'
  const userID = 'U1'
  const key = 'pm.project.kpi.hidden.T1.U1'
  assert.equal(kpiHiddenStorageKey(tenantID, userID), key)
  // 身份不完整时不产生键，调用方走内存态。
  assert.equal(kpiHiddenStorageKey('', userID), '')
  assert.equal(kpiHiddenStorageKey(tenantID, '  '), '')
  assert.equal(kpiHiddenStorageKey(' T2 ', ' U2 '), 'pm.project.kpi.hidden.T2.U2')

  const storage = memoryStorage()
  assert.equal(writeHiddenKpiKeys(storage, tenantID, userID, ['rectifying', 'unknown_key', 'rectifying'], ['all_projects', 'rectifying']), true)
  assert.equal(storage.getItem(key), JSON.stringify(['rectifying']))
  assert.deepEqual(readHiddenKpiKeys(storage, tenantID, userID, ['all_projects', 'rectifying']), ['rectifying'])
  // 不在当前布局里的 key（例如角色切换前的残留）读取时丢弃。
  assert.deepEqual(readHiddenKpiKeys(storage, tenantID, userID, ['all_projects', 'risk']), [])

  // JSON 损坏或不是数组时退回默认全可见，不抛错。
  const broken = memoryStorage({ [key]: '{not-json' })
  assert.deepEqual(readHiddenKpiKeys(broken, tenantID, userID, ['all_projects']), [])
  const wrongShape = memoryStorage({ [key]: JSON.stringify({ all_projects: true }) })
  assert.deepEqual(readHiddenKpiKeys(wrongShape, tenantID, userID, ['all_projects']), [])

  // 身份不完整只改内存态，不写存储。
  const anonymous = memoryStorage()
  assert.equal(writeHiddenKpiKeys(anonymous, '', '', ['rectifying'], ['rectifying']), false)
  assert.deepEqual(anonymous.dump(), {})

  // 恢复默认：写入空集合时删除存储项，不留空数组。
  writeHiddenKpiKeys(storage, tenantID, userID, [], ['all_projects', 'rectifying'])
  assert.equal(storage.getItem(key), null)
})

test('默认全部可见，全部隐藏后为空态，恢复默认回到全可见', async () => {
  const cards = ref(availableCards)
  const storage = memoryStorage()
  const scope = effectScope()
  const ui = scope.run(() => useProjectKpiVisibility({
    cards, tenantID: ref('T1'), userID: ref('U1'), storage,
  }))

  assert.deepEqual(ui.visibleCards.value.map((card) => card.key), availableCards.map((card) => card.key))
  assert.equal(ui.allHidden.value, false)
  assert.equal(ui.hiddenKeys.value.length, 0)
  assert.equal(ui.columnCount.value, 5)

  for (const card of availableCards) ui.toggleCard(card.key)
  assert.equal(ui.allHidden.value, true)
  assert.equal(ui.visibleCards.value.length, 0)
  // 全部隐藏时仍给出确定的列数，布局类名不会变成 pm-project-kpi-columns-0。
  assert.equal(ui.columnCount.value, 1)
  assert.deepEqual(readHiddenKpiKeys(storage, 'T1', 'U1', availableCards.map((card) => card.key)), availableCards.map((card) => card.key))

  ui.resetCards()
  assert.equal(ui.allHidden.value, false)
  assert.equal(ui.visibleCards.value.length, availableCards.length)
  assert.equal(storage.dump()['pm.project.kpi.hidden.T1.U1'], undefined)
  scope.stop()
})

test('隐藏后列数按可见卡片计算，角色布局变化丢弃不属于当前布局的隐藏 key', async () => {
  const cards = ref(availableCards)
  const storage = memoryStorage()
  const scope = effectScope()
  const ui = scope.run(() => useProjectKpiVisibility({
    cards, tenantID: ref('T1'), userID: ref('U1'), storage,
  }))

  ui.toggleCard('risk')
  ui.toggleCard('completed')
  assert.deepEqual(ui.visibleCards.value.map((card) => card.key), ['all_projects', 'in_flight', 'rectifying'])
  assert.equal(ui.columnCount.value, 3)

  // 角色切换：新布局没有 risk/completed，隐藏集合必须收敛，不得残留旧 key。
  cards.value = [
    { key: 'all_projects', label: '全部项目' },
    { key: 'rectifying', label: '整改中项目' },
  ]
  await nextTick()
  assert.deepEqual(ui.hiddenKeys.value, [])
  assert.equal(ui.visibleCards.value.length, 2)
  assert.equal(ui.columnCount.value, 2)
  scope.stop()
})

test('session 缺租户/用户时只保留内存态，不写共享存储；身份就绪后按该身份重新读取', async () => {
  const cards = ref(availableCards)
  const storage = memoryStorage()
  const tenantID = ref('')
  const userID = ref('')
  const scope = effectScope()
  const ui = scope.run(() => useProjectKpiVisibility({ cards, tenantID, userID, storage }))

  ui.toggleCard('risk')
  assert.deepEqual(ui.hiddenKeys.value, ['risk'])
  // 身份未知：内存里生效，但绝不写 localStorage，避免跨账号污染。
  assert.deepEqual(storage.dump(), {})

  // 工作区数据刷新会让卡片清单重算；身份未知时内存态不能被清空。
  cards.value = availableCards.filter((card) => card.key !== 'completed')
  await nextTick()
  assert.deepEqual(ui.hiddenKeys.value, ['risk'])

  tenantID.value = 'T1'
  userID.value = 'U1'
  await nextTick()
  // 身份就绪后以该身份的存储为准（默认全可见），内存态不跨身份继承。
  assert.deepEqual(ui.hiddenKeys.value, [])

  ui.toggleCard('rectifying')
  assert.deepEqual(readHiddenKpiKeys(storage, 'T1', 'U1', availableCards.map((card) => card.key)), ['rectifying'])

  // 换到另一个账号：读取不到上一账号的隐藏项。
  tenantID.value = 'T2'
  await nextTick()
  assert.deepEqual(ui.hiddenKeys.value, [])
  scope.stop()
})

test('指标网格列数规则：5 张以内单排，超过 5 张拆两行', () => {
  assert.equal(kpiColumnCount(0), 1)
  assert.equal(kpiColumnCount(1), 1)
  assert.equal(kpiColumnCount(3), 3)
  assert.equal(kpiColumnCount(5), 5)
  assert.equal(kpiColumnCount(6), 3)
  assert.equal(kpiColumnCount(7), 4)
  assert.equal(kpiColumnCount(9), 5)
  assert.equal(kpiColumnCount('4'), 4)
  assert.equal(kpiColumnCount(undefined), 1)
})

test('可见卡片过滤保持原顺序，未知隐藏 key 不影响渲染', () => {
  assert.deepEqual(visibleProjectKpiCards(availableCards, []).map((card) => card.key), availableCards.map((card) => card.key))
  assert.deepEqual(visibleProjectKpiCards(availableCards, ['rectifying']).map((card) => card.key), ['all_projects', 'in_flight', 'completed', 'risk'])
  assert.deepEqual(visibleProjectKpiCards(availableCards, ['not_exist']).length, availableCards.length)
  assert.deepEqual(visibleProjectKpiCards(undefined, ['rectifying']), [])
  assert.deepEqual(normalizeHiddenKpiKeys([' risk ', 'risk', 7], ['risk']), ['risk'])
})

test('指标卡设置面板具备开关语义、焦点与关闭行为，窄屏样式不溢出', () => {
  // 入口按钮：弹层语义 + 展开态 + 面板关联。
  assert.match(source, /aria-haspopup="dialog"/)
  assert.match(source, /:aria-expanded="kpiSettingsOpen"/)
  assert.match(source, /aria-controls="project-kpi-settings"/)
  assert.match(source, /role="dialog"[\s\S]{0,80}?aria-label="指标卡显示设置"/)
  // 每张卡一个原生 button + role=switch + aria-checked（Enter/Space 由浏览器派发 click）。
  assert.match(source, /class="pm-kpi-switch"\s+role="switch"\s+:aria-checked="isProjectKpiVisible\(card\.key\)"\s+@click="toggleProjectKpiCard\(card\.key\)"/)
  assert.match(source, /<span class="pm-kpi-switch-text"><b>\{\{ card\.label \}\}<\/b><small>\{\{ card\.meta \|\| '项目指标' \}\}<\/small><\/span>/)
  // 全部隐藏时的空态与恢复默认；网格改用可见卡片渲染。
  assert.match(source, /已隐藏全部指标卡/)
  assert.match(source, /v-if="allProjectKpiHidden" class="pm-kpi-hidden-empty"/)
  assert.match(source, /@click="resetProjectKpiCards">恢复默认</)
  assert.match(source, /v-for="card in projectKpiVisibleCards"/)
  // Escape 与点击外部关闭，打开后聚焦第一个开关。
  assert.match(source, /if \(kpiSettingsOpen\.value\) \{ dismissKpiSettings\(\{ restoreFocus: true \}\); return true \}/)
  assert.match(source, /document\.addEventListener\('click', onKpiSettingsOutsideClick\)/)
  assert.match(source, /document\.removeEventListener\('click', onKpiSettingsOutsideClick\)/)
  assert.match(source, /querySelector\('\[role="switch"\]'\)/)
  // 存储键形状与视图接线；视图不直接操作 localStorage。
  assert.match(visibilitySource, /export const PROJECT_KPI_HIDDEN_STORAGE_PREFIX = 'pm\.project\.kpi\.hidden\.'/)
  assert.match(source, /useProjectKpiVisibility\(\{/)
  assert.match(source, /tenantID: computed\(\(\) => session\.value\?\.tenant_id\)/)
  assert.match(source, /userID: computed\(\(\) => session\.value\?\.user_id\)/)
  assert.doesNotMatch(source, /localStorage/)
  // 窄屏面板改为整行宽度，不超出视口。
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.pm-kpi-settings-panel \{ left: 0; right: 0; width: auto;/)
  assert.match(styles, /\.pm-kpi-settings-panel \{[\s\S]*?width: min\(342px, calc\(100vw - 32px\)\);/)
  assert.match(styles, /\.pm-kpi-switch\[aria-checked="true"\] \.pm-kpi-switch-track \{ background: var\(--pm-primary\); \}/)
})
