import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 分类标签与状态五档必须分家：分类只用 --tag-*，状态只用 --status-*。
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const mainCss = read('../platform/shared/styles/main.css')
const pmCss = read('./styles/project-management.css')

const FAMILIES = ['person', 'equipment', 'credential', 'testing', 'system', 'other']

test('分类标签 token 在明暗两套里都定义', () => {
  for (const family of FAMILIES) {
    for (const slot of ['text', 'bg', 'border']) {
      const name = '--tag-' + family + '-' + slot
      assert.equal(mainCss.split(name + ':').length - 1, 2, name + ' 应有明暗两套')
    }
  }
})

test('分类样式不得引用状态 token', () => {
  const start = pmCss.indexOf('.pm-kind-pill {')
  assert.ok(start > 0)
  const block = pmCss.slice(start)
  assert.doesNotMatch(block, /var\(--status-/) 
  assert.match(block, /var\(--tag-person-text\)/)
  assert.match(block, /var\(--tag-credential-text\)/)
  assert.match(block, /border-radius: var\(--pm-r-full\)/)
})

test('资源类型与编码不再共用同一种状态胶囊', () => {
  const view = read('./views/ProjectManagementView.vue')
  assert.match(view, /pm-kind-pill/)
  assert.match(view, /<CodePills :codes="item\.codes \|\| \[\]" categorized \/>/)
})
