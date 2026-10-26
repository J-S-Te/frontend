<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { copyTextToClipboard } from '@/modules/shared/utils/clipboard'
import {
  applicationRoleSummary,
  applicationStatusOf,
  authorizationSummary,
  defaultExpandedAuthorizationApplications,
  roleScopeText,
  roleValidityText,
  sortAuthorizationApplications,
  sourceNameOf,
  technicalFieldsOf,
} from '@/modules/platform/iam/utils/effectiveAuthorizationOverview.js'

const props = defineProps({
  applications: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  unavailable: { type: Boolean, default: false },
  errorCount: { type: Number, default: 0 },
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['retry', 'manage'])

const expanded = ref(new Set())
const initialized = ref(false)
const copiedKey = ref('')
let copiedTimer = null

const rows = computed(() => sortAuthorizationApplications(props.applications || []))
const summary = computed(() => authorizationSummary(rows.value))

function initializeExpanded(list) {
  if (initialized.value) return
  if (props.loading) return
  expanded.value = new Set(defaultExpandedAuthorizationApplications(list))
  initialized.value = true
}

watch(rows, (value) => initializeExpanded(value), { immediate: true })
watch(() => props.loading, (loading) => {
  if (!loading) initializeExpanded(rows.value)
})

function rowId(row) {
  return String(row?.application_code || 'application').replace(/[^a-zA-Z0-9_-]/g, '-')
}
function detailId(row) {
  return `iam-authorization-detail-${rowId(row)}`
}
function isExpanded(row) {
  return expanded.value.has(row?.application_code)
}
function toggleRow(row) {
  if (!row || row.read_status === 'ERROR' || row.read_status === 'LOADING') return
  const next = new Set(expanded.value)
  const code = row.application_code
  if (next.has(code)) next.delete(code)
  else next.add(code)
  expanded.value = next
}
function statusOf(row) {
  return applicationStatusOf(row)
}
function emptyText(row) {
  const status = statusOf(row)
  if (status.key === 'CONFLICT') return '该应用存在授权冲突；来源仅用于诊断，不计入有效角色。'
  if (status.key === 'UNKNOWN') return '接口未返回可确认的授权状态，不能据此判断为已授权或未授权。'
  if (status.key === 'GRANTED') return '后端确认已授权，但未返回普通角色明细。'
  return '尚无有效授权。'
}
function sourceLabel(source) {
  return source?.source_label || '其他来源'
}
async function copyTechnical(row, group, source) {
  const fields = technicalFieldsOf(row, group, source)
  if (!fields.length) return
  const key = `${row?.application_code || ''}:${group?.key || ''}:${source?.source_id || source?.origin_id || source?.scope_id || ''}`
  try {
    await copyTextToClipboard(fields.map((field) => `${field.label}: ${field.value}`).join('\n'))
    copiedKey.value = key
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copiedKey.value = '' }, 1600)
  } catch {
    copiedKey.value = ''
  }
}
function copiedTechnical(row, group, source) {
  const key = `${row?.application_code || ''}:${group?.key || ''}:${source?.source_id || source?.origin_id || source?.scope_id || ''}`
  return copiedKey.value === key
}
function retry(row) {
  if (!row || row.read_status === 'LOADING') return
  emit('retry', row.application_code)
}
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="iam-authorization-overview-body">
    <div v-if="!loading && (rows.length || !unavailable)" class="iam-authorization-summary" role="status">
      <strong>{{ summary.text }}</strong>
      <span v-if="summary.contextText">{{ summary.contextText }}</span>
    </div>

    <p v-if="loading" class="iam-empty-inline">正在读取各应用的有效授权…</p>
    <p v-else-if="!rows.length && unavailable" class="iam-empty-inline">当前无法读取该用户的应用授权总览，请重试。</p>
    <p v-else-if="!rows.length" class="iam-empty-inline">当前没有可查看的应用授权。</p>

    <div v-else class="iam-authorization-application-list">
      <article
        v-for="row in rows"
        :key="row.application_code"
        class="iam-authorization-application-row"
        :class="statusOf(row).className"
      >
        <div class="iam-authorization-application-main">
          <div class="iam-authorization-application-name">
            <strong>{{ row.application_name }}</strong>
            <code v-if="row.application_code && row.application_name !== row.application_code">{{ row.application_code }}</code>
          </div>
          <div class="iam-authorization-role-summary">{{ applicationRoleSummary(row) }}</div>
          <span class="iam-authorization-status" :class="statusOf(row).className">{{ statusOf(row).label }}</span>
          <div class="iam-authorization-application-actions">
            <button
              v-if="row.read_status !== 'ERROR' && row.read_status !== 'LOADING'"
              type="button"
              class="console-button ghost iam-authorization-expand"
              :aria-expanded="isExpanded(row)"
              :aria-controls="detailId(row)"
              @click="toggleRow(row)"
            >{{ isExpanded(row) ? '收起' : '展开' }}</button>
            <button
              v-if="canManage && row.read_status !== 'ERROR' && row.read_status !== 'LOADING'"
              type="button"
              class="console-button ghost"
              @click="emit('manage', row.application_code)"
            >管理个人例外</button>
            <button
              v-if="row.read_status === 'ERROR'"
              type="button"
              class="console-button ghost"
              :disabled="row.read_status === 'LOADING'"
              @click="retry(row)"
            >重试</button>
          </div>
        </div>

        <p v-if="row.read_status === 'ERROR'" class="iam-authorization-error" role="alert">{{ row.error_message || '该应用授权读取失败，请重试。' }}</p>

        <div v-show="isExpanded(row)" :id="detailId(row)" class="iam-authorization-application-detail">
          <p v-if="row.conflicts.length" class="iam-authorization-conflict" role="alert">授权冲突：{{ row.conflicts.join('；') }}</p>
          <p v-if="!row.role_groups.length" class="iam-empty-inline">{{ emptyText(row) }}</p>
          <div v-for="group in row.role_groups" :key="group.key" class="iam-authorization-role-group">
            <div class="iam-authorization-role-head">
              <strong>{{ group.name }}</strong>
              <code>{{ group.code }}</code>
              <span v-if="!group.effective" class="iam-authorization-diagnostic">诊断来源，不计入有效角色</span>
            </div>
            <ul class="iam-authorization-source-list">
              <li v-for="(source, sourceIndex) in group.sources" :key="`${group.key}-${source.source_id || source.origin_id || sourceIndex}`" class="iam-authorization-source">
                <div class="iam-authorization-source-head">
                  <span class="iam-authorization-source-label">{{ sourceLabel(source) }}</span>
                  <strong>{{ sourceNameOf(source) }}</strong>
                </div>
                <dl class="iam-authorization-source-meta">
                  <div><dt>授权范围</dt><dd>{{ roleScopeText(source) }}</dd></div>
                  <div><dt>有效期</dt><dd>{{ roleValidityText(source) }}</dd></div>
                </dl>
                <details class="iam-authorization-technical">
                  <summary>技术信息</summary>
                  <dl>
                    <div v-for="field in technicalFieldsOf(row, group, source)" :key="field.label">
                      <dt>{{ field.label }}</dt><dd><code>{{ field.value }}</code></dd>
                    </div>
                  </dl>
                  <button type="button" class="console-button ghost" @click="copyTechnical(row, group, source)">
                    {{ copiedTechnical(row, group, source) ? '已复制' : '复制技术信息' }}
                  </button>
                </details>
              </li>
            </ul>
          </div>
        </div>
      </article>
    </div>

    <details class="iam-authorization-help">
      <summary>授权如何计算</summary>
      <p>有效角色来自个人例外、组织继承、岗位模板和系统来源；同一角色的多个来源分别展示，环境、范围和有效期不会跨来源合并。冲突来源只用于诊断，不计入有效角色。后端仍按应用、范围和有效期实时计算，页面不会重新赋权。</p>
    </details>
  </div>
</template>
