import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkVueComponent, checkVueDirectory } from './check-vue-components.mjs'

test('合法的脚本与双向绑定模板可通过组件门禁', () => {
  assert.deepEqual(checkVueComponent('<script setup>import {ref} from "vue"; const value=ref("")</script><template><input v-model="value" /></template>', 'Valid.vue'), [])
})

test('模板非法表达式、错误脚本和重复宏声明都不能进入构建', () => {
  for (const source of [
    '<template>{{ value + }}</template>',
    '<script setup>const value = </script><template><p /></template>',
    '<script setup>defineProps({a:String});defineProps({b:String})</script><template><p /></template>',
  ]) assert.ok(checkVueComponent(source, 'Invalid.vue').length > 0)
})

test('目录门禁拒绝空范围，且隐藏备份不参与生产检查', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vue-gate-'))
  try {
    assert.equal((await checkVueDirectory(directory, () => {})).errors, 1)
    await writeFile(join(directory, 'Actual.vue'), '<template><p>真实组件</p></template>')
    await writeFile(join(directory, '.Backup.vue'), '<template>{{ broken + }}</template>')
    assert.deepEqual(await checkVueDirectory(directory, () => {}), { components: 1, errors: 0 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
