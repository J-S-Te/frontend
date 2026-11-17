import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { ref, reactive } from 'vue'
import { formatPortalError } from './api/errorMessages.js'

const portal = parseSFC(await readFile(new URL('./views/CustomerPortalView.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const filing = parseSFC(await readFile(new URL('./components/FilingWizard.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content

/** 用途：执行组件中的真实函数，外部 API 只在网络边界替换。
 * 参数：source 为视图脚本，names 为函数名，scope 为响应式状态与外部依赖。
 * 返回值：原函数集合；断言针对其状态变化与可见消息。
 */
function functionsFrom(source, names, scope) {
  const declarations = parse(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
  assert.equal(declarations.length, names.length)
  return new Function(...Object.keys(scope), `${declarations.map(node => source.slice(node.start, node.end)).join('\n')};return {${names.join(',')}}`)(...Object.values(scope))
}

/** 用途：创建反馈写入成功而列表读取失败的最小门户状态。
 * 参数：无；外部读取故障只影响反馈列表。
 * 返回值：实际视图函数及其响应式状态。
 */
function feedbackHarness() {
  const scope = {
    loading: ref(false), refreshing: ref(false), error: ref(''), notice: ref(''), session: ref({ customer_id: 1 }), isPortalSuperAdmin: ref(false),
    capabilitiesLoaded: true, section: ref('feedback'), projects: ref([]), feedbacks: ref([]), feedbackNotifications: ref([]),
    feedbackNotificationGeneration: 0, feedbackNotificationLoading: ref(false),
    feedbackNotificationError: ref(''), feedbackNotificationUnreadCount: ref(null), feedbackPage: ref(1), feedbackTotal: ref(0), feedbackListError: ref(''),
    feedbackForm: reactive({ type: 'COMPLAINT', title: '问题', description: '详情', project_id: '', expected_contact: '' }),
    feedbackSubmitError: ref(''), feedbackContactError: ref(''), feedbackClosing: ref(false), selectedFeedback: ref({ feedback: { id: 'feedback-1' } }),
    feedbackCloseRetryKeys: new Map(), createIdempotencyKey: () => 'stable-close-key',
    hasPermission: permission => ['feedback.create', 'feedback.read', 'feedback.reply'].includes(permission),
    createFeedback: async () => ({ id: 'feedback-1' }), closeFeedback: async () => ({ id: 'feedback-1' }),
    listFeedbacks: async () => { throw new Error('反馈列表暂不可用，请稍后刷新。') },
    listFeedbackNotifications: async () => ({ items: [] }), getFeedbackNotificationUnreadCount: async () => ({ count: 0 }),
    subsystemAccessMessage: error => error.message, formatPortalError,
  }
  return { scope, ...functionsFrom(portal, ['load', 'loadFeedbackNotifications', 'submitFeedback', 'confirmCloseFeedback', 'validContact', 'fail'], scope) }
}

test('反馈已创建而刷新失败时保留成功回执，错误只属于列表读取', async () => {
  const h = feedbackHarness()
  await h.submitFeedback()
  assert.match(h.scope.notice.value, /反馈已提交/)
  assert.match(h.scope.feedbackListError.value, /反馈列表暂不可用/)
  assert.equal(h.scope.feedbackSubmitError.value, '')
  assert.equal(h.scope.feedbackForm.title, '')
})

test('反馈已关闭而刷新失败时保留成功回执，不要求再次关闭', async () => {
  const h = feedbackHarness()
  await h.confirmCloseFeedback()
  assert.match(h.scope.notice.value, /反馈已关闭/)
  assert.match(h.scope.feedbackListError.value, /反馈列表暂不可用/)
  assert.equal(h.scope.selectedFeedback.value, null)
})

test('备案锁定、版本冲突和幂等冲突分别解释，保持自动暂存停止', () => {
  for (const [code, expected] of [
    ['PORTAL_FILING_LOCKED', /提交.*锁定.*服务人员/],
    ['PORTAL_FILING_VERSION_CONFLICT', /其他.*修改.*重新加载/],
    ['PORTAL_FILING_IDEMPOTENCY_CONFLICT', /已.*提交|处理结果|重试标识/],
  ]) {
    const conflict = ref(false), messages = []
    const { handleConflict } = functionsFrom(filing, ['handleConflict'], { conflict, saveTimers: new Map(), formatPortalError, emit: (_, error) => messages.push(error.message) })
    assert.equal(handleConflict({ status: 409, code }), true)
    assert.equal(conflict.value, true)
    assert.match(messages[0], expected)
    if (code !== 'PORTAL_FILING_VERSION_CONFLICT') assert.doesNotMatch(messages[0], /其他页面已修改/)
  }
})

test('备案缺少整个分区时显示中文步骤名，不能把内部编码当标签', () => {
  const { issueLabel } = functionsFrom(filing, ['labelForStep', 'issueLabel'], {
    steps: [['ORGANIZATION', '单位基本情况']], fields: {}, currentCode: ref('ORGANIZATION'),
  })
  const message = issueLabel({ path: 'sections.ORGANIZATION', code: 'REQUIRED', message: 'section is required' })
  assert.match(message, /单位基本情况.*未填写/)
  assert.doesNotMatch(message, /ORGANIZATION|sections/)
})
