import assert from 'node:assert/strict'
import test from 'node:test'
import { access } from 'node:fs/promises'

// 用途：读取实际构建选择器，缺少能力时报告明确的行为断言。
// 参数：无。
// 返回值：选择器导出；能力尚未实现时使测试失败。
async function selectionTools() {
  const url = new URL('./moduleSelection.mjs', import.meta.url)
  const exists = await access(url).then(() => true, () => false)
  assert.ok(exists, '缺少按选中模块生成编译入口的构建选择器')
  return import(url)
}

test('选择 none 仅保留平台，默认 all 保持六业务兼容', async () => {
  const { selectModules } = await selectionTools()
  assert.deepEqual(selectModules('none').map(({ code }) => code), ['basic-platform'])
  assert.equal(selectModules().length, 7)
  assert.equal(selectModules('all').length, 7)
})

test('显式组合按规范 code 去重，拒绝拼错、空项及混用保留值', async () => {
  const { selectModules } = await selectionTools()
  assert.deepEqual(selectModules('project_management,contract_management,contract_management')
    .map(({ code }) => code), ['basic-platform', 'project_management', 'contract_management'])
  for (const value of ['crm', 'wat', 'contract_management,', 'all,contract_management',
    'none,contract_management', 'basic-platform']) {
    assert.throws(() => selectModules(value), /VITE_ENABLED_MODULES/)
  }
})

test('生成的合同入口只导入合同视图与会话，其他业务不进入编译图', async () => {
  const { generateModuleManifest } = await selectionTools()
  const source = generateModuleManifest('contract_management')
  assert.match(source, /contract_management\/views\/ContractManagementView\.vue/)
  assert.match(source, /contract_management\/api\/contract\.js/)
  for (const directory of ['project_management', 'settlement', 'customer_opportunity',
    'customer_portal', 'data_analysis']) {
    assert.doesNotMatch(source, new RegExp(`import[^\\n]*${directory}/`))
  }
})

test('无模块清单完全没有业务动态 import', async () => {
  const { generateModuleManifest } = await selectionTools()
  const source = generateModuleManifest('none')
  assert.doesNotMatch(source, /import\(/)
})

test('真实选中清单驱动门户与会话；未登记不开放、投影拒绝仍关闭', async () => {
  const { selectedModulesPlugin } = await selectionTools()
  const { build } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  const root = new URL('../', import.meta.url).pathname
  const result = await build({
    configFile: false, root, logLevel: 'silent',
    plugins: [selectedModulesPlugin('contract_management', {
      VITE_PROJECT_PUBLIC_PATH_PREFIX: '/custom-project',
    }), vue()],
    resolve: { alias: { '@': `${root}/src` } },
    build: { write: false, minify: false, rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: new URL('./selectionProbe.mjs', import.meta.url).pathname,
      output: { format: 'es', codeSplitting: false },
    } },
  })
  const chunk = result.output.find((entry) => entry.type === 'chunk' && entry.isEntry)
  const probe = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`)
  assert.deepEqual(probe.frontendModules.map(({ code }) => code),
    ['basic-platform', 'contract_management'])
  assert.equal(probe.buildPortalSubsystems([]).length, 1)
  const cards = probe.buildPortalSubsystems([
    { code: 'contract_management', projection_ready: false, allowed: false },
    { code: 'project_management', public_url: '/project_management/dashboard' },
    { code: 'external-tool', public_url: 'https://external.example/home', allowed: false },
    { code: 'custom-project', public_url: '/custom-project/dashboard' },
  ])
  assert.equal(cards[1].allowed, false)
  assert.equal(cards[1].route.name, 'contract_management')
  assert.equal(cards[2].route, undefined)
  assert.equal(cards[2].publicURL, '')
  assert.equal(cards[2].allowed, false)
  assert.equal(cards[3].publicURL, 'https://external.example/home')
  assert.equal(cards[3].allowed, false)
  assert.equal(cards[4].publicURL, '')
  assert.equal(cards[4].allowed, false)
  assert.equal(probe.sessionTargetForRoute({ requiresProjectSession: true }), null)
  assert.equal(probe.sessionTargetForRoute({ requiresContractSession: true }).key, 'Contract')
  assert.throws(() => probe.sessionTargetForRoute({
    requiresContractSession: true, requiresProjectSession: true,
  }), /冲突/)
})

test('其他入口传递引入未选模块时构建失败，不生成貌似裁剪成功的发行物', async () => {
  const { selectedModulesPlugin } = await selectionTools()
  const { build } = await import('vite')
  await assert.rejects(build({
    configFile: false, logLevel: 'silent',
    plugins: [selectedModulesPlugin('none')],
    build: { write: false, rollupOptions: {
      input: new URL('../src/modules/project_management/module.js', import.meta.url).pathname,
      preserveEntrySignatures: 'strict',
    } },
  }), /未选模块被编译依赖引入：project_management/)
})
