import test from 'node:test'
import assert from 'node:assert/strict'
import { enableableMetricLabels, enableableMetricSummary, metricEnableBlockText } from './metricEnable.js'

const metric = (extra = {}) => ({
  code: '1.1',
  name: '签约金额',
  origin: 'BUILTIN',
  can_enable: false,
  enable_block_reason: 'CALCULATION_BINDING_MISSING',
  ...extra,
})

test('未确认、口径漂移、未接入执行器分别给出可操作原因', () => {
  assert.match(metricEnableBlockText({ enable_block_reason: 'METRIC_STATUS_UNCONFIRMED' }), /口径状态未确认/)
  assert.match(metricEnableBlockText({ enable_block_reason: 'CALCULATION_DEFINITION_DRIFT' }), /偏离内置发布版本/)
  assert.match(metricEnableBlockText(metric()), /尚未接入受控计算执行器/)
  assert.doesNotMatch(metricEnableBlockText(metric()), /口径已确认/)
})

test('自定义指标说明当前只能维护口径', () => {
  const text = metricEnableBlockText(metric({ origin: 'CUSTOM' }))
  assert.match(text, /自定义指标/)
  assert.match(text, /维护口径/)
})

test('旧后端未返回原因时按来源给出兼容提示，未知原因码回落通用提示', () => {
  assert.match(metricEnableBlockText({ origin: 'CUSTOM' }), /自定义指标/)
  assert.match(metricEnableBlockText(metric({ enable_block_reason: undefined })), /未接入受控计算执行器或口径未匹配发布版本/)
  assert.match(metricEnableBlockText(null), /未接入受控计算执行器或口径未匹配发布版本/)
  assert.match(metricEnableBlockText({ enable_block_reason: 'UNKNOWN' }), /未绑定可用计算能力或口径不匹配/)
})

test('可启用指标清单只包含 can_enable 项并展示编码与名称', () => {
  assert.deepEqual(enableableMetricLabels([
    { code: '1.1', name: '签约金额', can_enable: false },
    { code: '2.1', name: '项目状态分布', can_enable: true },
  ]), ['2.1 项目状态分布'])
  assert.deepEqual(enableableMetricLabels(null), [])
  assert.equal(enableableMetricSummary([]), '暂无')
  assert.equal(enableableMetricSummary([{ code: '2.1', name: '项目状态分布', can_enable: true }]), '2.1 项目状态分布')
})
