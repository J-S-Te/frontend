import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as catalog from '../utils/applicationAuthorizationCatalog.js'
import * as authorization from '../utils/personalExceptionAuthorization.js'

const source = readFileSync(new URL('./PersonalExceptionEditor.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source)
const script = compileScript(descriptor, { id: 'personal-exception-editor' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'PersonalExceptionEditor.vue',
  id: 'personal-exception-editor',
  compilerOptions: { bindingMetadata: script.bindings },
})

test('personal exception editor compiles and exposes single-role fields', () => {
  assert.deepEqual(errors, [])
  assert.deepEqual(template.errors, [])
  assert.match(descriptor.template.content, /type="datetime-local"/)
  assert.match(descriptor.template.content, /影响确认/)
  assert.match(descriptor.template.content, /原值/)
  assert.match(descriptor.template.content, /新值/)
  assert.match(descriptor.template.content, /其他角色/)
  assert.match(descriptor.template.content, /aria-describedby/)
  assert.match(descriptor.template.content, /aria-live="polite"/)
  assert.match(descriptor.scriptSetup.content, /确认新增|保存修改|确认统一调整/)
})

test('editor preserves untouched raw times and never changes role on edit', () => {
  assert.match(descriptor.scriptSetup.content, /validFromTouched/)
  assert.match(descriptor.scriptSetup.content, /validUntilTouched/)
  assert.match(descriptor.scriptSetup.content, /resolvePersonalExceptionDraft/)
  assert.match(descriptor.scriptSetup.content, /isCreate\.value/)
  assert.doesNotMatch(descriptor.scriptSetup.content, /updateApplicationAccess|fetch\(/)
  assert.match(descriptor.template.content, /@keydown\.esc\.stop\.prevent/)
})

// renderExceptionEditor 用真实Vue组件与生产格式化函数呈现授权确认摘要。
// 参数：draft 为待确认授权草稿，props 为角色目录、继承来源及当前时间等覆盖项。
// 返回值：服务端渲染HTML；组件编译或渲染错误直接失败。
async function renderExceptionEditor(draft, props = {}) {
  const modules = {
    vue: Vue,
    '@/modules/platform/iam/utils/applicationAuthorizationCatalog': catalog,
    '@/modules/platform/iam/utils/personalExceptionAuthorization': authorization,
  }
  const imports = {}
  for (const node of script.scriptSetupAst.filter((item) => item.type === 'ImportDeclaration')) {
    for (const spec of node.specifiers) {
      imports[spec.local.name] = modules[node.source.value][spec.imported.name]
    }
  }
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', template.code
    .replace(/import \{([^}]+)\} from "vue"/g,
      (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return renderToString(Vue.createSSRApp(component, {
    draft,
    authorizationState: 'GRANTED',
    environments: [{ code: 'prod', name: 'prod' }],
    catalog: { sync_status: 'SYNCED', roles: [{ code: 'admin', status: 'ACTIVE' }] },
    ...props,
  }))
}

test('新增个人例外隐藏已生效的模板角色，保留其他继承来源和未授权角色', async () => {
  const roles = ['template', 'organization', 'system', 'legacy', 'available', 'manual']
    .map((code) => ({ code, name: code, status: 'ACTIVE', assignable: true }))
  const html = await renderExceptionEditor(authorization.createPersonalExceptionDraft(), {
    now: new Date('2026-11-18T00:00:00Z'),
    catalog: { sync_status: 'SYNCED', roles },
    existingManualRoles: [{ code: 'manual' }],
    inheritedRoles: [
      { code: 'template', source_type: 'POSITION', grant_origin: 'TEMPLATE' },
      { code: 'organization', source_type: 'ORG_UNIT', grant_origin: 'MANUAL' },
      { code: 'system', source_type: 'USER', grant_origin: 'SYSTEM' },
      { code: 'legacy', source_type: 'POSITION' },
    ],
  })

  assert.doesNotMatch(html, /<option[^>]*value="template"/)
  assert.doesNotMatch(html, /<option[^>]*value="manual"/)
  for (const code of ['organization', 'system', 'legacy', 'available']) {
    assert.match(html, new RegExp(`<option[^>]*value="${code}"`))
  }
})

test('只有当前生效的模板角色隐藏，未来和到期边界的角色仍可新增', async () => {
  const now = new Date('2026-11-18T00:00:00Z')
  const roles = ['active', 'pending', 'expired'].map((code) => ({ code, status: 'ACTIVE' }))
  const html = await renderExceptionEditor(authorization.createPersonalExceptionDraft(), {
    now,
    catalog: { sync_status: 'SYNCED', roles },
    inheritedRoles: [
      { code: 'active', grant_origin: 'TEMPLATE', valid_from: now.toISOString() },
      { code: 'pending', grant_origin: 'TEMPLATE', valid_from: '2026-11-19T00:00:00Z' },
      { code: 'expired', grant_origin: 'TEMPLATE', valid_until: now.toISOString() },
    ],
  })

  assert.doesNotMatch(html, /<option[^>]*value="active"/)
  assert.match(html, /<option[^>]*value="pending"/)
  assert.match(html, /<option[^>]*value="expired"/)
})

test('模板命中同一角色时已有个人例外仍可编辑并保留原始角色', async () => {
  const draft = authorization.createPersonalExceptionDraft({
    mode: 'edit', group: { roleCode: 'admin', records: [{ code: 'admin' }] },
  })
  const html = await renderExceptionEditor(draft, {
    mode: 'edit', inheritedRoles: [{ code: 'admin', grant_origin: 'TEMPLATE' }],
  })

  assert.match(html, /修改例外授权/)
  assert.match(html, /<code>admin<\/code>/)
  assert.doesNotMatch(html, /请选择角色/)
})

for (const state of ['CONFLICT', 'UNAUTHORIZED', '']) {
  test(`应用状态为 ${state || '未知'} 时模板诊断角色不从新增选项中隐藏`, async () => {
    const html = await renderExceptionEditor(authorization.createPersonalExceptionDraft(), {
      authorizationState: state,
      inheritedRoles: [{ code: 'admin', source_type: 'POSITION', grant_origin: 'TEMPLATE' }],
    })

    assert.match(html, /<option[^>]*value="admin"/)
  })
}

test('确认摘要显示真实环境与限时终点，不能把有限授权显示为长期', async () => {
  const html = await renderExceptionEditor({
    ...authorization.createPersonalExceptionDraft(),
    roleCode: 'admin',
    scopeType: 'ENVIRONMENT',
    environmentCode: 'prod',
    validUntilInput: '2026-10-30T19:30',
    validUntilTouched: true,
  })
  assert.match(html, /<dt>新值<\/dt><dd>指定环境：prod；立即生效，至 /)
  assert.doesNotMatch(html, /<dt>新值<\/dt><dd>[^<]*长期有效/)
})

test('确认摘要保留已有的未来开始时间和明确的长期结束选择', async () => {
  const html = await renderExceptionEditor({
    ...authorization.createPersonalExceptionDraft(),
    roleCode: 'admin',
    scopeType: 'APPLICATION',
    validityMode: 'PERMANENT',
    startMode: 'SPECIFIC',
    validFrom: '2026-11-01T00:00:00Z',
    validFromInput: authorization.toDateTimeLocal('2026-11-01T00:00:00Z'),
  })
  assert.match(html, /<dt>新值<\/dt><dd>整个应用；[^<]+ 起，长期有效<\/dd>/)
})
