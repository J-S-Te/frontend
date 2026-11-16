import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mountSFC } from '../../test/helpers/mountSFC.mjs'

// 用途：挂载异步面板宿主，使用 Vue 异步组件真实加载协议。
// 参数：loader 为受控模块加载函数。
// 返回值：宿主响应式状态及卸载方法。
async function fixture(loader) {
  // 通过宿主默认入口传入 loader 的支持由组件测试助手提供。
  return mountSFC(fileURLToPath(new URL('./components/AsyncPanel.vue', import.meta.url)), {}, { loader })
}

test('异步模块失败后可显式重新加载', async () => {
  let calls = 0
  const view = await fixture(async () => {
    if (++calls === 1) throw new Error('chunk unavailable')
    return { render: () => null }
  })
  try {
    await assert.rejects(view.state.panel.value.__asyncLoader(), /chunk unavailable/)
    view.state.retry()
    const component = await view.state.panel.value.__asyncLoader()
    assert.equal(typeof component.render, 'function')
    assert.equal(calls, 2)
  } finally { view.unmount() }
})
