import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./components/ReimbursementSpendPanel.vue', import.meta.url), 'utf8')

test('费用参与资格从人员目录选择主体，未读取到姓名时保留原主体', () => {
  assert.match(source, /listPersonnel/)
  assert.match(source, /personnelOptions/)
  assert.match(source, /<select v-model="exceptionForm\.subject_id"/)
  assert.match(source, /v-for="person in personnelOptions"/)
  assert.match(source, /:value="person\.id"/)
  assert.match(source, /personnelNames\.value\[person\.subject_id\]/)
})

test('人员目录失败时显示错误且不吞错，不再要求手输内部主体', () => {
  assert.match(source, /personnelError\.value = cause\.message \|\|/)
  assert.match(source, /ticket !== personnelSequence/)
  assert.doesNotMatch(source, /手动输入主体 ID/)
})

test('仅在项目存在且具备资格管理权限时默认读取项目资格名单', () => {
  assert.match(source, /if \(!props\.projectId \|\| !canManage\.value\) return/)
  assert.match(source, /if \(props\.projectId && canManage\.value\) void loadParticipants\(\)/)
})
