import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 三态 / 分页 / 反馈统一的「接线」锁。
//
// 共享组件本身的行为由 pagination-bar.test.mjs、list-state.test.mjs 锁；
// 这个文件锁的是**各模块真的接上了共享件**，而不是各自又长回一套手写三态与手写分页：
//   · 每个接入面都 import 共享组件；
//   · 列表的失败原因交给 :error，空态文案交给 empty-title，两者不再共用一句正文；
//   · 手写的「上一页 / 下一页」与「正在加载…」占位不再出现在这些视图里。
// 只要有人把某处改回手写实现，这里就会失败。

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const VIEWS = {
  crm: read('../customer_opportunity/views/CustomerOpportunityView.vue'),
  contract: read('../contract_management/views/ContractManagementView.vue'),
  project: read('../project_management/views/ProjectManagementView.vue'),
  settlement: read('../settlement/views/SettlementView.vue'),
  portal: read('../customer_portal/views/CustomerPortalView.vue'),
}

// 平台控制台 / 数据看板里剩下的手写分页与手写三态面（第二批统一）。
// 每个接入面除了「引共享件」，还要满足硬规则：
//   失败必须走 :error + @retry（重试重新发起同一个请求），
//   列表本体只在有数据时渲染，绝不再出现「正在加载… / 暂无…」的表格行占位。
const PLATFORM_SURFACES = [
  {
    name: '身份与组织（IAM）',
    source: read('../platform/iam/components/IamSettingsModule.vue'),
    pagers: [
      /<PaginationBar[\s\S]{0,500}:page="activePagination\.page"/,
      /:total="activePagination\.total"/,
      /:page-size="activePagination\.pageSize"/,
      /@change="\(next\) => goToPage\(activePanel, next\)"/,
    ],
    states: [
      /<ListState v-if="usersListState"[\s\S]{0,400}:error="panelErrors\.users"[\s\S]{0,500}@retry="loadUsers\(\)"/,
      /<ListState v-if="accountsListState"[\s\S]{0,400}:error="panelErrors\.accounts"[\s\S]{0,500}@retry="loadAccounts\(\)"/,
    ],
    // 手写的加载 / 空态表格行必须消失，否则失败会渲染成「暂无用户记录 / 暂无登录账号记录」。
    forbidden: [/<tr v-if="loading\.users">/, /<tr v-else-if="!filteredUsers\.length">/, /<tr v-if="loading\.accounts">/, /<tr v-else-if="!filteredAccounts\.length">/],
  },
  {
    name: '平台控制台审计日志',
    source: read('../platform/views/PlatformConsoleView.vue'),
    pagers: [
      /<PaginationBar label="审计事件分页"[\s\S]{0,300}:page="auditPage"/,
      /:total="auditTotal"/,
      /:page-size="auditPageSize"/,
      /@change="changeAuditPage"/,
    ],
    states: [
      /<ListState[\s\S]{0,200}v-if="auditListState"[\s\S]{0,400}:error="auditError"[\s\S]{0,400}@retry="loadAuditEvents"/,
      // 顶栏未读通知弹层同样不能把读取失败显示成「暂无未读通知」。
      /<ListState v-if="topbarNotificationsState"[\s\S]{0,400}:error="topbarNotificationsError"[\s\S]{0,300}@retry="loadTopbarNotifications"/,
    ],
    // 审计失败的旧实现会先清空记录再渲染「未找到符合筛选条件的审计事件」，这正是要禁止的。
    forbidden: [/正在读取审计事件…/, /<tr v-else-if="!pagedAuditRecords\.length">/, /class="audit-pagination"/, /<p v-else-if="!topbarNotifications\.length">暂无未读通知。/],
  },
  {
    name: '业务字典',
    source: read('../platform/dictionaries/components/DictionaryManagementModule.vue'),
    pagers: [
      /<PaginationBar label="业务字典分页"[\s\S]{0,300}:page="dictionaryPage"/,
      /:total="dictionaryTotal"/,
      /@change="setDictionaryPage"/,
      /<PaginationBar label="字典项分页"[\s\S]{0,300}:page="itemPage"/,
      /:total="itemTotal"/,
      /@change="setItemPage"/,
    ],
    states: [
      /<ListState[\s\S]{0,200}v-else-if="dictionaryListState"[\s\S]{0,500}:error="dictionaryError"[\s\S]{0,500}@retry="loadDictionaries\(\{ preserveSelection: false \}\)"/,
      /<ListState[\s\S]{0,200}v-if="canReadItems && itemListState"[\s\S]{0,500}:error="itemError"[\s\S]{0,400}@retry="loadItems"/,
    ],
    forbidden: [/正在读取业务字典…/, /正在读取字典项…/, /<tr v-else-if="!items\.length">/],
  },
  {
    name: '异步任务运维',
    source: read('../platform/files/components/FileTaskOperationsModule.vue'),
    pagers: [
      /<PaginationBar label="异步任务分页"[\s\S]{0,300}:page="page"/,
      /:total="total"/,
      /@change="changePage"/,
    ],
    states: [
      /<ListState v-if="jobsListState"[\s\S]{0,300}:error="listError"[\s\S]{0,300}@retry="loadJobs"/,
    ],
    forbidden: [/<tr v-if="loading">/, /<tr v-else-if="!jobs\.length">/],
  },
  {
    name: '应用登录目标',
    source: read('../platform/login-targets/components/ApplicationLoginTargetModule.vue'),
    pagers: [
      /<PaginationBar label="登录目标分页"[\s\S]{0,300}:page="page"/,
      /:total="total"/,
      /@change="setPage"/,
    ],
    states: [
      /<ListState[\s\S]{0,200}v-if="listState"[\s\S]{0,400}:error="listError"[\s\S]{0,400}@retry="loadTargets"/,
    ],
    forbidden: [/正在读取登录目标…/, /<tr v-else-if="!targets\.length">/],
  },
  {
    name: '商业授权事件',
    source: read('../platform/features/licenses/CommercialLicenseView.vue'),
    pagers: [
      /<PaginationBar[\s\S]{0,300}:page="events\.page"/,
      /:total="events\.total"/,
      /:page-size="eventPageSize"/,
      /@change="loadEvents"/,
    ],
    states: [
      /<ListState[\s\S]{0,200}v-if="eventsListState"[\s\S]{0,400}:error="eventsError"[\s\S]{0,400}@retry="loadEvents\(events\.page\)"/,
    ],
    forbidden: [/正在读取事件…/, /<p v-else-if="!eventsLoading && !eventsError" class="license-muted">/],
  },
  {
    name: '岗位授权模板',
    source: read('../platform/iam/components/PositionAuthorizationTemplates.vue'),
    pagers: [
      /<PaginationBar[\s\S]{0,300}:page="templatePage"/,
      /:total="activeTemplates\.length"/,
      /:page-size="templatePageSize"/,
      /@change="setTemplatePage"/,
    ],
    states: [
      /<ListState[\s\S]{0,200}v-if="templateListState"[\s\S]{0,400}:error="templatesError"[\s\S]{0,400}@retry="load"/,
    ],
    forbidden: [/正在读取模板…/, /<div v-else-if="!activeTemplates\.length" class="console-empty">/],
  },
  {
    name: '预警中心',
    source: read('../data_analysis/views/AlertsCenterView.vue'),
    pagers: [
      /<PaginationBar label="预警列表分页"[\s\S]{0,300}:page="page"/,
      /:total="total"/,
      /:page-size="pageSize"/,
      /@change="changePage"/,
    ],
    states: [
      /<ListState[\s\S]{0,200}v-if="alertListState"[\s\S]{0,400}:error="error"[\s\S]{0,400}@retry="load"/,
    ],
    forbidden: [/共 \{\{ total \}\} 条 · 第 \{\{ page \}\} \/ \{\{ pageCount \}\} 页/, /<EmptyState v-if="filteredAlerts\.length === 0"/],
  },
]

test('五个接入面都引入了共享三态 / 分页组件', () => {
  // 列表型页面统一用 ListState 闸门（内部就是 LoadingState / ErrorState / EmptyState）。
  for (const name of ['crm', 'contract', 'project', 'portal']) {
    assert.match(VIEWS[name], /import ListState from '@\/modules\/shared\/components\/ListState\.vue'/, `${name}: ListState`)
    assert.match(VIEWS[name], /import PaginationBar from '@\/modules\/shared\/components\/PaginationBar\.vue'/, `${name}: PaginationBar`)
  }
  // 结算整页的三态直接落共享基础组件（页面级失败 / 加载），列表分页走本地薄壳页脚。
  assert.match(VIEWS.settlement, /import LoadingState from '@\/modules\/shared\/components\/LoadingState\.vue'/)
  assert.match(VIEWS.settlement, /import ErrorState from '@\/modules\/shared\/components\/ErrorState\.vue'/)
  assert.match(VIEWS.settlement, /import SettlementListPager from '@\/modules\/settlement\/components\/SettlementListPager\.vue'/)
  assert.match(read('../settlement/components/SettlementListPager.vue'), /import PaginationBar from '@\/modules\/shared\/components\/PaginationBar\.vue'/)
})

test('失败原因与空态文案分开传：失败不会再显示成「暂无…」', () => {
  // CRM 客户列表：失败走 :error，空态才用「暂无符合条件的客户」。
  assert.match(VIEWS.crm, /<ListState v-if="customersListState" :loading="loading" :error="listError"[^>]*empty-title="暂无符合条件的客户"/)
  assert.match(VIEWS.crm, /<ListState v-if="opportunitiesListState" :loading="loading" :error="listError"[^>]*empty-title="暂无符合条件的商机"/)
  assert.match(VIEWS.crm, /<ListState v-if="presaleListState" :loading="loading" :error="listError"[^>]*empty-title="暂无可见申请"/)
  // 手写的「加载中」与「暂无…」不再和列表数据区并列出现。
  assert.doesNotMatch(VIEWS.crm, /<p v-if="loading">正在加载…<\/p>/)
  // 看板视图与门户列表也必须走三态闸门：请求失败时不能落回“暂无数据/暂无任务”。
  assert.match(VIEWS.crm, /<ListState v-if="opportunityBoardState" :loading="loading" :error="listError"[^>]*error-title="商机阶段看板加载失败"/)
  assert.match(VIEWS.crm, /<ListState v-if="presaleBoardState" :loading="loading" :error="listError"[^>]*error-title="售前状态看板加载失败"/)
  assert.match(VIEWS.portal, /<ListState v-if="projectListError \|\| \(!projects\.length && !loading\)" :error="projectListError"[\s\S]*?empty-title="暂无可查看的项目"/)
  assert.match(VIEWS.portal, /<ListState v-if="feedbackListError \|\| \(!feedbacks\.length && !loading\)" :error="feedbackListError"[\s\S]*?empty-title="暂无反馈"/)
  assert.match(VIEWS.portal, /@retry="reloadList"/)
  assert.doesNotMatch(VIEWS.portal, /<div v-else class="portal-empty">暂无可查看的项目<\/div>/)
  assert.doesNotMatch(VIEWS.portal, /<p v-if="!feedbacks\.length">暂无反馈<\/p>/)
  assert.doesNotMatch(VIEWS.crm, /<div v-else class="crm-empty">暂无符合条件的客户<\/div>/)
  assert.doesNotMatch(VIEWS.crm, /<div v-else class="crm-empty">暂无符合条件的商机<\/div>/)

  // 合同：加载不再复用红色错误样式，失败带重试。
  assert.doesNotMatch(VIEWS.contract, /<p v-if="businessDataLoading" class="contract-session-error">/)
  assert.match(VIEWS.contract, /<ListState\s+v-if="businessDataLoading \|\| businessDataError"[\s\S]{0,240}@retry="loadBusinessData"/)

  // 项目：报告阶段筛选失败不再渲染成空文案，空态区分「数据源为空 / 筛选无结果」。
  assert.doesNotMatch(VIEWS.project, /projectListEmptyText/)
  assert.match(VIEWS.project, /:error="projectListError"/)
  assert.match(VIEWS.project, /:empty-title="projectListSource\.length \? '暂无符合当前筛选条件的项目' : '暂无项目，请先新建项目'"/)

  // 门户：报告申请记录与项目动态都按「失败 → 可重试 / 空 → 空文案」分开。
  assert.match(VIEWS.portal, /<ListState v-else-if="reportListError \|\| reportListLoading \|\| !reports\.length"[\s\S]{0,240}@retry="loadReportWorkspace"/)
  assert.match(VIEWS.portal, /<ListState v-if="activityError \|\| activityLoading \|\| !activities\.length"[\s\S]{0,240}@retry="loadProjectActivities\(selectedProject\.project_id, activityPage\)"/)
  assert.doesNotMatch(VIEWS.portal, /<p v-if="loading">正在加载…<\/p>/)

  // 结算：整页失败 / 加载走共享三态，并且能重新发起同一个 load。
  assert.match(VIEWS.settlement, /<ErrorState v-if="error" :error="error" title="结算数据读取失败" @retry="load" \/>/)
  assert.match(VIEWS.settlement, /<LoadingState v-if="loading" title="正在读取结算数据…" \/>/)
  assert.doesNotMatch(VIEWS.settlement, /<p v-if="loading" class="settlement-loading">/)
})

test('手写的「上一页 / 下一页」条已全部由 PaginationBar 替代', () => {
  for (const [name, source] of Object.entries(VIEWS)) {
    assert.doesNotMatch(source, />上一页<\/button>/, `${name}: 仍有手写上一页按钮`)
    assert.doesNotMatch(source, />下一页<\/button>/, `${name}: 仍有手写下一页按钮`)
    assert.doesNotMatch(source, /role="group" aria-label="[^"]*分页"/, `${name}: 仍有手写分页容器`)
    assert.doesNotMatch(source, /aria-label="[^"]*分页"[^>]*>\s*<button/, `${name}: 仍有手写分页 nav`)
  }
  // 结算不再有浮在所有列表上方的独立分页面板。
  assert.doesNotMatch(VIEWS.settlement, /aria-label="列表分页"/)
  assert.doesNotMatch(VIEWS.settlement, /visibleListPages/)
})

test('结算把分页放回每个列表面板自己的页脚', () => {
  for (const section of ['receivables', 'receipts', 'allocations', 'invoices', 'dunning', 'finance', 'tasks']) {
    assert.match(
      VIEWS.settlement,
      new RegExp(`<SettlementListPager :entries="listPagerEntries\\('${section}'\\)"`),
      `结算 ${section} 面板缺少自己的分页页脚`,
    )
  }
  assert.match(VIEWS.settlement, /import SettlementListPager from '@\/modules\/settlement\/components\/SettlementListPager\.vue'/)
})

test('写操作返回业务编号时，提示把编号交给用户', () => {
  // 客户创建 / 售前申请：编号跟随提示（noticeReference），不会随列表刷新丢失。
  assert.match(VIEWS.crm, /:reference="noticeReference"/)
  assert.match(VIEWS.crm, /notifyWithReference\('客户创建成功。', created\?\.customer_no \|\| ''\)/)
  assert.match(VIEWS.crm, /notifyWithReference\('售前申请已提交；商机阶段保持不变。', value\?\.request_no \|\| ''\)/)
  // 门户：报告申请号写进提示。
  assert.match(VIEWS.portal, /:reference="noticeReference"/)
  assert.match(VIEWS.portal, /noticeWithReference\('报告申请已提交。', created\?\.request_no \|\| ''\)/)
  // 结算：回款号写进提示。
  assert.match(VIEWS.settlement, /<OperationToast :message="message" :reference="messageReference" \/>/)
  assert.match(read('../settlement/composables/useSettlementActions.js'), /function notify\(value, reference = ""\)/)
  assert.match(read('../settlement/composables/useReceiptRegistration.js'), /notify\("回款已登记。", receiptReference\)/)
  // 合同 / 平台继续沿用持久化结果横幅（现有行为依赖它）。
  assert.match(VIEWS.contract, /OperationResultBanner/)
})

// ===========================================================================
// 第二批：平台控制台（IAM / 审计 / 字典 / 异步任务 / 登录目标 / 商业授权 /
// 岗位授权模板）与数据看板的预警中心。
//
// 这三条用例合起来就是这些接入面的「接线锁」：
//   1) 都 import 共享件，且分页条真的拿到了 page / total / pageSize / @change；
//   2) 列表三态真的拿到了 :error 与 @retry（失败可重试，重试重新发起同一个请求）；
//   3) 手写分页按钮与手写加载 / 空态占位不再出现——只要有人把某处改回手写实现，
//      或把失败重新渲染成「暂无…」，这里立刻失败。
// ===========================================================================

test('平台 / 预警中心接入面都引入了共享三态与分页组件', () => {
  for (const { name, source } of PLATFORM_SURFACES) {
    // 引号风格各模块不同（单/双引号都在用），只锁「真的从 shared 引入」。
    assert.match(source, /import ListState from ['"]@\/modules\/shared\/components\/ListState\.vue['"]/, `${name}: 缺少 ListState 引入`)
    assert.match(source, /import PaginationBar from ['"]@\/modules\/shared\/components\/PaginationBar\.vue['"]/, `${name}: 缺少 PaginationBar 引入`)
  }
})

test('平台 / 预警中心分页条都拿到真实页码与总数，手写「上一页 / 下一页」已清除', () => {
  for (const { name, source, pagers } of PLATFORM_SURFACES) {
    for (const pattern of pagers) {
      assert.match(source, pattern, `${name}: 分页条缺少 ${pattern}`)
    }
    assert.doesNotMatch(source, />上一页<\/button>/, `${name}: 仍有手写上一页按钮`)
    assert.doesNotMatch(source, />下一页<\/button>/, `${name}: 仍有手写下一页按钮`)
    assert.doesNotMatch(source, /aria-label="[^"]*分页"\s*>/, `${name}: 仍有手写分页容器`)
  }
})

test('平台 / 预警中心的列表失败走 :error + @retry，不再渲染成「暂无…」或空表格行', () => {
  for (const { name, source, states, forbidden } of PLATFORM_SURFACES) {
    for (const pattern of states) {
      assert.match(source, pattern, `${name}: 三态闸门缺少失败重试绑定 ${pattern}`)
    }
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${name}: 仍存在手写加载 / 空态占位 ${pattern}`)
    }
  }
  // 失败的重试必须是「重新发起同一个请求」：三个自管理错误位的接入面直接复用原 load。
  const byName = Object.fromEntries(PLATFORM_SURFACES.map((surface) => [surface.name, surface.source]))
  assert.match(byName['平台控制台审计日志'], /:error="auditError"[\s\S]{0,400}@retry="loadAuditEvents"/)
  assert.match(byName['异步任务运维'], /:error="listError"[\s\S]{0,300}@retry="loadJobs"/)
  assert.match(byName['应用登录目标'], /:error="listError"[\s\S]{0,400}@retry="loadTargets"/)
})

// 三态优先级（loading > error > empty）必须写进各自的闸门表达式：
// 只要有人把失败位从 cond &&|| !list.length 里去掉，失败就会重新渲染成空状态，
// 或者空列表把失败原因挡在身后。这里按接入面逐个锁住表达式本身。
const STATE_GUARDS = [
  ['身份与组织（IAM）· 用户', '../platform/iam/components/IamSettingsModule.vue', /const usersListState = computed\(\(\) => loading\.users \|\| Boolean\(panelErrors\.users\) \|\| !filteredUsers\.value\.length\)/],
  ['身份与组织（IAM）· 账号', '../platform/iam/components/IamSettingsModule.vue', /const accountsListState = computed\(\(\) => loading\.accounts \|\| Boolean\(panelErrors\.accounts\) \|\| !filteredAccounts\.value\.length\)/],
  ['平台控制台审计日志', '../platform/views/PlatformConsoleView.vue', /const auditListState = computed\(\(\) => auditLoading\.value \|\| Boolean\(auditError\.value\) \|\| !pagedAuditRecords\.value\.length\)/],
  ['业务字典', '../platform/dictionaries/components/DictionaryManagementModule.vue', /const dictionaryListState = computed\(\(\) => dictionaryLoading\.value \|\| Boolean\(dictionaryError\.value\) \|\| !dictionaries\.value\.length\)/],
  ['字典项', '../platform/dictionaries/components/DictionaryManagementModule.vue', /const itemListState = computed\(\(\) => itemLoading\.value \|\| Boolean\(itemError\.value\) \|\| !items\.value\.length\)/],
  ['异步任务运维', '../platform/files/components/FileTaskOperationsModule.vue', /const jobsListState = computed\(\(\) => loading\.value \|\| Boolean\(listError\.value\) \|\| !jobs\.value\.length\)/],
  ['应用登录目标', '../platform/login-targets/components/ApplicationLoginTargetModule.vue', /const listState = computed\(\(\) => loading\.value \|\| Boolean\(listError\.value\) \|\| !targets\.value\.length\)/],
  ['商业授权事件', '../platform/features/licenses/CommercialLicenseView.vue', /const eventsListState = computed\(\(\) => eventsLoading\.value \|\| Boolean\(eventsError\.value\) \|\| !events\.value\.items\.length\)/],
  ['岗位授权模板', '../platform/iam/components/PositionAuthorizationTemplates.vue', /const templateListState = computed\(\(\) => loading\.value \|\| Boolean\(templatesError\.value\) \|\| !activeTemplates\.value\.length\)/],
  ['预警中心', '../data_analysis/views/AlertsCenterView.vue', /const alertListState = computed\(\(\) => loading\.value \|\| Boolean\(error\.value\) \|\| !filteredAlerts\.value\.length\)/],
]

test('每个接入面的三态闸门都把失败排在空态之前（loading > error > empty）', () => {
  for (const [name, file, pattern] of STATE_GUARDS) {
    assert.match(read(file), pattern, `${name}: 三态闸门丢掉了失败分支或优先级`)
  }
})
