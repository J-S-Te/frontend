import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLoginTargetApplicationOptions } from './applicationBoundary.js'

test('登录目标管理边界保留所有同名应用登记并使用唯一 ID 区分', () => {
  const options = buildLoginTargetApplicationOptions([
    { application_id: '01KYCOLDAPPLICATION0001', code: 'contract_management', name: '合同管理系统' },
    { application_id: '01KYCNEWAPPLICATION0002', code: 'contract_management_prod', name: '合同管理系统生产环境' },
  ])

  assert.equal(options.length, 2)
  assert.deepEqual(options.map((option) => option.applicationID).sort(), [
    '01KYCNEWAPPLICATION0002',
    '01KYCOLDAPPLICATION0001',
  ])
  assert.ok(options.every((option) => option.hasSameName))
  assert.ok(options.every((option) => option.label.includes('ID ')))
  assert.ok(options.some((option) => option.label.includes('contract_management')))
  assert.ok(options.some((option) => option.label.includes('contract_management_prod')))
})

test('不同名称的应用保持简洁标签且过滤缺少 application_id 的无效记录', () => {
  const options = buildLoginTargetApplicationOptions([
    { application_id: 'app-platform', code: 'platform', name: '基础能力平台' },
    { application_id: 'app-contract', code: 'contract_management', name: '合同管理系统' },
    { code: 'invalid', name: '无边界记录' },
  ])

  assert.equal(options.length, 2)
  assert.equal(options.find((option) => option.applicationID === 'app-platform').label, '基础能力平台（platform）')
  assert.equal(options.find((option) => option.applicationID === 'app-contract').label, '合同管理系统（contract_management）')
  assert.ok(options.every((option) => !option.hasSameName))
})

test('管理边界不会按应用名称或编码别名进行门户式去重', () => {
  const source = [
    { application_id: 'app-1', code: 'business_app', name: '业务系统' },
    { application_id: 'app-2', code: 'business-app', name: '业务系统' },
    { application_id: 'app-3', code: 'business-app-v2', name: '业务系统二期' },
  ]

  assert.equal(buildLoginTargetApplicationOptions(source).length, source.length)
})
