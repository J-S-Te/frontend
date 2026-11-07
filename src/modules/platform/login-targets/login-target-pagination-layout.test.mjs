import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const moduleSource = read('./components/ApplicationLoginTargetModule.vue')
const styles = read('./styles/application-login-target.css')

// 登录目标页在 ≤720px 曾把页头、筛选工具条、分页页脚放进同一个
// 「align-items: stretch; flex-direction: column」分组。分页条是共享 PaginationBar
// 的 flex 行，被页面规则改成 column 后「上一页 / 页码 / 下一页 / 跳至 / 每页」会纵向
// 堆叠。这里锁住：窄屏只允许页头与工具条改纵向，分页页脚必须保持行方向。
test('≤720px 分页页脚不再被并入 flex-direction: column 分组', () => {
  const start = styles.indexOf('@media (max-width: 720px)')
  assert.ok(start >= 0, '缺少 ≤720px 媒体查询')
  const next = styles.indexOf('\n@media ', start + 1)
  const block = styles.slice(start, next === -1 ? undefined : next)

  const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const paginationRules = rules.filter(([, selector]) => /login-target-module__pagination/.test(selector))
  assert.ok(paginationRules.length >= 1, '窄屏仍应保留分页页脚自身的对齐规则')
  for (const [, selector, body] of paginationRules) {
    assert.doesNotMatch(body, /flex-direction:\s*column\s*;/, `分页页脚不得改纵向：${selector.trim()}`)
  }

  // 页头与筛选工具条仍按原设计纵向排列（这里只是确认摘出的是分页而不是全部）。
  const headerRule = rules.find(([, selector]) => /login-target-module__header/.test(selector))
  assert.ok(headerRule, '页头窄屏规则不应被误删')
  assert.match(headerRule[2], /flex-direction:\s*column/)
})

test('分页条在页脚里保持行方向并于窄屏左对齐', () => {
  assert.match(moduleSource, /<footer class="login-target-module__pagination">\s*<PaginationBar label="登录目标分页"/)
  const start = styles.indexOf('@media (max-width: 720px)')
  const next = styles.indexOf('\n@media ', start + 1)
  const block = styles.slice(start, next === -1 ? undefined : next)
  const paginationRule = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(([, selector]) => /login-target-module__pagination/.test(selector))
  assert.match(paginationRule[2], /justify-content:\s*flex-start/, '窄屏分页页脚应左对齐，避免只靠右显示')
})
