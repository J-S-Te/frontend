import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAnyPermission } from '../../auth/utils/permissions.js'
import {
  IAM_ENTRY_PERMISSIONS,
  IAM_PANEL_PERMISSIONS,
  IAM_PERMISSIONS,
  iamPanelPermissions,
  iamPanelReadPermission,
} from './iamPermissions.js'

test('IAM 入口权限包含各面板的真实读取和管理权限', () => {
  for (const codes of Object.values(IAM_PANEL_PERMISSIONS)) {
    for (const code of codes) {
      assert.equal(IAM_ENTRY_PERMISSIONS.includes(code), true, `${code} 应允许进入 IAM`)
    }
  }
})

test('只有角色绑定权限且没有 user:read 时仍可进入 IAM 授权面板', () => {
	const principal = { permission_codes: [IAM_PERMISSIONS.roleBindingUpdate] }
  assert.equal(checkAnyPermission(principal, IAM_ENTRY_PERMISSIONS), true)
  assert.equal(checkAnyPermission(principal, iamPanelPermissions('positionAuthorizationTemplates')), true)
  assert.equal(checkAnyPermission(principal, iamPanelPermissions('users')), false)
})

test('各目录面板不再共享 user:read，而是使用各自权限集合', () => {
  const principal = { permission_codes: [IAM_PERMISSIONS.organizationRead] }
  assert.equal(checkAnyPermission(principal, iamPanelPermissions('organizations')), true)
  assert.equal(checkAnyPermission(principal, iamPanelPermissions('users')), false)
  assert.equal(iamPanelReadPermission('organizations'), IAM_PERMISSIONS.organizationRead)

  for (const panelKey of ['organizations', 'positions', 'memberships']) {
    assert.equal(iamPanelPermissions(panelKey).includes(IAM_PERMISSIONS.userRead), false, `${panelKey} 不得依赖 user:read`)
    assert.notEqual(iamPanelReadPermission(panelKey), IAM_PERMISSIONS.userRead, `${panelKey} 的读取权限必须独立`)
  }
  assert.equal(iamPanelPermissions('users').includes(IAM_PERMISSIONS.userRead), true)
})

test('组织、岗位、任职关系的操作权限只来自对应资源', () => {
  assert.deepEqual(iamPanelPermissions('organizations'), [
    IAM_PERMISSIONS.organizationRead,
    IAM_PERMISSIONS.organizationCreate,
    IAM_PERMISSIONS.organizationUpdate,
    IAM_PERMISSIONS.organizationDelete,
  ])
  assert.deepEqual(iamPanelPermissions('positions'), [
    IAM_PERMISSIONS.positionRead,
    IAM_PERMISSIONS.positionCreate,
    IAM_PERMISSIONS.positionDelete,
  ])
  assert.deepEqual(iamPanelPermissions('memberships'), [
    IAM_PERMISSIONS.membershipRead,
    IAM_PERMISSIONS.membershipCreate,
    IAM_PERMISSIONS.membershipUpdate,
  ])
})

test('管理权限可以显示对应面板，但读取权限仍保持独立', () => {
  const principal = { permission_codes: [IAM_PERMISSIONS.positionCreate] }
  assert.equal(checkAnyPermission(principal, iamPanelPermissions('positions')), true)
  assert.equal(checkAnyPermission(principal, [iamPanelReadPermission('positions')]), false)
})

test('未知面板返回空权限并保持失败关闭', () => {
  assert.deepEqual(iamPanelPermissions('unknown'), [])
  assert.equal(iamPanelReadPermission('unknown'), '')
  assert.equal(checkAnyPermission({ permission_codes: ['*'] }, iamPanelPermissions('unknown')), false)
})
