import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

test('用户详情将手机号按脱敏字段展示', () => {
  const rows = detailRows({
    kind: 'user',
    item: {
      user_id: 'user-001',
      display_name: '张三',
      mobile_masked: '138****0000',
      status: 'ACTIVE',
      version: 1,
    },
  })

  assert.deepEqual(rows.find((row) => row.label === '手机号（脱敏）'), {
    label: '手机号（脱敏）',
    value: '138****0000',
  })
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

test('用户详情提供受权限控制的管理员临时密码入口', () => {
  const source = readFileSync(fileURLToPath(new URL('../components/IamSettingsModule.vue', import.meta.url)), 'utf8')
  assert.match(source, /hasPermission\(IAM_PERMISSIONS\.accountPasswordReset\).*重置登录密码/)
  assert.match(source, /@click="openPasswordResetForUser\(detail\.item\)"/)
  assert.match(source, /后端未返回一次性临时密码/)
})

test('用户详情展示脱敏的 Keycloak 映射状态和 external subject', () => {
  const source = readFileSync(fileURLToPath(new URL('../components/IamSettingsModule.vue', import.meta.url)), 'utf8')
  assert.match(source, /keycloakMappingState/)
  assert.match(source, /keycloakExternalSubject/)
  assert.match(source, /Subject：\{\{ keycloakExternalSubject \}\}/)
  assert.match(source, /raw\.slice\(0, 4\).*raw\.slice\(-4\)/s)
})
