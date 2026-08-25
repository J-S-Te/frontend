<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  IamError,
  onboardEmployee,
} from '@/modules/platform/iam/api/iam'
import { previewPositionAuthorization } from '@/modules/platform/iam/api/positionAuthorization'
import {
  buildEmployeeOnboardingPayload,
  defaultEmployeeOnboardingForm,
  resolveOnboardingExpiresAt,
} from '@/modules/platform/iam/utils/employeeOnboarding'
import {
  organizationSelectOptions,
  positionsForOrganization,
} from '@/modules/platform/iam/utils/selectionCatalog'
import OnboardingPrerequisiteStep from '@/modules/platform/iam/components/OnboardingPrerequisiteStep.vue'

const props = defineProps({
  organizations: { type: Array, default: () => [] },
  positions: { type: Array, default: () => [] },
  applications: { type: Array, default: () => [] },
  // onBeforeOpen 在 modal 挂载时同步触发。父组件可以在这里发起后台数据加载
  // (组织 / 岗位 / 应用目录)，但不应该 await —— modal 自身的步骤 0 会自行检查。
  onBeforeOpen: { type: Function, default: null },
})

const emit = defineEmits(['close', 'completed', 'toast', 'refresh-prerequisites'])

const form = reactive(defaultEmployeeOnboardingForm())
const saving = ref(false)
const initialPasswordVisible = ref(false)
const authorizationPreview = ref(null)
const authorizationPreviewLoading = ref(false)
const authorizationPreviewUnavailable = ref(false)
// currentStep: 0 = 前置检查，1..4 = 原来的 4 步 wizard。
// modal 打开时总是落在 step 0；前置检查全绿后用户点击"开始新增员工"才进入 step 1。
const currentStep = ref(0)
const prerequisitesReady = ref(false)
let previousBodyOverflow = ''
// 触发前置检查组件内部"快速补齐"操作时使用的轻量递增计数器。
// 父组件 (PlatformConsoleView) 监听 prerequisites-bump 事件并按需刷新 orgs/positions/applications。
const prereqRefreshKey = ref(0)

onMounted(() => {
  // The wizard has its own scroll container. Lock the page behind it so a wheel
  // event at the modal edge cannot scroll the settings page underneath.
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  // 同步触发父级钩子；父级用它在挂载瞬间发起数据预加载。
  // 钩子失败不应阻塞 modal 自身的前置检查流程。
  if (typeof props.onBeforeOpen === 'function') {
    try { props.onBeforeOpen() } catch (error) { console.error('onBeforeOpen hook failed', error) }
  }
})

onUnmounted(() => {
  document.body.style.overflow = previousBodyOverflow
})

function entityId(item, ...keys) {
  return keys.map((key) => item?.[key]).find(Boolean) || ''
}

function positionId(item) {
  return entityId(item, 'position_id', 'id')
}

function positionName(item) {
  return item?.name || item?.position_name || item?.code || positionId(item)
}

const organizationOptions = computed(() => organizationSelectOptions(props.organizations))
const membershipPositions = computed(() => positionsForOrganization(props.positions, form.org_unit_id))
const selectedPosition = computed(() => membershipPositions.value.find((item) => positionId(item) === form.position_id) || null)
const previewRoles = computed(() => Array.isArray(authorizationPreview.value?.roles) ? authorizationPreview.value.roles : [])
const previewConflicts = computed(() => Array.isArray(authorizationPreview.value?.conflicts) ? authorizationPreview.value.conflicts : [])

watch(() => form.org_unit_id, () => {
  if (!membershipPositions.value.some((item) => positionId(item) === form.position_id)) {
    form.position_id = ''
  }
})

watch(
  () => [form.create_membership, form.position_id, form.inherit_authorization],
  () => { loadAuthorizationPreview() },
  { immediate: true },
)

function close() {
  if (!saving.value) emit('close')
}

function handlePrerequisitesContinue() {
  if (!prerequisitesReady.value) return
  currentStep.value = 1
}

function handlePrerequisitesRefresh() {
  // 通知父级重新拉取 orgs/positions/applications，前置检查组件会随之重算状态。
  prereqRefreshKey.value += 1
  emit('refresh-prerequisites')
}

function goToStep(step) {
  // 仅允许在已经通过前置检查后回到 step 0；其他步骤之间不可跳跃。
  if (step === 0) {
    currentStep.value = 0
    return
  }
  if (step >= 1 && step <= 4 && prerequisitesReady.value) {
    currentStep.value = step
  }
}

function optionalText(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function validateUser() {
  const displayName = String(form.display_name ?? '').trim()
  if (!displayName) throw new IamError('请填写员工姓名。')
  if (Array.from(displayName).length > 100) throw new IamError('员工姓名不能超过 100 个字符。')

  const email = optionalText(form.email)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IamError('邮箱格式不正确。')

  const mobile = optionalText(form.mobile)
  if (mobile) {
    if (Array.from(mobile).length > 32) throw new IamError('手机号不能超过 32 个字符。')
    if (!/^\+?\d+$/.test(mobile.replace(/[\s-]/g, ''))) throw new IamError('手机号只能包含数字、空格、连字符或开头的加号。')
  }
  return { display_name: displayName, email, mobile, status: form.status || 'ACTIVE' }
}

function validateAccount() {
  if (!form.create_account) return null
  const accountName = String(form.account_name ?? '').trim()
  if (Array.from(accountName).length < 3 || Array.from(accountName).length > 64) {
    throw new IamError('账号名长度必须为 3–64 个字符。')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(accountName)) {
    throw new IamError('账号名必须以字母或数字开头，且只能包含字母、数字、点、下划线和连字符。')
  }

  const password = String(form.initial_password ?? '')
  if (Array.from(password).length < 8 || Array.from(password).length > 128) throw new IamError('初始密码长度必须为 8–128 个字符。')
  if (/\s/.test(password)) throw new IamError('初始密码不能包含空白字符。')
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new IamError('初始密码必须同时包含大写字母、小写字母、数字和特殊字符。')
  }

  const validUntil = form.validity_mode === 'PERMANENT' ? null : resolveOnboardingExpiresAt(form.valid_until)
  if (form.validity_mode !== 'PERMANENT' && (!validUntil || new Date(validUntil).getTime() <= Date.now())) {
    throw new IamError('临时账号的有效截止时间必须晚于当前时间。')
  }
  return { account_name: accountName, initial_password: password, valid_until: validUntil }
}

function validateMembership() {
  if (!form.org_unit_id || !form.position_id) throw new IamError('请选择员工所属组织和岗位，用户必须对应一条任职关系。')
  if (!membershipPositions.value.some((item) => positionId(item) === form.position_id)) throw new IamError('请选择当前组织下的岗位。')

  const isShortTerm = form.membership_validity_mode === 'SHORT_TERM'
  if (isShortTerm && (!form.effective_from || !form.effective_to)) throw new IamError('短期任职必须同时填写生效日期和失效日期。')
  if (isShortTerm && form.effective_from > form.effective_to) throw new IamError('生效日期不能晚于失效日期。')

  return {
    org_unit_id: form.org_unit_id,
    position_id: form.position_id,
    membership_type: form.membership_type || 'PRIMARY',
    effective_from: isShortTerm ? form.effective_from : null,
    effective_to: isShortTerm ? form.effective_to : null,
    inherit_authorization: form.inherit_authorization !== false,
  }
}

async function loadAuthorizationPreview() {
  authorizationPreview.value = null
  authorizationPreviewUnavailable.value = false
  if (!form.inherit_authorization || !form.position_id) return

  authorizationPreviewLoading.value = true
  try {
    authorizationPreview.value = await previewPositionAuthorization({
      position_id: form.position_id,
      inherit_authorization: true,
    })
  } catch {
    // 可选预览端点不可阻断员工创建；表单提示当前状态，后端能力部署后会自然读取真实数据。
    authorizationPreviewUnavailable.value = true
  } finally {
    authorizationPreviewLoading.value = false
  }
}

async function submit() {
  if (saving.value) return
  saving.value = true
  try {
    const user = validateUser()
    const account = validateAccount()
    const membership = validateMembership()
    const payload = buildEmployeeOnboardingPayload(form, { user, account })
    // 保留已经归一化的任职数据，不再从原始表单重建，以免长期/短期模式切换后旧日期回流。
    payload.membership = membership

    const result = await onboardEmployee(payload)
    const displayName = result?.user?.display_name || result?.display_name || user.display_name
    const extras = [account ? '本地账号' : '', membership ? '任职关系' : ''].filter(Boolean)
    const compatibilityMode = result?.onboarding_mode === 'COMPATIBILITY'
    emit('toast', `${displayName} 已创建${extras.length ? `，并已建立${extras.join('、')}` : ''}。${compatibilityMode ? '后端原子创建接口尚不可用，已按兼容路径完成：用户 → 账号 → 任职关系。' : ''}`)
    emit('completed', result)
    emit('close')
  } catch (error) {
    emit('toast', error instanceof IamError ? error.message : (error?.message || '新增员工失败。'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="console-modal-backdrop" role="presentation" @click.self="close">
    <section class="console-detail-modal console-wizard-modal personnel-workbench-modal" role="dialog" aria-modal="true" aria-label="新增员工">
      <header class="personnel-workbench-header">
        <div>
          <p class="console-modal-eyebrow"><span class="personnel-workbench-eyebrow-icon"><ConsoleIcon name="organization" /></span>人员工作台 · 入职向导</p>
          <h2>新增员工</h2>
          <p class="personnel-workbench-header-hint">一次完成员工档案、登录账号、任职关系与岗位授权继承配置。</p>
        </div>
        <button class="console-modal-close" type="button" aria-label="关闭新增员工" :disabled="saving" @click="close"><ConsoleIcon name="close" /></button>
      </header>

      <form class="console-wizard-body" @submit.prevent="submit">
        <div class="settings-active-summary personnel-workbench-summary">
          <span class="settings-active-summary-icon"><ConsoleIcon name="info" /></span>
          <div class="settings-active-summary-copy">
            <strong>员工编号由服务端自动生成</strong>
            <p>正常情况下建议同时建立账号和任职关系；岗位角色由授权模板动态继承，不会复制成个人手工授权。</p>
          </div>
        </div>

        <div class="personnel-workbench-stepper-heading"><strong>创建流程</strong><span>完成前置检查后即可开始录入</span></div>
        <ol class="console-stepper personnel-workbench-stepper" aria-label="新增员工流程">
          <li class="console-stepper-step" :class="{ active: currentStep === 0, done: currentStep > 0 }" role="button" tabindex="0" @click="goToStep(0)" @keydown.enter.prevent="goToStep(0)">
            <span class="console-stepper-circle">
              <ConsoleIcon v-if="currentStep > 0" name="audit" />
              <span v-else>0</span>
            </span>
            <span class="console-stepper-label">前置检查</span>
          </li>
          <li class="console-stepper-step" :class="{ active: currentStep === 1, done: currentStep > 1 }">
            <span class="console-stepper-circle">
              <ConsoleIcon v-if="currentStep > 1" name="audit" />
              <span v-else>1</span>
            </span>
            <span class="console-stepper-label">基本信息</span>
          </li>
          <li class="console-stepper-step" :class="{ active: currentStep === 2, done: currentStep > 2 }">
            <span class="console-stepper-circle">
              <ConsoleIcon v-if="currentStep > 2" name="audit" />
              <span v-else>2</span>
            </span>
            <span class="console-stepper-label">登录账号</span>
          </li>
          <li class="console-stepper-step" :class="{ active: currentStep === 3, done: currentStep > 3 }">
            <span class="console-stepper-circle">
              <ConsoleIcon v-if="currentStep > 3" name="audit" />
              <span v-else>3</span>
            </span>
            <span class="console-stepper-label">任职关系</span>
          </li>
          <li class="console-stepper-step" :class="{ active: currentStep === 4 }">
            <span class="console-stepper-circle"><span>4</span></span>
            <span class="console-stepper-label">授权预览</span>
          </li>
        </ol>

        <OnboardingPrerequisiteStep
          v-if="currentStep === 0"
          :organizations="organizations"
          :positions="positions"
          :applications="applications"
          :refresh-key="prereqRefreshKey"
          @ready="prerequisitesReady = true"
          @not-ready="prerequisitesReady = false"
          @continue="handlePrerequisitesContinue"
          @refresh="handlePrerequisitesRefresh"
          @toast="(message) => emit('toast', message)"
        />

        <template v-if="currentStep >= 1">
          <section class="console-wizard-section active">
            <div class="console-wizard-section-head">
              <span class="console-wizard-section-icon"><ConsoleIcon name="user" /></span>
              <div>
                <h3>员工基本信息</h3>
                <p>建立人员档案。员工编号和基础平台普通用户能力由服务端统一处理。</p>
              </div>
            </div>
            <div class="console-form-grid">
              <label class="console-form-item"><span>展示姓名 *</span><input v-model="form.display_name" required maxlength="100" placeholder="例如：张三" /></label>
              <label class="console-form-item"><span>状态</span><select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
              <label class="console-form-item"><span>邮箱</span><input v-model="form.email" type="email" placeholder="例如：zhang.san@example.com" /></label>
              <label class="console-form-item"><span>手机号</span><input v-model="form.mobile" maxlength="32" placeholder="例如：13800000000" /></label>
            </div>
          </section>

          <section class="console-wizard-section" :class="{ active: form.create_account, muted: !form.create_account }">
            <div class="console-wizard-section-head">
              <span class="console-wizard-section-icon"><ConsoleIcon name="account" /></span>
              <div>
                <h3>本地登录账号</h3>
                <p>可选。关闭后只创建员工档案，后续可在“登录账号”中补建。</p>
              </div>
              <label class="console-wizard-toggle"><input v-model="form.create_account" type="checkbox" /><span>同时创建</span></label>
            </div>
            <div v-if="form.create_account" class="console-form-grid">
              <label class="console-form-item"><span>登录账号 *</span><input v-model="form.account_name" required minlength="3" maxlength="64" placeholder="例如：zhang.san" /><small class="console-wizard-field-help">账号必须唯一，以字母或数字开头。</small></label>
              <label class="console-form-item"><span>初始密码 *</span><div class="console-password-field"><input v-model="form.initial_password" :type="initialPasswordVisible ? 'text' : 'password'" required minlength="8" maxlength="128" autocomplete="new-password" /><button class="console-password-toggle" type="button" :aria-label="initialPasswordVisible ? '隐藏密码' : '显示密码'" @click="initialPasswordVisible = !initialPasswordVisible"><ConsoleIcon :name="initialPasswordVisible ? 'eye-off' : 'eye'" /></button></div></label>
              <label class="console-form-item"><span>账号有效期 *</span><select v-model="form.validity_mode"><option value="TEMPORARY">临时（默认 1 天）</option><option value="PERMANENT">永久</option></select></label>
              <label v-if="form.validity_mode !== 'PERMANENT'" class="console-form-item"><span>有效截止时间 *</span><input v-model="form.valid_until" required type="datetime-local" /><small class="console-wizard-field-help">到期后账号不能登录。</small></label>
            </div>
          </section>

          <section class="console-wizard-section active">
            <div class="console-wizard-section-head">
              <span class="console-wizard-section-icon"><ConsoleIcon name="role" /></span>
              <div>
                <h3>任职关系</h3>
                <p>必填。用户与人员通过任职关系一一对应；岗位是标准授权的来源。</p>
              </div>
            </div>
            <div class="console-form-grid">
              <label class="console-form-item"><span>所属组织 *</span><select v-model="form.org_unit_id" required><option value="">请选择组织</option><option v-for="item in organizationOptions" :key="item.option_id" :value="item.option_id">{{ item.option_label }}</option></select></label>
              <label class="console-form-item"><span>岗位 *</span><select v-model="form.position_id" :disabled="!form.org_unit_id || !membershipPositions.length" required><option value="">{{ !form.org_unit_id ? '请先选择组织' : (membershipPositions.length ? '请选择岗位' : '当前组织暂无岗位') }}</option><option v-for="item in membershipPositions" :key="positionId(item)" :value="positionId(item)">{{ positionName(item) }}</option></select><small v-if="form.org_unit_id && !membershipPositions.length" class="console-wizard-field-help">当前组织暂无岗位，请先在“岗位”中创建。</small></label>
              <label class="console-form-item"><span>任职类型 *</span><select v-model="form.membership_type"><option value="PRIMARY">主组织</option><option value="SECONDARY">次组织 / 兼岗</option></select></label>
              <label class="console-form-item"><span>生效方式 *</span><select v-model="form.membership_validity_mode"><option value="LONG_TERM">长期生效</option><option value="SHORT_TERM">短期生效</option></select></label>
              <label v-if="form.membership_validity_mode === 'SHORT_TERM'" class="console-form-item"><span>生效日期 *</span><input v-model="form.effective_from" required type="date" /></label>
              <label v-if="form.membership_validity_mode === 'SHORT_TERM'" class="console-form-item"><span>失效日期 *</span><input v-model="form.effective_to" required type="date" /></label>
              <label class="console-wizard-checkbox console-form-item full"><input v-model="form.inherit_authorization" type="checkbox" /><div><span>参与岗位授权继承</span><small class="console-wizard-field-help">关闭不会删除或影响日后设置的个人手工例外授权。</small></div></label>
            </div>
          </section>

          <section class="console-wizard-section" :class="{ active: form.inherit_authorization, muted: !form.inherit_authorization }">
            <div class="console-wizard-section-head">
              <span class="console-wizard-section-icon"><ConsoleIcon name="shield" /></span>
              <div>
                <h3>即将继承的应用角色</h3>
                <p>只展示岗位授权模板计算出的角色。基础平台不会在这里创建或修改子系统的业务角色、权限。</p>
              </div>
            </div>
            <p v-if="!form.inherit_authorization" class="console-wizard-empty">已关闭岗位授权继承。本次仍会创建任职关系，但不会自动获得岗位模板角色。</p>
            <p v-else-if="!selectedPosition" class="console-wizard-empty">请选择组织和岗位后查看授权预览。</p>
            <p v-else-if="authorizationPreviewLoading" class="console-wizard-empty">正在读取 {{ positionName(selectedPosition) }} 的岗位授权模板…</p>
            <p v-else-if="previewConflicts.length" class="console-wizard-empty error">{{ previewConflicts.join('；') }}</p>
            <div v-else-if="previewRoles.length" class="console-wizard-role-list">
              <div v-for="role in previewRoles" :key="`${role.template_id || 'template'}-${role.role_id || role.role_code}`">
                <strong>{{ role.application_name || role.application_code }}</strong>
                <span>{{ role.role_name || role.role_code }}</span>
                <small>来源：{{ role.template_name || '岗位授权模板' }}</small>
              </div>
            </div>
            <p v-else-if="authorizationPreviewUnavailable" class="console-wizard-empty">授权预览接口暂不可用，不影响创建员工；任职保存后会按岗位模板动态生效。接口部署完成后可在用户详情中查看实际角色。</p>
            <p v-else class="console-wizard-empty">该岗位当前没有已生效的授权模板角色。本次不会额外写入个人应用角色。</p>
            <p class="console-wizard-field-help">需要临时增加个人角色时，请在员工创建完成后使用“个人例外授权”；不要在此处重复分配岗位已继承的角色。</p>
          </section>
        </template>

        <div class="console-form-actions">
          <button class="console-button ghost" type="button" :disabled="saving" @click="close">取消</button>
          <button v-if="currentStep >= 1" class="console-button primary" type="submit" :disabled="saving"><ConsoleIcon name="save" />{{ saving ? '创建中…' : '创建员工' }}</button>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.personnel-workbench-modal { overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; border: 1px solid #dce7f5; box-shadow: 0 24px 70px rgba(28, 54, 98, .2); }
.personnel-workbench-header { position: relative; overflow: hidden; padding: 1.45rem 1.75rem 1.3rem; background: linear-gradient(135deg, #f7faff 0%, #edf4ff 100%); border-bottom: 1px solid #e1eaf5; }
.personnel-workbench-header::after { position: absolute; right: -3rem; bottom: -4.5rem; width: 13rem; height: 13rem; content: ''; border: 1.5rem solid rgba(110, 145, 220, .08); border-radius: 50%; }
.personnel-workbench-header > div { position: relative; z-index: 1; }
.personnel-workbench-header h2 { margin-top: .35rem; font-size: 1.45rem; letter-spacing: -.02em; }
.personnel-workbench-header-hint { margin: .4rem 0 0; color: var(--muted, #71829b); font-size: .78rem; line-height: 1.5; }
.personnel-workbench-eyebrow-icon { display: inline-grid; place-items: center; width: 1.35rem; height: 1.35rem; margin-right: .35rem; color: #4b70ca; background: #dfeaff; border-radius: .4rem; vertical-align: middle; }
.personnel-workbench-eyebrow-icon svg { width: .8rem; height: .8rem; }
.personnel-workbench-summary { margin: 1.1rem 0 1.25rem; border: 1px solid #dce8f7; border-radius: .8rem; background: linear-gradient(135deg, #fbfdff, #f5f9ff); }
.personnel-workbench-summary strong { color: #2c4f91; }
.personnel-workbench-summary p { max-width: 680px; }
.personnel-workbench-stepper-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin: 0 0 .65rem; color: var(--text, #263650); }
.personnel-workbench-stepper-heading strong { font-size: .86rem; }
.personnel-workbench-stepper-heading span { color: var(--muted, #71829b); font-size: .73rem; }
.personnel-workbench-stepper { margin-bottom: 1.35rem; padding: .9rem 1rem; border: 1px solid #e3ebf6; border-radius: .75rem; background: #fbfdff; }
.personnel-workbench-modal .console-wizard-section { border-radius: .8rem; box-shadow: 0 2px 8px rgba(41, 68, 111, .025); }
.personnel-workbench-modal .console-wizard-section.active { border-left-width: 4px; box-shadow: 0 5px 16px rgba(56, 92, 150, .06); }
.personnel-workbench-modal .console-wizard-section-head h3 { font-size: .92rem; }
.personnel-workbench-modal .console-wizard-section-head p { max-width: 650px; }
.personnel-workbench-modal .console-wizard-section-icon { border-radius: .7rem; }
.personnel-workbench-modal .console-form-item input, .personnel-workbench-modal .console-form-item select { min-height: 2.35rem; }
.personnel-workbench-modal .console-wizard-role-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.personnel-workbench-modal .console-wizard-role-list > div { position: relative; padding: .85rem .9rem .85rem 1.05rem; border-color: #dfe8f4; box-shadow: 0 2px 7px rgba(45, 76, 124, .035); }
.personnel-workbench-modal .console-wizard-role-list > div::before { position: absolute; top: 0; bottom: 0; left: 0; width: 3px; content: ''; border-radius: 7px 0 0 7px; background: #7b9ce2; }
.personnel-workbench-modal .console-wizard-empty { background: #fbfdff; }
.personnel-workbench-modal .console-form-actions { position: sticky; bottom: 0; z-index: 2; margin: 1rem -1.75rem -1.5rem; padding: .9rem 1.75rem; border-top: 1px solid #e3ebf6; background: rgba(255, 255, 255, .94); backdrop-filter: blur(8px); }
@media (max-width: 760px) {
  .personnel-workbench-header { padding: 1.2rem 1.15rem 1.1rem; }
  .personnel-workbench-modal .console-wizard-body { padding: 1rem 1.15rem 1.25rem; }
  .personnel-workbench-summary { margin-top: .85rem; }
  .personnel-workbench-stepper { padding: .75rem; }
  .personnel-workbench-stepper-heading { align-items: flex-start; flex-direction: column; gap: .2rem; }
  .personnel-workbench-modal .console-wizard-role-list { grid-template-columns: 1fr; }
  .personnel-workbench-modal .console-form-actions { margin-right: -1.15rem; margin-left: -1.15rem; padding-right: 1.15rem; padding-left: 1.15rem; }
}
@media (max-width: 480px) {
  .personnel-workbench-header h2 { font-size: 1.25rem; }
  .personnel-workbench-header-hint { max-width: 18rem; }
  .personnel-workbench-modal .console-form-actions { flex-direction: column-reverse; }
  .personnel-workbench-modal .console-form-actions .console-button { width: 100%; justify-content: center; }
}
</style>
