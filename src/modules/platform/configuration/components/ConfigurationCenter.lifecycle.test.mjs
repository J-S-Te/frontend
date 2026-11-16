import assert from 'node:assert/strict'
import { test } from 'node:test'
import { watch } from 'vue'
import { fileURLToPath } from 'node:url'
import { mountSFC } from '../../../../test/helpers/mountSFC.mjs'

test('配置行进入响应式列表时已包含编辑值，编辑不会改写原值', async () => {
  const api = fileURLToPath(new URL('../api/configuration.js', import.meta.url))
  const view = await mountSFC(fileURLToPath(new URL('./ConfigurationCenterModule.vue', import.meta.url)), {
    [api]: { listNamespaces: async () => ({ items: [] }),
      listConfigItems: async () => ({ items: [{ item_id: 'a', value: { enabled: true } }] }),
      createConfigItem() {}, createNamespace() {}, publishConfiguration() {}, updateConfigItem() {} },
    [fileURLToPath(new URL('../../auth/utils/principal.js', import.meta.url))]: { hasPermission: () => true },
  })
  const observed = []
  const stop = watch(view.state.items, rows => observed.push(rows[0]?.editValue), { flush: 'sync' })
  try {
    view.state.selectedNamespace.value = 'ns-a'
    await view.state.loadItems()
    assert.equal(observed.at(-1), '{\n  "enabled": true\n}')
    view.state.items.value[0].editValue = '草稿'
    assert.deepEqual(view.state.items.value[0].value, { enabled: true })
  } finally { stop(); view.unmount() }
})
