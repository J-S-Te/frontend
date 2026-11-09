import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'

test('来源业务键的真实HTML pattern遵循浏览器v模式并保留编号字符范围', () => {
  const source = readFileSync(new URL('./components/ContractImportPanel.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const pending = [baseParse(descriptor.template.content)]
  let input
  while (pending.length) {
    const node = pending.pop()
    if (node.tag === 'input' && node.props.some(property =>
      property.name === 'id' && property.value?.content === 'contract-import-row-external-record-id')) {
      input = node
      break
    }
    pending.push(...(node.children || []))
  }
  assert.ok(input, '来源业务键输入应存在')
  const pattern = input.props.find(property => property.name === 'pattern')?.value?.content
  let expression
  assert.doesNotThrow(() => { expression = new RegExp(`^(?:${pattern})$`, 'v') })
  for (const value of ['GTSR-261149', 'old_1', 'SYS:2026.001']) assert.equal(expression.test(value), true)
  for (const value of ['', 'old 1', '合同编号', 'a/b', 'a|b']) assert.equal(expression.test(value), false)
})
