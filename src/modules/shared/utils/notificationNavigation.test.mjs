import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouter, createMemoryHistory } from 'vue-router'

import {
  safeNotificationTarget as safeTarget,
  openNotificationTarget as openTarget,
  notificationTarget,
} from './notificationNavigation.js'

test('通知目标保留站内审批坐标、查询参数和锚点', () => {
  assert.equal(safeTarget('/contract_management/approvals?approval_id=a%2Fb#task'),
    '/contract_management/approvals?approval_id=a%2Fb#task')
  assert.equal(safeTarget('https://app.example/reimbursement/approvals?claim_id=c',
    'https://app.example'), '/reimbursement/approvals?claim_id=c')
})

test('通知缺少目标时不构造当前页或 undefined 路径', () => {
  for (const value of [undefined, null, '', 'undefined', 'approvals?id=1', '?id=1', '#task']) {
    assert.equal(safeTarget(value, 'https://app.example'), '', String(value))
  }
})

test('通知拒绝外站、脚本、协议相对路径和被编码的路径控制字符', () => {
  for (const value of ['https://evil.example/approvals', '//evil.example/x',
    'javascript:alert(1)', '/\\evil.example', '/%5cevil.example', '/%2fevil.example',
    '/approvals\n', ' /approvals', '/approvals%0d%0a']) {
    assert.equal(safeTarget(value, 'https://app.example'), '', value)
  }
})

test('点击有目标的通知进入业务页面，无目标时保留正文', async () => {
  const visits = []
  const router = { push: async (path) => { visits.push(path) } }
  assert.equal(await openTarget({ target_url: '/reimbursement/approvals?claim_id=c' }, router), true)
  assert.deepEqual(visits, ['/reimbursement/approvals?claim_id=c'])
  assert.equal(await openTarget({ title: '普通公告' }, router), false)
  assert.equal(await openTarget({ target_url: '//evil.example' }, router), false)
  assert.equal(visits.length, 1)
})

test('审批导航被守卫取消时报告失败，重复打开当前记录视为已经到达', async () => {
  await assert.rejects(async () => openTarget({ target_url: '/approvals' }, {
    push: async () => ({ type: 4 }),
  }), /无法进入/)
  assert.equal(await openTarget({ target_url: '/approvals' }, {
    push: async () => ({ type: 16 }),
  }), true)
})

test('合同历史提醒将旧的未注册详情路径转成带合同坐标的审批入口', () => {
  assert.equal(notificationTarget({ source_application: 'contract_management',
    category: 'PENDING_APPROVAL', target_url: '/contract_management/contracts/contract-1',
    reference_type: 'CONTRACT', reference_id: 'contract-1' }),
  '/contract_management/approvals?contract_id=contract-1')
  assert.equal(notificationTarget({ source_application: 'contract_management',
    category: 'APPROVAL_ASSIGNED', target_url: '/contract_management/approvals/approval-1',
    reference_type: 'APPROVAL', reference_id: 'approval-1' }),
  '/contract_management/approvals?approval_id=approval-1')
})

test('报销审批与信用待审旧通知从普通详情入口转入审批工作区', () => {
  assert.equal(notificationTarget({ source_application: 'reimbursement',
    category: 'REIMBURSEMENT_APPROVAL_REMINDER',
    target_url: '/reimbursement/claims?claim_id=claim-1',
    reference_type: 'REIMBURSEMENT_CLAIM', reference_id: 'claim-1' }),
  '/reimbursement/approvals?claim_id=claim-1')
  assert.equal(notificationTarget({ source_application: 'customer_and_opportunity',
    category: 'CREDIT_APPLICATION_PENDING',
    target_url: '/customer-opportunity/customers?customer_id=customer-1&tab=credit',
    reference_type: 'CUSTOMER', reference_id: 'customer-1' }),
  '/customer-opportunity/credit-approvals?customer_id=customer-1')
})

test('项目、人事和数析仅用真实业务引用补齐缺少的站内目标', () => {
  for (const [notification, expected] of [
    [{ source_application: 'project_management', category: 'DEVIATION_REPORTED',
      reference_type: 'SERVICE_ITEM', reference_id: 'item/1' },
    '/project_management/exceptions?service_item_id=item%2F1'],
    [{ source_application: 'project_management', category: 'TEAM_ASSIGNED',
      reference_type: 'SERVICE_ITEM', reference_id: 'item-1' },
    '/project_management/inbox?service_item_id=item-1'],
    [{ source_application: 'project_management', reference_type: 'PROJECT', reference_id: 'project-1' },
    '/project_management/project_detail?project=project-1'],
    [{ source_application: 'platform', category: 'PERSONNEL_CHANGE',
      reference_type: 'PERSONNEL_CHANGE', reference_id: 'request-1' },
    '/settings/personnel?request_id=request-1'],
    [{ source_application: 'data_analysis', category: 'DATA_ANALYSIS_ALERT',
      reference_type: 'ALERT', reference_id: 'alert-1' },
    '/data_analysis/alerts?alert_id=alert-1'],
  ]) assert.equal(notificationTarget(notification), expected)
})

test('未知类别或外站目标不根据文案猜审批入口，新的精确目标保持原样', () => {
  assert.equal(notificationTarget({ source_application: 'unknown',
    category: 'APPROVAL', reference_type: 'TASK', reference_id: '1' }), '')
  assert.equal(notificationTarget({ source_application: 'reimbursement',
    category: 'REIMBURSEMENT_APPROVAL_ASSIGNED',
    reference_type: 'REIMBURSEMENT_CLAIM', reference_id: '1',
    target_url: 'https://evil.example/claims' }), '')
  assert.equal(notificationTarget({ source_application: 'reimbursement',
    category: 'REIMBURSEMENT_APPROVAL_ASSIGNED',
    target_url: '/reimbursement/approvals?task_id=task-1&claim_id=claim-1' }),
  '/reimbursement/approvals?task_id=task-1&claim_id=claim-1')
})

test('失效通知目标不经兜底路由重定向到门户并冒充已进入业务', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/portal', component: {} },
    { path: '/:pathMatch(.*)*', redirect: '/portal' },
  ] })
  await assert.rejects(() => openTarget({ target_url: '/obsolete/notification' }, router), /未开放|失效/)
  assert.notEqual(router.currentRoute.value.path, '/portal')
})

test('结算历史催收提醒带入真实应收或计划编号，已有精确业务目标保持不变', () => {
  assert.equal(notificationTarget({ source_application: 'settlement',
    category: 'SETTLEMENT_RECEIVABLE_OVERDUE', target_url: '/settlement/dunning',
    reference_type: 'RECEIVABLE', reference_id: 'receivable-1' }),
  '/settlement/dunning?receivable_id=receivable-1')
  assert.equal(notificationTarget({ source_application: 'settlement',
    category: 'SETTLEMENT_OWNER_REMINDER', target_url: '/settlement',
    reference_type: 'RECEIVABLE_PLAN', reference_id: 'plan-1' }),
  '/settlement/receivables?plan_id=plan-1')
  assert.equal(notificationTarget({ source_application: 'settlement',
    target_url: '/settlement/invoices?request_id=request-1',
    reference_type: 'RECEIVABLE', reference_id: 'receivable-1' }),
  '/settlement/invoices?request_id=request-1')
})
