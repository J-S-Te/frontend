import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { statusTone } from './utils/statusTone.js'

const SRC = new URL('../../', import.meta.url).pathname
const COMPONENTS = join(SRC, 'modules/shared/components')

function compile(file) {
  const source = readFileSync(file, 'utf8')
  const { descriptor, errors } = parse(source, { filename: file })
  assert.deepEqual(errors, [], file)
  const script = compileScript(descriptor, { id: file })
  const template = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(template.errors, [], file)
  return { source, descriptor, script, template }
}

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
  assert.deepEqual(compiled.errors, [])
  const imports = {}
  for (const node of script.scriptSetupAst.filter((item) => item.type === 'ImportDeclaration')) {
    const dependency = await resolveDependency(file, node.source.value)
    for (const spec of node.specifiers) {
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier' ? (dependency.default ?? dependency) : dependency[spec.imported.name]
    }
  }
  for (const match of script.content.matchAll(/import \{([^}]+)\} from ['"]vue['"]/g)) {
    for (const part of match[1].split(',')) {
      const [imported, local = imported] = part.trim().split(/\s+as\s+/)
      if (imported && !(local in imports)) imports[local] = Vue[imported]
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

async function render(component, props, slots = {}) {
  return renderToString(Vue.createSSRApp({
    render: () => Vue.h(component, props, slots),
  }))
}

test('共享状态色调只按语义映射，未知状态回落 neutral', () => {
  assert.equal(statusTone('APPROVED'), 'success')
  assert.equal(statusTone('REJECTED'), 'danger')
  assert.equal(statusTone('PENDING_REVIEW'), 'warning')
  assert.equal(statusTone('unknown-new-status'), 'neutral')
  assert.equal(statusTone('', 'warning'), 'warning')
  assert.equal(statusTone('', 'not-a-tone'), 'neutral')
})

test('SegmentedTabs 具备 tablist/tab、aria-selected、roving tabindex 与方向键契约', async () => {
  const file = join(COMPONENTS, 'SegmentedTabs.vue')
  const { source } = compile(file)
  for (const marker of ['role="tablist"', 'role="tab"', 'aria-selected', ':tabindex=', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.ok(source.includes(marker), `SegmentedTabs 缺少 ${marker}`)
  }
  const component = await loadSfc(file)
  const html = await render(component, {
    modelValue: 'ledger',
    ariaLabel: '开票数据',
    items: [
      { value: 'requests', label: '开票申请' },
      { value: 'ledger', label: '发票台账', count: 3 },
    ],
  })
  assert.match(html, /role="tablist"/)
  assert.match(html, /aria-label="开票数据"/)
  assert.match(html, /role="tab"/)
  assert.match(html, /aria-selected="true"/)
  assert.match(html, /tabindex="0"/)
  assert.match(html, /tabindex="-1"/)
  assert.match(html, /aria-hidden="true">3</)
})

test('ToggleSwitch 使用 switch 语义并暴露 aria-checked/disabled', async () => {
  const file = join(COMPONENTS, 'ToggleSwitch.vue')
  const { source } = compile(file)
  for (const marker of ['role="switch"', 'aria-checked', ':disabled=', 'aria-busy']) {
    assert.ok(source.includes(marker), `ToggleSwitch 缺少 ${marker}`)
  }
  const component = await loadSfc(file)
  const html = await render(component, { modelValue: true, label: '启用自动审批' })
  assert.match(html, /role="switch"/)
  assert.match(html, /aria-checked="true"/)
  assert.match(html, /aria-label="启用自动审批"/)
  assert.match(html, /ui-toggle-switch__track/)
})

test('StatusBadge 将状态映射为语义 tone，并允许显式覆盖', async () => {
  const file = join(COMPONENTS, 'StatusBadge.vue')
  compile(file)
  const component = await loadSfc(file)
  const danger = await render(component, { status: 'REJECTED', label: '已驳回' })
  assert.match(danger, /ui-status-badge--danger/)
  assert.match(danger, />已驳回</)
  const overridden = await render(component, { status: 'APPROVED', tone: 'info', label: '人工标记' })
  assert.match(overridden, /ui-status-badge--info/)
})

test('FormDialog 提供 Teleport、dialog 语义、顶层 Esc、焦点陷阱与还焦契约', async () => {
  const file = join(COMPONENTS, 'FormDialog.vue')
  const { source } = compile(file)
  for (const marker of [
    '<Teleport to="body">',
    'role="dialog"',
    'aria-modal="true"',
    'dialogLayers',
    'bodyScrollLock',
    "event.key === 'Escape'",
    "event.key !== 'Tab'",
    'previousFocus',
    'focusInitial',
  ]) {
    assert.ok(source.includes(marker), `FormDialog 缺少 ${marker}`)
  }
  assert.match(source, /requestClose\('backdrop'\)/)
  assert.match(source, /overlayClass/)
  assert.match(source, /panelClass/)
})
