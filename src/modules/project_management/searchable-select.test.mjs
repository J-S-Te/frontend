import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath, URL } from 'node:url'

import { filterSearchableOptions, fuzzyIncludes, normalizeSearchText } from './components/searchableSelect.js'
import {
  bindSearchableSelectViewport,
  calculateSearchableSelectLayout,
  readSearchableSelectTheme,
  readViewport,
  searchableSelectMenuStyle,
} from './components/searchableSelectPositioning.js'

const component = readFileSync(fileURLToPath(new URL('./components/SearchableSelect.vue', import.meta.url)), 'utf8')

test('模糊选择支持连续文本、忽略分隔符和按字符顺序命中', () => {
  assert.equal(normalizeSearchText(' CISP-PTE '), 'cisppte')
  assert.equal(fuzzyIncludes('项目经理', '项经'), true)
  assert.equal(fuzzyIncludes('注册信息安全专业人员 CISP-PTE', 'cisp pte'), true)
  assert.equal(fuzzyIncludes('团队负责人', '设备'), false)
})

test('人员选项可按姓名、资质编号和资质编码搜索', () => {
  const options = [
    { id: 'user-1', name: '张三', resourceID: 'P-0007', codes: ['CISP-PTE'], description: 'P-0007 · CISP-PTE' },
    { id: 'user-2', name: '李四', resourceID: 'P-0008', codes: ['等保高级'] },
  ]
  assert.deepEqual(filterSearchableOptions(options, '张三').map((row) => row.id), ['user-1'])
  assert.deepEqual(filterSearchableOptions(options, '0007').map((row) => row.id), ['user-1'])
  assert.deepEqual(filterSearchableOptions(options, 'cisp pte').map((row) => row.id), ['user-1'])
  assert.deepEqual(filterSearchableOptions(options, '等保').map((row) => row.id), ['user-2'])
})

test('统一组件具备单选、多选、搜索、键盘和无障碍语义', () => {
  assert.match(component, /defineEmits\(\['update:modelValue', 'change'\]\)/)
  assert.match(component, /filterSearchableOptions\(props\.options, keyword\.value\)/)
  assert.match(component, /role="combobox"/)
  assert.match(component, /role="listbox"/)
  assert.match(component, /aria-multiselectable="multiple"/)
  assert.match(component, /event\.key === 'ArrowDown'/)
  assert.match(component, /event\.key === 'Escape'/)
})

test('下拉菜单由点击触发并随视口空间动态翻转定位', () => {
  assert.match(component, /@click\.stop="toggle"/)
  assert.doesNotMatch(component, /@mouseenter="(?:show|toggle)"|@focus="(?:show|toggle)"/)
  assert.match(component, /<Teleport to="body">/)
  assert.match(component, /calculateSearchableSelectLayout\(/)
  assert.match(component, /readViewport\(window\)/)
  assert.match(component, /bindSearchableSelectViewport\(window, onViewportChange\)/)
  assert.match(component, /document\.addEventListener\('pointerdown', onOutsidePointerDown, true\)/)
  assert.match(component, /!menu\.value\?\.contains\(event\.target\)/)
  assert.match(component, /readSearchableSelectTheme\(root\.value\)/)
  assert.match(component, /\.pm-search-select-menu \{ position: fixed;/)
})

test('定位纯函数在下方空间不足时向上翻转并限制在视口内', () => {
  const viewport = { width: 390, height: 720, left: 0, top: 0 }
  const trigger = { top: 660, bottom: 704, left: 330, width: 120 }
  const layout = calculateSearchableSelectLayout(trigger, viewport, 280)
  assert.equal(layout.placement, 'top')
  assert.ok(layout.top >= 12)
  assert.ok(layout.left >= 12)
  assert.ok(layout.left + layout.width <= 378)
  assert.ok(layout.maxHeight <= 320)
})

test('视口和主题读取由独立方法统一转换为菜单样式', () => {
  assert.deepEqual(readViewport({
    innerWidth: 1024,
    innerHeight: 768,
    visualViewport: { width: 360, height: 640, offsetLeft: 4, offsetTop: 8 },
  }), { width: 360, height: 640, left: 4, top: 8 })
  const theme = readSearchableSelectTheme({}, () => ({
    getPropertyValue: (name) => name === '--pm-primary' ? '#2563eb' : '',
    fontFamily: 'system-ui',
    fontSize: '14px',
    color: 'rgb(15, 23, 42)',
  }))
  const style = searchableSelectMenuStyle({ top: 20, left: 30, width: 240, maxHeight: 180 }, theme)
  assert.equal(style.top, '20px')
  assert.equal(style.width, '240px')
  assert.equal(style['--pm-primary'], '#2563eb')
  assert.equal(style.fontFamily, 'system-ui')
})

test('视口事件绑定方法统一注册并完整清理监听器', () => {
  const calls = []
  const makeTarget = (scope) => ({
    addEventListener: (type, listener, capture) => calls.push(['add', scope, type, listener, capture]),
    removeEventListener: (type, listener, capture) => calls.push(['remove', scope, type, listener, capture]),
  })
  const listener = () => {}
  const windowTarget = { ...makeTarget('window'), visualViewport: makeTarget('visualViewport') }
  const cleanup = bindSearchableSelectViewport(windowTarget, listener)
  cleanup()
  assert.equal(calls.filter(([action]) => action === 'add').length, 4)
  assert.equal(calls.filter(([action]) => action === 'remove').length, 4)
  assert.ok(calls.every(([, , , registered]) => registered === listener))
})

test('搜索栏图标和弹层尺寸受组件自身约束，不会被表单全局样式撑大', () => {
  assert.doesNotMatch(component, /ConsoleIcon/)
  assert.match(component, /class="pm-search-select-search-icon"/)
  assert.match(component, /\.pm-search-select-search-icon \{[^}]*width: 14px;[^}]*height: 14px;/)
  assert.match(component, /menuStyle\.value = searchableSelectMenuStyle\(/)
  assert.match(component, /\.pm-search-select-menu \{[^}]*overflow: hidden;/)
  assert.match(component, /\.pm-search-select-search \{[^}]*grid-template-columns: 16px minmax\(0, 1fr\);/)
  assert.match(component, /\.pm-search-select-search input \{[^}]*height: 36px;[^}]*min-height: 0;/)
})
