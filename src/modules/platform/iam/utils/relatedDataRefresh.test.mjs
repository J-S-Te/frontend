import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 组件行为回归：本批次修复的是“写入成功后兄弟组件仍使用旧目录”的数据一致性问题。
// 前端测试环境只有 node:test（无 DOM），因此这里对真实源码做定向断言，锁住：
// 1) 不再出现“数组非空就永久复用”的目录缓存；
// 2) 目录依赖的表单在打开时重新校验，并显式暴露加载 / 失败状态；
// 3) 写入确认成功后由 API 层发布失效通知，页面统一订阅。
// 这些断言在修复前的代码上会失败，可复现原始问题。

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const consoleView = source('../../views/PlatformConsoleView.vue')
const employeeModal = source('../components/EmployeeOnboardingModal.vue')
const prerequisiteStep = source('../components/OnboardingPrerequisiteStep.vue')
const iamSettings = source('../components/IamSettingsModule.vue')
const changeCenter = source('../components/PersonnelChangeCenter.vue')
const authorizationTemplates = source('../components/PositionAuthorizationTemplates.vue')
const batchImport = source('../components/BatchUserImportDialog.vue')
const identityEditorModal = source('../components/IdentityEditorModal.vue')
const iamApi = source('../api/iam.js')
const positionAuthorizationApi = source('../api/positionAuthorization.js')
const applicationsApi = source('../../applications/api/applications.js')
const loginTargetsApi = source('../../login-targets/api/loginTargets.js')
const invalidationBus = source('../../shared/utils/relatedDataInvalidation.js')

test('员工向导目录不再“数组非空就永久复用”，并在打开时重新校验', () => {
  assert.doesNotMatch(consoleView, /if \(!onboardingOrganizations\.value\.length\)/)
  assert.doesNotMatch(consoleView, /if \(!onboardingPositions\.value\.length\)/)
  assert.match(consoleView, /loadRelatedDataSafely\(/)
  assert.match(consoleView, /useRelatedDataInvalidation\(/)
  assert.match(consoleView, /:references-loading="onboardingReferencesLoading"/)
  assert.match(consoleView, /:references-error="onboardingReferencesError"/)
  // 打开弹窗不再等待网络，也不在“目录为空”时才加载。
  assert.match(consoleView, /showEmployeeOnboarding\.value = true\s*\n\s*loadOnboardingReferences\(\)/)
})

test('前置检查在快速补齐后等待目录确认，未确认前不能继续', () => {
  assert.match(prerequisiteStep, /pendingConfirmation/)
  assert.match(prerequisiteStep, /beginConfirmation\('organization', created, name\)/)
  assert.match(prerequisiteStep, /beginConfirmation\('position', created, name\)/)
  assert.match(prerequisiteStep, /const catalogsConfirmed = computed\(/)
  assert.match(prerequisiteStep, /:disabled="!allReady"/)
  assert.match(prerequisiteStep, /重试读取关联数据/)
  assert.match(prerequisiteStep, /referencesLoading/)
})

test('员工弹窗接收目录加载 / 失败状态，且只清除确实失效的选择', () => {
  assert.match(employeeModal, /referencesLoading: \{ type: Boolean/)
  assert.match(employeeModal, /referencesError: \{ type: String/)
  assert.match(employeeModal, /references-loading="referencesLoading"/)
  assert.match(employeeModal, /dropSelectionIfMissing\('organization'\)/)
  assert.match(employeeModal, /dropSelectionIfMissing\('position'\)/)
  assert.match(employeeModal, /其余已填写内容保持不变/)
  assert.match(employeeModal, /@retry-references/)
})

test('人员异动中心的目录读取按请求序号丢弃迟到响应', () => {
  assert.match(changeCenter, /let catalogsRequestSeq = 0/)
  assert.match(changeCenter, /if \(seq !== catalogsRequestSeq\) return/)
  assert.match(changeCenter, /const seq = \+\+catalogsRequestSeq/)
})

test('人员异动中心的目录改为每次打开重新读取并逐页读取', () => {
  assert.doesNotMatch(changeCenter, /if \(!users\.value\.length\)/)
  assert.doesNotMatch(changeCenter, /if \(!positions\.value\.length\)/)
  assert.doesNotMatch(changeCenter, /if \(!organizations\.value\.length\)/)
  assert.match(changeCenter, /loadAllCatalogPages\(listUsers/)
  assert.match(changeCenter, /loadAllCatalogPages\(listPositions/)
  assert.match(changeCenter, /loadAllCatalogPages\(listOrgUnits/)
  assert.match(changeCenter, /useRelatedDataInvalidation\(/)
  assert.match(changeCenter, /正在读取最新人员、组织与岗位目录/)
  assert.match(changeCenter, /重试读取/)
  // 责任接收人目录也不能只取第一页。
  assert.doesNotMatch(changeCenter, /listUsers\(\{ page: 1, pageSize: 100 \}\)/)
})

test('IAM 关联编辑器打开时重新校验目录，并订阅其他入口的写入', () => {
  assert.doesNotMatch(iamSettings, /if \(\['account', 'membership'\]\.includes\(kind\) && !users\.value\.length\) loadUsers\(\)/)
  assert.doesNotMatch(iamSettings, /if \(kind === 'position' && !organizations\.value\.length\) loadOrganizations\(\)/)
  assert.match(iamSettings, /function loadEditorReferences\(kind\)/)
  // 提示文案随统一编辑弹窗迁移到 IdentityEditorModal.vue；父组件负责状态与传参。
  assert.match(iamSettings, /:references-loading="editorReferencesLoading"/)
  assert.match(iamSettings, /:references-error="editorReferencesError"/)
  assert.match(iamSettings, /:selection-notice="editorSelectionNotice"/)
  assert.match(identityEditorModal, /正在读取最新关联目录/)
  assert.match(iamSettings, /useRelatedDataInvalidation\(/)
  assert.match(iamSettings, /:catalogs-loading="loading\.organizations \|\| loading\.positions"/)
  // 目录重新读取后只清理确实失效的选择，不重置其他表单内容。
  assert.match(iamSettings, /dropInvalidEditorSelections\(\)/)
  assert.match(iamSettings, /其余已填写内容保持不变/)
})

test('应用接入与登录目标接入同一失效机制，并逐页读取应用目录', () => {
  const onboarding = source('../../applications/components/SubsystemOnboardingModule.vue')
  const loginTargets = source('../../login-targets/components/ApplicationLoginTargetModule.vue')
  assert.match(onboarding, /useRelatedDataInvalidation\(/)
  assert.match(onboarding, /loadAllCatalogPages\(\s*listApplications/)
  assert.match(loginTargets, /useRelatedDataInvalidation\(/)
  assert.match(loginTargets, /RELATED_DATA\.APPLICATIONS/)
})

test('新增账号 / 任职的用户选择器使用完整用户目录而不是当前分页', () => {
  assert.match(iamSettings, /const editorUsers = ref\(\[\]\)/)
  assert.match(iamSettings, /async function loadEditorUserDirectory\(\)/)
  assert.match(iamSettings, /loadAllCatalogPages\(\s*listUsers/)
  // 编辑器下拉只能引用完整目录；引用面板分页列表会退回"只能选到这一页"。
  assert.doesNotMatch(iamSettings, /<option v-for="item in users"/)
  // 编辑器下拉随弹窗迁移到 IdentityEditorModal.vue；父组件把完整目录经 users 属性传入。
  assert.match(iamSettings, /:users="editorUsers"/)
  assert.match(identityEditorModal, /<option v-for="item in users"/)
})

test('岗位授权模板订阅岗位 / 模板 / 角色目录变化并清理失效岗位选择', () => {
  assert.match(authorizationTemplates, /useRelatedDataInvalidation\(/)
  assert.match(authorizationTemplates, /RELATED_DATA\.AUTHORIZATION_TEMPLATES/)
  assert.match(authorizationTemplates, /RELATED_DATA\.ROLE_CATALOG/)
  assert.match(authorizationTemplates, /selectionNotice/)
})

test('批量导入在校验与提交前核对最新目录，目录变化后重新核验预览', () => {
  assert.match(batchImport, /catalogsLoading: \{ type: Boolean/)
  assert.match(batchImport, /const previewStale = computed\(/)
  assert.match(batchImport, /function revalidatePreview\(\)/)
  assert.match(batchImport, /previewStale\.value/)
  assert.match(batchImport, /重新核验预览/)
  // 重新核验后按行号"精确"恢复勾选（含取消勾选），不清空已选择的文件。
  // 精确恢复勾选（含取消勾选）由纯函数负责，组件必须委托给它；
  // 行为断言见 batchUserImport.test.mjs 的两行 CSV 用例。
  assert.match(batchImport, /selectedLineNos/)
  assert.match(batchImport, /restoreRowSelection\(rows, selectedLineNos\)/)
  assert.match(batchImport, /import \{ parseApplicationRoles, restoreRowSelection \}/)
})

test('写入确认成功后由 API 层发布关联数据失效通知', () => {
  for (const [name, text] of [
    ['iam.js', iamApi],
    ['positionAuthorization.js', positionAuthorizationApi],
    ['applications.js', applicationsApi],
    ['loginTargets.js', loginTargetsApi],
  ]) {
    assert.match(text, /publishRelatedDataChanged/, `${name} 必须在写入确认成功后发布失效通知`)
  }
  // 发布必须发生在请求成功之后：每个被包装的写入都通过 onWriteSuccess/onTemplateWriteSuccess。
  assert.match(iamApi, /function onWriteSuccess\(promise, kinds\)/)
  assert.match(iamApi, /\.then\(\(result\) => \{\s*\n\s*publishRelatedDataChanged\(kinds\)/)
  assert.match(positionAuthorizationApi, /function onTemplateWriteSuccess\(promise\)/)
  assert.match(applicationsApi, /function onWriteSuccess\(promise, kinds\)/)
  assert.match(loginTargetsApi, /function onWriteSuccess\(promise\)/)
})

test('失效总线只传资源类别与会话范围，且会话切换会清空旧结果', () => {
  assert.doesNotMatch(invalidationBus, /display_name|user_id|role_code|password|token|secret/i)
  assert.match(invalidationBus, /export function setRelatedDataSessionScope/)
  assert.match(invalidationBus, /export function subscribeRelatedDataChanges/)
  assert.match(invalidationBus, /export async function loadRelatedDataSafely/)
  assert.match(invalidationBus, /type: 'session'/)
})

test('会话范围由 principal 统一推进，退出登录不会把旧目录带进新会话', () => {
  const principal = source('../../auth/utils/principal.js')
  assert.match(principal, /setRelatedDataSessionScope\(principalScope\(next\)\)/)
  assert.match(principal, /setRelatedDataSessionScope\(''\)/)
  // 只使用租户与用户标识，不把权限或角色写进会话范围。
  assert.match(principal, /const tenant = String\(next\.tenant\?\.id \|\| ''\)\.trim\(\)/)
  assert.doesNotMatch(principal, /principalScope[\s\S]{0,200}permission_codes/)
})
