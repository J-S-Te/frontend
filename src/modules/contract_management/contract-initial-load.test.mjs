import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { parse as parseSFC } from '@vue/compiler-sfc'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const script = parseSFC(source).descriptor.scriptSetup.content

// handleSectionSwitch 是首屏与分区切换的唯一协调点：从真实视图脚本里抽出函数体，
// 用计数替身执行，直接数“首屏会发起几次台账加载”。
function loadHandleSectionSwitch() {
  const declaration = parse(script, { sourceType: 'module' }).program.body
    .find((node) => node.type === 'FunctionDeclaration' && node.id.name === 'handleSectionSwitch')
  assert.ok(declaration, '缺少 handleSectionSwitch')
  const body = script.slice(declaration.start, declaration.end)
  return new Function(`let sectionVisited = false;\n${body}\nreturn handleSectionSwitch`)()
}

// 计数替身：reset 对应 resetFilters()，它内部 await loadBusinessData()，因此一次 reset 即一次台账请求。
function counterHarness() {
  const calls = { reset: 0, load: 0 }
  return {
    calls,
    // mount 模拟 onMounted 会话就绪后的首屏加载（视图里是 await loadBusinessData()）。
    mount() { calls.load += 1 },
    reset: async () => { calls.reset += 1; calls.load += 1 },
  }
}

// 回归锁定 L2：进入模块只加载一次。
// 旧实现里 watch(activeSection, …, { immediate: true }) 调 resetFilters() 发起一次台账加载，
// onMounted 再 await loadBusinessData() 一次，首屏 GET /contracts 于是发两次。
test('首屏触发不加载，onMounted 只加载一次，切换分区才再次加载', async () => {
  const handleSectionSwitch = loadHandleSectionSwitch()
  const h = counterHarness()

  // 1) immediate watch 的首屏触发：只做导航副作用，不发起任何加载。
  assert.equal(await handleSectionSwitch({ reset: h.reset }), false)
  assert.deepEqual(h.calls, { reset: 0, load: 0 })

  // 2) onMounted 在会话就绪后加载一次（视图里唯一一次首屏 await loadBusinessData()）。
  h.mount()
  assert.deepEqual(h.calls, { reset: 0, load: 1 })

  // 3) 切换分区：重置筛选并重新加载一次。
  assert.equal(await handleSectionSwitch({ reset: h.reset }), true)
  assert.deepEqual(h.calls, { reset: 1, load: 2 })
})

// 回归锁定：首屏不调用 resetFilters（否则会先清空 URL 恢复的筛选再加载），
// 但 onMounted 仍保留唯一一次台账加载。
test('首屏不清空筛选，视图只有一处 onMounted 首屏加载', () => {
  const mounted = source.match(/onMounted\(async \(\) => \{[\s\S]*?\n\}\)/)
  assert.ok(mounted, '缺少 onMounted')
  assert.equal((mounted[0].match(/await loadBusinessData\(\)/g) || []).length, 1)
  assert.equal((source.match(/onMounted\(/g) || []).length, 1)

  const watchBlock = source.slice(
    source.indexOf('watch(activeSection, () => {'),
    source.indexOf('}, { immediate: true })', source.indexOf('watch(activeSection, () => {')),
  )
  assert.ok(watchBlock.length > 0, '缺少 activeSection watch')
  // watch 回调只做导航副作用并交给 handleSectionSwitch，自己不再直接加载或清空筛选。
  assert.doesNotMatch(watchBlock, /resetFilters\(\)/)
  assert.doesNotMatch(watchBlock, /loadBusinessData\(/)
  assert.match(watchBlock, /void handleSectionSwitch\(\)/)
  // 切换分区仍然重置筛选并加载；查询/刷新、筛选 @change 仍走 reloadLedger。
  assert.match(source, /async function handleSectionSwitch\(\{ reset = resetFilters \} = \{\}\)/)
  assert.match(source, /<input v-model="keyword"[^>]*@change="reloadLedger"/)
  assert.match(source, /<select v-model="statusFilter"[^>]*@change="reloadLedger"/)
  assert.match(source, /@click="loadBusinessData"/)
})

// 回归锁定：URL 驱动的初始分区仍然生效（activeSection 由 route.params.section 推导，
// 与首屏加载去重无关）。
test('URL 初始分区仍决定首屏分区与标题', () => {
  assert.match(source, /const section = typeof route\.params\.section === 'string' \? route\.params\.section : 'dashboard'/)
  assert.match(source, /return sectionMeta\[section\] \? section : 'dashboard'/)
  assert.match(source, /document\.title = `\$\{pageMeta\.value\.title\} · 机构合同管理系统`/)
})
