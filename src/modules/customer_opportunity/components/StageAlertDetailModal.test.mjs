import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

// Golden 按北京时间录制；固定测试时区，避免 Docker UTC 与开发机输出不同。
process.env.TZ = 'Asia/Shanghai'

const SRC = new URL('../../../', import.meta.url).pathname

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier}`)
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
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

// golden 为提取前 ProjectManagementView.vue 操作详情抽屉片段的 SSR 渲染结果（批次 3 第三步采集），
// golden 为提取前 CustomerOpportunityView.vue 阶段超时告警详情弹窗片段的 SSR 渲染结果
// （批次 3 CRM 第三步采集）；提取后本组件必须逐字节复现同一 DOM。
const GOLDENS = {
  "unread": "<div class=\"crm-modal\"><article><h2>阶段超时告警详情</h2><dl><dt>商机编号</dt><dd>OPP-2026-001</dd><dt>阶段</dt><dd>STAGE_PRESALE_1</dd><dt>状态</dt><dd>已触发（未读）</dd><dt>阶段起算</dt><dd>2026年10月20日 16:00</dd><dt>应提醒时间</dt><dd>2026年10月27日 16:00</dd><dt>阈值版本</dt><dd>v3</dd><dt>触发时间</dt><dd>2026年10月27日 17:00</dd><dt>已读时间</dt><dd>—</dd></dl><div class=\"crm-actions\"><button>关闭</button><button class=\"primary\">标为已读并打开商机</button></div></article></div>",
  "read": "<div class=\"crm-modal\"><article><h2>阶段超时告警详情</h2><dl><dt>商机编号</dt><dd>OPP-2026-002</dd><dt>阶段</dt><dd>STAGE_PRESALE_2</dd><dt>状态</dt><dd>已触发（已读）</dd><dt>阶段起算</dt><dd>2026年10月18日 16:00</dd><dt>应提醒时间</dt><dd>2026年10月25日 16:00</dd><dt>阈值版本</dt><dd>v2</dd><dt>触发时间</dt><dd>2026年10月25日 17:00</dd><dt>已读时间</dt><dd>2026年10月25日 18:00</dd></dl><div class=\"crm-actions\"><button>关闭</button><button class=\"primary\">打开商机</button></div></article></div>",
  "sparse": "<div class=\"crm-modal\"><article><h2>阶段超时告警详情</h2><dl><dt>商机编号</dt><dd>OPP-2026-003</dd><dt>阶段</dt><dd>STAGE_PRESALE_3</dd><dt>状态</dt><dd>已取消</dd><dt>阶段起算</dt><dd>—</dd><dt>应提醒时间</dt><dd>—</dd><dt>阈值版本</dt><dd></dd><dt>触发时间</dt><dd>—</dd><dt>已读时间</dt><dd>—</dd></dl><div class=\"crm-actions\"><button>关闭</button><button class=\"primary\">打开商机</button></div></article></div>"
}
const CASES = {
  "unread": {
    "alert": {
      "opportunity_no": "OPP-2026-001",
      "stage": "STAGE_PRESALE_1",
      "status": "UNREAD",
      "basis_at": "2026-10-20T08:00:00Z",
      "due_at": "2026-10-27T08:00:00Z",
      "threshold_version": "v3",
      "sent_at": "2026-10-27T09:00:00Z",
      "read_at": null
    }
  },
  "read": {
    "alert": {
      "opportunity_no": "OPP-2026-002",
      "stage": "STAGE_PRESALE_2",
      "status": "READ",
      "basis_at": "2026-10-18T08:00:00Z",
      "due_at": "2026-10-25T08:00:00Z",
      "threshold_version": "v2",
      "sent_at": "2026-10-25T09:00:00Z",
      "read_at": "2026-10-25T10:00:00Z"
    }
  },
  "sparse": {
    "alert": {
      "opportunity_no": "OPP-2026-003",
      "stage": "STAGE_PRESALE_3",
      "status": "CANCELLED",
      "basis_at": "",
      "due_at": "",
      "threshold_version": "",
      "sent_at": null,
      "read_at": null
    }
  }
}

const component = await loadSfc(new URL('./StageAlertDetailModal.vue', import.meta.url).pathname)

test('阶段告警详情复现提取前 golden：未读告警', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES.unread) }))
  assert.equal(html, GOLDENS.unread)
})

test('阶段告警详情复现提取前 golden：已读告警', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES.read) }))
  assert.equal(html, GOLDENS.read)
})

test('阶段告警详情复现提取前 golden：已取消且字段缺失', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES.sparse) }))
  assert.equal(html, GOLDENS.sparse)
})

test('阶段告警详情以事件关闭与打开商机', () => {
  const source = readFileSync(new URL('./StageAlertDetailModal.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("emit('close')"))
  assert.ok(source.includes("emit('open')"))
})
