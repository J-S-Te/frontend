import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { ref } from 'vue'
import { createRequestScope } from '../platform/shared/composables/requestScope.js'
import { formatUserError } from '../shared/utils/userError.js'

const source = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')
const monitoringSource = await readFile(new URL('./composables/useProjectMonitoring.js', import.meta.url), 'utf8')
const displaySource = await readFile(new URL('./projectDisplay.js', import.meta.url), 'utf8')
const styles = await readFile(new URL('./styles/project-management.css', import.meta.url), 'utf8')

function extractFunction(name, context) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
  assert.ok(start >= 0, `missing ${name}`)
  const body = source.slice(start, source.indexOf('\n}', start) + 2)
  return vm.runInNewContext(`${body}\n({${name}})`, context)[name]
}

test('报告阶段筛选走列表接口 report_stage 参数并与状态筛选组合', () => {
  assert.match(source, /const reportStageFilter = ref\(''\)/)
  assert.match(source, /report_stage: reportStageFilter/)
  // 默认分页只回 20 行，报告阶段筛选必须走 all=1 快照，否则结果被静默截少。
  assert.match(source, /listProjectsSnapshot\(\{ report_stage: stage \}\)/)
  assert.match(source, /reportStageProjects\.value = snapshot\.items/)
  assert.match(source, /fields: \{ keyword, status: statusFilter, report_stage: reportStageFilter/)
  assert.match(source, /reportStageFilterOptions = Object\.entries\(reportStageLabel\)/)
  assert.match(source, /aria-label="按报告阶段筛选"/)
  assert.match(source, /报告阶段：全部/)
  assert.match(source, /v-if="reportStageFilter" class="pm-filter-tag"/)
  assert.match(source, /reportStageFilter\.value = ''/)
  // 报告阶段筛选结果只替换列表数据源，完整工作区快照与指标口径保持不变。
  assert.match(source, /const projectListSource = computed\(\(\) => reportStageFilter\.value \? reportStageProjects\.value : projects\.value\)/)
  // 2026-11 统一：加载 / 失败 / 空三态不再挤进一句 computed 文案，
  // 改为把三者分别交给 ListState（失败必须可重试，空才显示空文案）。
  assert.match(source, /const projectListError = computed\(\(\) => reportStageListError\.value \|\| ''\)/)
  assert.match(source, /:error="projectListError"/)
  assert.match(source, /return projectListSource\.value\.filter/)
  // 筛选读取失败时保留其它结果并给出有样式的内联错误条。
  assert.match(source, /v-if="reportStageListError" class="pm-inline-alert danger"/)
  assert.match(styles, /\.pm-inline-alert\.danger/)
})

test('报告阶段筛选请求携带 report_stage，切换筛选后旧响应不回写', async () => {
  const calls = []
  const pending = []
  const context = {
    ref, createRequestScope, formatUserError,
    reportStageFilter: ref('RECTIFYING'),
    reportStageProjects: ref([]),
    reportStageListLoading: ref(false),
    reportStageListError: ref(''),
    reportStageListScope: createRequestScope(),
    listProjectsSnapshot: (params) => {
      calls.push(params)
      return new Promise((resolve, reject) => pending.push({ resolve, reject }))
    },
  }
  const loadReportStageProjects = extractFunction('loadReportStageProjects', context)

  const first = loadReportStageProjects()
  assert.equal(calls[0].report_stage, 'RECTIFYING')
  assert.equal(Object.keys(calls[0]).length, 1)

  // 用户切换到另一个报告阶段：旧请求迟到时只能作废，不能覆盖新筛选结果。
  context.reportStageFilter.value = 'COMPILING'
  const second = loadReportStageProjects()
  assert.equal(calls[1].report_stage, 'COMPILING')

  pending[0].resolve({ items: [{ id: 'PJ-OLD' }], total: 1, truncated: false })
  await first
  assert.deepEqual(context.reportStageProjects.value, [])
  assert.equal(context.reportStageListLoading.value, true, '旧请求 finally 不得关闭新请求的加载态')

  pending[1].resolve({ items: [{ id: 'PJ-NEW', report_stage: 'COMPILING' }], total: 1, truncated: false })
  await second
  assert.deepEqual(context.reportStageProjects.value, [{ id: 'PJ-NEW', report_stage: 'COMPILING' }])
  assert.equal(context.reportStageListLoading.value, false)
  assert.equal(context.reportStageListError.value, '')
})

test('列表、看板与监控在状态旁展示报告阶段次级徽章', () => {
  assert.match(displaySource, /export function projectReportStageLabel\(project\)/)
  assert.match(displaySource, /return stage \? reportStageLabel\[stage\] \|\| '' : ''/)
  assert.match(source, /报告编制 · \{\{ projectReportStageLabel\(project\) \}\}/)
  assert.match(source, /报告编制 · \{\{ projectReportStageLabel\(card\) \}\}/)
  assert.match(source, /报告编制 · \{\{ projectReportStageLabel\(row\.project\) \}\}/)
  // 旧后端没有 report_stage 时 v-if 为假，不渲染占位徽章。
  assert.match(source, /v-if="projectReportStageLabel\(project\)"/)
  assert.match(styles, /\.pm-badge-stack \{ display: inline-flex;/)
})

test('首页报告编制指标位标注其中整改中数量，且与服务项行同口径', () => {
  assert.match(source, /const rectifyingItemCount = computed\(\(\) => serviceItems\.value\.filter\(\(item\) => String\(item\.report_status \?\? ''\)\.trim\(\)\.toUpperCase\(\) === 'RECTIFYING'\)\.length\)/)
  assert.match(source, /其中整改中 \{\{ rectifyingItemCount \}\} 项/)
  assert.match(source, /title="按当前已加载服务项统计，非全量"/)
})

test('监控页签解析 report_stage 前缀并展示阶段徽章', () => {
  assert.match(monitoringSource, /key: 'report_stage:RECTIFYING', label: '整改中'/)
  assert.match(monitoringSource, /monitoringFilterQuery\(monitorFilter\.value\)/)
  assert.match(monitoringSource, /monitoringStatusBuckets\(monitoringSnapshot\.value\)/)
  assert.match(monitoringSource, /report_stage_counts: \{\}/)
  // 视图表格用报告阶段徽章，并让派生分桶标签识别整改中。
  assert.match(source, /monitoredStatusByProject\(row\.project\)/)
})

test('报告状态中文词表只在 projectDisplay 维护一份', () => {
  assert.doesNotMatch(source, /const reportStatusLabel = \{/)
  assert.match(source, /reportStatusLabel,/)
  assert.match(displaySource, /export const reportStatusLabel = reportStageLabel/)
})
