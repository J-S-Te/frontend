import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const filename = new URL('./BatchUserImportDialog.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'batch-import-runtime' })
const compiled = compileTemplate({
  source: descriptor.template.content,
  filename: 'BatchUserImportDialog.vue',
  id: 'batch-import-runtime',
  compilerOptions: { bindingMetadata: script.bindings },
})
assert.deepEqual(compiled.errors, [])

// Load only dependencies actually imported by the production SFC. A missing
// composable import must fail instead of being supplied by the test harness.
const imports = {}
for (const node of script.scriptSetupAst.filter(node => node.type === 'ImportDeclaration')) {
  const path = node.source.value
  let dependency
  if (path.endsWith('.vue')) {
    dependency = { default: path.includes('ConfirmDialog') ? {
      props: ['title', 'description'],
      render() { return Vue.h('section', { role: 'alertdialog' }, [this.title, this.description]) },
    } : { render: () => null } }
  } else if (path.startsWith('@/')) {
    dependency = path.includes('/api/')
      ? { createEmployeesBatch: () => { throw new Error('unexpected API write') } }
      : await import(new URL(`../../../../${path.slice(2)}`, filename))
  } else {
    dependency = path.startsWith('.') ? await import(new URL(path, filename)) : await import(path)
  }
  for (const specifier of node.specifiers) {
    imports[specifier.local.name] = specifier.type === 'ImportDefaultSpecifier'
      ? dependency.default : dependency[specifier.imported.name]
  }
}
const component = new Function(...Object.keys(imports), script.content
  .replace(/^import .*$/gm, '')
  .replace('export default', 'return'))(...Object.values(imports))
component.render = new Function('Vue', compiled.code
  .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
  .replace('export function render', 'return function render'))(Vue)

async function mountState(prepare = () => {}) {
  let state
  const events = []
  const app = Vue.createSSRApp({
    ...component,
    setup(props, context) {
      state = component.setup(props, { ...context, emit: (...args) => events.push(args) })
      prepare(state)
      return state
    },
  })
  return { html: await renderToString(app), state, events }
}

test('batch import opens at the upload step without setup errors', async () => {
  const { html, state } = await mountState()
  assert.match(html, /aria-label="批量导入用户"/)
  assert.match(html, /从 CSV 导入用户/)
  assert.equal(state.step.value, 1)
})

test('preview shows close confirmation without a failed import result', async () => {
  let pending
  const { html, state, events } = await mountState(state => {
    state.step.value = 2
    pending = state.close()
  })
  assert.match(html, /role="alertdialog"/)
  assert.match(html, /关闭导入？/)
  assert.deepEqual(events, [])
  state.cancelClose()
  await pending
  assert.deepEqual(events, [])
  const closing = state.close()
  state.acceptClose()
  await closing
  assert.deepEqual(events, [['close']])
})

test('successful results show the one-time credential close warning', async () => {
  let pending
  const { html, state, events } = await mountState(state => {
    state.step.value = 3
    state.submitResult.value = {
      createdCount: 1, requestedCount: 1, failedCount: 0,
      initialCredentials: [{ accountName: 'test', initialPassword: 'test-only' }],
    }
    pending = state.close()
  })
  assert.match(html, /role="alertdialog"/)
  assert.match(html, /关闭并放弃初始凭据？/)
  state.cancelClose()
  await pending
  assert.deepEqual(events, [])
  assert.equal(state.submitResult.value.initialCredentials.length, 1)
  const credential = state.submitResult.value.initialCredentials[0]
  const closing = state.close()
  state.acceptClose()
  await closing
  assert.deepEqual(events, [['close']])
  assert.equal(credential.initialPassword, '')
  assert.deepEqual(state.submitResult.value.initialCredentials, [])
})

test('upload closes directly and an in-flight submit cannot close', async () => {
  const { state, events } = await mountState()
  state.submitting.value = true
  await state.close()
  assert.deepEqual(events, [])
  state.submitting.value = false
  await state.close()
  assert.deepEqual(events, [['close']])
})
