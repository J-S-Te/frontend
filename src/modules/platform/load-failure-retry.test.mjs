// 三个「只报错、不能就地恢复」的加载点现在都必须给出可重试的错误态：
//   1) 平台控制台审计筛选的应用下拉（loadApplications）
//   2) IAM 用户详情「登录账号 / 人员状态摘要」（loadAuthorizationOverview）
//   3) 子系统门户目录横幅（loadPortalCatalog）
// 每个用例同时锁两件事：
//   · 模板：失败行必须是有 role="alert" 的可读错误，且里面是 type="button"、
//     调用同一个 loader 的「重试」，同时「失败」不能退化成「空/无数据」；
//   · loader：失败 → 显式错误且不残留旧数据；重试 → 重发同一个请求；成功 → 清空错误。
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { formatUserError } from '../shared/utils/userError.js'

const FILES = {
  console: new URL('./views/PlatformConsoleView.vue', import.meta.url),
  iam: new URL('./iam/components/IamSettingsModule.vue', import.meta.url),
  portal: new URL('./views/SubsystemPortalView.vue', import.meta.url),
}

const compiled = Object.fromEntries(Object.entries(FILES).map(([key, url]) => {
  const source = readFileSync(url, 'utf8')
  const { descriptor, errors } = parse(source, { filename: key })
  assert.deepEqual(errors, [], key)
  return [key, { descriptor, setup: compileScript(descriptor, { id: key }) }]
}))

function functionSource(key, name) {
  const { descriptor, setup } = compiled[key]
  const node = setup.scriptSetupAst.find((item) => item.type === 'FunctionDeclaration' && item.id?.name === name)
  assert.ok(node, `${key}: ${name} 必须存在`)
  return descriptor.scriptSetup.content.slice(node.start, node.end)
}

const ref = (value) => ({ value })

async function loadApplicationsSandbox() {
  const state = {
    canReadApplications: ref(true),
    applications: ref([{ application_id: 'stale', code: 'stale' }]),
    applicationsError: ref(''),
    toasts: [],
  }
  let requests = 0
  let failing = true
  const loadAllCatalogPages = async () => {
    requests += 1
    // 非中文文案会被 formatUserError 收敛到调用方的 fallback，断言因此是稳定的。
    if (failing) throw Object.assign(new Error('upstream failed'), { code: 'HTTP_502' })
    return [{ application_id: 'a1', code: 'crm', name: 'CRM' }]
  }
  const loadApplications = new Function(
    'canReadApplications', 'applications', 'applicationsError', 'loadAllCatalogPages',
    'listApplications', 'showToast', 'formatUserError',
    `${functionSource('console', 'loadApplications')}; return loadApplications`,
  )(
    state.canReadApplications, state.applications, state.applicationsError, loadAllCatalogPages,
    () => {}, (message) => state.toasts.push(message), formatUserError,
  )
  return { state, loadApplications, requests: () => requests, succeed() { failing = false } }
}

async function authorizationOverviewSandbox() {
  const state = {
    authorizationOverview: ref({ accounts: [{ account_id: 'stale' }] }),
    authorizationOverviewUnavailable: ref(false),
    authorizationOverviewLoading: ref(false),
    detail: ref({ kind: 'user', item: { user_id: 'user-1' } }),
    detailAuthorizationRequestSeq: ref(7),
  }
  const requests = []
  let failing = true
  const getAuthorizationOverview = async (userId) => {
    requests.push(userId)
    if (failing) throw new Error('汇总接口读取失败')
    return { accounts: [], memberships: [], pending_changes: [], handover: [] }
  }
  const loadAuthorizationOverview = new Function(
    'authorizationOverview', 'authorizationOverviewUnavailable', 'authorizationOverviewLoading',
    'detail', 'detailAuthorizationRequestSeq', 'getAuthorizationOverview',
    `${functionSource('iam', 'loadAuthorizationOverview')}; return loadAuthorizationOverview`,
  )(
    state.authorizationOverview, state.authorizationOverviewUnavailable, state.authorizationOverviewLoading,
    state.detail, state.detailAuthorizationRequestSeq, getAuthorizationOverview,
  )
  // 重试只能重发这一个汇总请求：沙箱只提供这两个函数，多取任何无关数据都会直接 ReferenceError。
  const retryAuthorizationOverview = new Function(
    'detail', 'authorizationOverviewLoading', 'loadAuthorizationOverview',
    `${functionSource('iam', 'retryAuthorizationOverview')}; return retryAuthorizationOverview`,
  )(state.detail, state.authorizationOverviewLoading, loadAuthorizationOverview)
  return {
    state, requests, retryAuthorizationOverview,
    load: () => loadAuthorizationOverview(state.detail.value.item.user_id),
    succeed() { failing = false },
  }
}

async function portalCatalogSandbox() {
  const state = {
    subsystemCatalogLoading: ref(true),
    subsystemCatalogError: ref(''),
    registeredSubsystems: ref([{ key: 'stale' }]),
  }
  let requests = 0
  let failing = true
  const listPortalApplications = async () => {
    requests += 1
    if (failing) throw Object.assign(new Error('upstream failed'), { code: 'HTTP_502' })
    // 成功后目录可以为空：这仍然不是「失败」。
    return []
  }
  const loadPortalCatalog = new Function(
    'subsystemCatalogLoading', 'subsystemCatalogError', 'registeredSubsystems',
    'listPortalApplications', 'portalEnvironment', 'formatUserError',
    `${functionSource('portal', 'loadPortalCatalog')}; return loadPortalCatalog`,
  )(
    state.subsystemCatalogLoading, state.subsystemCatalogError, state.registeredSubsystems,
    listPortalApplications, '', formatUserError,
  )
  return { state, loadPortalCatalog, requests: () => requests, succeed() { failing = false } }
}

test('审计筛选：应用目录读取失败显示可重试错误行，重试重发同一请求并在成功后清空错误', async () => {
  const { descriptor } = compiled.console
  const template = descriptor.template.content

  // 失败必须显式可见：有独立错误行 + role="alert"，并说明「只能选全部应用」而不是「只有一个应用」。
  const errorRow = template.match(/<p v-if="applicationsError"[^>]*>[\s\S]{0,600}?<\/p>/)
  assert.ok(errorRow, '应用目录读取失败必须渲染独立的错误行')
  assert.match(errorRow[0], /role="alert"/)
  assert.match(errorRow[0], /应用列表读取失败/)
  // 重试是同一条错误行里、调用同一个 loadApplications 的普通按钮。
  assert.match(errorRow[0], /<button class="console-button ghost small" type="button" @click="loadApplications">/)
  assert.match(errorRow[0], /重试/)
  // 「全部应用」保持可用，失败不能让筛选器整体失效。
  assert.match(template, /<option value="">全部应用<\/option>/)

  const loader = await loadApplicationsSandbox()
  await loader.loadApplications()
  assert.equal(loader.requests(), 1)
  assert.match(loader.state.applicationsError.value, /读取应用列表失败/)
  assert.deepEqual(loader.state.applications.value, [], '失败不能继续渲染上一次的目录')
  assert.equal(loader.state.toasts.length, 1, '既有 toast 提示保留')

  loader.succeed()
  await loader.loadApplications()
  assert.equal(loader.requests(), 2, '重试必须重发同一个目录请求')
  assert.equal(loader.state.applicationsError.value, '', '成功读取后错误必须清空')
  assert.deepEqual(loader.state.applications.value.map((item) => item.code), ['crm'])
})

test('IAM 用户详情：登录账号与人员状态摘要的失败行各有重试，重试只重发该汇总请求', async () => {
  const { descriptor } = compiled.iam
  const template = descriptor.template.content

  const retryableRows = template.match(/<p v-else-if="authorizationOverviewUnavailable"[\s\S]{0,400}?<\/p>/g) || []
  assert.equal(retryableRows.length, 2, '登录账号与人员状态摘要两处都要有可重试的失败行')
  for (const row of retryableRows) {
    assert.match(row, /role="alert"/)
    assert.match(row, /<button class="console-button ghost small" type="button" :disabled="authorizationOverviewLoading" @click="retryAuthorizationOverview">/)
    assert.match(row, /重试/)
  }
  // 失败与「真的没有登录账号」必须是两段不同的文案，不能把失败读成空。
  const unavailableAt = template.indexOf('登录账号暂不可用，请稍后重试。')
  const emptyAt = template.indexOf('该用户尚未关联登录账号')
  assert.ok(unavailableAt > 0 && emptyAt > unavailableAt, '失败分支必须排在空分支之前')
  assert.doesNotMatch(template, /authorizationOverviewUnavailable[\s\S]{0,80}该用户尚未关联登录账号/)

  const overview = await authorizationOverviewSandbox()
  await overview.load()
  assert.equal(overview.state.authorizationOverviewUnavailable.value, true)
  assert.equal(overview.state.authorizationOverview.value, null, '失败不能保留上一次的汇总快照')
  assert.equal(overview.state.authorizationOverviewLoading.value, false)

  overview.succeed()
  overview.retryAuthorizationOverview()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(overview.requests, ['user-1', 'user-1'], '重试只重发同一用户的汇总请求')
  assert.equal(overview.state.authorizationOverviewUnavailable.value, false, '成功后必须清空失败位')
  assert.ok(overview.state.authorizationOverview.value)

  // 没有任何权限/详情时不发请求。
  overview.state.detail.value = null
  overview.retryAuthorizationOverview()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(overview.requests.length, 2)
})

test('子系统门户：目录加载失败保留原横幅文案并补重试，重试成功后即使目录为空也清空错误', async () => {
  const { descriptor } = compiled.portal
  const template = descriptor.template.content

  const errorRow = template.match(/<p v-if="subsystemCatalogError"[^>]*>[\s\S]{0,400}?<\/p>/)
  assert.ok(errorRow, '目录加载失败必须保留原错误横幅')
  assert.match(errorRow[0], /class="subsystem-portal__catalog-status is-error"/)
  assert.match(errorRow[0], /role="alert"/)
  assert.match(errorRow[0], /\{\{ subsystemCatalogError \}\}/, '横幅文案沿用原有错误信息')
  assert.match(errorRow[0], /<button class="subsystem-portal__catalog-retry" type="button" :disabled="subsystemCatalogLoading" @click="loadPortalCatalog\(\)">重试<\/button>/)
  // 失败优先于空：目录为空的一行必须是 v-else-if，失败时不会同时出现。
  assert.match(template, /<p v-else-if="registeredSubsystems\.length === 0" class="subsystem-portal__catalog-status">/)
  assert.match(template, /<p v-if="subsystemCatalogError"[\s\S]*?<p v-else-if="registeredSubsystems\.length === 0"/)

  // 新按钮只允许用 portal token 上色，深色/浅色主题共用一份规则。
  const styles = readFileSync(new URL('./styles/subsystem-portal.css', import.meta.url), 'utf8')
  const rule = styles.match(/\.subsystem-portal__catalog-retry \{[\s\S]*?\n\}/)
  assert.ok(rule, '重试按钮必须有 token 化的样式')
  assert.doesNotMatch(rule[0], /#[0-9a-f]{3,8}\b|rgba?\(/i, '不允许裸色值')

  const catalog = await portalCatalogSandbox()
  await catalog.loadPortalCatalog()
  assert.equal(catalog.requests(), 1)
  assert.match(catalog.state.subsystemCatalogError.value, /无法加载已接入的子系统/)
  assert.deepEqual(catalog.state.registeredSubsystems.value, [])
  assert.equal(catalog.state.subsystemCatalogLoading.value, false)

  catalog.succeed()
  await catalog.loadPortalCatalog()
  assert.equal(catalog.requests(), 2, '重试必须重发同一个目录请求')
  assert.equal(catalog.state.subsystemCatalogError.value, '', '成功（即使目录为空）必须清空错误')
  assert.deepEqual(catalog.state.registeredSubsystems.value, [])
})
