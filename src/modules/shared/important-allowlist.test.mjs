import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../', import.meta.url).pathname
const ALLOWED = new Set([
  'scrollbar-width', 'display', 'width', 'height',
  'animation-duration', 'animation-iteration-count',
  'scroll-behavior', 'transition-duration', 'transition',
])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name.endsWith('.css')) out.push(path)
  }
  return out
}

test('!important 只允许用于可访问性/滚动条/过渡兜底', () => {
  const offenders = []
  let total = 0
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/([a-z-]+)\s*:\s*[^;{}]*?!important/g)) {
      total += 1
      if (!ALLOWED.has(match[1])) offenders.push(file + ': ' + match[1])
    }
  }
  assert.deepEqual(offenders, [], '!important 只能用于白名单属性')
  assert.equal(total, 15, '!important 数量应与例外清单一致')
})
