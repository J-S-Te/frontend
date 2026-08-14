import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizePreviewHTML } from './utils/sanitizePreview.js'

test('保留静态排版标签', () => {
  const html = '<div class="page"><table><tr><td>合同编号：HT-1</td></tr></table></div>'
  assert.equal(sanitizePreviewHTML(html), html)
})

test('移除 script 与事件属性', () => {
  const html = '<div onclick="steal()">合同</div><script>alert(1)</script><img src="/logo.png" onerror="alert(2)">'
  const out = sanitizePreviewHTML(html)
  assert.ok(!out.includes('<script') && !out.includes('alert(1)'))
  assert.ok(!out.includes('onclick') && !out.includes('onerror'))
  assert.ok(out.includes('src="/logo.png"'))
})

test('移除 javascript:/data: URL', () => {
  const html = '<a href="javascript:alert(1)">点我</a><a href="/contracts">正常</a><img src="data:text/html;base64,xxx">'
  const out = sanitizePreviewHTML(html)
  assert.ok(!out.includes('javascript:'))
  assert.ok(!out.includes('data:'))
  assert.ok(out.includes('href="/contracts"'))
})

test('移除 iframe 与其内容', () => {
  const html = '<p>正文</p><iframe src="https://evil.example"></iframe><p>结尾</p>'
  const out = sanitizePreviewHTML(html)
  assert.ok(!out.includes('iframe'))
  assert.ok(out.includes('正文') && out.includes('结尾'))
})

test('非字符串输入返回空', () => {
  assert.equal(sanitizePreviewHTML(null), '')
  assert.equal(sanitizePreviewHTML(undefined), '')
})
