import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./table-enter.css', import.meta.url), 'utf8')
const main = readFileSync(new URL('../../../main.js', import.meta.url), 'utf8')

test('表格行入场动效按原型 B 的时长、位移与 stagger 落地', () => {
  assert.match(css, /@keyframes ui-table-row-in/)
  assert.match(css, /translateY\(8px\)/)
  assert.match(css, /240ms var\(--ease-out\)/)
  assert.match(css, /animation-delay: 200ms/)
  assert.match(css, /nth-child\(2\) \{ animation-delay: 230ms/)
  assert.match(css, /nth-child\(10\) \{ animation-delay: 470ms/)
})

test('减少动态偏好下表格行直接静态呈现', () => {
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /animation: none/)
})

test('表格动效在全局入口加载', () => {
  assert.match(main, /import '@\/modules\/shared\/styles\/table-enter\.css'/)
})
