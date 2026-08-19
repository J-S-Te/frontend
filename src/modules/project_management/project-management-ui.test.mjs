import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import projectManagementModule from './module.js'

const source = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('./styles/project-management.css', import.meta.url), 'utf8')

test('项目管理模块暴露统一前端路由', () => {
  assert.deepEqual(projectManagementModule.route, {
    name: 'project_management',
    params: { section: 'dashboard' },
  })
})

test('项目管理页面覆盖原型的五个业务域与核心交互', () => {
  for (const label of ['执行总览', '项目管理', '资源分配', '现场实施', '系统配置']) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /function confirmDecomposition\(\)/)
  assert.match(source, /function exportProjects\(\)/)
  assert.match(source, /class="pm-kanban"/)
  assert.match(source, /class="pm-drawer"/)
  assert.match(source, /onMounted\(loadWorkspace\)/)
  assert.match(source, /await confirmServiceItemsRequest\(ids\)/)
  assert.match(source, /await setRuleEnabled\(rule\.id, next\)/)
  assert.match(source, /listDeliveryEvents\(\)/)
  assert.match(source, /listCapabilities\(\)/)
  assert.match(source, /DEVIATION_REPORTED/)
})

test('项目管理页面不再渲染原型模拟业务数据', () => {
  for (const mockValue of ['87.4', '92.1', '96.8', 'PJ-2026-0817', '某证券交易所', '王晓飞', 'GB/T 28448-2019']) {
    assert.doesNotMatch(source, new RegExp(mockValue.replaceAll('.', '\\.')))
  }
  assert.match(source, /getDashboard\(\)/)
  assert.match(source, /getProjectSession\(\)/)
  assert.match(source, /standards: \[\]/)
  assert.match(source, /projectEvents\(drawerProject\)/)
})

test('项目系统退出会撤销会话而不是返回统一门户', () => {
  assert.match(source, /logoutCurrentSession\(\)/)
  assert.match(source, /router\.replace\(\{ name: 'login', query: \{ reason: 'session-ended' \} \}\)/)
  assert.equal((source.match(/@click="logoutSystem"/g) || []).length, 2)
  assert.match(source, /退出系统/)
})

test('项目管理页面对齐合同系统 UniLab UI 设计规范', () => {
  for (const token of [
    '--pm-ink: #0f172a',
    '--pm-body: #475569',
    '--pm-muted: #64748b',
    '--pm-blue: #2563eb',
    '--pm-green-text: #15803d',
    '--pm-amber-text: #b45309',
    '--pm-red-text: #b91c1c',
  ]) {
    assert.match(styles, new RegExp(token))
  }
  assert.match(styles, /\.pm-sidebar \{[\s\S]*?width: 248px;[\s\S]*?background: #0f172a;/)
  assert.match(styles, /\.pm-button \{[\s\S]*?min-height: 38px;[\s\S]*?font-size: 13\.5px;/)
  assert.match(styles, /\.pm-table \{ font-size: 13\.5px; \}/)
  assert.match(styles, /\.pm-table th \{[\s\S]*?font-size: 12\.5px;/)
  assert.match(styles, /:focus-visible \{[\s\S]*?outline: 2px solid var\(--pm-blue\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})
