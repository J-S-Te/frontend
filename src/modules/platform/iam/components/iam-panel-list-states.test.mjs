import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { reactive, ref } from 'vue'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { renderToString } from '@vue/server-renderer'
import { useOrganizationDirectory } from '../composables/useOrganizationDirectory.js'

// 身份与组织（IAM）里「组织目录 / 岗位 / 任职关系」三个子面板的失败可重试锁。
//
// 改造前这三个面板只有「加载中 / 空」两种文案：请求失败时 organizations / positions /
// memberships 保持空数组，用户看到的是「暂无组织记录」「暂无组织和岗位记录」
// 「暂无任职关系」——把失败读成「没有数据」，唯一信号是页面顶部的通用横幅。
// 现在三态统一交给 ListState（loading > error > empty），本文件用真实 SFC 渲染锁住：
//   · 失败 → ErrorState（role=alert + 重试按钮），绝不出现空态文案；
//   · 加载中 → LoadingState，且加载优先于失败；
//   · 真空 → 保留原来的空态文案；关键字无匹配 → 保留原来的筛选文案；
//   · 重试事件从子面板冒到父组件的同一个 load（重新发起同一个请求）。
// 再加一条父组件接线锁：失败原因必须写进 panelErrors 并真的下发给子面板。

const SRC = new URL('../../../../', import.meta.url).pathname

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.')
    ? resolve(dirname(fromFile), specifier)
    : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`)
}

async function loadSfc(file) {
  const { descriptor } = parse(readFileSync(file, 'utf8'))
  const script = compileScript(descriptor, { id: file })
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(compiled.errors, [], file)
  const imports = {}
  for (const node of script.scriptSetupAst.filter((item) => item.type === 'ImportDeclaration')) {
    const dependency = await resolveDependency(file, node.source.value)
    for (const spec of node.specifiers) {
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier' ? (dependency.default ?? dependency) : dependency[spec.imported.name]
    }
  }
  // compileScript 会把 TS SFC 的默认导出包成 `defineComponent(...)`：把它自动引入的
  // Vue 标识符补进求值作用域（与 shared/*.test.mjs 的加载器保持同一口径）。
  for (const match of script.content.matchAll(/import \{([^}]+)\} from ['"]vue['"]/g)) {
    for (const part of match[1].split(',')) {
      const [imported, local = imported] = part.trim().split(/\s+as\s+/)
      if (imported && !(local in imports)) imports[local] = Vue[imported]
    }
  }
  // 共享组件已改为 `<script lang="ts">`：compileScript 只展开宏、不擦除类型标注，
  // 因此先用 esbuild 把编译产物降级成 JS，再交给 new Function 求值。
  // esbuild 会把 import 重排成单行并补分号：在这里一次性去掉，下游 new Function 只吃纯 JS。
  const scriptCode = transformSync(script.content, { loader: 'ts' }).code
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"];?\n/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?\n?/gm, '')
  const component = new Function(...Object.keys(imports), scriptCode
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace(/^import\s+['"][^'"]+['"]\n?/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

function render(component, props) {
  return renderToString(Vue.createSSRApp({ render: () => Vue.h(component, props) }))
}

const PositionGroups = await loadSfc(new URL('./PositionGroups.vue', import.meta.url).pathname)
const MembershipGroups = await loadSfc(new URL('./MembershipGroups.vue', import.meta.url).pathname)
const FAILURE = '网络请求失败，请稍后重试。'

// ---------------------------------------------------------------------------
// 岗位面板（按组织架构分组）
// ---------------------------------------------------------------------------

test('岗位面板：读取失败渲染可重试的错误态，不渲染成「暂无组织和岗位记录」', async () => {
  const html = await render(PositionGroups, {
    positions: [],
    organizations: [],
    keyword: '',
    loading: false,
    error: FAILURE,
  })
  assert.match(html, /role="alert"/)
  assert.match(html, /岗位列表加载失败/)
  assert.match(html, new RegExp(FAILURE))
  assert.match(html, /ui-state__retry/)
  assert.match(html, />重新加载</)
  assert.doesNotMatch(html, /暂无组织和岗位记录/)
  assert.doesNotMatch(html, /没有匹配的岗位或组织/)
  assert.doesNotMatch(html, /iam-position-tree/)
})

test('岗位面板：加载中优先于失败，且保留原来的加载文案', async () => {
  const html = await render(PositionGroups, {
    positions: [],
    organizations: [],
    keyword: '',
    loading: true,
    error: FAILURE,
  })
  assert.match(html, /role="status"/)
  assert.match(html, /ui-state__spinner/)
  assert.match(html, /正在读取组织架构与岗位…/)
  assert.doesNotMatch(html, /role="alert"/)
  assert.doesNotMatch(html, /暂无组织和岗位记录/)
})

test('岗位面板：真正的空数据与筛选无结果保留原空态文案', async () => {
  const empty = await render(PositionGroups, { positions: [], organizations: [], keyword: '', loading: false, error: '' })
  assert.match(empty, /暂无组织和岗位记录。/)
  assert.doesNotMatch(empty, /role="alert"/)
  assert.doesNotMatch(empty, /ui-state__retry/)

  const filtered = await render(PositionGroups, { positions: [], organizations: [], keyword: '运维', loading: false, error: '' })
  assert.match(filtered, /没有匹配的岗位或组织。/)
  assert.doesNotMatch(filtered, /暂无组织和岗位记录/)
})

test('岗位面板：有数据时仍然渲染组织树，不显示任何三态占位', async () => {
  const html = await render(PositionGroups, {
    positions: [{ position_id: 'pos-1', name: '前端工程师', code: 'FE', status: 'ACTIVE', org_unit_id: 'org-1' }],
    organizations: [{ org_unit_id: 'org-1', name: '研发中心', code: 'RD', parent_id: '', status: 'ACTIVE' }],
    keyword: '',
    loading: false,
    error: '',
  })
  assert.match(html, /iam-position-tree/)
  assert.match(html, /前端工程师/)
  assert.doesNotMatch(html, /ui-state/)
})

test('岗位面板把重试交回父组件（emit retry，不自己猜请求）', () => {
  assert.ok(PositionGroups.emits?.includes('retry'), 'PositionGroups 必须声明 retry 事件')
  const source = readFileSync(new URL('./PositionGroups.vue', import.meta.url), 'utf8')
  assert.match(source, /:error="error"/)
  assert.match(source, /@retry="emit\('retry'\)"/)
})

// ---------------------------------------------------------------------------
// 任职关系面板（按组织归类）
// ---------------------------------------------------------------------------

test('任职面板：读取失败渲染可重试的错误态，不渲染成「暂无任职关系」', async () => {
  const html = await render(MembershipGroups, {
    memberships: [],
    organizations: [],
    keyword: '',
    loading: false,
    error: FAILURE,
  })
  assert.match(html, /role="alert"/)
  assert.match(html, /任职关系加载失败/)
  assert.match(html, new RegExp(FAILURE))
  assert.match(html, /ui-state__retry/)
  assert.match(html, />重新加载</)
  assert.doesNotMatch(html, /暂无任职关系/)
  assert.doesNotMatch(html, /没有匹配的用户、组织或岗位/)
  assert.doesNotMatch(html, /iam-membership-groups"/)
})

test('任职面板：加载中优先于失败，且保留原来的加载文案', async () => {
  const html = await render(MembershipGroups, {
    memberships: [],
    organizations: [],
    keyword: '',
    loading: true,
    error: FAILURE,
  })
  assert.match(html, /role="status"/)
  assert.match(html, /ui-state__spinner/)
  assert.match(html, /正在读取完整任职关系…/)
  assert.doesNotMatch(html, /role="alert"/)
  assert.doesNotMatch(html, /暂无任职关系/)
})

test('任职面板：真正的空数据与筛选无结果保留原空态文案', async () => {
  const empty = await render(MembershipGroups, { memberships: [], organizations: [], keyword: '', loading: false, error: '' })
  assert.match(empty, /暂无任职关系。/)
  assert.doesNotMatch(empty, /role="alert"/)
  assert.doesNotMatch(empty, /ui-state__retry/)

  const filtered = await render(MembershipGroups, { memberships: [], organizations: [], keyword: '张三', loading: false, error: '' })
  assert.match(filtered, /没有匹配的用户、组织或岗位。/)
  assert.doesNotMatch(filtered, /暂无任职关系/)
})

test('任职面板把重试交回父组件（emit retry，不自己猜请求）', () => {
  assert.ok(MembershipGroups.emits?.includes('retry'), 'MembershipGroups 必须声明 retry 事件')
  const source = readFileSync(new URL('./MembershipGroups.vue', import.meta.url), 'utf8')
  assert.match(source, /:error="error"/)
  assert.match(source, /@retry="emit\('retry'\)"/)
})

// ---------------------------------------------------------------------------
// 组织目录：失败原因经 useOrganizationDirectory 落到面板三态
// ---------------------------------------------------------------------------

test('组织目录读取失败时把失败原因留给面板三态，成功重新读取后清空', async () => {
  const panelErrors = reactive({ organizations: '' })
  const errorMessage = ref('')
  const state = {
    requestSeq: { organizations: 0 },
    pagination: { organizations: { page: 0, pageSize: 0, total: 0, serverPagingSupported: false } },
    panelFilters: reactive({ organizations: '' }),
    panelErrors,
    errorMessage,
  }
  let failing = true
  const listOrgUnits = async () => {
    if (failing) throw Object.assign(new Error(FAILURE), { status: 500 })
    return { items: [{ org_unit_id: 'org-1', name: '总部', code: 'HQ', status: 'ACTIVE' }], total: 1 }
  }
  const { organizations, loadOrganizations } = useOrganizationDirectory({
    canReadPanel: () => true,
    panels: [{ key: 'organizations', label: '组织单元' }],
    requestSeq: state.requestSeq,
    pagination: state.pagination,
    // 与组件里的 safeCall 同名同义：失败写 errorMessage 并返回 null，不抛出。
    safeCall: async (kind, fn) => {
      assert.equal(kind, 'organizations')
      errorMessage.value = ''
      try {
        return await fn()
      } catch (error) {
        errorMessage.value = error.message
        return null
      }
    },
    panelFilters: state.panelFilters,
    listOrgUnits,
    panelErrors,
    errorMessage,
  })

  await loadOrganizations()
  // 失败：目录保持空，但失败原因必须写进面板自己的错误位（面板据此渲染 ErrorState + 重试）。
  assert.deepEqual(organizations.value, [])
  assert.equal(panelErrors.organizations, FAILURE)

  failing = false
  await loadOrganizations()
  assert.equal(panelErrors.organizations, '', '重新读取成功后必须清掉失败原因')
  assert.deepEqual(organizations.value.map((item) => item.org_unit_id), ['org-1'])
})

test('组织目录没有注入 panelErrors 时保持原行为（不抛错）', async () => {
  const { loadOrganizations } = useOrganizationDirectory({
    canReadPanel: () => true,
    panels: [{ key: 'organizations', label: '组织单元' }],
    requestSeq: { organizations: 0 },
    pagination: { organizations: { page: 0, pageSize: 0, total: 0, serverPagingSupported: false } },
    safeCall: async () => null,
    panelFilters: reactive({ organizations: '' }),
    listOrgUnits: async () => ({ items: [], total: 0 }),
  })
  await loadOrganizations()
})

// ---------------------------------------------------------------------------
// 父组件接线：失败原因真的下发给了三个子面板，重试真的回到同一个 load
// ---------------------------------------------------------------------------

const IAM_SOURCE = readFileSync(new URL('./IamSettingsModule.vue', import.meta.url), 'utf8')

test('IAM 父组件为组织 / 岗位 / 任职各留一份失败原因并下发给子面板', () => {
  assert.match(
    IAM_SOURCE,
    /const panelErrors = reactive\(\{ users: '', accounts: '', organizations: '', positions: '', memberships: '' \}\)/,
  )
  // 失败原因来自 safeCall 写在 errorMessage 的统一消息，按面板复制一份。
  assert.match(IAM_SOURCE, /panelErrors\.positions = ''/)
  assert.match(IAM_SOURCE, /panelErrors\.positions = errorMessage\.value/)
  assert.match(IAM_SOURCE, /panelErrors\.memberships = ''/)
  assert.match(IAM_SOURCE, /panelErrors\.memberships = errorMessage\.value/)
  // 组织目录的失败原因由 composable 写入（同一套 safeCall 语义）。
  assert.match(IAM_SOURCE, /useOrganizationDirectory\(\{[^}]*panelErrors, errorMessage \}\)/)

  // 三个子面板都拿到 :error，并且重试重新发起同一个 load。
  assert.match(IAM_SOURCE, /:error="panelErrors\.organizations"[\s\S]{0,600}@retry="loadOrganizations\(\)"/)
  assert.match(IAM_SOURCE, /:error="panelErrors\.positions"[\s\S]{0,600}@retry="loadPositions\(\)"/)
  assert.match(IAM_SOURCE, /:error="panelErrors\.memberships"[\s\S]{0,400}@retry="loadMemberships\(\)"/)
})

test('IAM 的「可授权应用」列表：读取失败不再渲染成「当前没有可授权的应用」', () => {
  // 失败时 applications 被清空，所以空列表一律走三态闸门；:error 决定失败态（带重试）。
  assert.match(
    IAM_SOURCE,
    /const subjectApplicationsListState = computed\(\(\) => applicationsLoading\.value \|\| !applications\.value\.length\)/,
  )
  assert.match(
    IAM_SOURCE,
    /<ListState[\s\S]{0,200}v-if="subjectApplicationsListState"[\s\S]{0,400}:error="applicationAccessError"[\s\S]{0,400}@retry="loadApplicationsForSubject\(\)"/,
  )
  assert.doesNotMatch(IAM_SOURCE, /<p class="iam-empty-inline">正在读取应用列表…<\/p>/)
  assert.doesNotMatch(IAM_SOURCE, /<p class="iam-empty-inline">当前没有可授权的应用。<\/p>/)
})
