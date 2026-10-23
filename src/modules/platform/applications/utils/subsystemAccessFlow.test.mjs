import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import {
  SUBSYSTEM_ACCESS_STEPS,
  actionLabel,
  canConfirmPreview,
  isResumableOperation,
  isTerminalOperationStatus,
  markApplicationScope,
  missingItems,
  operationStageRows,
  operationStatusLabel,
  stageLabel,
  subsystemAccessIdempotencyKey,
  subsystemAccessStepIndex,
} from './subsystemAccessFlow.mjs'

const wizardFile = new URL('../components/SubsystemAccessWizard.vue', import.meta.url)
const progressFile = new URL('../components/SubsystemAccessProgress.vue', import.meta.url)
const wizardSource = await readFile(wizardFile, 'utf8')
const progressSource = await readFile(progressFile, 'utf8')

function compileSfc(source, filename) {
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [], filename + ' 解析错误')
  const script = compileScript(descriptor, { id: filename })
  const template = compileTemplate({
    source: descriptor.template.content,
    filename,
    id: filename + '-template',
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(template.errors, [], filename + ' 模板编译错误')
  return { descriptor, script, template }
}

test('统一接入向导与进度组件均可编译', () => {
  compileSfc(wizardSource, wizardFile.pathname)
  compileSfc(progressSource, progressFile.pathname)
})

test('控制台应用页签已挂载统一接入向导（旧模块保留兼容）', async () => {
  const consoleFile = new URL('../../views/PlatformConsoleView.vue', import.meta.url)
  const source = await readFile(consoleFile, 'utf8')
  compileSfc(source, consoleFile.pathname)
  assert.match(source, /import SubsystemAccessWizard from '@\/modules\/platform\/applications\/components\/SubsystemAccessWizard\.vue'/)
  assert.match(source, /<SubsystemAccessWizard[\s\S]{0,400}?can-preview="canReadApplications"/)
  // 旧接入模块保持挂载（保留旧接口兼容）。
  assert.match(source, /<SubsystemOnboardingModule[\s\S]{0,200}?can-onboard="canOnboardSubsystem"/)
})

test('组件使用文本绑定而不是 v-html（避免把服务端文本当 HTML 渲染）', () => {
  for (const source of [wizardSource, progressSource]) {
    assert.doesNotMatch(source, /v-html/)
  }
  assert.match(wizardSource, /\{\{ errorText \}\}/)
  assert.match(progressSource, /\{\{ item\.message \}\}/)
})

test('向导走统一入口接口并驱动五步流程', () => {
  for (const fn of ['previewSubsystemAccess', 'submitSubsystemAccessOperation', 'fetchSubsystemAccessOperation',
    'findSubsystemAccessOperation', 'resumeSubsystemAccessOperation']) {
    assert.match(wizardSource, new RegExp(fn))
  }
  assert.match(wizardSource, /terminalStatuses: \['SUCCEEDED', 'FAILED', 'WAITING'\]/)
  assert.match(wizardSource, /pollDeployment/)
  // 页面不自行选择动作：模板只展示服务端判定的动作。
  assert.doesNotMatch(wizardSource, /action:\s*'(ONBOARD|ADOPT|UPDATE|RETRY)'/)
})

test('步骤、阶段与状态文案覆盖六个阶段', () => {
  assert.equal(SUBSYSTEM_ACCESS_STEPS.length, 5)
  assert.deepEqual(SUBSYSTEM_ACCESS_STEPS.map((step) => step.key), ['select', 'check', 'confirm', 'progress', 'result'])
  assert.equal(stageLabel('CHECK'), '条件检查')
  assert.equal(stageLabel('DIRECTORY'), '目录登记')
  assert.equal(stageLabel('AUTH'), '认证配置')
  assert.equal(stageLabel('DEPLOY'), '运行部署')
  assert.equal(stageLabel('READINESS'), '就绪核验')
  assert.equal(stageLabel('RESULT'), '接入结果')
  assert.equal(actionLabel('ADOPT'), '接管运行时')
  assert.equal(operationStatusLabel('WAITING'), '等待处理')
})

test('终态与恢复判定一致（WAITING 属于终态但可继续）', () => {
  assert.equal(isTerminalOperationStatus('SUCCEEDED'), true)
  assert.equal(isTerminalOperationStatus('FAILED'), true)
  assert.equal(isTerminalOperationStatus('WAITING'), true)
  assert.equal(isTerminalOperationStatus('RUNNING'), false)
  assert.equal(isResumableOperation({ status: 'WAITING' }), true)
  assert.equal(isResumableOperation({ status: 'FAILED' }), true)
  assert.equal(isResumableOperation({ status: 'SUCCEEDED' }), false)
})

test('缺项与阶段行按分项规范化', () => {
  const items = missingItems([
    { Code: 'RUNTIME_APPROVAL_MISSING', Message: '缺少运行批准', NextAction: '生成批准候选' },
    { code: 'LICENSE_MISSING', message: '缺少商业授权' },
    null,
  ])
  assert.equal(items.length, 2)
  assert.equal(items[0].code, 'RUNTIME_APPROVAL_MISSING')
  assert.equal(items[0].nextAction, '生成批准候选')
  assert.equal(items[1].message, '缺少商业授权')

  const rows = operationStageRows([
    { stage: 'CHECK', status: 'SUCCEEDED', attempt_count: 1, evidence_ref: 'preflight:manifest-aaa' },
    { stage: 'AUTH', status: 'WAITING', attempt_count: 2, error_code: 'RUNTIME_APPROVAL_MISSING' },
  ])
  assert.equal(rows[0].label, '条件检查')
  assert.equal(rows[0].statusLabel, '已完成')
  assert.equal(rows[1].statusLabel, '等待处理')
  assert.equal(rows[1].errorCode, 'RUNTIME_APPROVAL_MISSING')
})

test('幂等键与步骤定位可预测', () => {
  assert.equal(subsystemAccessIdempotencyKey({ applicationCode: 'Settlement', environment: 'DEV', previewVersion: 'pv-1' }),
    'subsystem-access:settlement:dev:pv-1')
  assert.equal(subsystemAccessIdempotencyKey({ applicationCode: 'settlement', environment: 'dev', previewVersion: '' }), '')

  assert.equal(subsystemAccessStepIndex({}), 0)
  assert.equal(subsystemAccessStepIndex({ applicationCode: 'settlement', environment: 'dev' }), 1)
  assert.equal(subsystemAccessStepIndex({ applicationCode: 'settlement', environment: 'dev', preview: {} }), 2)
  assert.equal(subsystemAccessStepIndex({ preview: {}, operation: { status: 'RUNNING' } }), 3)
  assert.equal(subsystemAccessStepIndex({ preview: {}, operation: { status: 'WAITING' } }), 4)
})

test('确认条件：无预览版本、缺少权限或已一致时不可确认', () => {
  assert.equal(canConfirmPreview(null), false)
  assert.equal(canConfirmPreview({ preview_version: 'pv-1' }), true)
  assert.equal(canConfirmPreview({ preview_version: 'pv-1', display_only: true }), false)
  assert.equal(canConfirmPreview({ preview_version: '' }), false)
  assert.equal(canConfirmPreview({ preview_version: 'pv-1', missing_permissions: ['platform:application:update'] }), false)
})

test('U15：结果区按分项展示，且不宣称"业务可用"', async () => {
  // 未验证的维度不得显示为业务可用：组件不得出现此类断言文案。
  for (const source of [wizardSource, progressSource]) {
    assert.doesNotMatch(source, /业务可用|业务已可用|已通过业务验收/)
    assert.doesNotMatch(source, /v-html/)
  }
  // 分项维度必须显式呈现（部署/认证/授权/业务验证在阶段与缺项中分别列出）。
  assert.match(progressSource, /阶段结果（分项）/)
  assert.match(progressSource, /仍需处理/)
  assert.match(wizardSource, /未满足条件/)
  assert.match(wizardSource, /变更摘要/)
})


test('执行入口为既有受控入口时不允许在统一入口提交', () => {
  assert.equal(canConfirmPreview({ preview_version: 'pv-1', execution_path: 'unified' }), true)
  assert.equal(canConfirmPreview({ preview_version: 'pv-1', execution_path: 'legacy' }), false)
  assert.equal(canConfirmPreview({ preview_version: 'pv-1', execution_path: 'none' }), true)
})

test('候选系统按服务端清单标注范围（清单不可用则不过滤）', () => {
  const applications = [
    { code: 'settlement', name: '结算系统' },
    { code: 'legacy_demo', name: '历史演示' },
  ]
  const unknown = markApplicationScope(applications, null)
  assert.deepEqual(unknown.map((item) => item.inScope), [null, null])

  const scoped = markApplicationScope(applications, ['SETTLEMENT'])
  assert.deepEqual(scoped.map((item) => item.inScope), [true, false])
  // 原对象不被修改（避免污染调用方状态）。
  assert.equal(applications[0].inScope, undefined)
})

// 父子组件会各自归一化一次缺项；第二次转换必须保留“下一步”指引，
// 否则页面上的下一步提示会在二次处理后被清空（可复现的 UI 缺陷）。
test('缺项二次归一化仍保留下一步指引', () => {
  const once = missingItems([{ Code: 'RUNTIME_APPROVAL_MISSING', Message: '缺少运行批准', NextAction: '生成批准候选' }])
  const twice = missingItems(once)
  assert.equal(twice[0].code, 'RUNTIME_APPROVAL_MISSING')
  assert.equal(twice[0].message, '缺少运行批准')
  assert.equal(twice[0].nextAction, '生成批准候选')
})
