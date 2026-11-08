import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../components/ProjectEquipmentPanel.vue', import.meta.url), 'utf8')

// 用途：从真实 SFC 截取具名函数体，在注入上下文中执行，验证接线行为而非复述实现。
// 参数：name 为函数名，dependencies 为依赖注入，signature 覆盖默认形参。
// 返回值：可调用的真实函数。
function extractFunction(name, dependencies, signature = '') {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `missing ${name}`)
  const end = source.indexOf('\n}\n', start) + 3
  const declaration = source.slice(start, end)
  const names = Object.keys(dependencies)
  return new Function(...names, `${declaration}\nreturn ${name}`)(...names.map((key) => dependencies[key]))
}

// 用途：截取 watch(lastUpdatedAt, ...) 的回调体，验证刷新后的失效与按区域重读。
// 参数：dependencies 为依赖注入。
// 返回值：可直接调用的回调。
function extractLastUpdatedWatcher(dependencies) {
  const marker = 'watch(lastUpdatedAt, () => {'
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'missing refresh watcher')
  const bodyStart = start + marker.length
  const bodyEnd = source.indexOf('\n})', bodyStart)
  assert.ok(bodyEnd > bodyStart, 'unterminated refresh watcher')
  const body = source.slice(bodyStart, bodyEnd)
  const names = Object.keys(dependencies)
  return new Function(...names, `return () => {${body}}`)(...names.map((key) => dependencies[key]))
}

test('工作区首屏不再预读设备目录、人员姓名与 SLA 明细', () => {
  const start = source.indexOf('async function loadWorkspace({ reportError = true } = {}) {')
  assert.ok(start >= 0, 'missing loadWorkspace')
  const body = source.slice(start, source.indexOf('\n}\n', start))
  assert.doesNotMatch(body, /loadEquipment\(|listEquipment\(/, '核心快照加载不得预读设备目录')
  assert.doesNotMatch(body, /loadPersonnelNames\(|resolvePersonnelNames\(/, '核心快照加载不得预读人员姓名')
  assert.doesNotMatch(body, /listSlaOverdue\(/, '核心快照加载不得预读 SLA 明细')
  // 现场证据判定属于完成动作的前置条件，仍随工作区刷新重取（不在本次按需化范围）。
  assert.match(body, /refreshSelectedFieldEvidence\(\)/)
  // 核心原子快照仍然同批成功后再整体替换。
  assert.match(body, /listProjectsSnapshot\(\), listServiceItemsSnapshot\(\), listRules\(\)/)
  assert.match(body, /projects\.value = projectSnapshot\.items/)
  assert.match(body, /rules\.value = ruleRows\.map\(decorateRule\)/)
})

test('按栏目触发：未进入相关区域不发设备目录/SLA 请求', () => {
  const calls = []
  const onChange = extractFunction('onSectionChanged', {
    loadPersonnel: () => calls.push('personnel'),
    ensureEquipmentCatalog: () => calls.push('catalog'),
    loadEquipmentReservations: () => calls.push('reservations'),
    loadSlaOverdueDetails: () => calls.push('sla'),
    selectedServiceItem: ref({ id: 'SI-1' }),
  })
  onChange('dashboard')
  assert.deepEqual(calls, [], '执行总览不读取设备目录、占用或 SLA 明细')
  onChange('projects')
  assert.deepEqual(calls, [])
  onChange('equipment')
  assert.deepEqual(calls, ['catalog'], '进入设备能力只读取设备目录')
  calls.length = 0
  onChange('preparation')
  assert.deepEqual(calls, ['catalog', 'reservations'], '实施准备同时读取目录与占用（占用独立于目录）')
  calls.length = 0
  onChange('monitoring')
  assert.deepEqual(calls, ['personnel', 'sla'], '监控区域读取 SLA 明细')
  calls.length = 0
  onChange('inbox')
  assert.deepEqual(calls, ['personnel'], '待办区域只刷新人员目录')
})

test('刷新后按当前区域重新确认辅助数据，未进入的区域不发请求', () => {
  const calls = []
  const activeSection = ref('dashboard')
  const refresh = extractFunction('refreshSectionAuxiliary', {
    workspaceReady: ref(true),
    activeSection,
    ensureEquipmentCatalog: () => calls.push('catalog'),
    loadSlaOverdueDetails: () => calls.push('sla'),
  })
  refresh()
  assert.deepEqual(calls, [], '执行总览不读取辅助数据')
  activeSection.value = 'equipment'
  refresh()
  assert.deepEqual(calls, ['catalog'])
  calls.length = 0
  activeSection.value = 'monitoring'
  refresh()
  assert.deepEqual(calls, ['sla'])
  calls.length = 0
  activeSection.value = 'preparation'
  refresh()
  assert.deepEqual(calls, ['catalog'], '设备占用由服务项监听读取，刷新不得重复发起')
})

test('工作区刷新后姓名/SLA/设备目录失效并重新确认', () => {
  const calls = []
  const watcher = extractLastUpdatedWatcher({
    personnelNames: { reload: () => calls.push('names') },
    invalidateEquipmentCatalog: () => calls.push('invalidate-catalog'),
    invalidateSlaOverdue: () => calls.push('invalidate-sla'),
    refreshSectionAuxiliary: () => calls.push('refresh-section'),
    lastUpdatedAt: ref(new Date()),
  })
  watcher()
  assert.deepEqual(calls, ['names', 'invalidate-catalog', 'invalidate-sla', 'refresh-section'],
    '刷新必须让姓名重新确认，并让目录/SLA 失效后按区域重读')
})

test('SLA 明细失败显示「不可用」，不能渲染成「没有超期」', () => {
  const panel = source.slice(source.indexOf('SLA 超期明细是辅助数据'), source.indexOf('运营明细'))
  assert.match(panel, /SLA 超期明细不可用/)
  assert.match(panel, /retry-text="重试读取"/)
  assert.match(panel, /slaOverdueLoading \|\| slaOverduePending \|\| slaOverdueError/)
  assert.match(panel, /:loading="slaOverdueLoading \|\| slaOverduePending"/)
  // 只有确认过才允许进入「暂无超期」的空状态分支。
  assert.match(panel, /v-else class="pm-table-scroll"/)
  assert.match(panel, /暂无超期或临近超期的服务项/)
  // 旧的「失败即清空、等价于没有超期」写法必须消失。
  assert.doesNotMatch(source, /catch\s*\{\s*slaOverdueItems\.value = \[\]/)
  assert.match(source, /loader: \(\) => listSlaOverdue\(\)/)
})

test('设备候选选择器打开时校验目录新鲜度，未确认前不允许据此完成选择', () => {
  assert.match(source, /async function openEquipmentPicker\(\) \{[\s\S]*?await ensureEquipmentCatalog\(\)/)
  assert.match(source, /if \(!equipmentConfirmed\.value\) \{ showToast\('设备目录尚未确认/)
  // 占用未确认时不得把设备标成「可添加」：目录里的在位字段不能代替占用校验。
  assert.match(source, /equipmentReservationsLoading\.value \|\| equipmentReservationsError\.value/)
  assert.match(source, /label: '占用未确认'/)
  assert.match(source, /重试读取占用/)
  // 占用读取自身的失败态与加载态（独立于设备目录）。
  assert.match(source, /const equipmentReservationsLoading = ref\(false\)/)
  assert.match(source, /const equipmentReservationsError = ref\(''\)/)
})

test('设备维护面板通过动态导入建立加载边界，并保留原 DOM 层级与类名', () => {
  assert.match(source, /defineAsyncComponent\(\{[\s\S]*?import\('@\/modules\/project_management\/components\/ProjectEquipmentPanel\.vue'\)/)
  assert.match(source, /const equipmentPanel = shallowRef\(createEquipmentPanel\(\)\)/)
  assert.match(source, /:is="equipmentPanel"/)
  assert.match(source, /设备维护面板加载失败/)
  // 主页面不再内联维护表单；模板只保留面板挂载点。
  assert.doesNotMatch(source, /class="pm-form pm-equipment-form"/)
  assert.doesNotMatch(source, /v-for="item in equipment"/)
  for (const className of ['pm-equipment-layout', 'pm-equipment-form', 'pm-panel', 'pm-table-panel', 'pm-multi-dropdown', 'pm-multi-trigger', 'pm-multi-menu', 'pm-multi-chips']) {
    assert.match(panelSource, new RegExp(className), `面板必须保留 ${className} 类名`)
  }
  // 面板是 JS setup（避免类型门禁 include 扩张），不自行读取目录。
  assert.ok(panelSource.startsWith('<script setup>'), '面板必须是 JS <script setup>')
  assert.doesNotMatch(panelSource, /lang="ts"/)
  assert.doesNotMatch(panelSource, /listEquipment|resolvePersonnelNames|listSlaOverdue/)
  // 面板暴露读取失败的重试入口，目录失败不得显示成「暂无设备」。
  assert.match(panelSource, /重试读取目录/)
  assert.match(panelSource, /正在读取设备目录…/)
  assert.match(panelSource, /v-else-if="!items\.length"/)
})

test('未就绪不清除选择：栏目/辅助数据加载中不撤销已选服务项', () => {
  const start = source.indexOf('watch([activeSection, activeNodeItems, loading, sectionExtrasLoading, workspaceReady]')
  assert.ok(start >= 0, 'missing selection cleanup watcher')
  const body = source.slice(start, source.indexOf('}, { immediate: true })', start))
  assert.match(body, /if \(loading\.value \|\| sectionExtrasLoading\.value \|\| !workspaceReady\.value\) return/)
  assert.match(body, /selectedServiceItemIDs\.value = selectedServiceItemIDs\.value\.filter\(\(id\) => available\.has\(id\)\)/)
})
