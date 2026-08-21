import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./components/ContractDocumentPreview.vue', import.meta.url), 'utf8')

test('contract document preview offers bounded zoom controls', () => {
  assert.match(source, /const minimumZoom = 40/)
  assert.match(source, /const maximumZoom = 200/)
  assert.match(source, /@click="zoomOut"/)
  assert.match(source, /@click="zoomIn"/)
  assert.match(source, /\{\{ zoomPercent \}\}%/)
  assert.match(source, /@click="fitPage">适合页面/)
})

test('contract document preview supports native and fallback fullscreen display', () => {
  assert.match(source, /root\.value\?\.requestFullscreen/)
  assert.match(source, /document\.exitFullscreen\(\)/)
  assert.match(source, /is-fullscreen-fallback/)
  assert.match(source, /isFullscreen \? '退出全屏' : '全屏显示'/)
})

test('contract document preview sanitizes HTML before rendering it', () => {
  assert.match(source, /import \{ sanitizePreviewHTML \} from '\.\.\/utils\/sanitizePreview\.js'/)
  assert.match(source, /const sanitizedHtml = computed\(\(\) => sanitizePreviewHTML\(props\.html\)\)/)
  assert.match(source, /v-html="sanitizedHtml"/)
  assert.doesNotMatch(source, /v-html="(?:props\.)?html"/)
})
