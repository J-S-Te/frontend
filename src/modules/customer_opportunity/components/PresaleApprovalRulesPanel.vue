<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createPresaleApprovalRule,
  deletePresaleApprovalRule,
  listPresaleApprovalRules,
  updatePresaleApprovalRule,
} from '../api/presale.js'

const props = defineProps({ isAdmin: { type: Boolean, default: false } })
const rules = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editing = ref(null)
const activeRuleId = ref('')
const rulesExpanded = ref(true)
const editorExpanded = ref(true)
const form = reactive({
  id: '',
  name: '',
  priority: 0,
  enabled: true,
  expression: {
    logical: 'and',
    conditions: [{ field: 'urgency', operator: 'eq', value: 'NORMAL' }],
  },
  nodes: [],
})
const nodeTypes = [
  { value: 'APPROVAL', label: '审批' },
  { value: 'DEPARTMENT_ASSIGNMENT', label: '选择部门' },
  { value: 'PERSON_ASSIGNMENT', label: '选择人员' },
]
const roles = [
  { value: 'sales_director', label: '销售总监' },
  { value: 'technical_director', label: '技术总监' },
  { value: 'team_lead', label: '团队负责人' },
]
const canEdit = computed(() => props.isAdmin)

function reset() {
  Object.assign(form, {
    id: '',
    name: '',
    priority: 0,
    enabled: true,
    expression: {
      logical: 'and',
      conditions: [{ field: 'urgency', operator: 'eq', value: 'NORMAL' }],
    },
    nodes: [
      { id: 'sales-director', name: '销售总监审批', type: 'APPROVAL', role_code: 'sales_director' },
      { id: 'technical-director', name: '技术总监审批', type: 'APPROVAL', role_code: 'technical_director' },
      { id: 'department', name: '选择执行部门', type: 'DEPARTMENT_ASSIGNMENT', role_code: 'technical_director' },
      { id: 'people', name: '选择执行人员', type: 'PERSON_ASSIGNMENT', role_code: 'team_lead' },
    ],
  })
  editing.value = null
  activeRuleId.value = ''
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await listPresaleApprovalRules()
    rules.value = result?.data || result || []
    if (!activeRuleId.value && rules.value.length) activeRuleId.value = String(rules.value[0].id)
    if (activeRuleId.value && !rules.value.some((rule) => String(rule.id) === String(activeRuleId.value))) activeRuleId.value = rules.value[0] ? String(rules.value[0].id) : ''
    const activeRule = rules.value.find((rule) => String(rule.id) === String(activeRuleId.value))
    if (activeRule && !editing.value) edit(activeRule)
  } catch (loadError) {
    error.value = loadError?.message || '规则加载失败'
  } finally {
    loading.value = false
  }
}

function edit(rule) {
  Object.assign(form, JSON.parse(JSON.stringify(rule)))
  editing.value = rule.id
  activeRuleId.value = String(rule.id)
  editorExpanded.value = true
}

function selectRule(rule) {
  activeRuleId.value = String(rule.id)
  edit(rule)
}

function toggleRules() {
  rulesExpanded.value = !rulesExpanded.value
}

function toggleEditor() {
  editorExpanded.value = !editorExpanded.value
}

function addNode() {
  form.nodes.push({ id: `node-${Date.now()}`, name: '新节点', type: 'APPROVAL', role_code: 'team_lead' })
}

async function save() {
  if (!canEdit.value || !form.name.trim() || !form.nodes.length) return
  saving.value = true
  error.value = ''
  try {
    const payload = JSON.parse(JSON.stringify(form))
    delete payload.id
    if (editing.value) {
      await updatePresaleApprovalRule(editing.value, {
        ...payload,
        id: editing.value,
        version: form.version,
      })
    } else {
      await createPresaleApprovalRule(payload)
    }
    reset()
    await load()
  } catch (saveError) {
    error.value = saveError?.message || '规则保存失败'
  } finally {
    saving.value = false
  }
}

async function remove(rule) {
  if (!canEdit.value || !window.confirm(`确认删除规则“${rule.name}”？`)) return
  try {
    await deletePresaleApprovalRule(rule.id, rule.version)
    await load()
  } catch (removeError) {
    error.value = removeError?.message || '规则删除失败'
  }
}

onMounted(() => {
  load()
  reset()
})
</script>

<template>
  <section class="crm-panel crm-approval-rules-panel">
    <div class="crm-panel-heading crm-approval-rules-heading">
      <div>
        <h2>售前审批规则</h2>
        <p class="crm-note">规则按优先级匹配；已提交申请使用规则快照。</p>
      </div>
      <div class="crm-approval-heading-actions">
        <span class="crm-approval-count-badge">{{ rules.length }} 条规则</span>
        <button v-if="canEdit" class="console-button primary small" type="button" @click="reset">
          新增规则
        </button>
      </div>
    </div>

    <p v-if="error" class="crm-alert error" role="alert">{{ error }}</p>
    <p v-if="loading" class="crm-note">加载中…</p>

    <div v-if="!loading && !rules.length" class="crm-approval-rules-empty">
      <strong>暂无审批规则</strong>
      <span>创建规则后，新的售前申请将按优先级自动匹配审批流程。</span>
    </div>

    <div class="crm-approval-rules-section-heading">
      <div>
        <strong>规则列表</strong>
        <span>按优先级从高到低匹配</span>
      </div>
      <button class="console-button ghost small crm-approval-collapse-button" type="button" :aria-expanded="rulesExpanded" @click="toggleRules">
        <span class="crm-approval-chevron" :class="{ 'is-open': rulesExpanded }" aria-hidden="true">⌄</span>{{ rulesExpanded ? '收起列表' : '展开列表' }}
      </button>
    </div>
    <div v-show="rulesExpanded" class="crm-approval-rules-list">
      <div
        v-for="rule in rules"
        :key="rule.id"
        :class="['crm-approval-rule-row', { 'is-active': String(rule.id) === String(activeRuleId) }]"
        role="button"
        tabindex="0"
        @click="selectRule(rule)"
        @keydown.enter.prevent="selectRule(rule)"
      >
        <div class="crm-approval-rule-main">
          <div class="crm-approval-rule-title">
            <span class="crm-approval-rule-dot" :class="{ 'is-enabled': rule.enabled }" aria-hidden="true"></span>
            <strong>{{ rule.name }}</strong>
            <span :class="['crm-approval-status', rule.enabled ? 'is-enabled' : 'is-disabled']">
              {{ rule.enabled ? '已启用' : '已停用' }}
            </span>
          </div>
        <span class="crm-approval-rule-meta">优先级 {{ rule.priority }} · {{ rule.nodes?.length || 0 }} 个节点</span>
        </div>
        <div v-if="canEdit" class="crm-actions">
          <button class="console-button ghost small" type="button" @click.stop="edit(rule)">编辑</button>
          <button class="console-button danger small" type="button" @click.stop="remove(rule)">删除</button>
        </div>
      </div>
    </div>

    <form v-if="canEdit" class="crm-approval-rule-editor" @submit.prevent="save">
      <button class="crm-approval-editor-heading" type="button" :aria-expanded="editorExpanded" @click="toggleEditor">
        <span class="crm-approval-editor-heading-copy">
          <strong>{{ editing ? '编辑审批规则' : '新建审批规则' }}</strong>
          <span>定义规则名称、优先级和审批/指派节点</span>
        </span>
        <span class="crm-approval-editor-heading-actions">
          <span class="crm-approval-editor-badge">{{ form.enabled ? '启用中' : '已停用' }}</span>
          <span class="crm-approval-chevron" :class="{ 'is-open': editorExpanded }" aria-hidden="true">⌄</span>
        </span>
      </button>
      <div v-show="editorExpanded" class="crm-approval-editor-body">
        <div class="crm-approval-rule-fields">
          <label>
            <span>规则名称</span>
            <input v-model.trim="form.name" required maxlength="128" />
          </label>
          <label>
            <span>优先级</span>
            <input v-model.number="form.priority" type="number" />
          </label>
          <label class="checkbox">
            <input v-model="form.enabled" type="checkbox" />
            <span>启用此规则</span>
          </label>
        </div>
        <div class="crm-approval-node-toolbar">
          <div class="crm-approval-node-heading"><strong>流程节点</strong><span>按列表顺序执行，共 {{ form.nodes.length }} 个节点</span></div>
          <button class="console-button ghost small" type="button" @click="addNode">添加节点</button>
        </div>
        <div class="crm-approval-node-list">
          <div v-for="(node, index) in form.nodes" :key="node.id" class="crm-approval-node">
            <span class="crm-approval-node-index">{{ index + 1 }}</span>
            <input v-model.trim="node.name" required placeholder="节点名称" :aria-label="`第 ${index + 1} 个节点名称`" />
            <select v-model="node.type" :aria-label="`第 ${index + 1} 个节点类型`">
              <option v-for="item in nodeTypes" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <select v-model="node.role_code" :aria-label="`第 ${index + 1} 个节点角色`">
              <option v-for="item in roles" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <button class="console-button danger small" type="button" :disabled="form.nodes.length <= 1" :aria-label="`删除第 ${index + 1} 个节点`" @click="form.nodes.splice(index, 1)">删除</button>
          </div>
        </div>
        <div class="crm-approval-form-footer">
          <span class="crm-note">保存后将用于新提交的售前申请。</span>
          <button class="console-button primary" type="submit" :disabled="saving">
            {{ saving ? '保存中…' : (editing ? '保存修改' : '创建规则') }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
