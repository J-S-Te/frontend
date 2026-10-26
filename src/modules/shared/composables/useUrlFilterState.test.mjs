import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, reactive, ref } from 'vue'
import { useUrlFilterState } from './useUrlFilterState.js'

test('restores filters from URL and writes changes back', async () => {
  const route = reactive({ query: { keyword: '合同', status: '草稿' } })
  const router = { last: null, replace(value) { this.last = value; return Promise.resolve() } }
  const keyword = ref('')
  const status = ref('')
  const restores = []
  useUrlFilterState({
    route, router,
    fields: { keyword, status },
    onRestore: () => restores.push([keyword.value, status.value]),
  })
  await nextTick()
  assert.equal(keyword.value, '合同')
  assert.equal(status.value, '草稿')
  assert.equal(restores.length, 0)

  route.query = { keyword: '项目', status: '已生效', other: 'x' }
  await nextTick()
  assert.equal(keyword.value, '项目')
  assert.deepEqual(restores.at(-1), ['项目', '已生效'])

  keyword.value = ''
  await nextTick()
  assert.deepEqual(router.last.query, { status: '已生效', other: 'x' })
})
