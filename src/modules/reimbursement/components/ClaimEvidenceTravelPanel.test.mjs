import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { approvalNodeLabel } from '../rolePresentation.js'
import { renderToString } from '@vue/server-renderer'

// 用途：替身只记录选择器收到的接口、用途与当前引用，供模板断言外部边界。
// 参数：无。
// 返回值：渲染为可断言文本的Vue组件。
const pickerStub = {
  props: ['modelValue', 'path', 'purpose', 'valueKey', 'objectLabel', 'multiple', 'disabled', 'ariaLabel'],
  setup: (props) => () => Vue.h('div', { class: 'picker-stub' }, [
    Vue.h('b', {}, `${props.path} | ${props.purpose || ''}`),
    Vue.h('span', {}, String(Array.isArray(props.modelValue) ? props.modelValue.join(',') : props.modelValue || '')),
  ]),
}

// 用途：编译真实尾款与差旅业务面板供SSR检查。
// 参数：无。
// 返回值：保留真实条件、证据按钮和只读状态的Vue组件。
function component() {
  const { descriptor } = parse(readFileSync(new URL('./ClaimEvidenceTravelPanel.vue', import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'claim-tail-travel', inlineTemplate: true })
  const bindings = { approvalNodeLabel, BusinessOptionPicker: pickerStub }
  const body = compiled.content
    .replace(/^import\s+\w+\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, specifier) => {
      if (specifier !== 'vue') return ''
      for (const entry of names.split(',')) {
        const [name, alias = name] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = Vue[name]
      }
      return ''
    })
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(...Object.values(bindings))
}

test('人工补证后UNKNOWN仍显示未知，无差旅要求不强迫确认，终止引用不称已放行', async () => {
  const html = await renderToString(Vue.createSSRApp(component(), { itemNumber: 1, disabled: true, canDownload: true,
    item: { id: 'item', requires_travel_facts: false, historical_tail_evidence_text: 'tail-file',
      travel_assessment: { status: 'UNKNOWN', confirmed_unknown: true },
      travel_confirmation: { decision: '', reason: '', evidence_text: '' }, historical_tail_applications: [
        { project_id: 'project', policy: { id: 'policy', version: 3, expense_cutoff: '2026-10-31', valid_from: '2026-11-01', valid_until: '2026-11-30' } },
      ] },
    references: [{ project_id: 'project', eligible: false, participant_eligible: true, project_status: '已终止',
      travel_snapshot: { status: 'UNKNOWN', mode: 'NO_TRAVEL', actor_in_travelers: null, reason_codes: ['NOT_TRAVEL_APPROVAL'] } }] }))
  assert.match(html, /当前标准不要求差旅事实，不必填写人工确认/)
  assert.match(html, /事实未知/)
  assert.match(html, /状态仍为UNKNOWN/)
  assert.match(html, /历史尾款须有效政策、证据及额外审批/)
  assert.match(html, /实施准备、行程安排均不是出差审批/)
  assert.match(html, /policy · v3/)
  assert.match(html, /:disabled|disabled/)
  assert.match(html, /查看尾款证据 tail-file/)
  assert.doesNotMatch(html, /<select[^>]* required/)
  // 证据引用改由选择器按文件名挑选，面板里不再留可手抄文件ID的输入框。
  assert.match(html, /\/invoice-document-options \| reimbursement\.claim\.evidence/)
  assert.match(html, /tail-file/)
  assert.doesNotMatch(html, /尾款证据文件ID|差旅证据文件ID/)
})

test('审批岗位来源逐项展示项目权威node_role，不用本地映射或旧teamlead代替', async () => {
  const html = await renderToString(Vue.createSSRApp(component(), {
    item: { id: 'item', travel_confirmation: { decision: '', reason: '', evidence_text: '' } },
    references: [{ project_id: 'project', eligible: true, required_approver_refs: [
      { node_role: 'PROJECT_EXPENSE_OWNER', subject_id: 'manager', source_field: 'project_manager_id', source_version: '9' },
      { node_role: 'TECHNICAL_DIRECTOR', subject_id: 'technical', source_field: 'technical_director', source_digest: 'digest-technical', source_org_id: 'org' },
      { node_role: 'SALES_DIRECTOR', subject_id: 'sales', source_field: 'sales_director', source_digest: 'digest-sales', source_org_id: 'org' },
    ] }],
  }))
  assert.match(html, /项目经理（费用负责人）/)
  assert.match(html, /项目技术总监（技术负责人）/)
  assert.match(html, /项目销售总监（销售负责人）/)
  assert.match(html, /project_manager_id/)
  assert.match(html, /来源版本 9/)
  assert.match(html, /目录摘要 digest-technical/)
  assert.match(html, /授权组织 org/)
  assert.doesNotMatch(html, /team_lead_id|owner_identity_id/)
})


test('行程交叉核验展示每个可见分摊及人工票面来源，未知结论不称自动通过', async () => {
  const html = await renderToString(Vue.createSSRApp(component(), {
    item: { id: 'item', travel_confirmation: { decision: '', reason: '', evidence_text: '' },
      travel_assessment: { status: 'UNKNOWN', references: [{ project_id: 'project', service_item_id: 'service',
        cross_check_status: 'UNKNOWN', cross_check: { status: 'UNKNOWN', project_status: 'MATCH',
          reason_codes: ['INVOICE_FACTS_MISSING'], invoices: [
            { invoice_id: 'invoice', source_kind: 'MANUAL_FACE_CONFIRMATION', status: 'UNKNOWN', reason_codes: ['FACTS_MISSING'] },
          ] } }] } },
  }))
  assert.match(html, /申报与票据行程交叉核验/)
  assert.match(html, /project \/ service/)
  assert.match(html, /INVOICE_FACTS_MISSING/)
  assert.match(html, /invoice/)
  assert.match(html, /人工票面复核/)
  assert.match(html, /不代表自动识别或税务验真/)
})
