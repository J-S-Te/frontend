<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  fetchSubsystemAccessOperation,
  findSubsystemAccessOperation,
  getSubsystemCapabilities,
  previewSubsystemAccess,
  resumeSubsystemAccessOperation,
  submitSubsystemAccessOperation,
} from '../api/applications.js'
import { pollDeployment } from '../utils/deploymentPolling.mjs'
import {
  SUBSYSTEM_ACCESS_STEPS,
  actionLabel,
  canConfirmPreview,
  isResumableOperation,
  markApplicationScope,
  missingItems,
  subsystemAccessIdempotencyKey,
  subsystemAccessStepIndex,
} from '../utils/subsystemAccessFlow.mjs'
import { formatUserError, userErrorDiagnostics } from '../../../shared/utils/userError.js'
import SubsystemAccessProgress from './SubsystemAccessProgress.vue'

const props = defineProps({
  canPreview: { type: Boolean, default: false },
  canSubmit: { type: Boolean, default: false },
  environments: { type: Array, default: () => [] },
  variant: { type: String, default: 'button' },
  applications: { type: Array, default: () => [] },
  defaultEnvironment: { type: String, default: 'dev' },
})

const emit = defineEmits(['toast', 'completed'])

// 常驻页面只保留一个入口按钮；点击后在弹层里使用向导（避免占用页面主区域）。
const wizardOpen = ref(false)
const openWizard = () => { wizardOpen.value = true }
const closeWizard = () => { wizardOpen.value = false }

// 平台已知的默认值：公开地址取控制台自身的 origin（子系统公开地址即平台公开地址 + 路径前缀），
// 认证提供方默认使用平台提供方（platform）；两者都放在「高级设置」里，允许覆盖。
const platformDefaultOrigin = typeof window !== 'undefined' && window.location ? window.location.origin : ''

const form = reactive({
  applicationCode: '',
  environment: props.defaultEnvironment || 'dev',
  publicOrigin: platformDefaultOrigin,
  authProvider: 'platform',
  initialAdminId: '',
})

const preview = ref(null)
const operation = ref(null)
const stages = ref([])
const missing = ref([])
const busy = ref(false)
const errorText = ref('')
const errorNextAction = ref('')
const errorDiagnostics = ref({})
let observer = null

const stepIndex = computed(() => subsystemAccessStepIndex({
  applicationCode: form.applicationCode,
  environment: form.environment,
  preview: preview.value,
  operation: operation.value,
}))
// 标准环境码：与 CLI 的固定集合（dev/test/staging/prod）一致。
// 父视图未提供「已登记环境」时（例如尚未在其它模块选中应用），用它作为可选项，避免下拉为空无法选择。
const STANDARD_ENVIRONMENT_CODES = ['dev', 'test', 'staging', 'prod']

const environmentOptions = computed(() => {
  const provided = (Array.isArray(props.environments) ? props.environments : [])
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
  const unique = [...new Set(provided)]
  return unique.length ? unique : STANDARD_ENVIRONMENT_CODES
})

const usingStandardEnvironments = computed(() =>
  (Array.isArray(props.environments) ? props.environments : []).filter(Boolean).length === 0,
)
const canPreviewNow = computed(() => props.canPreview && Boolean(String(form.applicationCode).trim()) && Boolean(String(form.environment).trim()) && !busy.value)
const canConfirm = computed(() => props.canSubmit && canConfirmPreview(preview.value) && !busy.value)

// 已提交后：可继续则显示「继续处理」，否则显示「重新检查」。
const operationResumable = computed(() => isResumableOperation(operation.value))
const previewMissing = computed(() => missingItems(preview.value?.missing))
const previewAction = computed(() => (preview.value ? actionLabel(preview.value.action) : ''))

function clearError() {
  errorText.value = ''
  errorNextAction.value = ''
  errorDiagnostics.value = {}
}

function reportError(error, fallback) {
  const formatted = formatUserError(error, { fallback })
  errorText.value = formatted || fallback
  errorNextAction.value = ''
  errorDiagnostics.value = userErrorDiagnostics(error)
}

function stopObserver() {
  observer?.abort()
  observer = null
}

onBeforeUnmount(stopObserver)

// 候选系统按服务端清单标注范围：清单不可用时不过滤（服务端仍会拒绝范围外目标）。
const capabilityCodes = ref(null)
const applicationOptions = computed(() => markApplicationScope(props.applications, capabilityCodes.value))
onMounted(async () => {
  try {
    const capabilities = await getSubsystemCapabilities()
    const codes = capabilities?.supported_application_codes
    capabilityCodes.value = Array.isArray(codes) ? codes : null
  } catch {
    capabilityCodes.value = null
  }
})

// 目标（系统/环境）变化时立即丢弃旧预览与旧操作：轮询中的旧操作也会被中止，
// 避免“切到 B 却恢复/检查了 A”的误操作。
watch(
  () => [form.applicationCode, form.environment],
  () => {
    resetFlow()
  },
)

function applyOperationPayload(payload) {
  operation.value = payload
  stages.value = Array.isArray(payload?.stages) ? payload.stages : []
  missing.value = missingItems(payload?.missing)
}

async function runPreview() {
  if (!canPreviewNow.value) return
  clearError()
  busy.value = true
  stopObserver()
  operation.value = null
  stages.value = []
  missing.value = []
  try {
    preview.value = await previewSubsystemAccess({ applicationCode: form.applicationCode, environment: form.environment })
  } catch (error) {
    preview.value = null
    reportError(error, '条件检查失败，请稍后重试。')
  } finally {
    busy.value = false
  }
}

function watchOperation(operationId) {
  stopObserver()
  observer = new AbortController()
  return pollDeployment({
    immediate: true,
    signal: observer.signal,
    terminalStatuses: ['SUCCEEDED', 'FAILED', 'WAITING'],
    readStatus: async () => {
      const payload = await fetchSubsystemAccessOperation(operationId)
      applyOperationPayload(payload)
      return payload
    },
  }).then((result) => {
    // 轮询到达上限（默认 20 分钟）时必须明确告知，否则页面会永远停在最后一次
    // "执行中"的状态上，用户不知道需要重新连接。
    if (result === 'TIMEOUT') {
      reportError(Object.assign(new Error('POLL_TIMEOUT'), { code: 'POLL_TIMEOUT' }),
        '进度查询已超时：操作可能仍在后台执行。请重新点击"继续处理"恢复查询，或稍后在操作记录中查看最终结果。')
      return 'TIMEOUT'
    }
    return result
  }).catch((error) => {
    reportError(error, '读取接入进度失败，请稍后重试。')
    return 'ERROR'
  })
}

async function confirmAndSubmit() {
  if (!canConfirm.value) return
  clearError()
  busy.value = true
  try {
    const idempotencyKey = subsystemAccessIdempotencyKey({
      applicationCode: form.applicationCode,
      environment: form.environment,
      previewVersion: preview.value?.preview_version,
    })
    const result = await submitSubsystemAccessOperation({
      applicationCode: form.applicationCode,
      environment: form.environment,
      publicOrigin: form.publicOrigin,
      authProvider: form.authProvider,
      initialAdminId: form.initialAdminId,
      previewVersion: preview.value?.preview_version,
      idempotencyKey,
    })
    if (!result?.operation_id) {
      emit('toast', { type: 'success', message: '目标已接入且配置一致，无需重复操作。' })
      emit('completed')
      return
    }
    applyOperationPayload({ operation_id: result.operation_id, action: result.action, stage: result.stage, status: result.status, stages: [], missing: [] })
    emit('toast', { type: 'success', message: '接入操作已受理，正在自动执行。' })
    // 受理≠完成：受理时刷新父视图会读到"还没有目录/环境"的中间态；
    // 只有状态机真正到达 SUCCEEDED 才通知父视图刷新。
    const finalStatus = await watchOperation(result.operation_id)
    if (finalStatus === 'SUCCEEDED') emit('completed')
  } catch (error) {
    reportError(error, '提交接入操作失败，请稍后重试。')
  } finally {
    busy.value = false
  }
}

async function resumeOperation() {
  const operationId = operation.value?.operation_id
  if (!operationId || busy.value) return
  clearError()
  busy.value = true
  try {
    const payload = await resumeSubsystemAccessOperation(operationId)
    applyOperationPayload(payload)
    let finalStatus = String(payload?.status || '').toUpperCase()
    if (['RUNNING', 'PENDING'].includes(finalStatus)) {
      finalStatus = await watchOperation(operationId)
    }
    if (finalStatus === 'SUCCEEDED') emit('completed')
  } catch (error) {
    reportError(error, '恢复检查失败，请稍后重试。')
  } finally {
    busy.value = false
  }
}

async function reconnectTarget() {
  if (!canPreviewNow.value) return
  clearError()
  busy.value = true
  try {
    const payload = await findSubsystemAccessOperation({ applicationCode: form.applicationCode, environment: form.environment })
    applyOperationPayload(payload)
    let finalStatus = String(payload?.status || '').toUpperCase()
    if (!['SUCCEEDED', 'FAILED', 'WAITING'].includes(finalStatus)) {
      finalStatus = await watchOperation(payload?.operation_id)
    }
    if (finalStatus === 'SUCCEEDED') emit('completed')
  } catch (error) {
    // 404 = 该目标还没有任何接入操作，这是正常状态而不是错误：给出提示但不报错。
    if (isNotFoundError(error)) {
      emit('toast', '该目标当前没有接入操作；先点「检查条件」，再点「确认执行」即可开始。')
    } else {
      reportError(error, '读取当前操作失败，请稍后重试。')
    }
  } finally {
    busy.value = false
  }
}

function isNotFoundError(error) {
  const status = Number(error?.status || error?.statusCode || 0)
  if (status === 404) return true
  const code = String(error?.code || error?.details?.code || '')
  return code === 'NOT_FOUND' || code === 'PLATFORM_NOT_FOUND'
}

function resetFlow() {
  stopObserver()
  preview.value = null
  operation.value = null
  stages.value = []
  missing.value = []
  clearError()
}
</script>

<template>
  <div class="subsystem-access-wizard">
  <button
    type="button"
    :class="variant === 'nav' ? 'console-nav-item' : 'subsystem-access-wizard__trigger'"
    @click="openWizard"
  >
    <span>接入向导</span>
  </button>

  <div v-if="wizardOpen" class="subsystem-access-wizard__overlay" @click.self="closeWizard">
    <section
      class="subsystem-access-wizard__dialog"
      role="dialog"
      aria-modal="true"
      aria-label="接入向导"
      tabindex="-1"
      @keydown.esc="closeWizard"
    >
    <header class="subsystem-access-wizard__header">
      <div class="subsystem-access-wizard__heading">
        <p class="subsystem-access-wizard__eyebrow">统一接入向导</p>
        <h3 class="subsystem-access-wizard__title">选择系统与环境 → 检查条件 → 确认操作 → 自动执行 → 查看结果／继续恢复</h3>
      </div>
      <div class="subsystem-access-wizard__header-actions">
        <span class="subsystem-access-wizard__badge">
          第 {{ stepIndex + 1 }} / {{ SUBSYSTEM_ACCESS_STEPS.length }} 步 · {{ SUBSYSTEM_ACCESS_STEPS[stepIndex]?.label }}
        </span>
        <button type="button" class="subsystem-access-wizard__close" aria-label="关闭" @click="closeWizard">×</button>
      </div>
    </header>

    <ol class="subsystem-access-wizard__steps">
      <li
        v-for="(step, index) in SUBSYSTEM_ACCESS_STEPS"
        :key="step.key"
        :data-active="index === stepIndex"
        :data-done="index < stepIndex"
      >
        <span class="subsystem-access-wizard__step-index">
          <template v-if="index < stepIndex">✓</template>
          <template v-else>{{ index + 1 }}</template>
        </span>
        <span class="subsystem-access-wizard__step-label">{{ step.label }}</span>
      </li>
    </ol>

    <form class="subsystem-access-wizard__form" @submit.prevent="runPreview">
      <fieldset class="subsystem-access-wizard__fieldset" :disabled="busy">
        <legend>目标</legend>
        <div class="subsystem-access-wizard__grid">
          <label class="subsystem-access-wizard__field">
            <span>系统</span>
            <select v-model="form.applicationCode" :disabled="busy">
              <option value="">请选择系统</option>
              <option v-for="item in applicationOptions" :key="item.code" :value="item.code" :disabled="item.inScope === false">
                {{ item.name || item.code }}<template v-if="item.inScope === false">（不在当前交付清单内）</template>
              </option>
            </select>
          </label>
          <label class="subsystem-access-wizard__field">
            <span>环境</span>
            <select v-model="form.environment" :disabled="busy">
              <option v-for="item in environmentOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <details class="subsystem-access-wizard__advanced">
            <summary>高级设置（已按平台配置带入，可修改）</summary>
            <p class="subsystem-access-wizard__muted">
              公开地址默认取当前控制台地址；认证提供方默认 platform（Keycloak 环境可改为 keycloak）；初始管理员仅首次接入需要。
            </p>
            <div class="subsystem-access-wizard__grid">
              <label class="subsystem-access-wizard__field">
                <span>对外公开地址</span>
                <input v-model.trim="form.publicOrigin" type="url" placeholder="https://subsystem.example.com" :disabled="busy" maxlength="512">
              </label>
              <label class="subsystem-access-wizard__field">
                <span>认证提供方</span>
                <input v-model.trim="form.authProvider" type="text" placeholder="platform / keycloak" :disabled="busy" maxlength="128">
              </label>
              <label class="subsystem-access-wizard__field subsystem-access-wizard__field--wide">
                <span>初始管理员<span class="subsystem-access-wizard__optional">仅首次接入需要</span></span>
                <input v-model.trim="form.initialAdminId" type="text" placeholder="用户 ID" :disabled="busy" maxlength="128">
              </label>
            </div>
          </details>
        </div>
        <p v-if="usingStandardEnvironments" class="subsystem-access-wizard__note">
          未读取到该应用已登记的环境，先按标准环境码选择（dev / test / staging / prod）。
        </p>
      </fieldset>
      <div class="subsystem-access-wizard__actions">
        <button type="submit" class="subsystem-access-wizard__button subsystem-access-wizard__button--primary" :class="{ 'is-busy': busy }" :disabled="!canPreviewNow">检查条件</button>
        <button type="button" class="subsystem-access-wizard__button" :disabled="!canPreviewNow" @click="reconnectTarget">查看当前操作</button>
        <button type="button" class="subsystem-access-wizard__button subsystem-access-wizard__button--ghost" :disabled="busy" @click="resetFlow">重置</button>
      </div>
    </form>

    <p v-if="errorText" class="subsystem-access-wizard__error" role="alert">
      <span class="subsystem-access-wizard__error-icon" aria-hidden="true">!</span>
      <span>
        {{ errorText }}
        <small v-if="errorDiagnostics.code">（{{ errorDiagnostics.code }}<span v-if="errorDiagnostics.requestId"> · {{ errorDiagnostics.requestId }}</span>）</small>
        <small v-if="errorNextAction">下一步：{{ errorNextAction }}</small>
      </span>
    </p>

    <section v-if="preview" class="subsystem-access-wizard__preview" aria-label="条件检查结果">
      <div class="subsystem-access-wizard__preview-head">
        <h4>条件检查结果</h4>
        <span
          class="subsystem-access-wizard__chip"
          :data-tone="preview.execution_path === 'legacy' ? 'warn' : (preview.display_only ? 'muted' : 'ok')"
        >
          {{ preview.execution_path === 'legacy' ? '走既有入口' : (preview.display_only ? '无需操作' : '可自动执行') }}
        </span>
      </div>

      <dl class="subsystem-access-wizard__facts">
        <div>
          <dt>判定动作</dt>
          <dd>{{ previewAction }}<span v-if="preview.reason" class="subsystem-access-wizard__muted">（{{ preview.reason }}）</span></dd>
        </div>
        <div>
          <dt>起始阶段</dt>
          <dd>{{ preview.next_stage }}</dd>
        </div>
      </dl>

      <p v-if="preview.display_only" class="subsystem-access-wizard__hint">目标已接入且配置一致，无需重复操作。</p>
      <p v-if="preview.execution_path === 'legacy'" class="subsystem-access-wizard__hint">
        该动作当前由既有受控更新入口执行：{{ preview.legacy_hint }}
      </p>

      <div v-if="previewMissing.length && !preview.display_only" class="subsystem-access-wizard__block">
        <h5>未满足条件</h5>
        <ul class="subsystem-access-wizard__missing">
          <li v-for="item in previewMissing" :key="item.code || item.message">
            <strong v-if="item.code" class="subsystem-access-wizard__code">{{ item.code }}</strong>
            <span>{{ item.message }}</span>
            <small v-if="item.nextAction">下一步：{{ item.nextAction }}</small>
          </li>
        </ul>
      </div>

      <p v-if="preview.missing_permissions?.length" class="subsystem-access-wizard__warn">
        当前账号缺少权限：{{ preview.missing_permissions.join('、') }}
      </p>
      <p v-if="preview.required_permissions?.length" class="subsystem-access-wizard__muted">
        所需权限：{{ preview.required_permissions.join('、') }}
      </p>

      <div v-if="preview.change_summary?.length" class="subsystem-access-wizard__block">
        <h5>变更摘要</h5>
        <ul class="subsystem-access-wizard__summary">
          <li v-for="item in preview.change_summary" :key="item">{{ item }}</li>
        </ul>
      </div>

      <p class="subsystem-access-wizard__hint">确认后由服务端按上述判定自动执行；缺少批准、许可证、镜像或认证观察期未结束时会进入"等待处理"。</p>
      <div class="subsystem-access-wizard__actions">
        <button
          v-if="operation && operationResumable"
          type="button"
          class="subsystem-access-wizard__button subsystem-access-wizard__button--primary"
          :class="{ 'is-busy': busy }"
          :disabled="busy"
          @click="resumeOperation"
        >
          继续处理
        </button>
        <button
          v-else-if="operation"
          type="button"
          class="subsystem-access-wizard__button"
          :disabled="busy"
          @click="runPreview"
        >
          重新检查
        </button>
        <button
          v-else
          type="button"
          class="subsystem-access-wizard__button subsystem-access-wizard__button--primary"
          :class="{ 'is-busy': busy }"
          :disabled="!canConfirm"
          @click="confirmAndSubmit"
        >
          确认执行
        </button>
      </div>
    </section>

    <!-- 明确展示"这个操作属于哪个目标"：操作来自上一次提交或恢复，
         可能与当前表单选择不同（例如从操作记录恢复），避免误以为是当前选择的目标。 -->
    <p v-if="operation" class="subsystem-access-wizard__muted" data-testid="operation-target">
      当前操作目标：{{ operation.application_code || form.applicationCode }} / {{ operation.environment || operation.environment_code || form.environment }}
    </p>
    <SubsystemAccessProgress
      v-if="operation"
      :operation="operation"
      :stages="stages"
      :missing="missing"
      :busy="busy"
      @resume="resumeOperation"
    />
    </section>
  </div>
</div>
</template>

<style scoped>
.subsystem-access-wizard {
  --sa-accent: #2563eb;
  --sa-accent-soft: rgba(37, 99, 235, 0.1);
  --sa-border: #e2e8f0;
  --sa-surface: #ffffff;
  --sa-surface-muted: #f8fafc;
  --sa-text: #0f172a;
  --sa-text-muted: #64748b;
  --sa-warn: #b45309;
  --sa-warn-soft: rgba(180, 83, 9, 0.1);
  --sa-danger: #b91c1c;
  --sa-danger-soft: rgba(185, 28, 28, 0.08);
  --sa-radius: 12px;
  display: grid;
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--sa-border);
  border-radius: 16px;
  background: linear-gradient(180deg, #fbfdff 0%, var(--sa-surface) 120px);
  color: var(--sa-text);
  font-size: 14px;
}

.subsystem-access-wizard__header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.subsystem-access-wizard__heading { display: grid; gap: 4px; max-width: 62ch; }

.subsystem-access-wizard__eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sa-accent);
}

.subsystem-access-wizard__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
}

.subsystem-access-wizard__badge {
  flex: none;
  padding: 5px 10px;
  border: 1px solid var(--sa-border);
  border-radius: 999px;
  background: var(--sa-surface);
  color: var(--sa-text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.subsystem-access-wizard__steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.subsystem-access-wizard__steps li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid var(--sa-border);
  border-radius: 10px;
  background: var(--sa-surface);
  color: var(--sa-text-muted);
  font-size: 13px;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.subsystem-access-wizard__steps li[data-done='true'] {
  border-color: rgba(37, 99, 235, 0.35);
  background: var(--sa-accent-soft);
  color: var(--sa-accent);
}

.subsystem-access-wizard__steps li[data-active='true'] {
  border-color: var(--sa-accent);
  box-shadow: 0 0 0 3px var(--sa-accent-soft);
  background: var(--sa-surface);
  color: var(--sa-text);
  font-weight: 600;
}

.subsystem-access-wizard__step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 50%;
  background: var(--sa-surface-muted);
  color: inherit;
  font-size: 12px;
  font-weight: 600;
}

.subsystem-access-wizard__steps li[data-active='true'] .subsystem-access-wizard__step-index {
  background: var(--sa-accent);
  color: #fff;
}

.subsystem-access-wizard__step-label { line-height: 1.35; }

.subsystem-access-wizard__form { display: grid; gap: 14px; }

.subsystem-access-wizard__fieldset {
  margin: 0;
  padding: 16px;
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius);
  background: var(--sa-surface);
}

.subsystem-access-wizard__advanced {
  grid-column: 1 / -1;
  padding: 12px 14px;
  border: 1px dashed var(--sa-border);
  border-radius: 10px;
  background: var(--sa-surface-muted);
}

.subsystem-access-wizard__advanced > summary {
  cursor: pointer;
  color: var(--sa-text-muted);
  font-size: 13px;
  font-weight: 600;
  list-style: none;
}

.subsystem-access-wizard__advanced > summary::-webkit-details-marker { display: none; }

.subsystem-access-wizard__advanced > summary::before {
  content: "▸ ";
  display: inline-block;
  transition: transform 0.15s ease;
}

.subsystem-access-wizard__advanced[open] > summary::before { content: "▾ "; }

.subsystem-access-wizard__advanced > .subsystem-access-wizard__grid { margin-top: 12px; }

.subsystem-access-wizard__fieldset legend {
  padding: 0 6px;
  color: var(--sa-text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.subsystem-access-wizard__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.subsystem-access-wizard__field { display: grid; gap: 6px; font-size: 13px; }
.subsystem-access-wizard__field--wide { grid-column: 1 / -1; }

.subsystem-access-wizard__field > span {
  display: flex;
  gap: 8px;
  align-items: baseline;
  color: var(--sa-text-muted);
  font-weight: 500;
}

.subsystem-access-wizard__optional {
  color: var(--sa-text-muted);
  font-size: 11px;
  font-weight: 400;
  opacity: 0.85;
}

.subsystem-access-wizard__field select,
.subsystem-access-wizard__field input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border: 1px solid var(--sa-border);
  border-radius: 9px;
  background: var(--sa-surface);
  color: var(--sa-text);
  font: inherit;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.subsystem-access-wizard__field select:focus-visible,
.subsystem-access-wizard__field input:focus-visible {
  outline: none;
  border-color: var(--sa-accent);
  box-shadow: 0 0 0 3px var(--sa-accent-soft);
}

.subsystem-access-wizard__field select:disabled,
.subsystem-access-wizard__field input:disabled {
  background: var(--sa-surface-muted);
  color: var(--sa-text-muted);
  cursor: not-allowed;
}

.subsystem-access-wizard__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.subsystem-access-wizard__button {
  padding: 9px 16px;
  border: 1px solid var(--sa-border);
  border-radius: 9px;
  background: var(--sa-surface);
  color: var(--sa-text);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.subsystem-access-wizard__button:hover:not(:disabled) { border-color: #cbd5e1; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08); }
.subsystem-access-wizard__button:active:not(:disabled) { transform: translateY(1px); }

.subsystem-access-wizard__button--primary {
  border-color: var(--sa-accent);
  background: var(--sa-accent);
  color: #fff;
}

.subsystem-access-wizard__button--primary:hover:not(:disabled) { background: #1d4ed8; border-color: #1d4ed8; }

.subsystem-access-wizard__button--ghost { background: transparent; color: var(--sa-text-muted); }

.subsystem-access-wizard__button:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }

.subsystem-access-wizard__button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--sa-accent-soft), 0 0 0 1px var(--sa-accent);
}

.subsystem-access-wizard__error {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgba(185, 28, 28, 0.3);
  border-radius: var(--sa-radius);
  background: var(--sa-danger-soft);
  color: var(--sa-danger);
}

.subsystem-access-wizard__error small { display: block; margin-top: 4px; color: inherit; opacity: 0.85; }

.subsystem-access-wizard__error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 50%;
  background: var(--sa-danger);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.subsystem-access-wizard__preview {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius);
  background: var(--sa-surface);
}

.subsystem-access-wizard__preview-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.subsystem-access-wizard__preview-head h4 { margin: 0; font-size: 15px; font-weight: 600; }

.subsystem-access-wizard__chip {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--sa-border);
  background: var(--sa-surface-muted);
  color: var(--sa-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.subsystem-access-wizard__chip[data-tone='ok'] { border-color: rgba(21, 128, 61, 0.3); background: rgba(21, 128, 61, 0.1); color: #15803d; }
.subsystem-access-wizard__chip[data-tone='warn'] { border-color: rgba(180, 83, 9, 0.3); background: var(--sa-warn-soft); color: var(--sa-warn); }

.subsystem-access-wizard__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin: 0;
}

.subsystem-access-wizard__facts > div {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--sa-border);
  border-radius: 10px;
  background: var(--sa-surface-muted);
}

.subsystem-access-wizard__facts dt { color: var(--sa-text-muted); font-size: 12px; }
.subsystem-access-wizard__facts dd { margin: 0; font-weight: 600; }

.subsystem-access-wizard__block { display: grid; gap: 8px; }
.subsystem-access-wizard__block h5 { margin: 0; font-size: 13px; font-weight: 600; color: var(--sa-text-muted); }

.subsystem-access-wizard__missing,
.subsystem-access-wizard__summary { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }

.subsystem-access-wizard__missing li {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--sa-border);
  border-left: 3px solid var(--sa-warn);
  border-radius: 8px;
  background: var(--sa-surface-muted);
}

.subsystem-access-wizard__missing small,
.subsystem-access-wizard__summary small { color: var(--sa-text-muted); }

.subsystem-access-wizard__summary li {
  padding: 8px 12px;
  border: 1px dashed var(--sa-border);
  border-radius: 8px;
  color: var(--sa-text);
}

.subsystem-access-wizard__code {
  display: inline-block;
  width: fit-content;
  padding: 1px 7px;
  border-radius: 6px;
  background: var(--sa-warn-soft);
  color: var(--sa-warn);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.subsystem-access-wizard__hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--sa-surface-muted);
  color: var(--sa-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.subsystem-access-wizard__warn { margin: 0; color: var(--sa-warn); font-weight: 500; }
.subsystem-access-wizard__muted { margin: 0; color: var(--sa-text-muted); }

@media (max-width: 640px) {
  .subsystem-access-wizard { padding: 16px; }
  .subsystem-access-wizard__steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (prefers-reduced-motion: reduce) {
  .subsystem-access-wizard *,
  .subsystem-access-wizard *::before,
  .subsystem-access-wizard *::after { transition: none !important; }
}

/* ---- 布局收敛（覆盖上面的宽松取值） ---- */
.subsystem-access-wizard {
  max-width: 1080px;
  margin-inline: auto;
  gap: 14px;
  padding: 18px 20px;
}

.subsystem-access-wizard__title { font-size: 15px; }

.subsystem-access-wizard__steps { grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 6px; }
.subsystem-access-wizard__steps li { padding: 6px 9px; font-size: 12px; gap: 6px; }
.subsystem-access-wizard__step-index { width: 18px; height: 18px; font-size: 11px; }

.subsystem-access-wizard__fieldset { padding: 14px 16px; }
.subsystem-access-wizard__grid { gap: 12px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

.subsystem-access-wizard__note {
  margin: 8px 0 0;
  color: var(--sa-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.subsystem-access-wizard__actions { margin-top: 2px; }

.subsystem-access-wizard__facts { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
.subsystem-access-wizard__facts > div { padding: 7px 10px; }
.subsystem-access-wizard__facts dt { font-size: 11px; }
.subsystem-access-wizard__facts dd { font-size: 13px; }

.subsystem-access-wizard__preview { padding: 14px; gap: 10px; }
.subsystem-access-wizard__hint { padding: 8px 10px; font-size: 12px; }

@media (max-width: 720px) {
  .subsystem-access-wizard { padding: 14px; }
  .subsystem-access-wizard__steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* ---- 入口按钮与弹层 ---- */
.subsystem-access-wizard { display: block; max-width: none; margin: 0; padding: 0; border: 0; background: none; gap: 0; }

.subsystem-access-wizard__trigger {
  padding: 9px 18px;
  border: 1px solid var(--sa-accent);
  border-radius: 9px;
  background: var(--sa-accent);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.subsystem-access-wizard__trigger:hover { background: #1d4ed8; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.28); }
.subsystem-access-wizard__trigger:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--sa-accent-soft); }

.subsystem-access-wizard__overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 20px;
  overflow: auto;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
}

.subsystem-access-wizard__dialog {
  width: min(1080px, 100%);
  display: grid;
  gap: 14px;
  padding: 20px 22px;
  border: 1px solid var(--sa-border);
  border-radius: 16px;
  background: linear-gradient(180deg, #fbfdff 0%, var(--sa-surface) 120px);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
  outline: none;
}

.subsystem-access-wizard__header-actions { display: flex; align-items: center; gap: 8px; }

.subsystem-access-wizard__close {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--sa-border);
  border-radius: 8px;
  background: var(--sa-surface);
  color: var(--sa-text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.subsystem-access-wizard__close:hover { color: var(--sa-text); border-color: #cbd5e1; }

/* ---- 按钮位置：主按钮靠右、次按钮靠左（操作顺序稳定） ---- */
.subsystem-access-wizard__actions { justify-content: flex-end; }
.subsystem-access-wizard__actions > .subsystem-access-wizard__button--ghost { margin-right: auto; }

/* ---- 动态反馈（纯 CSS，尊重 reduced-motion） ---- */
@keyframes sa-fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes sa-spin { to { transform: rotate(360deg); } }
@keyframes sa-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(180, 83, 9, 0.35); } 50% { box-shadow: 0 0 0 5px rgba(180, 83, 9, 0); } }
@keyframes sa-shimmer { 0% { background-position: -220px 0; } 100% { background-position: 220px 0; } }

.subsystem-access-wizard__preview,
.subsystem-access-wizard__error,
.subsystem-access-wizard__dialog { animation: sa-fade-up 0.18s ease-out both; }

.subsystem-access-wizard__steps li[data-active="true"] {
  background-image: linear-gradient(90deg, transparent 0%, rgba(37, 99, 235, 0.08) 45%, transparent 90%);
  background-size: 220px 100%;
  background-repeat: no-repeat;
  animation: sa-shimmer 1.8s ease-in-out infinite;
}

.subsystem-access-wizard__chip[data-tone="warn"] { animation: sa-pulse 2s ease-in-out infinite; }

.subsystem-access-wizard__button.is-busy { position: relative; padding-left: 34px; cursor: progress; }

.subsystem-access-wizard__button.is-busy::before {
  content: "";
  position: absolute;
  left: 12px;
  top: 50%;
  width: 13px;
  height: 13px;
  margin-top: -7px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: sa-spin 0.7s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .subsystem-access-wizard__preview,
  .subsystem-access-wizard__error,
  .subsystem-access-wizard__dialog,
  .subsystem-access-wizard__steps li[data-active="true"],
  .subsystem-access-wizard__chip[data-tone="warn"],
  .subsystem-access-wizard__button.is-busy::before { animation: none !important; }
}
</style>
