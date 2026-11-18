import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./metric-cards.css', import.meta.url), 'utf8')

test('指标卡默认中性，只有 warning/danger 保留语义色', () => {
  assert.match(css, /\.contract-app \.contract-stat-grid :is\(\.blue, \.purple, \.green\)/)
  assert.match(css, /\.crm-page \.crm-stat-card\[data-tone='success'\] \.crm-stat-value/)
  assert.match(css, /\.expense-canvas \.expense-metric\[data-tone='green'\]::before/)
  assert.match(css, /\.settlement-page \.settlement-cards article\.tone-orange::before \{ background: var\(--warning\)/)
  assert.match(css, /\.pm-page \.pm-kpi\.primary/)
})

