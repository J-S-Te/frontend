import { watch } from 'vue'
import { createNotificationStream } from '../../shared/composables/notificationStream.js'

/**
 * 用途：仅在项目业务页面订阅原生 SSE，按当前 Vue 作用域接收并合并后台刷新。
 * 参数：enabled/context/section/projectID 为响应式页面坐标；connect 和 refresh 为流与读取入口。
 * 返回值：Vue watcher 停止函数，组件作用域销毁时自动关闭连接。
 */
export function useProjectWorkflowSync({
  enabled, context, section, projectID, connect, refresh,
  visibility = typeof document === 'undefined' ? null : document,
  coalesceMs = 80, fallbackMs = 5000,
}) {
  return watch([enabled, context, section, projectID], ([active, owner, view, id], _, onCleanup) => {
    if (!active) return
    let live = true
    const observe = createNotificationStream({
      connect: () => connect(id), changeEvent: 'workflow-changed',
      coalesceMs, fallbackMs, maxFallbackMs: 15000, visibility,
    })
    const stop = observe(() => refresh({ context: owner, section: view, projectID: id }, () => live))
    onCleanup(() => { live = false; stop() })
  }, { immediate: true, flush: 'sync' })
}

/**
 * 用途：合并定向读取的项目、服务项或历史事件，保留其它项目的已加载记录。
 * 参数：current 为现有视图集合，rows 为已授权新记录，projectID 为定向项目，idFor 提取归属项目。
 * 返回值：新集合；空项目坐标表示整体替换。
 */
export function replaceWorkflowRows(current, rows, projectID, idFor) {
  return projectID ? [...current.filter((row) => idFor(row) !== projectID), ...rows] : rows
}

/**
 * 用途：后台更新服务项时保留用户对待确认拆解项的勾选结果。
 * 参数：current 为页面当前服务项，rows 为最新受权服务项。
 * 返回值：带有当前有效勾选状态的新服务项集合。
 */
export function reconcileWorkflowServiceItems(current, rows) {
  const eligible = new Set(['待确认', '待复核'])
  const selections = new Map(current.filter(row => eligible.has(row.status))
    .map(row => [row.id, row.selected]))
  return rows.map(row => ({
    ...row, selected: eligible.has(row.status) && (selections.get(row.id) ?? true),
  }))
}
