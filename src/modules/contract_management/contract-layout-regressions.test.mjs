import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const styles = read('./styles/contract-management.css')
const paymentSummary = read('./components/PaymentTermsSummary.vue')

// P2⑤：付款计划表继承 .contract-data-table 的 980px 最小宽度，直接放进合同详情
// 模态弹窗会把整个弹窗撑出横向滚动。这里锁住「表格外面有局部滚动容器」。
test('付款计划表格被局部横向滚动容器包住，不撑破合同详情弹窗', () => {
  assert.match(
    paymentSummary,
    /<div v-else class="contract-payment-scroll" data-table-scroll>[\s\S]*?<table class="contract-data-table">/,
    '付款计划表必须包在局部滚动容器内',
  )
  const scrollRule = /\.contract-payment-scroll\s*\{([^}]*)\}/.exec(paymentSummary)
  assert.ok(scrollRule, '缺少 .contract-payment-scroll 规则')
  assert.match(scrollRule[1], /overflow-x:\s*auto/, '付费计划滚动容器必须横向滚动')
  assert.match(scrollRule[1], /max-width:\s*100%/, '滚动容器不得超过弹窗内容区')
  assert.match(paymentSummary, /data-table-scroll/, '滚动容器应接入全局横向滚动提示')
})

// P2⑦：合同搜索框基础规则 min-width:270px 在 320px 视口会溢出。
test('合同搜索框最小宽度取 min(270px, 100%)，320px 视口不溢出', () => {
  const base = /\.contract-search-field\s*\{\s*display:\s*flex;\s*min-width:\s*([^;]+);/.exec(styles)
  assert.ok(base, '缺少 .contract-search-field 基础规则')
  assert.equal(base[1].trim(), 'min(270px, 100%)', '搜索框最小宽度必须同时受视口宽度约束')
  assert.match(base[1], /100%/, '320px 视口下必须退化为可用宽度的 100%')
})
