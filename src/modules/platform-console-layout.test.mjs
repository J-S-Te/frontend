import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matched = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source)
  assert.ok(matched, `缺少规则 ${selector}`)
  return matched[1]
}

// 回归锁定：页头与下方卡片的间距曾被写成 margin-bottom: 1px（几乎贴合），
// 标题区和内容区视觉上粘在一起。现统一为 16px。
test('平台控制台页头与内容间距为 16px，不再出现 1px 间距', () => {
  const css = read('./platform/styles/console.css')
  assert.match(ruleBody(css, '.console-page-head'), /margin-bottom:\s*16px/)
  assert.doesNotMatch(css, /(?<!-)\bmargin-bottom:\s*1px/, '不得再有 margin-bottom: 1px')
})

// 回归锁定：系统设置页只保留一层页面标题，且与审计页一致用 <h1>。
test('系统设置页标题使用 <h1>系统设置</h1>', () => {
  const view = read('./platform/views/PlatformConsoleView.vue')
  assert.match(view, /<h1>系统设置<\/h1>/)
})

// 回归锁定：视觉隐藏的 <h2> 只在 IAM tab 渲染——其余 10 个设置模块自身首个标题就是 <h2>，
// 再补一层同名同级标题会让读屏标题列表出现重复条目；条件必须同时包含 tab 守卫与 'iam'。
test('视觉隐藏的 <h2> 只在 IAM tab 渲染', () => {
  const view = read('./platform/views/PlatformConsoleView.vue')
  assert.match(
    view,
    /<h2 v-if="hasActiveFilteredSettingsTab && activeSettingsTab === 'iam'" class="shared-visually-hidden">/,
  )
  assert.equal((view.match(/shared-visually-hidden/g) || []).length, 1, '只允许一处视觉隐藏标题')
  const css = read('./shared/styles/global-ux.css')
  const hidden = ruleBody(css, '.shared-visually-hidden')
  // 必须保留在可访问性树中：用 1px 裁剪盒，而不是 display:none / visibility:hidden。
  assert.match(hidden, /position:\s*absolute/)
  assert.match(hidden, /clip-path:\s*inset\(50%\)/)
  assert.doesNotMatch(hidden, /display:\s*none|visibility:\s*hidden/)
})
