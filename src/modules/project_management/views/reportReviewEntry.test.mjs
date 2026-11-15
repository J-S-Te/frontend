import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { baseParse, compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'

const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')

// 用途：定位真实审核面板及其模板祖先，不复制页面的业务条件。
// 参数：node 为实际页面模板节点。
// 返回值：节点包含审核入口时为 true。
function containsReviewEntry(node) {
  return node.tag === 'ReportReviewFactsPanel' ||
    (node.children || []).some(containsReviewEntry)
}

// 用途：保留目标入口实际条件链及其前置互斥分支。
// 参数：nodes 为同级模板节点。
// 返回值：可交给真实 Vue 渲染器的最小入口模板。
function reviewEntryTemplate(nodes) {
  const elements = nodes.filter(node => node.type === 1)
  const target = elements.findIndex(containsReviewEntry)
  if (target < 0) return ''
  let first = target
  while (first > 0 && elements[first].props.some(prop =>
    prop.type === 7 && ['else-if', 'else'].includes(prop.name))) first--
  return elements.slice(first, target + 1).map(node => {
    const condition = node.props.filter(prop => prop.type === 7 &&
      ['if', 'else-if', 'else'].includes(prop.name)).map(prop => prop.loc.source).join(' ')
    if (node.tag === 'ReportReviewFactsPanel') return node.loc.source
    const children = containsReviewEntry(node) ? reviewEntryTemplate(node.children || []) : ''
    // 无条件祖先直接展开，普通template元素会让浏览器把业务入口放进惰性内容。
    return condition ? `<template ${condition}>${children}</template>` : children
  }).join('\n')
}

test('主报告页实际条件链挂载真实审核面板，其他栏目和未选项不挂载', async () => {
  const ast = baseParse(parse(source).descriptor.template.content)
  assert.ok(containsReviewEntry(ast), '主前端尚未集成真实审核轮次面板')
  const render = new Function('Vue', compile(reviewEntryTemplate(ast.children),
    { mode: 'function', prefixIdentifiers: true }).code)(Vue)
  for (const [section, selected, visible, permissions = ['project.read']] of [
    ['reports', true, true], ['reports', false, false], ['planning', true, false],
    ['reports', true, false, []],
  ]) {
    const values = { activeSection: section, selectedServiceItem: selected ? {id:'SI-1'} : null,
      loading: false, sectionExtrasLoading: false, loadError: '', workspaceReady: true,
      sectionExtrasError: '', isVisibleConfigSection: false, session: {permissions},
      refreshAfterWrite: () => {} }
    const app = Vue.createSSRApp({ render, setup: () => values,
      components: { ReportReviewFactsPanel: { props:['item','session'],
        render: () => Vue.h('section', {'data-review-entry':'real-rounds'}) } } })
    const html = await renderToString(app)
    assert.doesNotMatch(html, /<template(?:\s|>)/, '入口不能落入浏览器不显示的原生template容器')
    assert.equal(html.includes('data-review-entry="real-rounds"'), visible)
  }
})
