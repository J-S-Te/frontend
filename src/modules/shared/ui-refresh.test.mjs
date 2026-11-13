import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../../main.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles/ui-refresh.css', import.meta.url), 'utf8')

test('Ant Design 视觉层在 global-ux 之后加载，覆盖全模块而不改写业务入口', () => {
  const globalIndex = main.indexOf("import '@/modules/shared/styles/global-ux.css'")
  const refreshIndex = main.indexOf("import '@/modules/shared/styles/ui-refresh.css'")
  assert.ok(globalIndex >= 0, 'global-ux.css must remain imported')
  assert.ok(refreshIndex > globalIndex, 'ui-refresh.css must load after global-ux.css')
  assert.ok(!main.includes('ui-refresh.css\nimport'), 'unexpected duplicate import order')
})

test('视觉层覆盖八个子系统的主要组件挂点并保留深色主题', () => {
  for (const marker of [
    '.console-card', '.contract-card', '.crm-panel', '.portal-card',
    '.settlement-panel', '.da-panel', '.pm-panel', '.expense-panel',
    '.console-button', '.contract-button', '.pm-button', '.da-button', '.expense-button',
    '[data-theme="dark"]',
  ]) {
    assert.ok(css.includes(marker), `ui-refresh.css 缺少 ${marker}`)
  }
})

test('视觉层不使用 !important，并尊重减少动态效果偏好', () => {
  assert.ok(!css.includes('!important'))
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /--ui-radius-card:\s*8px/)
  assert.match(css, /--ui-radius-control:\s*6px/)
})

test('视觉层只通过根变量改色，不引入新的全局 !important 重置', () => {
  assert.ok(css.includes('--ui-primary: #1677ff'))
  assert.ok(!/^\s*\*\s*\{/m.test(css), '不要用通配符覆盖所有控件')
})
