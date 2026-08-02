import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const styles = await readFile(new URL('./styles/contract-management.css', import.meta.url), 'utf8')

test('contract operation prompts are centered in the viewport', () => {
  assert.match(styles, /\.contract-toast\{[^}]*top:50%;left:50%;[^}]*transform:translate\(-50%,-50%\)/)
  assert.doesNotMatch(styles, /\.contract-toast\{[^}]*(?:right|bottom):25px/)
  assert.match(styles, /\.contract-toast-enter-from[^}]*translate\(-50%,calc\(-50% \+ 8px\)\)/)
})
