import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../../main.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles/process-timeline.css', import.meta.url), 'utf8')

test('流程时间线样式在 Ant 视觉层之后加载', () => {
  assert.ok(main.includes("import '@/modules/shared/styles/process-timeline.css'"))
  assert.ok(main.indexOf('process-timeline.css') > main.indexOf('ui-refresh.css'))
})

test('五类流程时间线共享同一套卡片和标题尺度', () => {
  for (const marker of [
    '.settlement-timeline-body', '.expense-timeline__item', '.report-timeline li > div',
    '.crm-timeline-card', '.contract-action-log > div',
  ]) assert.ok(css.includes(marker), marker)
  assert.match(css, /--tl-card-radius:\s*var\(--ui-radius-card/)
  assert.match(css, /padding:\s*11px 13px/)
  assert.match(css, /font-size:\s*14px/)
})

test('CRM 三列布局和窄屏两列布局都保留', () => {
  assert.match(css, /grid-template-columns:\s*30px minmax\(118px, 140px\) minmax\(0, 1fr\)/)
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /grid-template-columns:\s*30px minmax\(0, 1fr\)/)
})
