import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./components/PersonnelChangeCenter.vue', import.meta.url), 'utf8')

test('人员异动页面按类型校验任职字段并公开审批交接规则', () => {
  assert.match(source, /\['PROMOTION', 'DEMOTION', 'TRANSFER'\]\.includes\(form\.type\)/)
  assert.match(source, /晋升、降职和调岗必须选择原任职/)
  assert.match(source, /晋升、降职、调岗和复职必须选择新组织和新岗位/)
  assert.match(source, /离职必须审批并完成责任交接/)
  assert.doesNotMatch(source, /离职、复职可不填/)
  assert.match(source, /submitPersonnelChange/)
  assert.match(source, /transitionPersonnelChange/)
  assert.match(source, /PENDING_HANDOVER/)
})

test('人员异动弹窗将操作栏固定在可滚动表单外', () => {
  assert.match(source, /\.personnel-change-modal \{ display: flex;/)
  assert.match(source, /\.personnel-change-modal-body \{ min-height: 0; flex: 1 1 auto;/)
  assert.match(source, /\.personnel-change-modal > \.console-form-actions \{ position: relative;/)
})

test('复职人员目录不再限制为仅在职人员', () => {
  assert.match(source, /listUsers\(\{ page: 1, pageSize: 100 \}\)/)
  assert.doesNotMatch(source, /listUsers\(\{ page: 1, pageSize: 100, status: 'ACTIVE' \}\)/)
})
