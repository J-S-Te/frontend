import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./components/ReimbursementSpendPanel.vue', import.meta.url), 'utf8')

test('费用参与资格只维护例外人员，人员从目录选择并保留未知主体显示', () => {
  assert.match(source, /listPersonnel/)
  assert.match(source, /personnelOptions/)
  assert.match(source, /<select v-model="exceptionForm\.subject_id"/)
  assert.match(source, /v-for="person in personnelOptions"/)
  assert.match(source, /:value="person\.id"/)
  assert.match(source, /personnelNames\[person\.subject_id\]/)
})

test('人员目录失败时显示错误且不吞错，不再要求手输内部主体', () => {
  assert.match(source, /personnelError\.value = cause\.message \|\|/)
  assert.match(source, /ticket !== personnelSequence/)
  assert.doesNotMatch(source, /手动输入主体 ID/)
})

test('仅在项目存在且具备资格管理权限时默认读取例外名单', () => {
  assert.match(source, /if \(!props\.projectId \|\| !canManage\.value\) return/)
  assert.match(source, /if \(props\.projectId && canManage\.value\) void loadParticipants\(\)/)
})
