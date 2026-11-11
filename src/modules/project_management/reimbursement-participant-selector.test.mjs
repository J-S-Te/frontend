import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./components/ReimbursementSpendPanel.vue', import.meta.url), 'utf8')

test('费用参与资格从人员目录选择主体并保留既有未知主体', () => {
  assert.match(source, /listPersonnel/)
  assert.match(source, /const personnelSelectOptions = computed/)
  assert.match(source, /<select v-model="participantForm\.subject_id"/)
  assert.match(source, /v-for="person in personnelSelectOptions"/)
  assert.match(source, /:value="person\.id"/)
  assert.match(source, /options\.unshift/)
})

test('人员目录失败时保留手动输入降级且不吞错', () => {
  assert.match(source, /const manualSubject = ref\(false\)/)
  assert.match(source, /手动输入主体 ID/)
  assert.match(source, /personnelError\.value = cause\.message \|\|/)
  assert.match(source, /ticket !== personnelSequence/)
})

test('仅在项目存在且具备资格管理权限时读取人员目录', () => {
  assert.match(source, /if \(!props\.projectId \|\| !canManage\.value\) return/)
  assert.match(source, /if \(props\.projectId && canManage\.value\) void loadPersonnel\(\)/)
})
