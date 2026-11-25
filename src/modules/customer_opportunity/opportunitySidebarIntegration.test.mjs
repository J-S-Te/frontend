import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computed, reactive, ref } from 'vue'
import { createAttachmentUploadRetryState } from './attachmentUploadRetry.js'

const view = readFileSync(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')

test('商机详情使用独立分页总数，打开与刷新详情时不会因响应式对象误用而崩溃', () => {
  const declaration = view.split('\n').find(line => line.startsWith('const opportunityPresaleCount ='))
  assert.ok(declaration, '详情应提供关联售前总数')
  const page = reactive({ number: 1, size: 10, total: 23 })
  const count = new Function('computed', 'opportunityPresalePage',
    `${declaration}\nreturn opportunityPresaleCount`)(computed, page)
  assert.equal(count.value, 23)
  page.total = 31
  assert.equal(count.value, 31)
})

// 用途：执行主视图中的实际具名函数，仅替换明确的外部边界和响应式输入。
// 参数：names 为待提取函数，dependencies 为该场景依赖。
// 返回值：可直接调用的实际视图函数集合。
function actualFunctions(names, dependencies) {
  const source = names.map(name => {
    const result = view.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))
    assert.ok(result, `实际视图中应存在${name}`)
    return result[0]
  }).join('\n')
  return new Function(...Object.keys(dependencies),
    `${source}\nreturn { ${names.join(', ')} }`)(...Object.values(dependencies))
}

test('打开另一商机时清除上一个商机已选择但尚未上传的文件', async () => {
  const dependencies = Object.fromEntries([
    'opportunityDetailLoadSequence', 'opportunityDetailTab', 'selectedOpportunity',
    'selectedOpportunityCustomerCredit', 'selectedOpportunityOwnerOrgID', 'stageHistory',
    'followups', 'opportunityTeam', 'opportunityTeamDirectoryAvailable', 'opportunityMemberTerms',
    'opportunityMemberTermsError', 'opportunityMemberTermsLoading', 'opportunityExternalStatus',
    'opportunityQuoteAmountCheck', 'opportunityExternalStatusError', 'opportunityPresales',
    'opportunityPresaleError', 'opportunityAttachments', 'opportunityAttachmentCapabilities',
    'opportunityAttachmentError', 'opportunityAttachmentLoading', 'opportunityTermsOpen',
    'opportunityTeamExpanded', 'error',
  ].map(name => [name, ref(name === 'opportunityDetailLoadSequence' ? 1 : null)]))
  const oldFile = { name: 'A报价.pdf' }
  Object.assign(dependencies, {
    opportunityAttachmentFile: ref(oldFile), opportunityTeamExpanded: ref(true),
    opportunityMemberTermsPage: {}, opportunityPresalePage: {},
    getOpportunity: async () => { throw new Error('隔离详情读取') },
    getOpportunityStageHistory: async () => ({}), listOpportunityFollowups: async () => ({}),
    getOpportunityMembers: async () => ({}), showError: () => {},
  })
  await actualFunctions(['openOpportunity'], dependencies).openOpportunity(2)
  assert.equal(dependencies.opportunityAttachmentFile.value, null)
  assert.equal(dependencies.opportunityTeamExpanded.value, false)
})

test('A上传在途时切换到B，旧完成回调不能清掉B文件或覆盖B提示和加载状态', async () => {
  let release
  const uploads = [], completions = [], reloads = []
  const fileA = { name: 'A报价.pdf', size: 42, type: 'application/pdf' }
  const dependencies = {
    selectedOpportunity: ref({ id: 1 }), opportunityDetailLoadSequence: ref(1),
    opportunityAttachmentFile: ref(fileA), opportunityAttachmentCapabilities: ref({ upload_available: true }),
    canUploadOpportunityAttachments: ref(true), opportunityAttachmentLoading: ref(false),
    opportunityAttachmentError: ref(''), notice: ref(''),
    validateOpportunityAttachment: () => ({ ok: true }), sha256File: async () => 'digest',
    attachmentUploadRetries: createAttachmentUploadRetryState(() => 'isolated-key'),
    createOpportunityAttachmentUpload: async id => ({ upload_mode: 'INTERNAL', attachment: { id: `file-${id}`, version: 1 } }),
    uploadOpportunityAttachmentContent: async (id, fileID, file) => {
      uploads.push([id, fileID, file.name]); await new Promise(resolve => { release = resolve })
    },
    completeOpportunityAttachmentUpload: async id => { completions.push(id) },
    loadOpportunityAttachments: async id => { reloads.push(id) }, formatCRMError: error => error.message,
  }
  const names = ['uploadOpportunityAttachment']
  if (view.includes('function isCurrentOpportunityAttachmentContext(')) {
    names.unshift('isCurrentOpportunityAttachmentContext')
  }
  const write = actualFunctions(names, dependencies).uploadOpportunityAttachment()
  await new Promise(resolve => setImmediate(resolve))
  const fileB = { name: 'B投标.pdf' }
  dependencies.selectedOpportunity.value = { id: 2 }
  dependencies.opportunityDetailLoadSequence.value++
  dependencies.opportunityAttachmentFile.value = fileB
  dependencies.notice.value = 'B的提示'
  dependencies.opportunityAttachmentError.value = 'B的错误'
  dependencies.opportunityAttachmentLoading.value = true
  release(); await write
  assert.deepEqual(uploads, [[1, 'file-1', 'A报价.pdf']])
  assert.ok(completions.every(id => id === 1))
  assert.equal(dependencies.opportunityAttachmentFile.value.name, fileB.name)
  assert.equal(dependencies.notice.value, 'B的提示')
  assert.equal(dependencies.opportunityAttachmentError.value, 'B的错误')
  assert.equal(dependencies.opportunityAttachmentLoading.value, true)
  assert.deepEqual(reloads, [])
})

test('关闭重开同一商机后，旧附件列表返回不能覆盖新详情', async () => {
  let release
  const dependencies = {
    selectedOpportunity: ref({ id: 1 }), opportunityDetailLoadSequence: ref(1),
    canReadOpportunityAttachments: ref(true), opportunityAttachmentLoading: ref(false),
    opportunityAttachmentError: ref(''), opportunityAttachments: ref([]),
    opportunityAttachmentCapabilities: ref(null),
    getOpportunityAttachmentCapabilities: async () => ({ upload_available: true }),
    listOpportunityAttachments: () => new Promise(resolve => { release = resolve }),
  }
  const names = ['loadOpportunityAttachments']
  if (view.includes('function isCurrentOpportunityAttachmentContext(')) {
    names.unshift('isCurrentOpportunityAttachmentContext')
  }
  const read = actualFunctions(names, dependencies).loadOpportunityAttachments(1)
  dependencies.opportunityDetailLoadSequence.value++
  dependencies.opportunityAttachments.value = [{ id: 'new-detail' }]
  dependencies.opportunityAttachmentCapabilities.value = { download_available: false }
  dependencies.opportunityAttachmentLoading.value = true
  release([{ id: 'old-detail' }]); await read
  assert.deepEqual(dependencies.opportunityAttachments.value.map(item => item.id), ['new-detail'])
  assert.equal(dependencies.opportunityAttachmentCapabilities.value.download_available, false)
  assert.equal(dependencies.opportunityAttachmentLoading.value, true)
})
