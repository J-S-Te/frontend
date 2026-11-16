import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { effectScope, nextTick, ref, watch } from 'vue'

const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
const start = source.indexOf('watch([activeSection, activeNodeItems')
const end = source.indexOf('}, { immediate: true })', start) + '}, { immediate: true })'.length
const declaration = source.slice(start, end)

test('栏目读取期间不清除选中服务项，稳定快照确认移出节点后才清除', async () => {
  const scope = effectScope()
  const state = { activeSection: ref('implementation'),
    activeNodeItems: ref([{ id: 'SI-1', status: '实施准备中' }]),
    selectedServiceItemIDs: ref(['SI-1']), loading: ref(false),
    sectionExtrasLoading: ref(false), workspaceReady: ref(true) }
  try {
    scope.run(() => new Function('watch', ...Object.keys(state), declaration)(watch, ...Object.values(state)))
    state.loading.value = true
    state.workspaceReady.value = false
    state.activeNodeItems.value = [] // PREPARATION_STARTED 所需事件仍在读取，不能判断已移出节点。
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    state.activeNodeItems.value = [{ id: 'SI-1', status: '实施准备中' }]
    state.workspaceReady.value = true
    state.loading.value = false
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, ['SI-1'])
    state.activeNodeItems.value = [] // 这次稳定快照确认已移出节点，必须撤销旧选择。
    await nextTick()
    assert.deepEqual(state.selectedServiceItemIDs.value, [])
  } finally { scope.stop() }
})
