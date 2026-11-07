// 「合同批量导入」面板的分区可见性约定（定向修复）。
//
// 锁定三件事：
// 1. ContractImportPanel 只挂在 imports（合同批量导入）分区；contracts（合同台账）等其他分区不再渲染它。
// 2. 权限判断保留：有导入权限但缺当前分区时仍不渲染。
// 3. 深链兼容：URL 带 ?import_batch=<批次号> 且当前不在 imports 时，初始化/参数变化会把分区切到 imports，
//    避免旧链接落点没有面板（参数在、面板不在 = 用户看到白屏）。
//
// 前两组用真实模板片段 + 真实 Vue 渲染执行，第三组从视图脚本抽出真实函数用替身执行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse as parseJS } from '@babel/parser'

const source = readFileSync(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const sfc = parse(source, { filename: 'ContractManagementView.vue' })
const template = sfc.descriptor.template.content
const script = sfc.descriptor.scriptSetup.content

// importPanelSectionRender 编译视图里真实的 <ContractImportPanel …/> 片段，用真实 Vue 渲染，
// 只把面板组件换成可识别的桩，从而直接观察“哪个分区会渲染导入面板”。
// 参数：activeSection 目标分区，granted 为当前会话持有的权限码集合。
// 返回值：异步渲染出的 HTML 字符串。
async function importPanelSectionRender(activeSection, granted, query = {}) {
  const start = template.indexOf('<ContractImportPanel')
  assert.notEqual(start, -1, '视图模板中缺少 ContractImportPanel')
  const end = template.indexOf('/>', start) + 2
  const snippet = template.slice(start, end)
  const { code, errors } = compileTemplate({ source: snippet, filename: 'ContractManagementView.vue', id: 'import-panel-section-test' })
  assert.deepEqual(errors, [])
  const render = new Function('Vue', code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  const context = {
    activeSection,
    can: (permission) => granted.includes(permission),
    contractSourceCapabilities: { batch_enabled: true, pdf_enabled: true, supported_modes: ['NORMAL'] },
    session: { identity_id: 'actor-1' },
    route: { query },
    isAdmin: true,
  }
  const app = Vue.createSSRApp({ render: () => render(context) })
  app.component('ContractImportPanel', {
    props: ['enabled', 'defaultOpen', 'initialBatchId'],
    setup: () => () => Vue.h('div', { 'data-testid': 'contract-import-panel-stub' }),
  })
  return renderToString(app)
}

const ALL_IMPORT_PERMISSIONS = [
  'contract.import.preview',
  'contract.import.commit',
  'contract.import.approve',
  'contract.import.release',
]

test('导入面板只在「合同批量导入」分区渲染，合同台账等其他分区不再出现', async () => {
  for (const section of ['contracts', 'dashboard', 'templates', 'approvals', 'rules', 'signing', 'reports', 'outbox', 'intakes']) {
    const html = await importPanelSectionRender(section, ALL_IMPORT_PERMISSIONS)
    assert.doesNotMatch(html, /contract-import-panel-stub/, `分区 ${section} 不应渲染合同导入面板`)
  }
  const importsHTML = await importPanelSectionRender('imports', ALL_IMPORT_PERMISSIONS)
  assert.match(importsHTML, /contract-import-panel-stub/, '「合同批量导入」分区必须渲染导入面板')
})

test('导入面板的权限判断保留：无导入权限时不渲染，即使位于 imports 分区', async () => {
  for (const granted of [[], ['contract.read'], ['contract.create']]) {
    const html = await importPanelSectionRender('imports', granted)
    assert.doesNotMatch(html, /contract-import-panel-stub/, `权限 ${JSON.stringify(granted)} 不应看到导入面板`)
  }
})

test('视图模板只有一处导入面板挂载点，且挂载条件只认 imports 分区', () => {
  assert.equal((template.match(/<ContractImportPanel[\s>]/g) ?? []).length, 1, '合同管理视图只允许一处导入面板挂载')
  assert.doesNotMatch(template, /\['contracts',\s*'imports'\]\.includes\(activeSection\)/, '不允许再把台账与导入分区共用面板')
  assert.match(template, /v-if="activeSection === 'imports' && \(/, '挂载条件必须以 imports 分区为前缀')
  assert.match(template, /:default-open="activeSection === 'imports'"/, '面板只在 imports 挂载，default-open 无需再看路由参数')
})

// importBatchSectionSwitch 从视图脚本抽出真实的 ensureImportBatchSection，用替身执行，
// 直接观察它是否把分区切到 imports。
function importBatchSectionSwitch({ batchID, activeSection, allowed = true, replaceCalls = [] }) {
  const declaration = parseJS(script, { sourceType: 'module' }).program.body
    .find((node) => node.type === 'FunctionDeclaration' && node.id.name === 'ensureImportBatchSection')
  assert.ok(declaration, '缺少 ensureImportBatchSection')
  const body = script.slice(declaration.start, declaration.end)
  return new Function(
    'route', 'activeSection', 'session', 'canAccessContractSection', 'router',
    `${body}\nreturn ensureImportBatchSection()`,
  )(
    { query: batchID ? { import_batch: batchID } : {} },
    { value: activeSection },
    { value: { roles: ['admin'], permissions: [] } },
    () => allowed,
    { replace: async (location) => { replaceCalls.push(location) } },
  )
}

test('带 ?import_batch= 深链时自动切到 imports 分区并保留批次参数', () => {
  const replaceCalls = []
  assert.equal(importBatchSectionSwitch({ batchID: 'batch-9', activeSection: 'contracts', replaceCalls }), true)
  assert.equal(replaceCalls.length, 1)
  assert.deepEqual(replaceCalls[0].name, 'contract_management')
  assert.equal(replaceCalls[0].params.section, 'imports')
  assert.equal(replaceCalls[0].query.import_batch, 'batch-9')
})

test('深链切换只在需要时发生：无参数、已在 imports、无权进入 imports 都不跳转', () => {
  const noQuery = []
  assert.equal(importBatchSectionSwitch({ batchID: '', activeSection: 'contracts', replaceCalls: noQuery }), false)
  assert.equal(noQuery.length, 0)

  const alreadyImports = []
  assert.equal(importBatchSectionSwitch({ batchID: 'batch-9', activeSection: 'imports', replaceCalls: alreadyImports }), false)
  assert.equal(alreadyImports.length, 0)

  // 无权进入 imports 时不跳转，避免与路由守卫的“无权分区回退”互相触发成循环。
  const denied = []
  assert.equal(importBatchSectionSwitch({ batchID: 'batch-9', activeSection: 'contracts', allowed: false, replaceCalls: denied }), false)
  assert.equal(denied.length, 0)
})

test('深链切换接入初始化与路由参数变化，而非只在某个分区快照里', () => {
  const mounted = script.match(/onMounted\(async \(\) => \{[\s\S]*?\n\}\)/)
  assert.ok(mounted, '缺少 onMounted')
  assert.match(mounted[0], /session\.value = await getContractSession\(\)[\s\S]*ensureImportBatchSection\(\)/, '会话就绪后要校正分区')
  assert.match(script, /watch\(\(\) => route\.query\.import_batch, \(\) => \{ ensureImportBatchSection\(\) \}\)/, 'URL 参数变化时要校正分区')
})
