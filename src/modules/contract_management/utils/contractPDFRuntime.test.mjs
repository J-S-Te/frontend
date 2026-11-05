import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 首屏体积回归：pdf.js主库必须留在预览时才下载的独立块里。
// 静态 import 会把它重新并回首屏 vendor（约430KB），未打开预览的页面也要下载。
test('pdf.js主库只在打开预览时动态加载且Worker保持同源', async () => {
  const source = await readFile(new URL('./contractPDFRuntime.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*import\s[^\n]*from\s*['"]pdfjs-dist/m,
    'pdf.js主库不得静态引入，否则重新进入首屏vendor块')
  assert.match(source, /import\(\s*['"]pdfjs-dist['"]\s*\)/,
    '必须通过动态import懒加载pdf.js主库')
  assert.match(source, /pdf\.worker\.min\.mjs\?worker&url/,
    'Worker必须作为同源资源打包，不得指向CDN')
  assert.doesNotMatch(source, /https?:\/\//,
    '不得把原件或Worker指向外部服务')
  assert.match(source, /GlobalWorkerOptions\.workerSrc/, '必须显式注册同源Worker地址')
})
