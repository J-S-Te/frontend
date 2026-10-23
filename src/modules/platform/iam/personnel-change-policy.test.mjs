import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import { computed, reactive, ref } from 'vue'
import { loadAllCatalogPages } from './utils/paginatedCatalog.js'
import { formatUserError } from '../../shared/utils/userError.js'

const source = readFileSync(new URL('./components/PersonnelChangeCenter.vue', import.meta.url), 'utf8')

test('人员异动页面按类型校验任职字段并公开审批交接规则', () => {
  assert.match(source, /\['PROMOTION', 'DEMOTION', 'TRANSFER', 'TERMINATION'\]\.includes\(form\.type\)/)
  assert.match(source, /晋升、降职、调岗和离职必须选择原任职/)
  assert.match(source, /晋升、降职、调岗和复职必须选择新组织和新岗位/)
  assert.match(source, /离职必须审批并完成责任交接/)
  assert.doesNotMatch(source, /离职、复职可不填/)
  assert.match(source, /submitPersonnelChange/)
  assert.match(source, /transitionPersonnelChange/)
  assert.match(source, /PENDING_HANDOVER/)
  assert.match(source, /rejectWorkflowAction/)
  assert.match(source, /cancelPersonnelChange/)
  assert.match(source, /platform:approval:process/)
  assert.match(source, /listPersonnelHandoverItems/)
  assert.match(source, /completePersonnelHandoverItem/)
  assert.match(source, /请选择责任接收人/)
  assert.match(source, /全部成功后才允许排期离职/)
})

test('人员异动弹窗将操作栏固定在可滚动表单外', () => {
  assert.match(source, /\.personnel-change-modal \{ display: flex;/)
  assert.match(source, /\.personnel-change-modal-body \{ min-height: 0; flex: 1 1 auto;/)
  assert.match(source, /\.personnel-change-modal > \.console-form-actions \{ position: relative;/)
})

// 执行组件真实的目录控制器和选择计算。仅服务边界使用测试替身，
// 分页与 Vue 响应式逻辑均使用真实模块。
const { descriptor } = parse(source)
const setup = compileScript(descriptor, { id: 'personnel-change-policy' })
const controllerNames = new Set(['availableUsers', 'catalogsRequestSeq', 'loadCatalogs', 'dropInvalidSelections'])
const controllerSource = setup.scriptSetupAst.filter((node) => {
  if (node.type === 'VariableDeclaration') return node.declarations.some((item) => controllerNames.has(item.id.name))
  return node.type === 'FunctionDeclaration' && controllerNames.has(node.id.name)
}).map((node) => descriptor.scriptSetup.content.slice(node.start, node.end)).join('\n')

function catalogFixture(listUsers, allowed = true) {
  const state = {
    computed, loadAllCatalogPages, formatUserError, listUsers,
    listPositions: async () => ({ items: [], total: 0 }),
    listOrgUnits: async () => ({ items: [], total: 0 }),
    canUpdate: ref(allowed), users: ref([]), positions: ref([]), organizations: ref([]),
    catalogsLoading: ref(false), catalogsFailed: ref(false), error: ref(''),
    form: reactive({ type: 'REHIRE', userId: '', targetOrgUnitId: '', targetPositionId: '' }),
    memberships: ref([]), personConfirmed: ref(false), catalogNotice: ref(''),
  }
  const controller = vm.runInNewContext(`${controllerSource}\n({ loadCatalogs, availableUsers })`, state)
  return { state, controller }
}

function pagedUsers() {
  const requests = []
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `active-${index}`, status: 'ACTIVE' }))
  const secondPage = [
    { id: 'disabled-page-two', status: 'DISABLED' },
    { id: 'disabled-lowercase', status: 'disabled' },
    { id: 'active-page-two', status: 'active' },
    { id: 'unknown-state', status: 'PENDING' },
    { id: 'missing-state' },
  ]
  return {
    requests,
    list: async (query) => {
      requests.push(query)
      assert.ok(query.page === 1 || query.page === 2, 'directory must stop at the declared total')
      return { items: query.page === 1 ? firstPage : secondPage, total: 105, page: query.page, pageSize: 100 }
    },
  }
}

test('复职目录逐页读取未过滤的人员，第二页停用人员仍可选', async () => {
  const directory = pagedUsers()
  const { state, controller } = catalogFixture(directory.list)
  assert.equal(await controller.loadCatalogs(), true)
  assert.equal(state.users.value.length, 105)
  assert.deepEqual(directory.requests, [{ pageSize: 100, page: 1 }, { pageSize: 100, page: 2 }])
  assert.deepEqual(controller.availableUsers.value.map((user) => user.id), ['disabled-page-two', 'disabled-lowercase'])
  assert.equal(state.catalogsFailed.value, false)
})

test('晋升降职调岗和离职仅选择在职人员，包括第二页人员', async () => {
  const directory = pagedUsers()
  const { state, controller } = catalogFixture(directory.list)
  await controller.loadCatalogs()
  for (const type of ['PROMOTION', 'DEMOTION', 'TRANSFER', 'TERMINATION']) {
    state.form.type = type
    const ids = controller.availableUsers.value.map((user) => user.id)
    assert.equal(ids.length, 101, type)
    assert.ok(ids.includes('active-0'), type)
    assert.ok(ids.includes('active-page-two'), type)
    assert.ok(!ids.includes('disabled-page-two'), type)
    assert.ok(!ids.includes('unknown-state'), type)
    assert.ok(!ids.includes('missing-state'), type)
  }
})

test('人员目录失败时保留失败状态，不伪装为成功的空目录', async () => {
  const { state, controller } = catalogFixture(async () => { throw new Error('fixture directory unavailable') })
  assert.equal(await controller.loadCatalogs(), false)
  assert.equal(state.catalogsFailed.value, true)
  assert.equal(state.catalogsLoading.value, false)
  assert.match(state.error.value, /人员目录/)
  assert.deepEqual(controller.availableUsers.value, [])
})

test('无更新权限不请求人员目录', async () => {
  let requests = 0
  const { state, controller } = catalogFixture(async () => { requests++; return { items: [], total: 0 } }, false)
  await controller.loadCatalogs()
  assert.equal(requests, 0)
  assert.equal(state.catalogsLoading.value, false)
})
