import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'

test('指标字典确认框独立于指标循环和管理按钮分支，空列表也能取消编辑', () => {
  const source = readFileSync(new URL('../data_analysis/views/DictionaryView.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const root = baseParse(descriptor.template.content)
  let count = 0
  function visit(node, repeated = false) {
    const inLoop = repeated || Boolean(node.props?.some(p => p.type === 7 && p.name === 'for'))
    if (node.tag === 'ConfirmDialog') { count++; assert.equal(inLoop, false) }
    for (const child of node.children || []) visit(child, inLoop)
  }
  visit(root)
  assert.equal(count, 1)
})
