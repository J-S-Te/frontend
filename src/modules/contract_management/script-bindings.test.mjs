import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse as parseSFC, compileScript } from '@vue/compiler-sfc'
import { parse } from '@babel/parser'
import { walkIdentifiers } from '@vue/compiler-core'

const filename = new URL('./views/ContractManagementView.vue', import.meta.url)
const source = await readFile(filename, 'utf8')
const browserGlobals = new Set(`undefined NaN Infinity console window document navigator location history
  localStorage sessionStorage setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
  fetch Headers Request Response FormData Blob File URL URLSearchParams AbortController Intl Date Math Number String
  Boolean Object Array Set Map WeakMap WeakSet Promise Error TypeError RegExp JSON BigInt Symbol parseInt parseFloat
  encodeURIComponent decodeURIComponent btoa atob structuredClone`.split(/\s+/))

function unresolvedReferences(code) {
  const { descriptor } = parseSFC(code, { filename: filename.pathname })
  const script = compileScript(descriptor, { id: 'contract-script-bindings' })
  const known = Object.fromEntries(Object.keys(script.bindings).map((name) => [name, 1]))
  const unresolved = new Set()
  walkIdentifiers(parse(descriptor.scriptSetup.content, { sourceType: 'module' }).program,
    (node, _parent, _stack, isReference, isLocal) => {
      if (isReference && !isLocal && !known[node.name] && !browserGlobals.has(node.name)) unresolved.add(node.name)
    }, false, [], known)
  return [...unresolved].sort()
}

test('contract view callbacks reference imported functions, lexical bindings or browser globals', () => {
  assert.deepEqual(unresolvedReferences(source), [])
})

test('binding check catches the missing opportunity import that Vite alone does not reject', () => {
  const withoutImport = source.replace(/^  listMyOpportunities,\n/m, '')
  assert.deepEqual(unresolvedReferences(withoutImport), ['listMyOpportunities'])
})
