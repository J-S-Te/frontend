import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { statusToneMap } from '../project_management/projectDisplay.js'

// 状态胶囊的单一色板契约：五档语义只存在于 main.css 的 --status-* token，
// 各子系统徽标只能消费 token；violet 退出状态体系，仅分类标签可用。
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const TONES = ['neutral', 'processing', 'success', 'warning', 'danger']
const SLOTS = ['bg', 'border', 'text', 'dot']
const mainCss = read('../platform/shared/styles/main.css')

test('五档语义 token 在明暗两套里都完整定义', () => {
  for (const tone of TONES) {
    for (const slot of SLOTS) {
      const name = '--status-' + tone + '-' + slot
      const count = mainCss.split(name + ':').length - 1
      assert.equal(count, 2, name + ' 应在浅色与深色各定义一次')
    }
  }
  assert.match(mainCss, /--radius-pill: 999px/)
})

test('各子系统徽标只消费 --status-* token', () => {
  const families = [
    '../project_management/styles/project-management.css',
    '../contract_management/styles/contract-management.css',
    '../customer_opportunity/styles/customer-opportunity.css',
    '../reimbursement/reimbursement.css',
    '../settlement/styles/settlement.css',
    '../data_analysis/styles/data-analysis.css',
    '../platform/styles/console.css',
  ]
  for (const family of families) {
    assert.match(read(family), /var\(--status-[a-z]+-(?:bg|text)\)/, family + ' 需要引用状态 token')
  }
})

test('项目管理状态映射收敛到五档，violet 不再表示状态', () => {
  const values = Object.values(statusToneMap)
  assert.ok(values.length > 30)
  for (const tone of new Set(values)) {
    assert.ok(TONES.includes(tone), '状态色调 ' + tone + ' 不在五档白名单内')
  }
  assert.equal(values.includes('violet'), false)
})
