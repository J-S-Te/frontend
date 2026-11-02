import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const viewSource = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const routerSource = await readFile(new URL('../../router/index.js', import.meta.url), 'utf8')

test('集成死信作为独立运维分区接入合同后台导航', () => {
  assert.match(viewSource, /outbox: \{ title: '集成死信', description: '[^']+' \}/)
  assert.match(viewSource, /label: '运维\/集成', items: \[\{ key: 'outbox', label: '集成死信', icon: 'reset' \}\]/)
  // 管理员与普通角色导航都声明该入口，实际可见性由 canAccessContractSection 过滤。
  assert.equal((viewSource.match(/key: 'outbox', label: '集成死信'/g) || []).length, 2)
})

test('集成死信面板只在对应分区挂载，并由 approval.manage 决定运维视图', () => {
  assert.match(viewSource, /import ContractIntegrationOutboxPanel from '@\/modules\/contract_management\/components\/ContractIntegrationOutboxPanel\.vue'/)
  assert.match(viewSource, /activeSection === 'outbox'[\s\S]*<ContractIntegrationOutboxPanel :can-manage="can\('approval\.manage'\)" @notify="showToast" \/>/)
})

test('合同路由分区白名单包含集成死信分区', () => {
  assert.match(routerSource, /const contractSections = \[[^\]]*'outbox'\]/)
})

test('面板源码不拼接自由 kind，不伪造成功，权限错误不回显原始错误', async () => {
  const panel = await readFile(new URL('./components/ContractIntegrationOutboxPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /import \{\s*listFailedIntegrationOutboxEvents,\s*retryFailedIntegrationOutboxEvent,\s*\} from '\.\.\/api\/contract'/)
  assert.match(panel, /if \(described\.status === 401 \|\| described\.status === 403\) \{\s*permissionStatus\.value = described\.status/)
  // 权限态只展示说明，不渲染 describeFailure 的 message。
  const permissionBlock = panel.slice(panel.indexOf('contract-outbox-permission'), panel.indexOf('contract-outbox-action-error'))
  assert.doesNotMatch(permissionBlock, /\{\{ error \}\}/)
  assert.match(panel, /await retryFailedIntegrationOutboxEvent\(item\.kind \|\| kind\.value, item\.id\)/)
  assert.match(panel, /await load\(\)/)
})
