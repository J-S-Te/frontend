import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./ContractImportHistoryPanel.vue', import.meta.url), 'utf8')

test('历史导入独立统计按状态、摘要、表格和技术水位分层', () => {
  assert.match(source, /import-history-status/)
  assert.match(source, /import-history-metrics/)
  assert.match(source, /import-history-table-card/)
  assert.match(source, /import-history-coverage/)
  assert.match(source, /import-history-tech/)
  assert.match(source, /数据来源与发布水位/)
  assert.match(source, /statusMeta/)
  assert.match(source, /historyAvailability\(result\.value\)/)
  assert.match(source, /formatBusinessDateTime/)
})

test('历史分栏使用中文模式与状态，源事实和 API 摘要分开表达', () => {
  assert.match(source, /CONTINUE_LIVE: '接续履约'/)
  assert.match(source, /ARCHIVE_ONLY: '历史存档'/)
  assert.match(source, /HISTORICAL_CLOSED: '历史结清'/)
  assert.match(source, /ARCHIVE_SEPARATE: '档案独立统计'/)
  assert.match(source, /HISTORICAL_SEPARATE: '历史独立统计'/)
  assert.match(source, /source_facts_count/)
  assert.match(source, /其余仅 API 摘要/)
  assert.match(source, /API 摘要已接入不代表源库事实已接入/)
  assert.match(source, /result\.source_snapshot_id/)
  assert.match(source, /result\.aggregation_run_id/)
  assert.match(source, /result\.basis/)
  assert.doesNotMatch(source, /同步状态：\{\{ result\.sync_status \|\| 'UNKNOWN' \}\}/)
})
