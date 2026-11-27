import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { parse as parseScript } from '@babel/parser'
import { parse } from '@vue/compiler-sfc'
import { computed, reactive, ref } from 'vue'
import { IamError } from '../api/iam.js'
import { createRequestScope } from '../../shared/composables/requestScope.js'
import {
  buildEmployeeOnboardingPayload, defaultEmployeeOnboardingForm, resolveOnboardingExpiresAt,
} from '../utils/employeeOnboarding.js'
import { organizationSelectOptions, positionsForOrganization } from '../utils/selectionCatalog.js'
import { optionalText } from '../utils/userInputValidation.js'

const source = readFileSync(new URL('./EmployeeOnboardingModal.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.scriptSetup.content
const statements = parseScript(script, { sourceType: 'module' }).program.body
const fields = ['canCreateAccount', 'createAccount', 'organizationOptions', 'onboardingPermissionNotice',
  'hasOnboardingScope', 'canStartOnboarding', 'membershipPositions']
const operations = ['entityId', 'positionId', 'loadOnboardingPermissions', 'handlePrerequisitesContinue', 'fieldValidationError',
  'validateUser', 'validateAccount', 'validateMembership', 'submit']
const scopedPermissions = { can_create_account: false, all_organizations: false, organization_ids: ['tech'] }

// 用途：执行真实入职组件的权限判断及提交逻辑，替换网络调用。
// 参数：permissions 为初始入职授权，startingOrg 为初始组织，readPermissions 为预检接口替身。
// 返回值：实际组件状态、提交函数及已记录的请求列表。
function mountOnboardingLogic(permissions, startingOrg = 'tech', readPermissions = async () => permissions) {
  const requests = []
  const organizations = [{ id: 'tech', name: '技术部' }, { id: 'sales', name: '销售部' }]
  const positions = [{ id: 'engineer', org_unit_id: 'tech' }, { id: 'sales-rep', org_unit_id: 'sales' }]
  const form = reactive({
    ...defaultEmployeeOnboardingForm(), display_name: '测试员工',
    org_unit_id: startingOrg, position_id: startingOrg === 'tech' ? 'engineer' : 'sales-rep',
  })
  const context = {
    computed, IamError, form, organizationSelectOptions, positionsForOrganization,
    buildEmployeeOnboardingPayload, optionalText, resolveOnboardingExpiresAt,
    props: { organizations, positions, referencesLoading: false, referencesError: '' },
    onboardingPermissions: ref(permissions), onboardingPermissionsLoading: ref(false),
    onboardingPermissionsError: ref(''), onboardingPermissionsScope: createRequestScope(),
    onboardingPermissionContext: ref('first'), onboardingPrincipal: ref({ user: { id: 'initial' } }),
    getEmployeeOnboardingPermissions: readPermissions,
    currentStep: ref(0), prerequisitesReady: ref(true), saving: ref(false),
    onboardingFieldError: ref(null), onboardingFailureMessage: error => error.message,
    draftRecovery: { clear() {} }, emit() {}, nextTick: async () => {},
    document: { querySelector: () => null },
    onboardEmployee: async (payload) => { requests.push(payload); return {} },
  }
  const selected = statements.filter(node => fields.includes(node.declarations?.[0]?.id?.name)
    || operations.includes(node.id?.name))
  assert.equal(selected.length, fields.length + operations.length)
  const declarations = selected.map(node => script.slice(node.start, node.end)).join('\n')
  const logic = vm.runInNewContext(`${declarations}\n({ ${fields.concat(operations).join(', ')} })`, context)
  return { ...logic, ...context, requests }
}

test('缺少任职权限时保持前置步骤，并拦截保存', async () => {
  const page = mountOnboardingLogic({ ...scopedPermissions, organization_ids: [] })
  page.handlePrerequisitesContinue()
  assert.equal(page.currentStep.value, 0)
  assert.match(page.onboardingPermissionNotice.value, /没有创建员工任职关系的权限/)
  page.currentStep.value = 1
  await page.submit()
  assert.equal(page.requests.length, 0)
})

test('仅列出获授权的组织，缺少账号权限时按不创建账号提交', async () => {
  const page = mountOnboardingLogic(scopedPermissions)
  assert.deepEqual(page.organizationOptions.value.map(option => option.option_id), ['tech'])
  assert.equal(page.form.create_account, true, '模拟默认值或已有草稿勾选')
  assert.equal(page.createAccount.value, false)
  assert.match(source, /v-model="createAccount" type="checkbox" :disabled="!canCreateAccount \|\| saving"/)
  assert.match(source, /当前账号没有创建登录账号的权限/)
  page.handlePrerequisitesContinue()
  assert.equal(page.currentStep.value, 1)
  await page.submit()
  assert.equal(page.requests.length, 1)
  assert.equal(page.requests[0].account, null)
  assert.equal(page.requests[0].membership.org_unit_id, 'tech')
})

test('过期草稿中的范围外组织无法进入保存请求', async () => {
  const page = mountOnboardingLogic(scopedPermissions, 'sales')
  page.handlePrerequisitesContinue()
  await page.submit()
  assert.equal(page.requests.length, 0)
  assert.match(page.onboardingFieldError.value.message, /授权范围内/)
})

test('换号后迟到的预检结果不能恢复旧账号的办理范围', async () => {
  const pending = []
  const page = mountOnboardingLogic(scopedPermissions, 'tech',
    () => new Promise(resolve => pending.push(resolve)))
  const previous = page.loadOnboardingPermissions()
  page.onboardingPermissionContext.value = 'second'
  page.onboardingPrincipal.value = { user: { id: 'next' } }
  const current = page.loadOnboardingPermissions()
  pending[1]({ ...scopedPermissions, organization_ids: [] })
  await current
  pending[0]({ ...scopedPermissions, can_create_account: true })
  await previous
  assert.equal(page.canStartOnboarding.value, false)
  assert.equal(page.canCreateAccount.value, false)
})
