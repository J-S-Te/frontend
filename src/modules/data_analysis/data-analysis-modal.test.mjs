import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// 取选择器对应的声明体（选择器后第一个 {...}），保留后代选择器与裸选择器的区别。
function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matched = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source)
  assert.ok(matched, `缺少规则 ${selector}`)
  return matched[1]
}

// 回归锁定：弹窗遮罩曾是低层级裸样式，被 64px 吸顶顶栏切成上下两截、且贴边不可滚。
// 现要求遮罩 z-index 高于顶栏，并用顶部内距让开顶栏高度。
test('数据看板弹窗遮罩层级高于吸顶顶栏，并让开 64px 顶栏', () => {
  const css = read('./styles/data-analysis.css')
  const backdrop = ruleBody(css, '.da-modal-backdrop')
  assert.match(backdrop, /position:\s*fixed/)
  assert.match(backdrop, /inset:\s*0/)
  assert.match(backdrop, /z-index:\s*1000/)

  const topbar = ruleBody(css, '.da-topbar')
  const topbarZ = Number((/z-index:\s*(\d+)/.exec(topbar) || [])[1])
  const backdropZ = Number((/z-index:\s*(\d+)/.exec(backdrop) || [])[1])
  assert.ok(Number.isFinite(topbarZ) && Number.isFinite(backdropZ))
  assert.ok(backdropZ > topbarZ, '遮罩必须盖住吸顶顶栏')

  const paddingTop = Number((/padding:\s*(\d+)px/.exec(backdrop) || [])[1])
  assert.ok(Number.isFinite(paddingTop), '遮罩必须声明带数值的 padding')
  assert.ok(paddingTop >= 64, `遮罩顶部内距 ${paddingTop}px 必须让开 64px 顶栏`)
})

// 回归锁定：高度上限必须挂在 `.da-modal-backdrop .da-modal` 后代选择器上。
// 裸 `.da-modal`（权重 0-1-0）会被 `.portal-dialog > article`（权重 0-1-1）覆盖，
// 表现为长表单弹窗超出视口且无法滚动。
test('数据看板弹窗高度上限由后代选择器声明，裸 .da-modal 不再带 max-height', () => {
  const css = read('./styles/data-analysis.css')
  const scoped = ruleBody(css, '.da-modal-backdrop .da-modal')
  assert.match(scoped, /max-height:\s*calc\(100vh - \d+px\)/)
  assert.doesNotMatch(ruleBody(css, '.da-modal'), /max-height/)
})
