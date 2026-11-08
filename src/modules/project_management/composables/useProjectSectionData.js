import { onScopeDispose, ref, watch } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'

const eventSections = new Set([
  'dashboard', 'projects', 'project_detail', 'monitoring', 'decomposition', 'allocation',
  'inbox', 'planning', 'preparation', 'assignments', 'methods', 'implementation',
  'exceptions', 'standards', 'reports',
])

// 用途：按实际业务依赖选择栏目附加数据，不把节点判定所需事件当作装饰数据。
// 参数：section 为服务端导航校验后的栏目编号。
// 返回值：本栏目需要读取的资源名，顺序稳定。
function resourcesFor(section) {
  const names = eventSections.has(section) ? ['events'] : []
  if (['dashboard', 'projects'].includes(section)) names.push('dashboard')
  if (['automations', 'sla'].includes(section)) names.push('catalog')
  return names
}

// 用途：在核心快照之外按栏目读取附加数据，隔离栏目、主体和授权世代。
// 参数：section/context/ready 为响应式上下文；allowed 校验栏目；loaders/apply/reset 连接页面状态。
// 返回值：加载态、可重试错误和读取入口；失败不缓存，不重发任何业务写操作。
export function useProjectSectionData({ section, context, ready, allowed, loaders, apply, reset }) {
  const loading = ref(false)
  const error = ref('')
  let generation = 0
  let pending = null
  let disposed = false

  // 用途：使旧栏目和旧授权的在途读取失效。
  // 参数：无。
  // 返回值：无；旧请求完成后不能再发布数据或错误。
  function invalidate() {
    generation += 1
    pending = null
    loading.value = false
    error.value = ''
  }

  // 用途：读取当前栏目依赖；同一代并发入口复用一次读取。
  // 参数：无；刷新或重新进入栏目会由上下文变更建立新代次。
  // 返回值：成功为 true；失败或失效为 false，并保留可重试错误。
  function load() {
    if (disposed || !ready.value) return Promise.resolve(false)
    if (!allowed(section.value)) {
      error.value = '当前账号无权查看此栏目，请刷新工作区。'
      return Promise.resolve(false)
    }
    if (pending) return pending
    const ticket = generation
    const names = resourcesFor(section.value)
    if (!names.length) return Promise.resolve(true)
    loading.value = true
    error.value = ''
    pending = Promise.all(names.map(name => Promise.resolve().then(() => {
      if (!disposed && ticket === generation) return loaders[name]()
    })))
      .then(values => {
        if (disposed || ticket !== generation) return false
        apply(Object.fromEntries(names.map((name, index) => [name, values[index]])))
        return true
      }).catch(cause => {
        if (!disposed && ticket === generation) {
          error.value = formatUserError(cause, { fallback: '当前栏目数据读取失败，请重试。' })
        }
        return false
      }).finally(() => {
        if (!disposed && ticket === generation) { loading.value = false; pending = null }
      })
    return pending
  }

  watch([section, context, ready], () => {
    invalidate()
    reset()
    if (ready.value) void load()
  }, { flush: 'sync' })
  onScopeDispose(() => { disposed = true; invalidate() })
  return { loading, error, load }
}
