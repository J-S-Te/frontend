import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const view = read('./views/CustomerOpportunityView.vue')

const DRAFT_PAGE = /(?<![A-Za-z])page\.(number|total|size)/

// 分页条已统一到 shared/components/PaginationBar.vue（2026-11 三态/分页/反馈统一）：
// 视图只负责给出「展示源」和「翻页入口」，上一页 / 下一页的文案与禁用语义由组件自己保证
// （逐条行为见 shared/pagination-bar.test.mjs）。这里锁的是视图侧的契约：
//   · 展示源必须是 renderedPage（不是可能已被筛选复位的草稿 page）；
//   · 翻页入口必须是该列表自己的分页函数；
//   · 视图里不再手写禁用公式与加载占位。
const BARS = [
  ['客户列表分页', 'changeCustomerPage'],
  ['商机列表分页', 'changeOpportunityPage'],
]

function paginationBar(label) {
  const index = view.indexOf(`<PaginationBar class="crm-actions" label="${label}"`)
  assert.ok(index >= 0, `缺少分页条 ${label}`)
  const end = view.indexOf('/>', index)
  assert.ok(end > index)
  return view.slice(index, end)
}

test('客户与商机两个列表各有一条统一分页条，展示源是只读 renderedPage', () => {
  for (const [label, handler] of BARS) {
    const bar = paginationBar(label)
    assert.match(bar, /:page="renderedPage\.number"/, `${label}: 页码来自 renderedPage`)
    assert.match(bar, /:total="renderedPage\.total"/, `${label}: 总数来自 renderedPage`)
    assert.match(bar, /:page-size="renderedPage\.size"/, `${label}: 页容量来自 renderedPage`)
    assert.match(bar, /:loading="loading"/, `${label}: 加载态交给统一分页条`)
    assert.match(bar, new RegExp(`@change="${handler}"`), `${label}: 翻页走该列表自己的分页函数`)
  }
  // 视图不再自己算「下一页」是否禁用，也不再自己写页码文案。
  assert.equal((view.match(/renderedPage\.number \* renderedPage\.size/g) || []).length, 0)
  assert.doesNotMatch(view, /role="group" aria-label="客户列表分页"/)
  assert.doesNotMatch(view, /role="group" aria-label="商机列表分页"/)
  for (const [label] of BARS) assert.doesNotMatch(paginationBar(label), DRAFT_PAGE, `${label}: 不得用草稿 page 做展示或翻页基准`)
})

// 回归锁定：renderedPage 只在请求成功（或失败清空）后写入，请求开始路径绝不预写。
// 否则翻到第 3 页或点“查询”时会先闪一下“第 1 页，共 0 条”。
test('renderedPage 只在列表请求完成后写入，请求开始路径不预写', () => {
  const start = view.indexOf('async function loadCurrent(')
  assert.ok(start >= 0)
  const end = view.indexOf('async function syncPresaleURL', start)
  assert.ok(end > start)
  const body = view.slice(start, end)

  const assignments = [...body.matchAll(/Object\.assign\(renderedPage|renderedPage\.(?:number|size|total)\s*=/g)].map(
    (matched) => matched.index,
  )
  assert.equal(assignments.length, 3, '只允许客户成功、商机成功、失败清空三处写入')

  const firstAwait = body.indexOf('await ')
  assert.ok(firstAwait >= 0)
  for (const index of assignments) {
    assert.ok(index > firstAwait, 'renderedPage 不得在请求开始的同步路径里写入')
  }

  // 客户：写入在 await listCustomers 之后；商机：写入在 await listOpportunities 之后。
  const customerFetch = body.indexOf('await listCustomers(')
  const opportunityFetch = body.indexOf('await listOpportunities(')
  assert.ok(customerFetch >= 0 && opportunityFetch >= 0)
  assert.ok(assignments[0] > customerFetch, '客户列表成功后写入 renderedPage')
  assert.ok(assignments[1] > opportunityFetch, '商机列表成功后写入 renderedPage')
  // 失败清空发生在 catch 分支（请求结束后），不是请求开始。
  assert.ok(assignments[2] > body.indexOf('} catch (value)'), '失败清空必须留在 catch 分支')
  assert.match(body.slice(assignments[2], assignments[2] + 120), /number: 1, size: page\.size, total: 0/)
})

// 回归锁定：「下一页」禁用条件的基准必须是已渲染页（renderedPage）而不是草稿 page。
// 用草稿 page.size 时，用户改了筛选（草稿页码复位）但列表未刷新，禁用状态会算错。
// 现在公式只存在于 PaginationBar（由 :page/:page-size/:total 三个 prop 决定），
// 所以视图侧的约束是「三个 prop 同源于 renderedPage」，行为侧由
// shared/pagination-bar.test.mjs 的禁用边界用例锁定。
test('下一页禁用条件不再由视图手写，基准 props 同源于 renderedPage', () => {
  for (const [label] of BARS) {
    const bar = paginationBar(label)
    assert.match(bar, /:page="renderedPage\.number"/)
    assert.match(bar, /:page-size="renderedPage\.size"/)
    assert.match(bar, /:total="renderedPage\.total"/)
    assert.doesNotMatch(bar, /:page="page\./)
  }
  assert.doesNotMatch(view, /renderedPage\.number \* page\.size/)
})
