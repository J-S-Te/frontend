import { computed, createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import OwnerSelector from '../../modules/customer_opportunity/components/OwnerSelector.vue'
import ConfigurationCenter from '../../modules/platform/configuration/components/ConfigurationCenterModule.vue'
import AsyncPanel from '../../modules/shared/components/AsyncPanel.vue'
import { useDialogFocusTrap } from '../../modules/shared/composables/useDialogFocusTrap.js'
import { useCurrentPrincipal } from '../../modules/platform/auth/utils/principal.js'
import { useFormDraft } from '../../modules/shared/composables/useFormDraft.js'
import ProjectView from '../../modules/project_management/views/ProjectManagementView.vue'

let app
window.unmountFixture = () => { app?.unmount(); app = null }
// 用途：挂载实际组件并保存本轮测试实例，不创建真实业务数据。
// 参数：component 为目标组件；props 为合成参数。
// 返回值：已挂载实例。
function mount(component, props = {}) {
  window.unmountFixture()
  app = createApp(component, props)
  app.config.errorHandler = error => { window.fixtureErrors.push(error.message) }
  return app.mount('#fixture')
}
window.fixtureErrors = []
window.mountOwner = () => mount(OwnerSelector)
window.mountConfiguration = async () => {
  await useCurrentPrincipal().refreshPrincipal({ force: true })
  mount(ConfigurationCenter)
}
window.mountAsync = () => {
  let count = 0
  const loader = async () => {
    window.asyncLoads = ++count
    if (count === 1) throw new Error('synthetic module failure')
    return { props: ['canManage'], emits: ['notify'], setup: (props, { emit }) =>
      () => h('button', { id: 'async-action', disabled: !props.canManage,
        onClick: () => emit('notify', '已触发原业务事件') }, '实际组件内容') }
  }
  const open = ref(false)
  const canManage = ref(false)
  window.asyncOpen = open
  window.asyncCanManage = canManage
  mount({ setup: () => () => open.value
    ? h(AsyncPanel, { loader, canManage: canManage.value,
      onNotify: message => { window.asyncNotice = message } }) : h('p', '面板尚未打开') })
}
window.mountFocus = () => mount({ setup() {
  const active = ref(false), container = ref(null)
  window.focusActive = active
  useDialogFocusTrap({ active, container })
  return () => active.value ? h('section', { ref: container, role: 'dialog' }, [
    h('input', { id: 'focus-first', 'aria-label': '首个字段' }),
    h('button', { id: 'focus-last', onClick: () => { active.value = false } }, '关闭'),
  ]) : null
} })
window.mountDraft = () => mount({ setup() {
  const form = ref({ name: '' })
  const draft = useFormDraft({ key: 'vue-lifecycle-synthetic-draft', form: form.value,
    principal: ref({ tenant_id: 'qa', identity_id: 'qa-user' }), debounceMs: 0 })
  return () => h('div', [h('input', { id: 'draft-input', value: form.value.name,
    onInput: event => { form.value.name = event.target.value } }),
  h('button', { id: 'restore-draft', onClick: draft.restore }, '恢复合成草稿')])
} })
window.mountProject = async () => {
  window.unmountFixture()
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { name: 'project_management', path: '/project/:section', component: ProjectView },
  ] })
  await router.push('/project/projects')
  app = createApp(ProjectView)
  app.use(router)
  app.config.errorHandler = error => { window.fixtureErrors.push(error.message) }
  window.projectRouter = router
  app.mount('#fixture')
  await nextTick()
}
window.fixtureReady = true
