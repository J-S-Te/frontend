import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./components/PersonnelChangeCenter.vue', import.meta.url), 'utf8')

test('人员异动页面要求离职选择原任职并公开审批交接规则', () => {
  assert.match(source, /\['PROMOTION', 'DEMOTION', 'TRANSFER', 'TERMINATION'\]\.includes\(form\.type\)/)
  assert.match(source, /晋升、降职、调岗和离职必须选择原任职/)
  assert.match(source, /离职必须审批并完成责任交接/)
  assert.doesNotMatch(source, /管理员直接配置，无需审批/)
  assert.doesNotMatch(source, /离职、复职可不填/)
  assert.match(source, /submitPersonnelChange/)
  assert.match(source, /transitionPersonnelChange/)
  assert.match(source, /PENDING_HANDOVER/)
})

test('复职人员目录不再限制为仅在职人员', () => {
  assert.match(source, /listUsers\(\{ page: 1, pageSize: 100 \}\)/)
  assert.doesNotMatch(source, /listUsers\(\{ page: 1, pageSize: 100, status: 'ACTIVE' \}\)/)
})
