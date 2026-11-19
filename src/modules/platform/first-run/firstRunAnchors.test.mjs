import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  FIRST_RUN_GUIDES,
  FIRST_RUN_PORTAL_GUIDE,
  FIRST_RUN_SUBSYSTEM_ANCHORS,
} from './utils/firstRunState.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

// guide -> 锚点来源。私有壳层检查三处；AppShell 壳层检查共享外壳 + 返回门户声明。
const PRIVATE_SHELLS = {
  contract: '../../contract_management/views/ContractManagementView.vue',
}
const APP_SHELL_VIEWS = {
  platform: '../views/PlatformConsoleView.vue',
  reimbursement: '../../reimbursement/views/ReimbursementView.vue',
  settlement: '../../settlement/views/SettlementView.vue',
  customer_opportunity: '../../customer_opportunity/views/CustomerOpportunityView.vue',
  customer_portal: '../../customer_portal/views/CustomerPortalView.vue',
  project: '../../project_management/views/ProjectManagementView.vue',
  data_analysis: '../../data_analysis/views/DashboardShellView.vue',
}

test('注册 guide 的每一步锚点都在对应模板中存在', async () => {
  const portal = await read('../views/SubsystemPortalView.vue')
  for (const step of FIRST_RUN_GUIDES[FIRST_RUN_PORTAL_GUIDE].steps) {
    assert.match(portal, new RegExp(`data-first-run-anchor="${step.anchor}"`), `门户缺少锚点 ${step.anchor}`)
  }

  const appShell = await read('../../shared/components/AppShell.vue')
  assert.match(appShell, /data-first-run-anchor="subsystem-nav"/)
  assert.match(appShell, /data-first-run-anchor="subsystem-title"/)

  for (const [key, path] of Object.entries(PRIVATE_SHELLS)) {
    const source = await read(path)
    for (const step of FIRST_RUN_GUIDES[key].steps) {
      assert.match(source, new RegExp(`data-first-run-anchor="${step.anchor}"`), `${key} 缺少锚点 ${step.anchor}`)
    }
  }

  for (const [key, path] of Object.entries(APP_SHELL_VIEWS)) {
    const source = await read(path)
    assert.match(source, /anchor: ["']subsystem-portal["']/, `${key} 缺少返回门户锚点声明`)
  }

  // 每个 guide 的 3 个步骤必须与共享锚点常量一致，防止模板/状态层漂移。
  for (const key of Object.keys(FIRST_RUN_GUIDES).filter((item) => item !== FIRST_RUN_PORTAL_GUIDE)) {
    assert.deepEqual(
      FIRST_RUN_GUIDES[key].steps.map((step) => step.anchor),
      [FIRST_RUN_SUBSYSTEM_ANCHORS.nav, FIRST_RUN_SUBSYSTEM_ANCHORS.title, FIRST_RUN_SUBSYSTEM_ANCHORS.portal],
      key,
    )
  }
})

test('报销 guide 已登记且路由指向 reimbursement', () => {
  assert.equal(FIRST_RUN_GUIDES.reimbursement?.routeNames?.includes('reimbursement'), true)
  assert.equal(FIRST_RUN_GUIDES.reimbursement.steps.length, 3)
})
