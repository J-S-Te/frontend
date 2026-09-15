import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath, URL } from 'node:url'

import { filterSearchableOptions, fuzzyIncludes, normalizeSearchText } from './components/searchableSelect.js'

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
