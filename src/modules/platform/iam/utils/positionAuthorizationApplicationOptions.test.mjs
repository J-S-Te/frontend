import assert from 'node:assert/strict'
import test from 'node:test'

import {
  additionalApplicationOptions,
  applicationIdOf,
} from './positionAuthorizationApplicationOptions.js'

const applications = [
  { application_id: 'platform', name: '基础平台' },
  { application_id: 'contract', name: '合同管理系统' },
  { application_id: 'crm', name: '客户与商机管理系统' },
  { application_id: 'project', name: '项目服务内容管理系统' },
]

test('追加子系统排除主应用和已选的其他子系统', () => {
  const rows = [
    { application_id: 'crm' },
    { application_id: '' },
  ]
  const options = additionalApplicationOptions(applications, 'contract', rows, rows[1])
  assert.deepEqual(options.map(applicationIdOf), ['platform', 'project'])
})

test('当前行保留自己的已选值，避免编辑时显示空白', () => {
  const current = { application_id: 'crm' }
  const options = additionalApplicationOptions(applications, 'contract', [current], current)
  assert.deepEqual(options.map(applicationIdOf), ['platform', 'crm', 'project'])
})

test('没有主应用时仍排除其他追加行已经选择的应用', () => {
  const rows = [
    { application_id: 'contract' },
    { application_id: '' },
  ]
  const options = additionalApplicationOptions(applications, '', rows, rows[1])
  assert.deepEqual(options.map(applicationIdOf), ['platform', 'crm', 'project'])
})

test('空应用列表和空行安全返回空数组', () => {
  assert.deepEqual(additionalApplicationOptions(null, '', null, null), [])
  assert.deepEqual(additionalApplicationOptions(applications, '', [{ application_id: '' }], null).length, 4)
})

test('支持 id 字段并过滤空标识', () => {
  const list = [{ id: 'a' }, { id: '' }, { name: 'missing-id' }]
  assert.deepEqual(additionalApplicationOptions(list, '', [], null).map(applicationIdOf), ['a'])
})
