import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../', import.meta.url).pathname
const ALLOWED = new Set([1200, 900, 640, 480])
const OLD = new Set([1366, 1360, 1343, 1320, 1280, 1203, 1180, 1120, 1080, 1050, 1000, 980, 860, 820, 800, 768, 760, 720, 700, 680, 650, 620, 560, 520, 460, 420])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name.endsWith('.css') || entry.name.endsWith('.vue')) out.push(path)
  }
  return out
}

test('响应式断点只允许 1200 / 900 / 640 / 480', () => {
  const offenders = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/@media \(max-width: ?(\d+)px\)/g)) {
      const width = Number(match[1])
      if (OLD.has(width) || !ALLOWED.has(width)) offenders.push(`${file}: ${width}px`)
    }
  }
  assert.deepEqual(offenders, [], '断点必须收敛到 1200/900/640/480')
})
