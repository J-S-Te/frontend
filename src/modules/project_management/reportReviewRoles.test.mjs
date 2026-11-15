import test from 'node:test'
import assert from 'node:assert/strict'
import { canDecideMetricReport } from './metricFacts.js'

test('审核按钮需要明确审核权限，并与编制及送审身份分离', () => {
  const pending = {decision:'PENDING',prepared_by:'author',submitted_by:'manager'}
  for (const [user, permissions, allowed] of [
    ['quality',['project.report.review'],true],
    ['manager',['project.report.prepare'],false],
    ['author',['project.report.review'],false],
    ['manager',['project.report.prepare','project.report.review'],false],
    ['reader',['project.read'],false],
    ['',['project.report.review'],false],
  ]) {
    assert.equal(canDecideMetricReport(pending, {user_id:user,permissions}), allowed)
  }
  assert.equal(canDecideMetricReport({...pending,decision:'PASSED'},
    {user_id:'quality',permissions:['project.report.review']}), false)
})
