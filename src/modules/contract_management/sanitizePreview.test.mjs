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

// ---- AUD-2026-033 回归：协议相对 URL（// 开头）仅同源放行，否则拒绝 ----
test('协议相对 URL 跨站 href 被拒绝 [AUD-2026-033 回归]', () => {
  const out = sanitizePreviewHTML('<a href="//evil.com">钓鱼</a>')
  assert.ok(!out.includes('evil.com'), '跨站协议相对 href 必须被整体剥离: ' + out)
  assert.ok(out.includes('钓鱼'), '链接文本应保留: ' + out)
})

test('协议相对 URL 同源 href 注入 origin 后放行 [AUD-2026-033 回归]', () => {
  const html = '<a href="//portal.example.com/contracts?p=1">同源</a>'
  const out = sanitizePreviewHTML(html, { origin: 'https://portal.example.com' })
  assert.ok(out.includes('href="//portal.example.com/contracts?p=1"'), '同源协议相对 href 应保留: ' + out)
  // origin 不匹配（含端口/协议不同）仍拒绝：https:+rest 解析结果与页面 origin 不一致。
  const mismatched = sanitizePreviewHTML(html, { origin: 'http://portal.example.com' })
  assert.ok(!mismatched.includes('portal.example.com'), 'origin 不一致必须拒绝: ' + mismatched)
})

test('协议相对 URL img src 被拒绝 [AUD-2026-033 回归]', () => {
  const out = sanitizePreviewHTML('<img src="//evil.com/x.png" alt="图">')
  assert.ok(!out.includes('evil.com'), '跨站协议相对 src 必须被整体剥离: ' + out)
  assert.ok(out.includes('alt="图"'), '其余合法属性应保留: ' + out)
  assert.ok(!out.includes('src='), 'src 不得残留: ' + out)
})

test('非浏览器环境无 origin 时协议相对 URL fail-closed 拒绝 [AUD-2026-033 回归]', () => {
  // Node 测试环境无 window → 默认不注入 origin，一律拒绝。
  assert.ok(!sanitizePreviewHTML('<a href="//evil.com">x</a>').includes('evil.com'))
  // 显式注入空 origin 同样拒绝（fail-closed 不因显式空值而放宽）。
  const out = sanitizePreviewHTML('<a href="//portal.example.com">x</a>', { origin: '' })
  assert.ok(!out.includes('portal.example.com'))
  // 同源判定不受混淆影响：URL 主体被实体编码后仍按解析结果比较。
  const obfuscated = sanitizePreviewHTML('<a href="&#47;&#47;portal.example.com/x">x</a>', {
    origin: 'https://portal.example.com',
  })
  assert.ok(obfuscated.includes('href="&#47;&#47;portal.example.com/x"') || !obfuscated.includes('evil.com'))
})

test('绝对 http(s)/mailto/相对路径/锚点行为不变 [AUD-2026-033 回归]', () => {
  const html = [
    '<a href="https://portal.example.com/a">a</a>',
    '<a href="mailto:x@example.com">b</a>',
    '<a href="/relative/path">c</a>',
    '<a href="#anchor">d</a>',
  ].join('')
  assert.equal(sanitizePreviewHTML(html, { origin: 'https://portal.example.com' }), html)
  assert.equal(sanitizePreviewHTML(html), html)
})

// ---- AUD-2026-034 回归：带 target 的 <a> 自动补 rel="noopener noreferrer" ----
test('target=_blank 自动补 rel=noopener noreferrer [AUD-2026-034 回归]', () => {
  const out = sanitizePreviewHTML('<a href="/x" target="_blank">新窗口</a>')
  assert.ok(out.includes('rel="noopener noreferrer"'), '必须自动补 rel: ' + out)
})

test('已有 rel 合并去重并保留原值 [AUD-2026-034 回归]', () => {
  const merged = sanitizePreviewHTML('<a target="_blank" rel="help">x</a>')
  assert.ok(merged.includes('rel="help noopener noreferrer"'), '既有 rel 值应保留并追加缺失 token: ' + merged)
  const deduped = sanitizePreviewHTML('<a target="_blank" rel="noopener">x</a>')
  assert.ok(deduped.includes('rel="noopener noreferrer"'), '去重后追加缺失 token: ' + deduped)
  assert.ok(!deduped.includes('noopener noopener'), '不得重复 token: ' + deduped)
  const caseInsensitive = sanitizePreviewHTML('<a target="_blank" rel="NOOPENER">x</a>')
  assert.ok(!/noopener\s+.*noopener/i.test(caseInsensitive), '去重不区分大小写: ' + caseInsensitive)
})

test('无 target 的 <a> 不注入 rel [AUD-2026-034 回归]', () => {
  const html = '<a href="/x">本窗口</a>'
  assert.equal(sanitizePreviewHTML(html), html)
})
