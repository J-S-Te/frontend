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

// ---- SEC-X1 回归：属性之间无空白的事件载荷（旧正则沙箱的绕过路径）必须被拒绝 ----
test('相邻属性载荷 "onerror 与 /onerror 被拒绝 [SEC-X1 回归]', () => {
  const payloads = [
    '<img src="/nope.png"onerror="alert(1)">',
    '<img src="/nope.png" onerror=alert(1)>',
    '<img src="/nope.png" /onerror=alert(1)>',
    '<img src="/nope.png"/onerror="alert(1)">',
    '<img/src="/nope.png"/onerror=alert(1)>',
    '<IMG SRC="/nope.png" ONERROR=alert(1)>',
    '<div data-x="1"onclick="alert(1)">文本</div>',
  ]
  for (const payload of payloads) {
    const out = sanitizePreviewHTML(payload)
    assert.ok(!/on[a-z]+\s*=/i.test(out), '事件属性必须被剥离: ' + out)
    assert.ok(!out.includes('alert(1)'), '事件载荷不得残留: ' + out)
  }
  assert.ok(sanitizePreviewHTML(payloads[0]).includes('src="/nope.png"'))
})

test('<details open/ontoggle 相邻属性载荷被拒绝 [SEC-X1 回归]', () => {
  const out = sanitizePreviewHTML('<details open/ontoggle="alert(1)"><summary>标题</summary>正文</details>')
  assert.ok(!out.includes('ontoggle'), 'ontoggle 必须被剥离: ' + out)
  assert.ok(!/on[a-z]+\s*=/i.test(out), '事件属性必须被剥离: ' + out)
  assert.ok(out.includes('<details open>'), '无害的 open 属性与结构应保留: ' + out)
  assert.ok(out.includes('正文'), '正文内容应保留: ' + out)
})

test('实体/控制符混淆的危险 URL 被拒绝 [SEC-X1 回归]', () => {
  const payloads = [
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="javascript&colon;alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href=" javascript:alert(1)">x</a>',
    '<a href="\u0000javascript:alert(1)">x</a>',
  ]
  for (const payload of payloads) {
    const out = sanitizePreviewHTML(payload)
    assert.ok(!out.includes('alert(1)'), '危险 URL 必须被整体剥离: ' + out)
    assert.ok(!/href\s*=\s*"[^"]*script/i.test(out), 'href 不得保留脚本 scheme: ' + out)
  }
})

test('svg/math 外国内容中的事件载荷被整体丢弃 [SEC-X1 回归]', () => {
  assert.equal(sanitizePreviewHTML('<svg/onload=alert(1)>'), '')
  const out = sanitizePreviewHTML('<p>前</p><svg><g onload=alert(1)></g></svg><p>后</p>')
  assert.ok(!out.includes('onload'), 'svg 内容必须整体丢弃: ' + out)
  assert.ok(out.includes('前') && out.includes('后'), '被禁元素外的内容应保留: ' + out)
})
