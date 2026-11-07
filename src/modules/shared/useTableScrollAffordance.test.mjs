import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  resolveTableScrollState,
  resolveTableScrollEdgeInsets,
  tableScrollStateClasses,
  TABLE_SCROLL_CLASS,
  TABLE_SCROLL_EPSILON,
  TABLE_SCROLL_SCROLLERS,
} from './composables/useTableScrollAffordance.js'

// 纯函数单测：状态判定和覆盖层矩形换算都不依赖 DOM，可以直接断言。
// 这两个函数是“只在能滚的那一侧出现提示”和“覆盖层正好压在表头之上”的唯一真值来源。

test('不溢出时两个方向都不提示（保持“没有可滚内容就不出现提示”）', () => {
  const state = resolveTableScrollState({ scrollLeft: 0, scrollWidth: 900, clientWidth: 900 })
  assert.equal(state.maxScrollLeft, 0)
  assert.equal(state.overflowing, false)
  assert.equal(state.canScrollLeft, false)
  assert.equal(state.canScrollRight, false)
  assert.deepEqual(tableScrollStateClasses(state), [])
})

test('内容比容器窄时同样不提示', () => {
  const state = resolveTableScrollState({ scrollLeft: 0, scrollWidth: 640, clientWidth: 900 })
  assert.equal(state.overflowing, false)
  assert.deepEqual(tableScrollStateClasses(state), [])
})

test('溢出且在最左：只提示右侧还有列', () => {
  const state = resolveTableScrollState({ scrollLeft: 0, scrollWidth: 1360, clientWidth: 900 })
  assert.equal(state.maxScrollLeft, 460)
  assert.equal(state.canScrollLeft, false)
  assert.equal(state.canScrollRight, true)
  assert.deepEqual(tableScrollStateClasses(state), [TABLE_SCROLL_CLASS.canRight])
})

test('滚到中间：左右两侧都提示', () => {
  const state = resolveTableScrollState({ scrollLeft: 230, scrollWidth: 1360, clientWidth: 900 })
  assert.equal(state.canScrollLeft, true)
  assert.equal(state.canScrollRight, true)
  assert.deepEqual(tableScrollStateClasses(state),
    [TABLE_SCROLL_CLASS.canLeft, TABLE_SCROLL_CLASS.canRight])
})

test('滚到最右：右侧提示消失，只提示左侧还能回去', () => {
  const atEnd = resolveTableScrollState({ scrollLeft: 460, scrollWidth: 1360, clientWidth: 900 })
  assert.equal(atEnd.canScrollRight, false, '滚到尽头不能再提示“右侧还有列”')
  assert.equal(atEnd.canScrollLeft, true)
  assert.deepEqual(tableScrollStateClasses(atEnd), [TABLE_SCROLL_CLASS.canLeft])
})

test('从尽头滚回来，右侧提示重新出现', () => {
  const atEnd = resolveTableScrollState({ scrollLeft: 460, scrollWidth: 1360, clientWidth: 900 })
  const back = resolveTableScrollState({ scrollLeft: 300, scrollWidth: 1360, clientWidth: 900 })
  const atStart = resolveTableScrollState({ scrollLeft: 0, scrollWidth: 1360, clientWidth: 900 })
  assert.equal(atEnd.canScrollRight, false)
  assert.equal(back.canScrollRight, true)
  assert.equal(atStart.canScrollRight, true)
  assert.equal(back.canScrollLeft, true)
  assert.equal(atStart.canScrollLeft, false)
})

test('亚像素误差和边界抖动不算可滚动', () => {
  // scrollWidth/clientWidth 可能差 0.5px；不能因此常驻显示提示。
  const subpixel = resolveTableScrollState({ scrollLeft: 0, scrollWidth: 900.5, clientWidth: 900 })
  assert.equal(subpixel.overflowing, false)
  assert.deepEqual(tableScrollStateClasses(subpixel), [])
  // 停在离尽头 0.5px 的位置仍算“到头了”。
  const nearEnd = resolveTableScrollState({ scrollLeft: 459.5, scrollWidth: 1360, clientWidth: 900 })
  assert.equal(nearEnd.canScrollRight, false)
  // 但真的差 2px 时仍应提示。
  const notEnd = resolveTableScrollState({ scrollLeft: 458, scrollWidth: 1360, clientWidth: 900 })
  assert.equal(notEnd.canScrollRight, true)
})

test('epsilon 可调，缺省值就是共享常量', () => {
  assert.equal(TABLE_SCROLL_EPSILON, 1)
  const loose = resolveTableScrollState({ scrollLeft: 0, scrollWidth: 900.5, clientWidth: 900 }, 0)
  assert.equal(loose.overflowing, true)
})

test('缺失或非法读数按 0 处理，不抛错', () => {
  assert.deepEqual(tableScrollStateClasses(resolveTableScrollState()), [])
  assert.deepEqual(tableScrollStateClasses(undefined), [])
  const broken = resolveTableScrollState({ scrollLeft: 'abc', scrollWidth: -5, clientWidth: null })
  assert.equal(broken.maxScrollLeft, 0)
  assert.equal(broken.canScrollLeft, false)
  assert.equal(broken.canScrollRight, false)
})

test('覆盖层矩形贴合滚动容器内容盒（排除边框与滚动条）', () => {
  // 宿主 900 宽；容器在宿主内左缩进 12、上缩进 40，容器自身有 1px 左边框、800 内容宽。
  const insets = resolveTableScrollEdgeInsets({
    scrollerRect: { left: 12, top: 40 },
    hostRect: { left: 0, top: 0 },
    hostClientLeft: 0,
    hostClientTop: 0,
    hostScrollLeft: 0,
    hostScrollTop: 0,
    hostClientWidth: 900,
    scrollerClientLeft: 1,
    scrollerClientTop: 0,
    scrollerClientWidth: 800,
    scrollerClientHeight: 240,
  })
  assert.deepEqual(insets, { top: 40, left: 13, right: 87, height: 240 })
})

test('宿主自身滚动时用内容坐标，覆盖层跟着容器一起走', () => {
  const insets = resolveTableScrollEdgeInsets({
    scrollerRect: { left: -8, top: 10 },
    hostRect: { left: 0, top: 0 },
    hostClientLeft: 0,
    hostClientTop: 0,
    hostScrollLeft: 20,
    hostScrollTop: 30,
    hostClientWidth: 900,
    scrollerClientLeft: 1,
    scrollerClientTop: 0,
    scrollerClientWidth: 800,
    scrollerClientHeight: 240,
  })
  assert.deepEqual(insets, { top: 40, left: 13, right: 87, height: 240 })
})

test('宿主有边框时以 padding box 为基准', () => {
  const insets = resolveTableScrollEdgeInsets({
    scrollerRect: { left: 21, top: 11 },
    hostRect: { left: 20, top: 10 },
    hostClientLeft: 1,
    hostClientTop: 1,
    hostClientWidth: 900,
    scrollerClientWidth: 900,
    scrollerClientHeight: 120,
  })
  assert.deepEqual(insets, { top: 0, left: 0, right: 0, height: 120 })
})

test('结果按 0.01px 取整，避免行长小数为 0.0001 时抖动', () => {
  const insets = resolveTableScrollEdgeInsets({
    scrollerRect: { left: 10.123456, top: 3.333333 },
    hostRect: { left: 0, top: 0 },
    hostClientWidth: 500,
    scrollerClientWidth: 400.987654,
    scrollerClientHeight: 88.888888,
  })
  assert.equal(insets.left, 10.12)
  assert.equal(insets.top, 3.33)
  assert.equal(insets.right, 88.89)
  assert.equal(insets.height, 88.89)
})

// ── 登记表覆盖（P2⑧） ───────────────────────────────────────────────────────
// 横向滚动提示原先只认 8 个共享类，新页面的滚动容器没有渐隐，用户看不到右侧还有列。
// 现在用 data-table-scroll 作为显式 opt-in 标记，并把已知的 12 类容器补齐。

test('滚动容器登记表包含 data-table-scroll opt-in 标记', () => {
  assert.ok(TABLE_SCROLL_SCROLLERS.includes('[data-table-scroll]'), '登记表必须识别 [data-table-scroll]')
})

// 文件相对本测试文件（src/modules/shared/）；数量是该文件里应出现的标记数。
const DATA_TABLE_SCROLL_CONTAINERS = [
  ['结算 · import-scroll', '../settlement/components/SettlementContractImportPanel.vue', 2],
  ['数析 · import-history-scroll', '../data_analysis/components/ContractImportHistoryPanel.vue', 1],
  // 模板示例表 + 唯一含宽表格的商机团队任期面板（三个 attachment-panel 共享宿主，只标记其一）
  ['CRM · crm-import-template-scroll / opportunity-attachment-panel', '../customer_opportunity/views/CustomerOpportunityView.vue', 2],
  ['门户 · filing-matrix-scroll', '../customer_portal/components/FilingWizard.vue', 1],
  ['IAM · personnel-change-table', '../platform/iam/components/PersonnelChangeCenter.vue', 1],
  ['平台 · configuration-table', '../platform/configuration/components/ConfigurationCenterModule.vue', 1],
  ['平台 · notification-table', '../platform/notifications/components/NotificationCenterModule.vue', 2],
  ['许可 · runtime-table', '../platform/features/licenses/RuntimeEnforcementView.vue', 1],
  ['项目 · pm-matrix-wrap', '../project_management/views/ProjectManagementView.vue', 2],
  ['合同 · local-catalog-table', '../contract_management/components/LocalContractCatalogPanel.vue', 1],
  ['合同 · contract-integration-outbox', '../contract_management/components/ContractIntegrationOutboxPanel.vue', 1],
]

test('12 类新增滚动容器都显式标记 data-table-scroll', () => {
  for (const [label, file, expected] of DATA_TABLE_SCROLL_CONTAINERS) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    const occurrences = (source.match(/data-table-scroll/g) || []).length
    assert.ok(occurrences >= expected, `${label}: 需要至少 ${expected} 处 data-table-scroll，实际 ${occurrences}`)
  }
})

test('global-ux.css 的渐隐与滚动条清单同步包含 data-table-scroll', () => {
  const css = readFileSync(new URL('./styles/global-ux.css', import.meta.url), 'utf8')
  const lists = [...css.matchAll(/:where\(([^)]*)\)/g)]
    .map((matched) => matched[1])
    .filter((list) => list.includes('.contract-table-scroll'))
  assert.ok(lists.length >= 6, `应至少覆盖降级渐隐 / 滚动条 / Firefox 三组共 6 条清单，实际 ${lists.length}`)
  for (const list of lists) {
    assert.ok(list.includes('[data-table-scroll]'), `滚动清单漏掉 data-table-scroll：${list.trim().slice(0, 80)}…`)
  }
})
