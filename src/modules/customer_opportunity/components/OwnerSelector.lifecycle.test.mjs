import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextTick } from 'vue'
import { fileURLToPath } from 'node:url'
import { mountSFC } from '../../../test/helpers/mountSFC.mjs'

// 用途：挂载负责人选择器，并以可控网络完成顺序验证竞态。
// 参数：无。
// 返回值：组件状态、卸载入口及等待中的读取请求。
async function fixture() {
  const requests = []
  const mounted = await mountSFC(fileURLToPath(new URL('./OwnerSelector.vue', import.meta.url)), {
    [fileURLToPath(new URL('../api/ownerDirectory.js', import.meta.url))]: {
      listOwnerDirectory: (params, options) => new Promise((resolve, reject) => {
        requests.push({ params, options, resolve, reject })
      }),
    },
  })
  return { ...mounted, requests }
}

test('连续搜索取消旧读取，即使服务端迟到也不覆盖新选项', async () => {
  const view = await fixture()
  try {
    view.state.keyword.value = '新负责人'
    const searching = view.state.search()
    assert.equal(view.requests[0].options?.signal?.aborted, true)
    view.requests[1].resolve({ items: [{ user_id: 'new', username: '新负责人' }] })
    await searching
    view.requests[0].resolve({ items: [{ user_id: 'old' }] })
    await nextTick()
    assert.equal(view.state.users.value[0].user_id, 'new')
  } finally { view.unmount() }
})

test('卸载取消读取，迟到响应不写回组件状态', async () => {
  const view = await fixture()
  view.unmount()
  assert.equal(view.requests[0].options?.signal?.aborted, true)
  view.requests[0].resolve({ items: [{ user_id: 'late' }] })
  await nextTick()
  assert.deepEqual(view.state.users.value, [])
})

test('真实读取失败显示错误，原条件可重试成功', async () => {
  const view = await fixture()
  try {
    view.requests[0].reject(Object.assign(new Error('unavailable'), { status: 503 }))
    await new Promise(resolve => setImmediate(resolve))
    assert.match(view.state.error.value, /暂不可用/)
    const retry = view.state.initialize()
    view.requests[1].resolve({ items: [{ user_id: 'retry' }] })
    await retry
    assert.equal(view.state.error.value, '')
    assert.equal(view.state.users.value[0].user_id, 'retry')
  } finally { view.unmount() }
})
