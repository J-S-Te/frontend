<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  assignableActiveCatalogRoles,
  isCatalogSynchronized,
} from '@/modules/platform/iam/utils/applicationAuthorizationCatalog'
import {
  hasPersonalExceptionDraftChanges,
  resolvePersonalExceptionDraft,
  roleCodeOf,
  roleNameOf,
  scopeTextOf,
  validityTextOf,
} from '@/modules/platform/iam/utils/personalExceptionAuthorization'

const props = defineProps({
  application: { type: Object, default: null },
  mode: { type: String, default: 'create' },
  draft: { type: Object, required: true },
  initialDraft: { type: Object, default: null },
  catalog: { type: Object, default: null },
  environments: { type: Array, default: () => [] },
  existingManualRoles: { type: Array, default: () => [] },
  inheritedRoles: { type: Array, default: () => [] },
  fieldErrors: { type: Object, default: () => ({}) },
  blockers: { type: Array, default: () => [] },
  warnings: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['update:draft', 'submit', 'cancel'])

const roleSelect = ref(null)
const roleQuery = ref('')
const isCreate = computed(() => props.mode === 'create')
const isNormalize = computed(() => props.mode === 'normalize')
const title = computed(() => {
  if (isNormalize.value) return '统一调整历史记录'
  if (isCreate.value) return '新增例外授权'
  return '修改例外授权'
})
const submitText = computed(() => {
  if (isNormalize.value) return '确认统一调整'
  if (isCreate.value) return '确认新增'
  return '保存修改'
})
const existingRoleCodes = computed(() => new Set(props.existingManualRoles.map((role) => roleCodeOf(role)).filter(Boolean)))
const inheritedRoleCodes = computed(() => new Set(props.inheritedRoles.map((role) => roleCodeOf(role)).filter(Boolean)))
const allRoleOptions = computed(() => assignableActiveCatalogRoles(props.catalog))
const roleOptions = computed(() => {
  const query = roleQuery.value.trim().toLowerCase()
  return allRoleOptions.value.filter((role) => {
    const code = roleCodeOf(role)
    if (isCreate.value && existingRoleCodes.value.has(code)) return false
    if (!query) return true
    return code.toLowerCase().includes(query) || String(roleNameOf(role, props.catalog)).toLowerCase().includes(query)
  })
})
const selectedRoleName = computed(() => roleNameOf({ code: props.draft.roleCode }, props.catalog))
const catalogReady = computed(() => Boolean(props.catalog && isCatalogSynchronized(props.catalog)))
const resolved = computed(() => resolvePersonalExceptionDraft(props.draft))
const changed = computed(() => hasPersonalExceptionDraftChanges(props.initialDraft, props.draft))
const scopeType = computed(() => String(resolved.value.scopeType || 'APPLICATION').toUpperCase())
const validityMode = computed(() => String(props.draft.validityMode || 'RANGE').toUpperCase())
const startMode = computed(() => String(props.draft.startMode || 'IMMEDIATE').toUpperCase())
const originalText = computed(() => {
  const records = Array.isArray(props.draft.initialRecords) ? props.draft.initialRecords : []
  if (!records.length) return '新增记录'
  return records.map((role) => scopeTextOf(role) + '；' + validityTextOf(role)).join(' / ')
})
const newText = computed(() => {
  const draft = resolved.value
  const role = {
    role_code: draft.roleCode,
    scope_type: draft.scopeType,
    environment_code: draft.environmentCode,
    valid_from: draft.validFrom,
    valid_until: draft.validUntil,
  }
  return scopeTextOf(role) + '；' + validityTextOf(role)
})
const impactWarnings = computed(() => {
  const messages = [...props.warnings]
  const records = Array.isArray(props.draft.initialRecords) ? props.draft.initialRecords : []
  const first = records[0]
  if (first) {
    const oldScope = String(first.scope_type || 'APPLICATION').toUpperCase()
    if (oldScope === 'ENVIRONMENT' && scopeType.value === 'APPLICATION') {
      messages.push('范围从指定环境扩大到整个应用，这是扩大授权，服务端会重新执行委派检查。')
    }
    const oldEnd = first.valid_until ? new Date(first.valid_until).getTime() : null
    const newEnd = resolved.value.validUntil ? new Date(resolved.value.validUntil).getTime() : null
    if (oldEnd && (!newEnd || newEnd > oldEnd)) {
      messages.push('有效期结束时间被延长或改为长期有效，这是扩大授权。')
    }
    if (first.valid_from && (!resolved.value.validFrom || new Date(resolved.value.validFrom).getTime() < new Date(first.valid_from).getTime())) {
      messages.push('开始时间提前，这会扩大生效窗口。')
    }
  }
  if (isNormalize.value && records.length > 1) {
    messages.push('保存会把这 ' + records.length + ' 条记录替换为 1 条，原有范围/窗口不会自动保留。')
  }
  return [...new Set(messages)]
})
const inheritedWarning = computed(() => {
  const code = String(props.draft.roleCode || '').trim()
  return code && inheritedRoleCodes.value.has(code)
    ? '该角色同时来自岗位/组织继承；个人例外可能重叠，但不会把继承来源写入人工集合。'
    : ''
})

function update(patch) {
  emit('update:draft', { ...props.draft, ...patch })
}

function onField(field, event) {
  update({ [field]: event?.target?.value ?? '' })
}

function onScopeChange(event) {
  const next = String(event?.target?.value || 'APPLICATION').toUpperCase()
  update({ scopeType: next, environmentCode: next === 'APPLICATION' ? '' : props.draft.environmentCode })
}

function onValidityChange(event) {
  update({ validityMode: String(event?.target?.value || 'RANGE').toUpperCase() })
}

function onStartModeChange(event) {
  update({ startMode: String(event?.target?.value || 'IMMEDIATE').toUpperCase() })
}

function onStartInput(event) {
  update({ validFromInput: event?.target?.value || '', validFromTouched: true })
}

function onEndInput(event) {
  update({ validUntilInput: event?.target?.value || '', validUntilTouched: true })
}

function submit() {
  if (props.busy || !changed.value) return
  emit('submit')
}

function cancel() {
  emit('cancel')
}

onMounted(() => {
  nextTick(() => roleSelect.value?.focus?.())
})
</script>

<template>
  <section class="iam-personal-exception-editor" @keydown.esc.stop.prevent="cancel">
    <header class="iam-personal-exception-editor-head">
      <div>
        <h4>{{ title }}</h4>
        <p v-if="application">应用：{{ application.name || application.display_name || application.code }} · {{ application.code }}</p>
        <p v-if="isCreate">单角色编辑；提交时会替换该应用下的完整人工集合，其他角色按原值保留。</p>
        <p v-else>角色固定为“{{ selectedRoleName }}”；不能在这里换成另一个角色，更换请走撤销后新增。</p>
      </div>
      <button type="button" class="console-button ghost" :disabled="busy" @click="cancel">取消</button>
    </header>

    <p v-if="inheritedWarning" class="iam-field-help iam-personal-exception-warning" role="status">{{ inheritedWarning }}</p>

    <div class="iam-personal-exception-editor-grid">
      <label v-if="isCreate" class="iam-personal-exception-field">
        <span>角色 *</span>
        <input v-model="roleQuery" type="search" maxlength="100" placeholder="按角色名称或编码搜索" :disabled="busy || !catalogReady" aria-describedby="personal-exception-role-error" />
        <select ref="roleSelect" :value="draft.roleCode" :disabled="busy || !catalogReady" @change="onField('roleCode', $event)">
          <option value="">{{ roleOptions.length ? '请选择角色' : (catalogReady ? '目录中没有可分配角色' : '角色目录未就绪') }}</option>
          <option v-for="role in roleOptions" :key="roleCodeOf(role)" :value="roleCodeOf(role)">{{ roleNameOf(role, catalog) }} · {{ roleCodeOf(role) }}</option>
        </select>
        <small v-if="roleQuery && !roleOptions.length">没有匹配的角色；清空搜索可查看全部可分配角色。</small>
        <small v-else-if="!catalogReady">角色目录未同步，暂不能新增或修改。</small>
        <small v-else>同一角色已有个人例外时不会出现在新增选项中；请修改已有授权。</small>
        <small v-if="fieldErrors.roleCode" id="personal-exception-role-error" class="iam-personal-exception-error">{{ fieldErrors.roleCode }}</small>
      </label>
      <div v-else class="iam-personal-exception-field">
        <span>角色</span>
        <strong>{{ selectedRoleName }}</strong>
        <code>{{ draft.roleCode }}</code>
        <small v-if="isNormalize">同角色历史记录：{{ draft.initialRecords.length }} 条 → 1 条</small>
      </div>

      <label class="iam-personal-exception-field">
        <span>范围 *</span>
        <select :value="draft.scopeType" :disabled="busy" @change="onScopeChange">
          <option value="APPLICATION">整个应用</option>
          <option value="ENVIRONMENT" :disabled="!environments.length">指定环境</option>
        </select>
        <small v-if="!environments.length">当前没有可用环境；如应用只支持整个应用，请保持“整个应用”。</small>
      </label>

      <label v-if="scopeType === 'ENVIRONMENT'" class="iam-personal-exception-field">
        <span>环境 *</span>
        <select :value="draft.environmentCode" :disabled="busy || !environments.length" @change="onField('environmentCode', $event)" aria-describedby="personal-exception-environment-error">
          <option value="">请选择环境</option>
          <option v-for="environment in environments" :key="environment.code" :value="environment.code">{{ environment.name }} · {{ environment.code }}</option>
        </select>
        <small v-if="fieldErrors.environmentCode" id="personal-exception-environment-error" class="iam-personal-exception-error">{{ fieldErrors.environmentCode }}</small>
      </label>

      <label class="iam-personal-exception-field">
        <span>有效期 *</span>
        <select :value="draft.validityMode" :disabled="busy" @change="onValidityChange">
          <option value="RANGE">指定时间</option>
          <option value="PERMANENT">长期有效</option>
        </select>
        <small>长期有效只清除结束限制，不会自动清掉已有的未来开始时间。</small>
      </label>

      <label class="iam-personal-exception-field">
        <span>开始时间</span>
        <select :value="draft.startMode" :disabled="busy" @change="onStartModeChange">
          <option value="IMMEDIATE">立即生效</option>
          <option value="SPECIFIC">指定时间</option>
        </select>
        <small>时间按浏览器本地时区显示。</small>
      </label>

      <label v-if="startMode === 'SPECIFIC'" class="iam-personal-exception-field">
        <span>开始时间 *</span>
        <input :value="draft.validFromInput" type="datetime-local" :disabled="busy" @input="onStartInput" aria-describedby="personal-exception-start-error" />
        <small v-if="fieldErrors.validFrom" id="personal-exception-start-error" class="iam-personal-exception-error">{{ fieldErrors.validFrom }}</small>
      </label>

      <label v-if="validityMode === 'RANGE'" class="iam-personal-exception-field">
        <span>结束时间 *</span>
        <input :value="draft.validUntilInput" type="datetime-local" :disabled="busy" @input="onEndInput" aria-describedby="personal-exception-end-error" />
        <small v-if="fieldErrors.validUntil" id="personal-exception-end-error" class="iam-personal-exception-error">{{ fieldErrors.validUntil }}</small>
      </label>
    </div>

    <div class="iam-personal-exception-impact" aria-live="polite">
      <h5>影响确认</h5>
      <dl>
        <div><dt>原值</dt><dd>{{ originalText }}</dd></div>
        <div><dt>新值</dt><dd>{{ newText }}</dd></div>
        <div><dt>其他角色</dt><dd>不受本次操作修改；岗位/组织继承来源也不会被写入或删除。</dd></div>
      </dl>
      <ul v-if="impactWarnings.length" class="iam-personal-exception-warnings">
        <li v-for="warning in impactWarnings" :key="warning">{{ warning }}</li>
      </ul>
    </div>

    <div v-if="blockers.length" class="iam-personal-exception-blockers" role="alert">
      <strong>暂不能提交：</strong>
      <ul><li v-for="blocker in blockers" :key="blocker">{{ blocker }}</li></ul>
    </div>

    <footer class="iam-personal-exception-editor-foot">
      <button type="button" class="console-button ghost" :disabled="busy" @click="cancel">取消</button>
      <button type="button" class="console-button primary" :disabled="busy || !changed" @click="submit">{{ busy ? '保存中…' : submitText }}</button>
    </footer>
  </section>
</template>
