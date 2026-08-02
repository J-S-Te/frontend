<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import {
  IamError,
  createOrgUnit,
  createPosition,
} from '@/modules/platform/iam/api/iam'
import { listPositionAuthorizationTargets } from '@/modules/platform/iam/api/positionAuthorization'
import { createApplication } from '@/modules/platform/applications/api/applications'
import { organizationSelectOptions } from '@/modules/platform/iam/utils/selectionCatalog'

const props = defineProps({
  organizations: { type: Array, default: () => [] },
  positions: { type: Array, default: () => [] },
  applications: { type: Array, default: () => [] },
  // 父级每次发起后台刷新时递增；递增后本组件会重新评估 app catalog 与整体状态。
  refreshKey: { type: Number, default: 0 },
})

const emit = defineEmits(['ready', 'not-ready', 'continue', 'refresh', 'toast'])

// 应用 catalog 的真实"目标数"需要去问后端，prop 的 applications 是基础平台注册的应用列表。
// 两者可能不完全一致 —— 没有 catalog 就没有可分配的岗位授权模板，因此这里独立检查。
const appCatalogLoading = ref(false)
const appCatalogCount = ref(0)
const appCatalogChecked = ref(false)
const appCatalogError = ref('')

const orgForm = reactive({ name: '', parentId: '', sortOrder: 0 })
const positionForm = reactive({ orgUnitId: '', name: '' })
const applicationForm = reactive({ code: '', name: '', applicationType: 'web' })

const activeForm = ref('') // '' | 'organization' | 'position' | 'application'
const creatingKind = ref('')
const formError = ref('')

const organizationCount = computed(() => props.organizations.length)
const positionCount = computed(() => props.positions.length)
const organizationOptions = computed(() => organizationSelectOptions(props.organizations))

const organizationReady = computed(() => organizationCount.value > 0)
const positionReady = computed(() => positionCount.value > 0)
const applicationReady = computed(() => appCatalogCount.value > 0)

const allReady = computed(() => organizationReady.value && positionReady.value && applicationReady.value)

function emitReadyState() {
  if (allReady.value) emit('ready')
  else emit('not-ready')
}

function showToast(message) { emit('toast', message) }

async function loadAppCatalog() {
  appCatalogLoading.value = true
  appCatalogError.value = ''
  try {
    const data = await listPositionAuthorizationTargets()
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
    appCatalogCount.value = items.length
  } catch (error) {
    appCatalogError.value = error?.message || '读取应用目录失败。'
    appCatalogCount.value = 0
    console.error('OnboardingPrerequisiteStep: listPositionAuthorizationTargets failed', error)
  } finally {
    appCatalogLoading.value = false
    appCatalogChecked.value = true
    emitReadyState()
  }
}

function openForm(kind) {
  formError.value = ''
  activeForm.value = kind
  if (kind === 'position' && !positionForm.orgUnitId && organizationOptions.value.length) {
    positionForm.orgUnitId = organizationOptions.value[0].option_id
  }
}

function cancelForm() {
  activeForm.value = ''
  formError.value = ''
  creatingKind.value = ''
}

async function submitOrganization() {
  if (creatingKind.value) return
  const name = String(orgForm.name || '').trim()
  if (!name) { formError.value = '请填写组织名称。'; return }
  creatingKind.value = 'organization'
  formError.value = ''
  try {
    await createOrgUnit({
      parentId: orgForm.parentId || null,
      name,
      sortOrder: Number(orgForm.sortOrder) || 0,
    })
    orgForm.name = ''
    orgForm.parentId = ''
    orgForm.sortOrder = 0
    activeForm.value = ''
    showToast(`组织 ${name} 已创建。`)
    emit('refresh')
  } catch (error) {
    formError.value = error instanceof IamError ? error.message : (error?.message || '创建组织失败。')
  } finally {
    creatingKind.value = ''
  }
}

async function submitPosition() {
  if (creatingKind.value) return
  const orgUnitId = positionForm.orgUnitId
  const name = String(positionForm.name || '').trim()
  if (!orgUnitId) { formError.value = '请先选择所属组织。'; return }
  if (!name) { formError.value = '请填写岗位名称。'; return }
  creatingKind.value = 'position'
  formError.value = ''
  try {
    await createPosition({ orgUnitId, name })
    positionForm.name = ''
    activeForm.value = ''
    showToast(`岗位 ${name} 已创建。`)
    emit('refresh')
  } catch (error) {
    formError.value = error instanceof IamError ? error.message : (error?.message || '创建岗位失败。')
  } finally {
    creatingKind.value = ''
  }
}

async function submitApplication() {
  if (creatingKind.value) return
  const code = String(applicationForm.code || '').trim()
  const name = String(applicationForm.name || '').trim()
  if (!code) { formError.value = '请填写应用编码。'; return }
  if (!name) { formError.value = '请填写应用名称。'; return }
  creatingKind.value = 'application'
  formError.value = ''
  try {
    await createApplication({ code, name, applicationType: applicationForm.applicationType || 'web' })
    applicationForm.code = ''
    applicationForm.name = ''
    activeForm.value = ''
    showToast(`应用 ${name} 已注册。`)
    emit('refresh')
  } catch (error) {
    formError.value = error?.message || '注册应用失败。'
  } finally {
    creatingKind.value = ''
  }
}

function onRefresh() {
  loadAppCatalog()
  emit('refresh')
}

function onContinue() {
  if (!allReady.value) return
  emit('continue')
}

onMounted(() => { loadAppCatalog() })

// 父级刷新数据后，prop 数组变化 + refreshKey 递增都需要重算。
watch(() => [props.organizations.length, props.positions.length, props.applications.length, props.refreshKey], () => {
  emitReadyState()
})
</script>

<template>
  <section class="console-prereq-layout" aria-label="前置检查">
    <div class="settings-active-summary">
      <span class="settings-active-summary-icon"><ConsoleIcon name="info" /></span>
      <div class="settings-active-summary-copy">
        <strong>新增员工前请确认基础数据</strong>
        <p>至少 1 个组织、1 个岗位、1 个应用目录。缺失项可在此处直接补齐，不必跳到“身份、组织与授权”页面。</p>
      </div>
    </div>

    <div class="console-form-grid console-prereq-grid">
      <article class="console-card console-prereq-card" :data-ready="organizationReady ? 'true' : 'false'">
        <header class="console-prereq-card-head">
          <span class="console-status-dot" :class="organizationReady ? 'console-status-dot--ok' : 'console-status-dot--error'">
            <ConsoleIcon :name="organizationReady ? 'audit' : 'close'" />
          </span>
          <div>
            <h4>组织</h4>
            <p>至少需要 1 个组织作为员工的所属部门</p>
          </div>
          <span class="console-prereq-count">{{ organizationCount }}</span>
        </header>
        <div class="console-prereq-card-foot">
          <span v-if="organizationReady" class="console-tag console-tag--ok">已就绪</span>
          <button v-else class="console-button ghost small" type="button" @click="openForm('organization')">
            <ConsoleIcon name="info" />快速创建组织
          </button>
        </div>
        <form v-if="activeForm === 'organization'" class="console-prereq-form" @submit.prevent="submitOrganization">
          <label><span>组织名称 *</span><input v-model="orgForm.name" required maxlength="64" placeholder="例如：研发中心" /></label>
          <label>
            <span>上级组织（留空为根）</span>
            <select v-model="orgForm.parentId">
              <option value="">无（根组织）</option>
              <option v-for="item in organizationOptions" :key="item.option_id" :value="item.option_id">
                {{ item.option_label }}
              </option>
            </select>
          </label>
          <label><span>显示顺序</span><input v-model.number="orgForm.sortOrder" type="number" min="0" step="10" /><small>数字越小，在同一上级组织下越靠前；建议使用 10、20、30。</small></label>
          <div class="console-form-actions">
            <button class="console-button ghost small" type="button" :disabled="creatingKind === 'organization'" @click="cancelForm">取消</button>
            <button class="console-button primary small" type="submit" :disabled="creatingKind === 'organization'">
              <ConsoleIcon name="save" />{{ creatingKind === 'organization' ? '创建中…' : '创建组织' }}
            </button>
          </div>
        </form>
      </article>

      <article class="console-card console-prereq-card" :data-ready="positionReady ? 'true' : 'false'">
        <header class="console-prereq-card-head">
          <span class="console-status-dot" :class="positionReady ? 'console-status-dot--ok' : 'console-status-dot--error'">
            <ConsoleIcon :name="positionReady ? 'audit' : 'close'" />
          </span>
          <div>
            <h4>岗位</h4>
            <p>至少需要 1 个岗位用于建立任职关系</p>
          </div>
          <span class="console-prereq-count">{{ positionCount }}</span>
        </header>
        <div class="console-prereq-card-foot">
          <span v-if="positionReady" class="console-tag console-tag--ok">已就绪</span>
          <button v-else class="console-button ghost small" type="button" @click="openForm('position')">
            <ConsoleIcon name="info" />快速创建岗位
          </button>
        </div>
        <form v-if="activeForm === 'position'" class="console-prereq-form" @submit.prevent="submitPosition">
          <label>
            <span>所属组织 *</span>
            <select v-model="positionForm.orgUnitId" required>
              <option value="">请选择组织</option>
              <option v-for="item in organizationOptions" :key="item.option_id" :value="item.option_id">
                {{ item.option_label }}
              </option>
            </select>
            <small v-if="!organizations.length">需要先创建至少 1 个组织。</small>
          </label>
          <label><span>岗位名称 *</span><input v-model="positionForm.name" required maxlength="64" placeholder="例如：研发经理" /></label>
          <div class="console-form-actions">
            <button class="console-button ghost small" type="button" :disabled="creatingKind === 'position'" @click="cancelForm">取消</button>
            <button class="console-button primary small" type="submit" :disabled="creatingKind === 'position' || !positionForm.orgUnitId">
              <ConsoleIcon name="save" />{{ creatingKind === 'position' ? '创建中…' : '创建岗位' }}
            </button>
          </div>
        </form>
      </article>

      <article class="console-card console-prereq-card" :data-ready="applicationReady ? 'true' : 'false'">
        <header class="console-prereq-card-head">
          <span class="console-status-dot" :class="appCatalogLoading ? 'console-status-dot--pending' : (applicationReady ? 'console-status-dot--ok' : 'console-status-dot--error')">
            <ConsoleIcon :name="appCatalogLoading ? 'info' : (applicationReady ? 'audit' : 'close')" />
          </span>
          <div>
            <h4>应用目录</h4>
            <p>至少需要 1 个应用拥有可分配的岗位授权目标</p>
          </div>
          <span class="console-prereq-count">{{ appCatalogChecked ? appCatalogCount : '…' }}</span>
        </header>
        <div class="console-prereq-card-foot">
          <span v-if="applicationReady" class="console-tag console-tag--ok">已就绪</span>
          <span v-else-if="appCatalogLoading" class="console-tag console-tag--pending">检查中…</span>
          <span v-else-if="appCatalogError" class="console-tag console-tag--error">{{ appCatalogError }}</span>
          <button v-else class="console-button ghost small" type="button" @click="openForm('application')">
            <ConsoleIcon name="info" />快速注册应用
          </button>
        </div>
        <form v-if="activeForm === 'application'" class="console-prereq-form" @submit.prevent="submitApplication">
          <label><span>应用编码 *</span><input v-model="applicationForm.code" required maxlength="64" placeholder="例如：crm-portal" /></label>
          <label><span>应用名称 *</span><input v-model="applicationForm.name" required maxlength="64" placeholder="例如：客户关系管理门户" /></label>
          <label>
            <span>应用类型</span>
            <select v-model="applicationForm.applicationType">
              <option value="web">Web 应用</option>
              <option value="api">API / 后端服务</option>
              <option value="cli">CLI 工具</option>
            </select>
          </label>
          <div class="console-form-actions">
            <button class="console-button ghost small" type="button" :disabled="creatingKind === 'application'" @click="cancelForm">取消</button>
            <button class="console-button primary small" type="submit" :disabled="creatingKind === 'application'">
              <ConsoleIcon name="save" />{{ creatingKind === 'application' ? '注册中…' : '注册应用' }}
            </button>
          </div>
        </form>
      </article>
    </div>

    <p v-if="formError" class="console-prereq-error" role="alert">{{ formError }}</p>

    <div class="console-prereq-actions">
      <button class="console-button ghost small" type="button" :disabled="appCatalogLoading" @click="onRefresh">
        <ConsoleIcon name="reset" />重新检查
      </button>
      <button class="console-button primary" type="button" :disabled="!allReady" @click="onContinue">
        <ConsoleIcon name="save" />{{ allReady ? '开始新增员工' : '请先补齐前置项' }}
      </button>
    </div>
  </section>
</template>
