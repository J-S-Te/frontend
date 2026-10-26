import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./FilingWizard.vue', import.meta.url), 'utf8')

test('备案确认弹窗挂在根级公共区，任何操作场景都能渲染', () => {
  // 三个 askConfirm 消费场景：列表删除草稿、详情删除草稿、提交并锁定。
  assert.match(source, /async function deleteDraft\(item\)[\s\S]*?await askConfirm\(/)
  assert.match(source, /async function confirmSubmit\(\)[\s\S]*?await askConfirm\(/, '提交确认必须走 askConfirm')
  const dialogIndex = source.indexOf('<ConfirmDialog')
  assert.ok(dialogIndex > 0, 'ConfirmDialog 必须渲染')
  // 根级判据：位于最后一个 </section>（模板根收尾）之前、且在列表/详情分支之外——
  // 通过「其后直到 </template> 不再出现 filing-toolbar 或 v-if/v-else 结构开标签」验证。
  const tail = source.slice(dialogIndex, source.indexOf('</template>', dialogIndex))
  assert.ok(tail.includes('</section>'), '弹窗应位于根 section 内')
  assert.doesNotMatch(tail, /filing-toolbar|<template v-else/, '弹窗之后不应再有条件分支结构')
  // 关键回归：不得再嵌进「新建备案」工具栏的 canCreate/creating 分支。
  const toolbar = source.slice(source.indexOf('class="filing-toolbar"'), source.indexOf('filing-list-row'))
  assert.doesNotMatch(toolbar, /ConfirmDialog/, '确认弹窗不得放进新建备案分支')
})

test('删除与提交共用同一确认实例（useConfirmDialog 单实例）', () => {
  assert.equal((source.match(/useConfirmDialog\(\)/g) || []).length, 1)
  assert.equal((source.match(/<ConfirmDialog/g) || []).length, 1)
  // 提交确认的文案与危险标记保持既有语义。
  assert.match(source, /title: '提交并锁定备案\？'/)
  assert.match(source, /confirmText: '提交并锁定'/)
  assert.match(source, /danger: true/)
})

test('卸载清理 beforeunload 监听与自动暂存定时器（验收：完整卸载清理）', () => {
  const unmountIndex = source.indexOf('onUnmounted(')
  assert.ok(unmountIndex > 0)
  const block = source.slice(unmountIndex, source.indexOf('})', unmountIndex))
  assert.match(block, /removeEventListener\('beforeunload', beforeUnloadGuard\)/, '卸载必须摘除 dirty 期间动态挂载的 beforeunload 监听')
  assert.match(block, /for \(const timer of saveTimers\.values\(\)\) clearTimeout\(timer\)/, '卸载必须清空自动暂存定时器')
  assert.match(block, /saveTimers\.clear\(\)/)
  assert.match(block, /clearTimeout\(validationNoticeTimer\)/, '既有的提示定时器清理保持不变')
})
