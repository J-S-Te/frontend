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

// 回归锁定：标题层级由设置模块自身连续表达，不再用视觉隐藏 <h2> 补 IAM 的层级。
test('设置页标题层级由模块自身 h2/h3 连续表达，不再使用视觉隐藏标题', () => {
  const view = read('./platform/views/PlatformConsoleView.vue')
  assert.doesNotMatch(view, /shared-visually-hidden/, '设置页不再补视觉隐藏标题')
  const iam = read('./platform/iam/components/IamSettingsModule.vue')
  assert.match(iam, /<h2 id="iam-management-guide-title">按归属、职责和例外分层管理<\/h2>/)
  assert.doesNotMatch(iam, /<h3 id="iam-management-guide-title">/)
})
