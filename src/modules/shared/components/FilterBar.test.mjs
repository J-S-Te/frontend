import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./FilterBar.vue', import.meta.url), 'utf8')

test('筛选条默认只显示前 3 个字段，并提供展开状态', () => {
  assert.match(source, /visibleCount: \{ type: Number, default: 3 \}/)
  assert.match(source, /:nth-child\(n \+ 4\)/)
  assert.match(source, /:aria-expanded="expanded \? 'true' : 'false'"/)
  assert.match(source, /@click="toggle"/)
})

test('筛选条保留业务插槽与操作区', () => {
  assert.match(source, /<slot name="fields" \/>/)
  assert.match(source, /<slot name="actions" \/>/)
  assert.match(source, /@media \(max-width: 640px\)/)
})
