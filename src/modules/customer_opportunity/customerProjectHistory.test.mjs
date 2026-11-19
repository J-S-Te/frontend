import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { compileScript, parse } from '@vue/compiler-sfc'
import { reactive, ref } from 'vue'
import { formatCRMError } from './api/errorMessages.js'

const view = readFileSync(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(view)
const script = compileScript(descriptor, { id: 'crm-customer-project-history' })
const loadNode = script.scriptSetupAst.find((node) => node.id?.name === 'loadCustomerProjectPage')
const loadSource = descriptor.scriptSetup.content.slice(loadNode.start, loadNode.end)

/**
 * 用途：运行客户项目历史页签的真实分页函数，替换外部读取请求。
 * 参数：listCustomerProjects 为可控的项目历史 API。
 * 返回值：页签状态和分页加载入口。
 */
function projectHistoryFixture(listCustomerProjects) {
  const state = {
    selectedCustomer: ref({ id: '7' }),
    customerProjectLoadSequence: ref(0),
    customerProjects: ref([]),
    customerProjectsSource: ref(''),
    customerProjectsLoading: ref(false),
    customerProjectsNotConfigured: ref(false),
    customerProjectsPage: reactive({ number: 1, size: 20, total: 0 }),
    customerTabErrors: reactive({}),
    listCustomerProjects,
    formatCRMError,
  }
  const load = vm.runInNewContext(`(${loadSource})`, state)
  return { ...state, load }
}

test('项目历史未配置时进入专用的状态提示，不生成通用重试错误', async () => {
  const state = projectHistoryFixture(async () => {
    throw Object.assign(new Error(), {
      status: 503, code: 'CRM_CUSTOMER_PROJECT_HISTORY_NOT_CONFIGURED',
    })
  })

  assert.equal(await state.load(1), false)
  assert.equal(state.customerProjectsNotConfigured.value, true)
  assert.equal(state.customerTabErrors.projects, undefined)
  assert.equal(state.customerProjectsLoading.value, false)
})

test('项目历史临时失败保留可重试错误，重新查询成功后更新列表', async () => {
  let attempts = 0
  const item = { project_id: 'p-1', project_name: '项目一' }
  const state = projectHistoryFixture(async () => {
    if (++attempts === 1) {
      throw Object.assign(new Error(), {
        status: 503, code: 'CRM_CUSTOMER_PROJECT_HISTORY_UNAVAILABLE',
      })
    }
    return { source: 'project_management', items: [item], page: 1, page_size: 20, total: 1 }
  })

  assert.equal(await state.load(1), false)
  assert.equal(state.customerProjectsNotConfigured.value, false)
  assert.ok(state.customerTabErrors.projects)
  assert.equal(await state.load(1), true)
  assert.equal(state.customerTabErrors.projects, undefined)
  assert.deepEqual(state.customerProjects.value, [item])
  assert.equal(state.customerProjectsSource.value, 'project_management')
  assert.equal(state.customerProjectsPage.total, 1)
})
