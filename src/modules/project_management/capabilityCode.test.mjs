import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITY_CODE_CATEGORIES, capabilityCodeCategory } from './capabilityCode.js'
import { STATUS_TONES } from '../shared/theme/statusCatalog.js'

test('常见资质/能力编码归入稳定类别', () => {
  assert.equal(capabilityCodeCategory('代码审计'), 'testing')
  assert.equal(capabilityCodeCategory('WEB扫描'), 'testing')
  assert.equal(capabilityCodeCategory('APP检测'), 'testing')
  assert.equal(capabilityCodeCategory('漏洞扫描'), 'testing')
  assert.equal(capabilityCodeCategory('等级保护中级测评师'), 'credential')
  assert.equal(capabilityCodeCategory('商用密码测评师'), 'credential')
  assert.equal(capabilityCodeCategory('渗透测试工程师'), 'credential')
  assert.equal(capabilityCodeCategory('ISO27001'), 'system')
  assert.equal(capabilityCodeCategory('CMMI3'), 'system')
  assert.equal(capabilityCodeCategory('自定义编码'), 'other')
  assert.equal(capabilityCodeCategory(''), 'other')
})

test('大小写与空格不改变类别，后端类别优先', () => {
  assert.equal(capabilityCodeCategory('  web扫描 '), 'testing')
  assert.equal(capabilityCodeCategory('custom', 'credential'), 'credential')
  assert.equal(capabilityCodeCategory('web扫描', 'unknown'), 'testing')
})

test('分类键与状态五档完全隔离', () => {
  for (const category of CAPABILITY_CODE_CATEGORIES) {
    assert.equal(STATUS_TONES.includes(category), false)
  }
})
