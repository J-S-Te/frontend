import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const authSource = await readFile(new URL('../api/auth.js', import.meta.url), 'utf8')
const principalSource = await readFile(new URL('./principal.js', import.meta.url), 'utf8')

test('successful login clears the previous browser authorization snapshot before redirect', () => {
  assert.match(authSource, /if \(!response\.ok\)[\s\S]*advanceBrowserSessionGeneration\(\)[\s\S]*return \{\s*body,/)
})

test('logout clears authorization state for both successful and already-invalid sessions', () => {
  assert.match(authSource, /if \(response\.status === 401\) \{\s*advanceBrowserSessionGeneration\(\)/)
  assert.match(authSource, /advanceBrowserSessionGeneration\(\)\s*broadcastSessionEnded\('manual-logout'\)/)
})

test('late principal responses cannot repopulate a cache cleared during account switching', () => {
  assert.match(principalSource, /const requestedGeneration = cacheGeneration/)
  assert.match(principalSource, /if \(requestedGeneration !== cacheGeneration\) return principal\.value/)
  assert.match(principalSource, /pendingFetch\?\.generation === cacheGeneration/)
  assert.match(principalSource, /cacheGeneration \+= 1/)
})
