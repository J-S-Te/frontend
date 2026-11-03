import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath, URL } from 'node:url'

// BIZ-XAPI-09：已审批合同选择器必须走"服务端关键字搜索 + 游标分页"，
// 不再一次拉 200 条后静默截断。这里锁定三处契约：API 客户端、远程选择器组件、
// 建项弹窗的合同选择器区域。
const apiSource = readFileSync(fileURLToPath(new URL('./api/projectManagement.js', import.meta.url)), 'utf8')
const component = readFileSync(fileURLToPath(new URL('./components/SearchableSelect.vue', import.meta.url)), 'utf8')
const view = readFileSync(fileURLToPath(new URL('./views/ProjectManagementView.vue', import.meta.url)), 'utf8')

test('searchApprovedContractOptions 使用专用端点并规范化关键字与游标', () => {
  assert.match(apiSource, /export async function searchApprovedContractOptions\(\{ keyword = '', afterId = '', limit = 50 \} = \{\}\)/)
  // 关键字去空白后再作为查询参数；空关键字不发送，避免服务端把空串当成过滤条件。
  assert.match(apiSource, /const trimmedKeyword = String\(keyword \|\| ''\)\.trim\(\)/)
  assert.match(apiSource, /if \(trimmedKeyword\) search\.set\('keyword', trimmedKeyword\)/)
  assert.match(apiSource, /if \(afterId\) search\.set\('after_id', afterId\)/)
  assert.match(apiSource, /if \(limit\) search\.set\('limit', String\(limit\)\)/)
  // 端点必须是 /approved-contract-options：/approved-contracts/search 会与
  // /approved-contracts/:contractID 触发 gin 路由冲突。
  assert.ok(apiSource.includes("request(`/approved-contract-options${search.toString() ? `?${search}` : ''}`)"))
  assert.ok(!apiSource.includes('/approved-contracts/search'))
  assert.match(apiSource, /contracts: Array\.isArray\(data\?\.contracts\) \? data\.contracts : \[\]/)
  assert.match(apiSource, /next_after_id: String\(data\?\.next_after_id \|\| ''\)/)
})

test('SearchableSelect 默认本地过滤不变，remote 模式跳过本地过滤并上报搜索/加载更多', () => {
  assert.match(component, /remote: \{ type: Boolean, default: false \}/)
  assert.match(component, /loading: \{ type: Boolean, default: false \}/)
  assert.match(component, /hasMore: \{ type: Boolean, default: false \}/)
  assert.match(component, /defineEmits\(\['update:modelValue', 'change', 'search', 'load-more'\]\)/)
  // remote 时直接使用父组件给的选项；默认分支保持既有本地过滤行为。
  assert.match(component, /props\.remote\s*\n?\s*\? props\.options\s*\n?\s*: filterSearchableOptions\(props\.options, keyword\.value\)/)
  assert.match(component, /emit\('search', keyword\.value\)/)
  assert.match(component, /emit\('load-more'\)/)
  assert.match(component, /@input="onSearchInput"/)
  assert.match(component, /v-if="remote && hasMore"/)
  assert.match(component, /pm-search-select-more/)
})

test('建项弹窗的合同选择器改为远程搜索并保留既有选中链路', () => {
  // 不再用一次性 200 条的原生下拉。
  assert.ok(!view.includes('listApprovedContracts({ limit: 200 })'))
  assert.ok(!view.includes('<select v-model="createForm.contractID"'))
  assert.match(view, /import \{[^}]*searchApprovedContractOptions[^}]*\} from '@\/modules\/project_management\/api\/projectManagement'/)
  assert.match(view, /searchApprovedContractOptions\(\{ keyword, afterId: afterID, limit: APPROVED_CONTRACT_OPTION_LIMIT \}\)/)
  assert.match(view, /<SearchableSelect v-model="createForm.contractID"[^>]*remote[^>]*:has-more="Boolean\(approvedContractSearchNextAfterID\)"[^>]*@search="onApprovedContractSearch"[^>]*@load-more="loadMoreApprovedContractOptions"[^>]*@change="onApprovedContractChange"/)
  // 防抖 300ms：输入过程中不逐字请求。
  assert.match(view, /clearTimeout\(approvedContractSearchTimer\)/)
  assert.match(view, /\}, 300\)/)
  // 选中后仍走既有 selectApprovedContract 读取合同服务范围。
  assert.match(view, /function onApprovedContractChange\(contractID\) \{[\s\S]*selectApprovedContract\(contract\)/)
  assert.match(view, /const catalog = await getApprovedContractServiceItems\(contract\.id\)/)
})

test('合同选择器只显示未建项合同，空态文案区分"搜索无结果"与"没有可用合同"', () => {
  // 已建项合同仍不可选：服务端已过滤，前端继续按合同身份兜一层。
  assert.match(view, /const availableApprovedContracts = computed\(\(\) => approvedContracts\.value\.filter\(\(contract\) =>[\s\S]*builtContractKeys\.value\.has/)
  assert.match(view, /const approvedContractEmptyText = computed\(\(\) => \(approvedContractSearchKeyword\.value\.trim\(\)/)
  // 仅"首页空且无下一页"才提示没有可用合同。
  assert.match(view, /if \(!approvedContractOptions\.value\.length && !approvedContractSearchNextAfterID\.value\) \{/)
  assert.match(view, /当前没有尚未建立项目的已审批合同/)
})

test('加载更多在无游标或加载中时不重复发请求', () => {
  assert.match(view, /function loadMoreApprovedContractOptions\(\) \{\s*\n\s*if \(!approvedContractSearchNextAfterID\.value \|\| approvedContractSearchLoading\.value\) return/)
  assert.match(view, /loadApprovedContractOptions\(\{ keyword: approvedContractSearchKeyword\.value, append: true \}\)\.catch\(\(\) => \{\}\)/)
  // 新搜索结果与后续页按合同 ID 去重，避免同一合同重复出现。
  assert.match(view, /const seen = new Set\(\)/)
})
