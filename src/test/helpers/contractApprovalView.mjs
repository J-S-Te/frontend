import { readFileSync } from 'node:fs'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse } from '@babel/parser'

// 用途：在真实Vue模板AST中定位指定元素，避免复制审批按钮模板。
// 参数：node为当前节点，predicate为目标元素判定。
// 返回值：首个匹配节点；不存在时返回undefined。
function findElement(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const found = findElement(child, predicate)
    if (found) return found
  }
}

// 用途：读取实际审批刷新、动作条件与弹窗按钮，供单测和隔离浏览器共同使用。
// 参数：无；入口为当前工作树合同视图。
// 返回值：真实函数/计算属性源码及节点和按钮模板，缺失时立即报错。
export function contractApprovalViewParts() {
  const path = new URL('../../modules/contract_management/views/ContractManagementView.vue', import.meta.url)
  const { descriptor } = parseSFC(readFileSync(path, 'utf8'))
  const source = descriptor.scriptSetup.content
  const program = parse(source, { sourceType: 'module' }).program
  const names = ['normalizeApproval', 'setInitiatedApprovals', 'refreshApprovalRealtime',
    'processApproval', 'displayNameFor']
  const functions = names.map(name => {
    const node = program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
    if (!node) throw new Error('缺少真实审批函数：' + name)
    return source.slice(node.start, node.end)
  }).join('\n')
  const bindings = ['can', 'formatDate', 'canActOnApproval'].map(name => {
    const node = program.body.find(node => node.type === 'VariableDeclaration'
      && node.declarations.some(item => item.id.name === name))
    if (!node) throw new Error('缺少真实审批绑定：' + name)
    return source.slice(node.start, node.end)
  }).join('\n')
  // 用途：按固定样式类识别真实弹窗中的元素。
  // 参数：name为样式类名，node为被检查的模板节点。
  // 返回值：节点是否具有该样式类。
  const hasClass = name => node => node.tag && node.props?.some(prop =>
    prop.name === 'class' && prop.value?.content.split(' ').includes(name))
  const modal = findElement(descriptor.template.ast, hasClass('contract-approval-modal'))
  const footer = modal?.children.find(node => node.tag === 'footer')
  const highlight = findElement(modal || {}, hasClass('contract-detail-highlight'))
  const nodeSummary = highlight?.children.filter(node => node.tag === 'div')[2]
  if (!footer || !nodeSummary) throw new Error('缺少真实审批弹窗模板')
  return { functions, bindings, footer: footer.loc.source, node: nodeSummary.loc.source }
}
