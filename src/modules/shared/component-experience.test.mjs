import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { compileStyle } from '@vue/compiler-sfc'

const cssPath = new URL('./styles/component-experience.css', import.meta.url)
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
const main = readFileSync(new URL('../../main.js', import.meta.url), 'utf8')

test('组件体验层位于既有视觉层之后，且 CSS 可被实际编译', () => {
  const refresh = main.indexOf("import '@/modules/shared/styles/ui-refresh.css'")
  const experience = main.indexOf("import '@/modules/shared/styles/component-experience.css'")
  assert.ok(refresh >= 0 && experience > refresh)
  assert.ok(css.length > 0)
  assert.deepEqual(compileStyle({ source: css, id: 'experience' }).errors, [])
})

test('动效统一时长且退出快于进入，减少动效时长归零', () => {
  assert.match(css, /--ui-motion-fast:\s*100ms/)
  assert.match(css, /--ui-motion-enter:\s*200ms/)
  assert.match(css, /--ui-motion-drawer:\s*300ms/)
  assert.match(css, /--ui-motion-exit:\s*100ms/)
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /--ui-motion-enter:\s*0ms/)
  assert.match(reduced, /animation:\s*none/)
  assert.match(reduced, /transition:\s*none/)
  assert.doesNotMatch(css, /transition:\s*all\b/)
  assert.doesNotMatch(css, /!important/)
})

test('表单控件含独立筛选输入且错误态晚于 hover，禁用与只读有独立状态', () => {
  assert.match(css, /input:not\(\[type="checkbox"\]\)/)
  assert.match(css, /:read-only/)
  assert.match(css, /aria-invalid="true"/)
  assert.match(css, /:user-invalid/)
  assert.ok(css.indexOf('[aria-invalid="true"]') > css.indexOf(':hover'))
  assert.match(css, /:focus-visible/)
  assert.match(css, /:disabled/)
})

test('所有八模块的导航、弹出、控制、展示实际挂点都能应用规范', () => {
  const hooks = {
    platform: ['.console-nav-item', '.console-detail-modal', '.console-button', '.console-card'],
    contract: ['.contract-nav-item', '.contract-detail-modal', '.contract-button', '.contract-card'],
    project: ['.pm-nav-item', '.pm-dialog', '.pm-button', '.pm-panel'],
    crm: ['.crm-nav-item', '.crm-customer-dialog', '.crm-content', '.crm-panel'],
    portal: ['.portal-nav-item', '.portal-dialog', '.portal-content', '.portal-card'],
    reimbursement: ['.expense-tabs', '.shared-confirm', '.expense-button', '.expense-panel'],
    settlement: ['.settlement-nav-item', '.settlement-notification-popover', '.settlement-content', '.settlement-panel'],
    analysis: ['.da-nav-item', '.da-modal', '.da-button', '.da-panel'],
  }
  for (const [module, selectors] of Object.entries(hooks)) {
    for (const selector of selectors) assert.ok(css.includes(selector), `${module}: ${selector}`)
  }
})

test('共享页签和 Teleport 表单使用根级主题，不依赖业务容器的局部变量', () => {
  assert.match(css, /--ui-overlay-scrim:/)
  assert.match(css, /\.ui-form-dialog\s*\{[^}]*background:\s*var\(--ui-overlay-scrim\)/)
  assert.match(css, /\.ui-segmented-tabs__tab\[aria-selected="true"\][^{]*\{[^}]*color:\s*var\(--ui-primary-ink\)/)
})
