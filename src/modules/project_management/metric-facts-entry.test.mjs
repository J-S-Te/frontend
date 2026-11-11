import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { baseParse, compile } from '@vue/compiler-dom'
import { createSSRApp, h } from 'vue'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'

// containsResourceEntry 检查实际模板子树是否包含资源业务入口。
// 参数：node 为Vue编译器实际解析节点。
// 返回值：包含入口时为true。
function containsResourceEntry(node) {
  return node.tag === 'ResourceMetricFactsPanel' || (node.children || []).some(containsResourceEntry)
}

// conditionAttributes 保留实际模板的条件链，不复制页面业务内容和数据依赖。
// 参数：node 为实际模板节点。
// 返回值：Vue原有if/else-if/else指令文本。
function conditionAttributes(node) {
  return (node.props || []).filter((prop) => prop.type === 7 && ['if', 'else-if', 'else'].includes(prop.name)).map((prop) => prop.loc.source).join(' ')
}

// projectEntryTree 将实际页面条件链交给真实Vue渲染器，非目标业务仅保留条件分支。
// 参数：nodes 为页面编译AST的同级节点。
// 返回值：保留入口所有条件祖先及互斥兄弟分支的最小模板。
function projectEntryTree(nodes) {
  return nodes.filter((node) => node.type === 1).map((node) => {
    const condition = conditionAttributes(node)
    if (node.tag === 'ResourceMetricFactsPanel') return `<ResourceMetricFactsPanel ${condition} />`
    if (containsResourceEntry(node)) return `<template ${condition}>${projectEntryTree(node.children || [])}</template>`
    return condition ? `<template ${condition}><span /></template>` : ''
  }).join('\n')
}

test('实际页面互斥条件链在实施、设备、资质、计划四个栏目都可渲染资源入口', async () => {
  const source = readFileSync(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
  const template = parse(source).descriptor.template.content
  const projected = projectEntryTree(baseParse(template).children)
  const render = new Function('Vue', compile(projected, { mode: 'function', prefixIdentifiers: true }).code)(Vue)
  for (const section of ['implementation', 'equipment', 'qualifications', 'planning']) {
    const app = createSSRApp({ render, data: () => ({ activeSection: section, loading: false, sectionExtrasLoading: false, loadError: '', workspaceReady: true, sectionExtrasError: '', session: { permissions: ['project.read'] }, isVisibleConfigSection: false }), components: { ResourceMetricFactsPanel: () => h('section', { 'data-entry': 'resource-facts' }) } })
    app.config.warnHandler = () => {}
    const html = await renderToString(app)
    assert.match(html, /data-entry="resource-facts"/, `资源入口在${section}被实际条件链吞掉`)
  }
})

test('独立资源面板可以选择授权进行中及已完成服务项，不依赖计划页残留选择', async () => {
  const { mountSFC } = await import('../../test/helpers/mountSFC.mjs')
  const { resolve } = await import('node:path')
  const commands = []
  const api = resolve('src/modules/project_management/api/projectManagement.js')
  const mounted = await mountSFC(resolve('src/modules/project_management/components/ResourceMetricFactsPanel.vue'), { [api]: {
    getMetricResources: async () => [], listPersonnel: async () => ({ items: [], total: 0 }),
    postMetricResource: async (...args) => { commands.push(args); return {} }, postMetricUsageAction: async () => ({}),
  } }, { items: [{ id: 'SI-running', status: '实施中' }, { id: 'SI-done', status: '已完成' }], session: { user_id: 'engineer', permissions: ['project.resource_usage.record', 'project.field.execute'] }, resources: [{ resource_type: 'PERSON', resource_id: 'person' }] })
  try {
    if (mounted.state.selectedMetricItemID) mounted.state.selectedMetricItemID.value = 'SI-done'
    Object.assign(mounted.state.form, { resource_id: 'person', business_date: '2026-11-01', start: '09:00', end: '10:00', note: '历史实际登记', evidence: '当日原始记录' })
    await mounted.state.save('usages')
    assert.equal(commands.length, 1, '已完成服务项无法在独立入口登记')
    assert.equal(commands[0][1].service_item_id, 'SI-done')
  } finally { mounted.unmount() }
})
