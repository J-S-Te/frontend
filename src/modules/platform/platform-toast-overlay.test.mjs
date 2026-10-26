import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'

const source = readFileSync(new URL('./views/PlatformConsoleView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const compiled = compileTemplate({ source: descriptor.template.content, filename: 'PlatformConsoleView.vue', id: 'platform-toast' })
const css = readFileSync(new URL('./styles/console.css', import.meta.url), 'utf8')
function findToast(node, ancestors = []) {
  if (node.type === 1 && node.props.some(p => p.name === 'class' && p.value?.content === 'console-toast')) return { node, ancestors }
  for (const child of node.children || []) {
    const found = findToast(child, [...ancestors, node])
    if (found) return found
  }
}

test('platform feedback is teleported to body outside page stacking contexts', () => {
  assert.deepEqual(compiled.errors, [])
  const toast = findToast(baseParse(descriptor.template.content))
  assert.ok(toast, 'production template must render feedback')
  const teleport = toast.ancestors.find(node => node.tag === 'Teleport')
  assert.ok(teleport, 'feedback must escape the console stacking context')
  assert.ok(teleport.props.some(p => p.name === 'to' && p.value?.content === 'body'))
  assert.ok(toast.node.props.some(p => p.name === 'role' && p.value?.content === 'status'))
})

test('all toast layer declarations stay above operation and shared confirmation dialogs', () => {
  const layers = [...css.matchAll(/\.console-toast\s*\{([^}]+)\}/g)]
    .flatMap(match => [...match[1].matchAll(/z-index:\s*(\d+)/g)].map(value => Number(value[1])))
  assert.ok(layers.length)
  for (const layer of layers) assert.ok(layer > 10000, `toast z-index ${layer} can be covered by a confirmation`)
})

test('feedback stays at the top on desktop and mobile without intercepting actions', () => {
  const rules = [...css.matchAll(/\.console-toast\s*\{([^}]+)\}/g)].map(match => match[1]).join('\n')
  assert.match(rules, /top:\s*(?:max\()?24px/)
  assert.doesNotMatch(rules, /bottom:\s*\d+px/)
  assert.match(rules, /pointer-events:\s*none/)
  assert.match(rules, /overflow-wrap:\s*anywhere/)
})
