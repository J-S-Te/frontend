import { computed, ref, shallowRef, watch } from 'vue'
import { createResourceMetricCommands } from '../resourceMetricCommandState.js'
export { createResourceMetricCommands } from '../resourceMetricCommandState.js'

// 用途：协调节点快捷入口、现场完成核对和统一台账，保留原现场完成门禁。
// 参数：options 提供会话、节点、可见父项、原完成命令及导航边界。
// 返回值：弹窗上下文、共享命令和明确的打开、关闭及完成操作。
export function useResourceMetricWorkflow(options) {
  const { session, selectedItem, items, section, saving, canComplete,
    complete, loadEquipment, navigateCenter } = options
  const dialog = ref(null), commands = shallowRef(createResourceMetricCommands())
  const scopeKey = computed(() => JSON.stringify([
    session.value?.tenant_id || '', session.value?.user_id || '',
  ]))
  const dialogItem = computed(() => items.value.find(item => item.id === dialog.value?.itemID) || null)

  // 用途：从当前节点打开容量或用量，现场结束时只增加核对入口。
  // 参数：initialTab 为首选录入类型，finish 表示核对后继续原现场完成动作。
  // 返回值：无；无可见父项或无读取权限时不打开。
  function open(initialTab = 'usage', finish = false) {
    const item = selectedItem.value
    if (!item || saving.value || !session.value?.permissions?.includes('project.read')) return
    if (finish && !canComplete.value) return
    dialog.value = { itemID: item.id, initialTab, finish }
    void loadEquipment()
  }

  // 用途：关闭当前界面，原资源命令仍由页面会话持有以便恢复。
  // 参数：无。
  // 返回值：无；现场完成请求在途时暂不卸载其确认界面。
  function close() {
    if (!saving.value) dialog.value = null
  }

  // 用途：在同一父项继续原现场完成操作，不要求必须录入资源用量。
  // 参数：无，读取当前完成权限及原服务项选择。
  // 返回值：完成Promise；只有原命令确认已保存才关闭窗口。
  async function finish() {
    const context = dialog.value
    if (!context?.finish || saving.value || !canComplete.value || !dialogItem.value
      || selectedItem.value?.id !== context.itemID) return
    const confirmed = await complete()
    if (confirmed && dialog.value === context) dialog.value = null
  }

  // 用途：打开统一资源台账并携带当前服务项作为可核验的选择上下文。
  // 参数：无。
  // 返回值：无，最终可见性仍由目标页和服务端核对。
  function openCenter() {
    navigateCenter(selectedItem.value?.id || '')
  }

  watch(scopeKey, () => {
    dialog.value = null
    commands.value = createResourceMetricCommands()
  }, { flush: 'sync' })
  watch(section, close)
  watch(() => selectedItem.value?.id, id => {
    if (dialog.value && dialog.value.itemID !== id) close()
  })
  return { dialog, dialogItem, commands, scopeKey, open, close, finish, openCenter }
}
