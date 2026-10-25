import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

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
// 提取后本组件必须逐字节复现同一 DOM；有意变更须同步重采 golden。
const GOLDENS = {
  "allocation-item": "<div class=\"pm-overlay\"><aside class=\"pm-drawer\"><header><div><span>@SECTION allocation</span><h2>SI/1 环境检测</h2></div><button class=\"pm-icon-button\" aria-label=\"关闭\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><div class=\"pm-drawer-body\"><section class=\"pm-drawer-hero\"><span class=\"pm-badge neutral\">待分配</span><p><!--[-->甲醛、苯系物检测<!--]--><span class=\"pm-cell-warning\">排期冲突：与 SI/2 设备重叠</span></p><div class=\"pm-progress\"><i style=\"width:40%;\"></i></div><b>40% 已完成</b></section><dl><!--[--><div><dt>服务项编号</dt><dd><!--[-->SI/1<!--]--></dd></div><div><dt>团队负责人</dt><dd><!--[-->张三<!--]--></dd></div><div><dt>工程师</dt><dd><!--[--><span class=\"pm-code-pills\"><!--[--><span class=\"pm-code-pill\">李四</span><span class=\"pm-code-pill\">王五</span><!--]--></span><!--]--></dd></div><div><dt>实施人员</dt><dd><!--[--><span>—</span><!--]--></dd></div><div><dt>测试模式</dt><dd><!--[-->标准方法<!--]--></dd></div><!--]--></dl></div><footer><button class=\"pm-button\">关闭</button></footer></aside></div>",
  "qualifications-codes": "<div class=\"pm-overlay\"><aside class=\"pm-drawer\"><header><div><span>@SECTION qualifications</span><h2>环境检测仪</h2></div><button class=\"pm-icon-button\" aria-label=\"关闭\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><div class=\"pm-drawer-body\"><section class=\"pm-drawer-hero\"><span class=\"pm-badge neutral\">有效</span><p><!--[--><span class=\"pm-code-pills\"><!--[--><span class=\"pm-code-pill\">PEN-TEST</span><span class=\"pm-code-pill\">EQ-CERT</span><!--]--></span><!--]--><!--v-if--></p><div class=\"pm-progress\"><i style=\"width:0%;\"></i></div><b>0% 已完成</b></section><dl><!--[--><div><dt>资源类型</dt><dd><!--[-->设备能力<!--]--></dd></div><div><dt>能力编码</dt><dd><!--[--><span class=\"pm-code-pills\"><!--[--><span class=\"pm-code-pill\">PEN-TEST</span><span class=\"pm-code-pill\">EQ-CERT</span><!--]--></span><!--]--></dd></div><div><dt>检定有效期</dt><dd><!--[-->2026-12-31<!--]--></dd></div><!--]--></dl></div><footer><button class=\"pm-button\">关闭</button></footer></aside></div>",
  "empty-detail-and-warning": "<div class=\"pm-overlay\"><aside class=\"pm-drawer\"><header><div><span>@SECTION reports</span><h2>SI/3 报告编制</h2></div><button class=\"pm-icon-button\" aria-label=\"关闭\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><div class=\"pm-drawer-body\"><section class=\"pm-drawer-hero\"><span class=\"pm-badge neutral\">编制中</span><p><!--[--><span>—</span><!--]--><!--v-if--></p><div class=\"pm-progress\"><i style=\"width:100%;\"></i></div><b>100% 已完成</b></section><dl><!--[--><div><dt>报告阶段</dt><dd><!--[-->COMPILING<!--]--></dd></div><!--]--></dl></div><footer><button class=\"pm-button\">关闭</button></footer></aside></div>",
  "minimal": "<div class=\"pm-overlay\"><aside class=\"pm-drawer\"><header><div><span>unknown-section</span><h2>未知分区行</h2></div><button class=\"pm-icon-button\" aria-label=\"关闭\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><div class=\"pm-drawer-body\"><section class=\"pm-drawer-hero\"><span class=\"pm-badge neutral\"></span><p><!--[--><!--]--><!--v-if--></p><div class=\"pm-progress\"><i style=\"width:0%;\"></i></div><b>0% 已完成</b></section><dl><!--[--><!--]--></dl></div><footer><button class=\"pm-button\">关闭</button></footer></aside></div>"
}
const CASES = {
  "allocation-item": {
    "detail": {
      "section": "allocation",
      "row": {
        "id": "SI/1",
        "name": "SI/1 环境检测",
        "state": "待分配",
        "detail": "甲醛、苯系物检测",
        "warning": "排期冲突：与 SI/2 设备重叠",
        "progress": 40
      }
    },
    "fields": [
      {
        "label": "服务项编号",
        "value": "SI/1"
      },
      {
        "label": "团队负责人",
        "value": "张三"
      },
      {
        "label": "工程师",
        "value": [
          "李四",
          "王五"
        ]
      },
      {
        "label": "实施人员",
        "value": []
      },
      {
        "label": "测试模式",
        "value": "标准方法"
      }
    ]
  },
  "qualifications-codes": {
    "detail": {
      "section": "qualifications",
      "row": {
        "id": "EQ-1",
        "name": "环境检测仪",
        "state": "有效",
        "detail": [
          "PEN-TEST",
          "EQ-CERT"
        ],
        "progress": 0
      }
    },
    "fields": [
      {
        "label": "资源类型",
        "value": "设备能力"
      },
      {
        "label": "能力编码",
        "value": [
          "PEN-TEST",
          "EQ-CERT"
        ]
      },
      {
        "label": "检定有效期",
        "value": "2026-12-31"
      }
    ]
  },
  "empty-detail-and-warning": {
    "detail": {
      "section": "reports",
      "row": {
        "id": "SI/3",
        "name": "SI/3 报告编制",
        "state": "编制中",
        "detail": [],
        "warning": "",
        "progress": 100
      }
    },
    "fields": [
      {
        "label": "报告阶段",
        "value": "COMPILING"
      }
    ]
  },
  "minimal": {
    "detail": {
      "section": "unknown-section",
      "row": {
        "name": "未知分区行",
        "state": "",
        "detail": "",
        "progress": 0
      }
    },
    "fields": []
  }
}

const component = await loadSfc(new URL('./OperationDetailDrawer.vue', import.meta.url).pathname)

const { operationSectionLabel } = await import('../projectDisplay.js')

function expected(key, section) {
  return GOLDENS[key].replace(`@SECTION ${section}`, operationSectionLabel(section))
}

test('操作详情抽屉复现提取前 golden：服务项详情与警告', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES['allocation-item']) }))
  assert.equal(html, expected('allocation-item', 'allocation'))
})

test('操作详情抽屉复现提取前 golden：能力编码数组渲染', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES['qualifications-codes']) }))
  assert.equal(html, expected('qualifications-codes', 'qualifications'))
})

test('操作详情抽屉复现提取前 golden：空详情数组与 100% 进度', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES['empty-detail-and-warning']) }))
  assert.equal(html, expected('empty-detail-and-warning', 'reports'))
})

test('操作详情抽屉复现提取前 golden：未知分区与空字段', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, CASES['minimal']) }))
  assert.equal(html, GOLDENS['minimal'].replace('unknown-section', operationSectionLabel('unknown-section')))
})

test('operationSectionLabel 的分区文案与提取前一致（未知分区原样返回）', () => {
  assert.equal(operationSectionLabel('allocation'), '任务分配')
  assert.equal(operationSectionLabel('exceptions'), '偏离评审')
  assert.equal(operationSectionLabel('reports'), '报告与收尾')
  assert.equal(operationSectionLabel('no-such-section'), '事项详情')
})

test('操作详情抽屉以 close 事件关闭（遮罩、头部与页脚各自发出）', () => {
  const drawerSource = readFileSync(new URL('./OperationDetailDrawer.vue', import.meta.url), 'utf8')
  const count = drawerSource.split("$emit('close')").length - 1
  assert.ok(count >= 3, 'backdrop/header/footer must each emit close')
})
