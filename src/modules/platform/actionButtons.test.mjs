import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { parse as parseSFC } from '@vue/compiler-sfc'

// loadAction 装载真实组件中的业务处理函数，替换外部边界。
// 参数：file 为组件相对路径，name 为函数名，context 为依赖。
// 返回值：使用所给依赖执行的真实函数。
function loadAction(file, name, context) {
  const source = parseSFC(readFileSync(new URL(file, import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const declaration = parse(source, { sourceType: 'module' }).program.body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  return new Function(...Object.keys(context), `${source.slice(declaration.start, declaration.end)}; return ${name}`)(...Object.values(context))
}

test('applying access settings cancels without a write and names the saved configuration', async () => {
  let writes = 0
  let options
  const action = loadAction('./settings/components/PublicAccessSettingsModule.vue', 'applySettings', {
    canUpdate: { value: true }, applying: { value: false }, saving: { value: false },
    form: { value: { publicOrigin: 'https://draft.example.test' } },
    savedSettings: { value: { publicOrigin: 'https://saved.example.test', version: 3 } },
    normalizePublicOrigin: value => value,
    askConfirm: async value => { options = value; return false },
    window: { confirm: () => true },
    errorMessage: { value: '' }, applyAccessSettings: async () => { writes++; return {} },
    showToast: () => {}, readError: () => '',
  })
  await action()
  assert.equal(writes, 0)
  assert.equal(options.confirmText, '应用访问配置')
  assert.match(options.description, /saved\.example\.test/)
  assert.doesNotMatch(options.description, /draft\.example\.test/)
})

test('environment retirement checks cancellation and does not stop a runtime', async () => {
  let writes = 0
  let options
  const environment = { id: 'env-1', environment: 'test' }
  const action = loadAction('./applications/components/SubsystemOnboardingModule.vue', 'offboardEnvironment', {
    selectedApplication: { value: { id: 'app-1', code: 'crm' } },
    environmentStatus: () => 'READY', canManageRuntime: { value: true },
    isManagedRuntimeTarget: () => true, saving: { value: false },
    askConfirm: async value => { options = value; return false },
    window: { confirm: () => true },
    teardownSubsystem: async () => { writes++ }, clearError: () => {},
    notify: () => {}, loadEnvironments: async () => {}, setError: () => {},
  })
  await action(environment)
  assert.equal(writes, 0)
  assert.equal(options.confirmText, '退役环境')
})

test('notification version publishes the complete form once and names its final result', async () => {
  let options
  const writes = []
  const action = loadAction('./notifications/components/NotificationCenterModule.vue', 'newVersion', {
    working: { value: false }, loading: { value: false }, canUpdateTemplates: { value: true },
    askPrompt: async value => { options = value; return { title_template: '提醒标题', body_template: '提醒正文' } },
    window: { prompt: () => 'old native input' },
    createNotificationTemplateVersion: async (...args) => { writes.push(args) },
    runAction: async write => write(), loadTemplates: async () => {},
  })
  await action({ id: 'template-1', name: '提醒' })
  assert.equal(options.confirmText, '发布新版本')
  assert.deepEqual(writes, [['template-1', {
    title_template: '提醒标题', body_template: '提醒正文', variables: [],
  }]])
})
