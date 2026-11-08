import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { renderToString } from '@vue/server-renderer'

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

async function renderComponent(component, props) {
  return renderToString(Vue.createSSRApp({ render: () => Vue.h(component, props) }))
}

// golden 为提取前 IamSettingsModule.vue 组织面板片段的 SSR 渲染结果（批次 2 第三步采集），
// 提取后本组件必须逐字节复现同一 DOM；任何有意变更须同步重采 golden。
const GOLDENS = {
  "limit-and-deleting": "<section class=\"iam-table-section iam-organizations-panel\"><div class=\"iam-filter-row\"><label class=\"console-search-field\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M10.8 4a6.8 6.8 0 1 0 4.3 12.1l4.4 4.4 1.4-1.4-4.4-4.4A6.8 6.8 0 0 0 10.8 4Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><input type=\"search\" placeholder=\"搜索组织名称或编码\" maxlength=\"100\" value></label><span>3 / 共 3 个组织</span></div><p class=\"iam-server-limit-note\">未能读取全部组织数据，当前树可能不完整。请检查组织列表接口是否能继续翻页。</p><section class=\"iam-organization-tree-card\" aria-label=\"组织架构\"><header class=\"iam-organization-tree-toolbar\"><div><p>组织目录</p><strong>组织架构树</strong><span>同一上级下按显示顺序由小到大排列</span></div><div class=\"iam-tree-toolbar-metrics\"><span><b>2</b> 个有效组织</span><span><b>3</b> 个当前可见</span></div><div class=\"iam-organization-tree-toolbar-actions\"><button class=\"console-button ghost small\" type=\"button\">全部展开</button><button class=\"console-button ghost small\" type=\"button\">全部收起</button></div></header><div class=\"iam-organization-tree\" role=\"tree\" aria-label=\"组织单元树\"><!--[--><article class=\"iam-organization-tree-row\" style=\"--tree-depth:0;\" role=\"treeitem\" aria-level=\"1\" aria-expanded=\"true\" tabindex=\"0\" data-organization-tree-node><div class=\"iam-organization-tree-identity\"><button class=\"iam-organization-tree-toggle is-expanded\" type=\"button\" aria-label=\"收起ACME Group\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9 18 6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6L9 18Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button><span class=\"iam-organization-tree-icon\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M4 3h7v5H4V3Zm9 0h7v5h-7V3ZM9 10h6v4h5v7h-7v-5H11v5H4v-7h5v-4Zm-3 6v3h3v-3H6Zm9 0v3h3v-3h-3Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><span class=\"iam-organization-tree-name\"><strong>ACME Group</strong><small>ORG-ROOT</small></span></div><div class=\"iam-organization-tree-meta\"><span><small>上级组织</small><strong>根组织</strong></span><span><small>显示顺序</small><strong>10</strong></span><span><small>直属下级</small><strong>1 个</strong></span><span class=\"console-badge status-active\">启用</span></div><div class=\"iam-organization-tree-actions\"><button class=\"console-text-button\" type=\"button\">详情</button><button class=\"console-text-button\" type=\"button\" title=\"复制组织 ID：org-root-1\">复制 ID</button><button class=\"console-text-button\" type=\"button\">新增下级</button><button class=\"console-text-button\" type=\"button\">编辑</button><button class=\"console-text-button danger\" type=\"button\">删除</button></div></article><article class=\"iam-organization-tree-row is-child\" style=\"--tree-depth:1;\" role=\"treeitem\" aria-level=\"2\" aria-expanded=\"true\" tabindex=\"0\" data-organization-tree-node><div class=\"iam-organization-tree-identity\"><button class=\"iam-organization-tree-toggle is-expanded\" type=\"button\" aria-label=\"收起R&amp;D Center\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9 18 6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6L9 18Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button><span class=\"iam-organization-tree-icon\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M4 3h7v5H4V3Zm9 0h7v5h-7V3ZM9 10h6v4h5v7h-7v-5H11v5H4v-7h5v-4Zm-3 6v3h3v-3H6Zm9 0v3h3v-3h-3Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><span class=\"iam-organization-tree-name\"><strong>R&amp;D Center</strong><small>ORG-RD</small></span></div><div class=\"iam-organization-tree-meta\"><span><small>上级组织</small><strong>ACME Group</strong></span><span><small>显示顺序</small><strong>20</strong></span><span><small>直属下级</small><strong>1 个</strong></span><span class=\"console-badge status-active\">启用</span></div><div class=\"iam-organization-tree-actions\"><button class=\"console-text-button\" type=\"button\">详情</button><button class=\"console-text-button\" type=\"button\" title=\"复制组织 ID：org-child-1\">复制 ID</button><button class=\"console-text-button\" type=\"button\">新增下级</button><button class=\"console-text-button\" type=\"button\">编辑</button><button class=\"console-text-button danger\" type=\"button\" disabled>删除中…</button></div></article><article class=\"iam-organization-tree-row is-child\" style=\"--tree-depth:2;\" role=\"treeitem\" aria-level=\"3\" tabindex=\"0\" data-organization-tree-node><div class=\"iam-organization-tree-identity\"><span class=\"iam-organization-tree-toggle-spacer\" aria-hidden=\"true\"></span><span class=\"iam-organization-tree-icon\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M4 3h7v5H4V3Zm9 0h7v5h-7V3ZM9 10h6v4h5v7h-7v-5H11v5H4v-7h5v-4Zm-3 6v3h3v-3H6Zm9 0v3h3v-3h-3Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><span class=\"iam-organization-tree-name\"><strong>Frontend Team</strong><small>ORG-RD-FE</small></span></div><div class=\"iam-organization-tree-meta\"><span><small>上级组织</small><strong>R&amp;D Center</strong></span><span><small>显示顺序</small><strong>10</strong></span><!--v-if--><span class=\"console-badge status-disabled\">停用</span></div><div class=\"iam-organization-tree-actions\"><button class=\"console-text-button\" type=\"button\">详情</button><button class=\"console-text-button\" type=\"button\" title=\"复制组织 ID：org-leaf-1\">复制 ID</button><button class=\"console-text-button\" type=\"button\">新增下级</button><button class=\"console-text-button\" type=\"button\">编辑</button><button class=\"console-text-button danger\" type=\"button\">删除</button></div></article><!--]--></div></section></section>",
  "filtered-clean": "<section class=\"iam-table-section iam-organizations-panel\"><div class=\"iam-filter-row\"><label class=\"console-search-field\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M10.8 4a6.8 6.8 0 1 0 4.3 12.1l4.4 4.4 1.4-1.4-4.4-4.4A6.8 6.8 0 0 0 10.8 4Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><input type=\"search\" placeholder=\"搜索组织名称或编码\" maxlength=\"100\" value=\"R&amp;D\"></label><span>3 / 共 3 个组织</span></div><!--v-if--><section class=\"iam-organization-tree-card\" aria-label=\"组织架构\"><header class=\"iam-organization-tree-toolbar\"><div><p>组织目录</p><strong>组织架构树</strong><span>同一上级下按显示顺序由小到大排列</span></div><div class=\"iam-tree-toolbar-metrics\"><span><b>2</b> 个有效组织</span><span><b>2</b> 个当前可见</span></div><div class=\"iam-organization-tree-toolbar-actions\"><button class=\"console-button ghost small\" type=\"button\">全部展开</button><button class=\"console-button ghost small\" type=\"button\">全部收起</button></div></header><div class=\"iam-organization-tree\" role=\"tree\" aria-label=\"组织单元树\"><!--[--><article class=\"iam-organization-tree-row\" style=\"--tree-depth:0;\" role=\"treeitem\" aria-level=\"1\" aria-expanded=\"true\" tabindex=\"0\" data-organization-tree-node><div class=\"iam-organization-tree-identity\"><button class=\"iam-organization-tree-toggle is-expanded\" type=\"button\" aria-label=\"收起ACME Group\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9 18 6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6L9 18Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button><span class=\"iam-organization-tree-icon\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M4 3h7v5H4V3Zm9 0h7v5h-7V3ZM9 10h6v4h5v7h-7v-5H11v5H4v-7h5v-4Zm-3 6v3h3v-3H6Zm9 0v3h3v-3h-3Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><span class=\"iam-organization-tree-name\"><strong>ACME Group</strong><small>ORG-ROOT</small></span></div><div class=\"iam-organization-tree-meta\"><span><small>上级组织</small><strong>根组织</strong></span><span><small>显示顺序</small><strong>10</strong></span><span><small>直属下级</small><strong>1 个</strong></span><span class=\"console-badge status-active\">启用</span></div><div class=\"iam-organization-tree-actions\"><button class=\"console-text-button\" type=\"button\">详情</button><button class=\"console-text-button\" type=\"button\" title=\"复制组织 ID：org-root-1\">复制 ID</button><button class=\"console-text-button\" type=\"button\">新增下级</button><button class=\"console-text-button\" type=\"button\">编辑</button><button class=\"console-text-button danger\" type=\"button\">删除</button></div></article><article class=\"iam-organization-tree-row is-child\" style=\"--tree-depth:1;\" role=\"treeitem\" aria-level=\"2\" tabindex=\"0\" data-organization-tree-node><div class=\"iam-organization-tree-identity\"><span class=\"iam-organization-tree-toggle-spacer\" aria-hidden=\"true\"></span><span class=\"iam-organization-tree-icon\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M4 3h7v5H4V3Zm9 0h7v5h-7V3ZM9 10h6v4h5v7h-7v-5H11v5H4v-7h5v-4Zm-3 6v3h3v-3H6Zm9 0v3h3v-3h-3Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><span class=\"iam-organization-tree-name\"><strong>R&amp;D Center</strong><small>ORG-RD</small></span></div><div class=\"iam-organization-tree-meta\"><span><small>上级组织</small><strong>ACME Group</strong></span><span><small>显示顺序</small><strong>20</strong></span><!--v-if--><span class=\"console-badge status-active\">启用</span></div><div class=\"iam-organization-tree-actions\"><button class=\"console-text-button\" type=\"button\">详情</button><button class=\"console-text-button\" type=\"button\" title=\"复制组织 ID：org-child-1\">复制 ID</button><button class=\"console-text-button\" type=\"button\">新增下级</button><button class=\"console-text-button\" type=\"button\">编辑</button><button class=\"console-text-button danger\" type=\"button\">删除</button></div></article><!--]--></div></section></section>"
}
const CASES = {
  "limit-and-deleting": {
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "filteredOrganizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "panelFilters": {
      "organizations": ""
    },
    "pagination": {
      "organizations": {
        "page": 1,
        "pageSize": 100,
        "total": 3,
        "serverPagingSupported": false
      }
    },
    "loading": {
      "organizations": false
    },
    "deletingOrganizationId": "org-child-1",
    "canCreate": true,
    "canUpdate": true,
    "canDelete": true
  },
  "filtered-clean": {
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "filteredOrganizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "panelFilters": {
      "organizations": "R&D"
    },
    "pagination": {
      "organizations": {
        "page": 1,
        "pageSize": 100,
        "total": 3,
        "serverPagingSupported": true
      }
    },
    "loading": {
      "organizations": false
    },
    "deletingOrganizationId": "",
    "canCreate": true,
    "canUpdate": true,
    "canDelete": true
  }
}

const component = await loadSfc(new URL('./OrganizationDirectoryPanel.vue', import.meta.url).pathname)

test('组织面板复现提取前 golden：分页受限提示与删除中状态', async () => {
  const html = await renderComponent(component, CASES['limit-and-deleting'])
  assert.equal(html, GOLDENS['limit-and-deleting'])
})

test('组织面板复现提取前 golden：关键字过滤与干净态', async () => {
  const html = await renderComponent(component, CASES['filtered-clean'])
  assert.equal(html, GOLDENS['filtered-clean'])
})

test('组织面板把 OrgUnitTree 五类事件原样再发出', async () => {
  // 事件转发接线由编译后源码核对：子组件对 OrgUnitTree 的五类事件一一 $emit 同名事件。
  const panelSource = readFileSync(new URL('./OrganizationDirectoryPanel.vue', import.meta.url), 'utf8')
  for (const name of ['copy-id', 'create-child', 'detail', 'edit', 'remove']) {
    assert.ok(panelSource.includes("emit('" + name), name)
  }
})

// ---------------------------------------------------------------------------
// 失败 / 加载 / 空三态：组织目录读取失败必须渲染可重试的错误态，
// 不能像改造前那样只留一句「暂无组织记录。」（用户会把失败读成组织被清空）。
// 三个用例都走真实 SFC 渲染；金样用例（有数据）仍然逐字节等于提取前 DOM。
// ---------------------------------------------------------------------------

const FAILURE = '组织目录读取失败：网络不可用，请稍后重试。'

function stateCase({ organizations = [], keyword = '', loading = false, error = '' } = {}) {
  return {
    organizations,
    filteredOrganizations: organizations,
    panelFilters: { organizations: keyword },
    pagination: { organizations: { page: 1, pageSize: 100, total: organizations.length, serverPagingSupported: true } },
    loading: { organizations: loading },
    error,
    deletingOrganizationId: '',
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  }
}

test('组织面板：读取失败渲染可重试的错误态，而不是「暂无组织记录」', async () => {
  const html = await renderComponent(component, stateCase({ error: FAILURE }))
  assert.match(html, /role="alert"/)
  assert.match(html, /组织目录加载失败/)
  assert.match(html, new RegExp(FAILURE))
  assert.match(html, /ui-state__retry/)
  assert.match(html, />重新加载</)
  assert.doesNotMatch(html, /暂无组织记录/)
  assert.doesNotMatch(html, /iam-organization-tree-row/)
})

test('组织面板：加载中优先于失败，保留原来的加载文案', async () => {
  const html = await renderComponent(component, stateCase({ loading: true, error: FAILURE }))
  assert.match(html, /role="status"/)
  assert.match(html, /ui-state__spinner/)
  assert.match(html, /正在读取完整组织架构…/)
  assert.doesNotMatch(html, /role="alert"/)
  assert.doesNotMatch(html, /暂无组织记录/)
})

test('组织面板：真正的空数据与筛选无结果保留原空态文案', async () => {
  const empty = await renderComponent(component, stateCase())
  assert.match(empty, /暂无组织记录。/)
  assert.doesNotMatch(empty, /role="alert"/)
  assert.doesNotMatch(empty, /ui-state__retry/)

  const filtered = await renderComponent(component, stateCase({ keyword: '运维' }))
  assert.match(filtered, /没有匹配的组织单元。/)
  assert.doesNotMatch(filtered, /暂无组织记录/)
})

test('组织面板把重试原样转交给父组件（retry 重新发起同一个 loadOrganizations）', async () => {
  const panelSource = readFileSync(new URL('./OrganizationDirectoryPanel.vue', import.meta.url), 'utf8')
  assert.match(panelSource, /@retry="\$emit\('retry'\)"/)
  assert.ok(component.emits?.includes('retry'), 'OrganizationDirectoryPanel 必须声明 retry 事件')
})
