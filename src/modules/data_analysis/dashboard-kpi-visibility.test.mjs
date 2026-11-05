// 数据看板指标卡显示偏好与报告阶段取数：纯逻辑 + 视图接线断言（node:test，对齐 data-analysis-ui.test.mjs）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DASHBOARD_CARD_HIDDEN_PREFIX,
  PROJECT_CARD_KEYS,
  cardHiddenStorageKey,
  metricColumnCount,
  normalizeHiddenCardKeys,
  readHiddenCardKeys,
  reportStageCount,
  visibleDashboardCards,
  writeHiddenCardKeys,
} from './utils/dashboardCardVisibility.js'

const native = readFileSync(new URL('./views/NativeDashboardView.vue', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./views/DashboardShellView.vue', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles/data-analysis.css', import.meta.url), 'utf8')

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) },
    dump: () => Object.fromEntries(data),
  }
}

const cards = PROJECT_CARD_KEYS.map((key) => ({ key, label: key }))

test('隐藏偏好按「租户 + 用户」隔离，身份不完整时不给存储键', () => {
  assert.equal(cardHiddenStorageKey('t1', 'u1'), 'da.project.kpi.hidden.t1.u1')
  assert.equal(cardHiddenStorageKey(' t1 ', ' u1 '), 'da.project.kpi.hidden.t1.u1')
  assert.ok(DASHBOARD_CARD_HIDDEN_PREFIX === 'da.project.kpi.hidden.')
  assert.equal(cardHiddenStorageKey('', 'u1'), '')
  assert.equal(cardHiddenStorageKey('t1', null), '')
  assert.equal(cardHiddenStorageKey(undefined, undefined), '')
})

test('默认全部可见；隐藏单张只影响该卡，全部隐藏后可见列表为空', () => {
  assert.deepEqual(visibleDashboardCards(cards, []).map((card) => card.key), PROJECT_CARD_KEYS)
  assert.deepEqual(visibleDashboardCards(cards, ['risk']).map((card) => card.key), ['project_total', 'in_flight', 'service_items', 'rectifying'])
  assert.deepEqual(visibleDashboardCards(cards, PROJECT_CARD_KEYS), [])
  // 未知 key 不影响渲染；非法输入退化为空列表。
  assert.equal(visibleDashboardCards(cards, ['not_exist']).length, cards.length)
  assert.deepEqual(visibleDashboardCards(undefined, ['risk']), [])
})

test('key 归一化丢弃未知 key、跨分区 key、空值与重复项，并跟随卡片顺序', () => {
  assert.deepEqual(normalizeHiddenCardKeys([' risk ', 'risk', 7, ''], PROJECT_CARD_KEYS), ['risk'])
  assert.deepEqual(normalizeHiddenCardKeys(['contract_amount', 'rectifying'], PROJECT_CARD_KEYS), ['rectifying'])
  assert.deepEqual(normalizeHiddenCardKeys(['rectifying', 'project_total'], PROJECT_CARD_KEYS), ['project_total', 'rectifying'])
  assert.deepEqual(normalizeHiddenCardKeys('risk', PROJECT_CARD_KEYS), [])
  assert.deepEqual(normalizeHiddenCardKeys(null, PROJECT_CARD_KEYS), [])
})

test('列数随可见卡变化：最多 6 列，超过 6 张拆两行，全隐藏仍是合法列数', () => {
  assert.equal(metricColumnCount(0), 1)
  assert.equal(metricColumnCount(1), 1)
  assert.equal(metricColumnCount(3), 3)
  assert.equal(metricColumnCount(5), 5)
  assert.equal(metricColumnCount(6), 6)
  assert.equal(metricColumnCount(7), 4)
  assert.equal(metricColumnCount(10), 5)
  assert.equal(metricColumnCount('4'), 4)
  assert.equal(metricColumnCount(undefined), 1)
})

test('读取存储：JSON 数组生效，损坏或非数组结构退化为默认全可见', () => {
  const key = cardHiddenStorageKey('t1', 'u1')
  const stored = memoryStorage({ [key]: JSON.stringify(['risk', 'rectifying']) })
  assert.deepEqual(readHiddenCardKeys(stored, 't1', 'u1', PROJECT_CARD_KEYS), ['risk', 'rectifying'])
  // 未知 key 与跨分区 key 在读取时就丢弃。
  assert.deepEqual(readHiddenCardKeys(memoryStorage({ [key]: JSON.stringify(['risk', 'contract_total']) }), 't1', 'u1', PROJECT_CARD_KEYS), ['risk'])
  assert.deepEqual(readHiddenCardKeys(memoryStorage({ [key]: '{bad json' }), 't1', 'u1', PROJECT_CARD_KEYS), [])
  assert.deepEqual(readHiddenCardKeys(memoryStorage({ [key]: '{"risk":true}' }), 't1', 'u1', PROJECT_CARD_KEYS), [])
  // 别的账号的键不参与当前账号；无身份不读存储。
  assert.deepEqual(readHiddenCardKeys(stored, 't2', 'u2', PROJECT_CARD_KEYS), [])
  assert.deepEqual(readHiddenCardKeys(stored, '', '', PROJECT_CARD_KEYS), [])
  assert.deepEqual(readHiddenCardKeys(null, 't1', 'u1', PROJECT_CARD_KEYS), [])
})

test('写入存储：只落当前分区 key，恢复默认删除存储项，无身份只保留内存态', () => {
  const storage = memoryStorage()
  const key = cardHiddenStorageKey('t1', 'u1')
  assert.equal(writeHiddenCardKeys(storage, 't1', 'u1', ['risk', 'contract_total'], PROJECT_CARD_KEYS), true)
  assert.equal(storage.getItem(key), JSON.stringify(['risk']))
  assert.equal(writeHiddenCardKeys(storage, 't1', 'u1', [], PROJECT_CARD_KEYS), true)
  assert.equal(storage.getItem(key), null)
  // 恢复默认不会留下空数组。
  assert.deepEqual(Object.keys(storage.dump()), [])
  // 无身份或存储不可用时返回 false：调用方仍可即时生效，只是不持久化。
  assert.equal(writeHiddenCardKeys(storage, '', '', ['risk'], PROJECT_CARD_KEYS), false)
  assert.equal(writeHiddenCardKeys(null, 't1', 'u1', ['risk'], PROJECT_CARD_KEYS), false)
  assert.deepEqual(Object.keys(storage.dump()), [])
})

test('整改中项目取 report_stage_counts.RECTIFYING，缺失/null 记为未采集而不是 0', () => {
  assert.deepEqual(reportStageCount({ RECTIFYING: 3 }, 'RECTIFYING'), { available: true, value: 3 })
  // 大小写与首尾空格归一化；数值字符串同样识别。
  assert.deepEqual(reportStageCount({ ' rectifying ': '4' }, 'rectifying'), { available: true, value: 4 })
  assert.deepEqual(reportStageCount({ Rectifying: 2.9 }, 'RECTIFYING'), { available: true, value: 2 })
  // 已采集但该阶段没有记录 → 0；负值收敛为 0。
  assert.deepEqual(reportStageCount({}, 'RECTIFYING'), { available: true, value: 0 })
  assert.deepEqual(reportStageCount({ RECTIFYING: -2 }, 'RECTIFYING'), { available: true, value: 0 })
  // 旧快照：null / 缺失 / 非对象 → 未采集，value 为 null。
  for (const counts of [null, undefined, '']) {
    assert.deepEqual(reportStageCount(counts, 'RECTIFYING'), { available: false, value: null })
  }
  assert.deepEqual(reportStageCount([3], 'RECTIFYING'), { available: false, value: null })
  // 非数值的脏数据不冒充计数。
  assert.deepEqual(reportStageCount({ RECTIFYING: 'n/a' }, 'RECTIFYING'), { available: true, value: 0 })
})

test('视图把身份传入原生看板，偏好只走本地存储键', () => {
  assert.match(shell, /:tenant-id="me\?\.tenant_id"/)
  assert.match(shell, /:user-id="me\?\.user_id"/)
  assert.match(native, /tenantId: \{ type: \[String, Number\], default: "" \}/)
  assert.match(native, /userId: \{ type: \[String, Number\], default: "" \}/)
  // 纯逻辑全部来自 utils/dashboardCardVisibility.js，视图不复制一套隐藏规则。
  assert.match(native, /from "\.\.\/utils\/dashboardCardVisibility\.js"/)
  for (const symbol of ['PROJECT_CARD_KEYS', 'cardHiddenStorageKey', 'metricColumnCount', 'normalizeHiddenCardKeys', 'readHiddenCardKeys', 'reportStageCount', 'visibleDashboardCards', 'writeHiddenCardKeys']) {
    assert.match(native, new RegExp(`import \\{[\\s\\S]*?\\b${symbol},?[\\s\\S]*?\\} from "\\.\\.\\/utils\\/dashboardCardVisibility\\.js"`), symbol)
  }
  // 偏好只落 da.project.kpi.hidden.*，不复用合同目标等其他本地配置键。
  assert.match(native, /writeHiddenCardKeys\(browserStorage\(\), props\.tenantId, props\.userId, normalized, PROJECT_CARD_KEYS\)/)
})

test('项目分区指标卡带稳定 key，渲染仍用 label，整改中卡不把未知写成 0', () => {
  for (const key of PROJECT_CARD_KEYS) {
    assert.match(native, new RegExp(`key: "${key}"`))
  }
  assert.match(native, /rectifying\.available \? formatInteger\(rectifying\.value\) : "—"/)
  assert.match(native, /meta: rectifying\.available \? "报告整改阶段" : "未采集"/)
  // 渲染使用 label 与可见卡片集合，不用中文当持久化 key。
  assert.match(native, /<span>\{\{ item\.label \}\}<\/span>/)
  assert.match(native, /v-for="item in displayedMetrics"/)
  assert.match(native, /:key="item\.key \|\| item\.label"/)
  assert.match(native, /v-if="item\.meta" class="da-native-metric-meta"/)
})

test('指标卡设置面板：弹层语义 + 开关语义 + 全部隐藏空态 + 恢复默认', () => {
  assert.match(native, /aria-haspopup="dialog"/)
  assert.match(native, /:aria-expanded="cardSettingsOpen"/)
  assert.match(native, /aria-controls="da-project-card-settings"/)
  assert.match(native, /role="dialog"[\s\S]{0,120}?aria-label="指标卡显示设置"/)
  assert.match(native, /class="da-native-card-switch"\s+role="switch"\s+:aria-checked="isProjectCardVisible\(card\.key\)"\s+@click="toggleProjectCard\(card\.key\)"/)
  assert.match(native, /已隐藏全部指标卡/)
  assert.match(native, /v-if="allProjectCardsHidden" class="da-native-metrics-empty" role="status"/)
  assert.match(native, /@click="resetProjectCards">恢复默认</)
  // Escape 与点击外部关闭，打开后焦点落在第一个开关。
  assert.match(native, /event\.key !== "Escape"/)
  assert.match(native, /document\.addEventListener\("click", onCardSettingsOutsideClick\)/)
  assert.match(native, /document\.removeEventListener\("click", onCardSettingsOutsideClick\)/)
  assert.match(native, /querySelector\('\[role="switch"\]'\)/)
})

test('隐藏后网格列数随可见卡重算，窄屏不溢出，开关有可见状态色', () => {
  assert.match(styles, /\.da-native-metrics \{ --da-metric-columns: 6; display: grid; grid-template-columns: repeat\(var\(--da-metric-columns\), minmax\(0, 1fr\)\)/)
  assert.match(styles, /@media \(min-width: 1101px\) \{[\s\S]*?\.da-native-metrics-cols-1 \{ --da-metric-columns: 1; \}/)
  assert.match(styles, /\.da-native-metrics-cols-5 \{ --da-metric-columns: 5; \}/)
  assert.match(styles, /\.da-native-card-switch\[aria-checked="true"\] \.da-native-card-switch-track \{ background: #2563eb; \}/)
  assert.match(styles, /\.da-native-metric\.warn strong \{ color: var\(--da-amber-text[^)]*\); \}/)
  assert.match(styles, /\.da-native-card-settings-panel \{[\s\S]*?width: min\(300px, calc\(100vw - 32px\)\);/)
})
