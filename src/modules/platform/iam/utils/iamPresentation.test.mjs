import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detailRows,
  detailTitle,
  displayLoginAccountType,
} from './iamPresentation.js'

test('登录账号详情可格式化账号类型、认证方式和状态', () => {
  const detail = {
    kind: 'account',
    item: {
      account_id: 'acc-001',
      account_name: 'alice',
      user_id: 'user-001',
      account_type: 'HUMAN',
      auth_source: 'LOCAL',
      status: 'ACTIVE',
      version: 2,
    },
  }

  assert.equal(detailTitle(detail), 'alice')
  assert.deepEqual(detailRows(detail), [
    { label: '账号 ID', value: 'acc-001' },
    { label: '账号', value: 'alice' },
    { label: '关联用户 ID', value: 'user-001' },
    { label: '账号类型', value: '个人账号' },
    { label: '认证方式', value: '本地密码' },
    { label: '状态', value: '启用' },
    { label: '最近登录', value: '—' },
    { label: '版本', value: 2 },
  ])
})

test('旧账号响应缺少类型字段时使用兼容展示值', () => {
  assert.equal(displayLoginAccountType({}), '个人账号 / 本地密码')
})

test('任职关系详情不会跨脚本引用未定义的格式化函数', () => {
  const rows = detailRows({
    kind: 'membership',
    item: {
      membership_id: 'membership-001',
      user_id: 'user-001',
      org_unit_id: 'org-001',
      membership_type: 'PART_TIME',
      status: 'ACTIVE',
    },
  })

  assert.deepEqual(rows.find((row) => row.label === '任职类型'), {
    label: '任职类型',
    value: '兼岗',
  })
})
