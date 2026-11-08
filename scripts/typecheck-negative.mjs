import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 负向类型门禁：证明 `npm run typecheck` 那套配置**真的会报错**。
//
// 为什么需要它：只跑正向门禁时，「类型检查一条都没扫到」和「代码真的干净」输出一样
// （都是 0 错误）。这个脚本把故意写错的夹具交给同一套编译选项检查，并要求每个
// [NEG-n] 标记行上恰好出现一条「类型不可赋值 / 无匹配重载」诊断：
//   · 报错条数必须等于标记数（多一条说明夹具本身还坏了别的，少一条说明某条契约被放宽了）；
//   · 诊断只能落在夹具文件里（否则是配置坏了，不是夹具生效）；
//   · 每条诊断必须是可赋值性错误（而不是「找不到模块」这种环境问题冒充通过）。
//
// 用法：node scripts/typecheck-negative.mjs（npm run typecheck:negative）
const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = join(root, 'src/test/typecheck-negative.fixtures.ts')
const project = 'tsconfig.typecheck-negative.json'
const vueTsc = join(root, 'node_modules/vue-tsc/bin/vue-tsc.js')

// 用途：从夹具里找出每个 [NEG-n] 标记对应的「被检查语句」行号（1 起）。
// 参数：source 为夹具全文。
// 返回值：Map<标记, 行号>；标记后第一行非注释、非空行的行号。
function expectedLines(source) {
  const lines = source.split('\n')
  const expected = new Map()
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/\[NEG-(\d+)\]/)
    if (!marker) continue
    let cursor = index + 1
    while (cursor < lines.length && (/^\s*$/.test(lines[cursor]) || /^\s*\/\//.test(lines[cursor]))) cursor += 1
    expected.set(marker[0], cursor + 1)
  }
  return expected
}

// 用途：把 vue-tsc 输出解析为「文件 + 行号 + 诊断文本」。
// 参数：output 为 vue-tsc 的标准输出。
// 返回值：诊断数组；不含缩进的「补充说明」行。
function diagnostics(output) {
  const found = []
  for (const line of output.split('\n')) {
    const match = line.match(/^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/)
    if (match) found.push({ file: match[1], line: Number(match[2]), code: match[4], message: match[5] })
  }
  return found
}

const expected = expectedLines(readFileSync(fixture, 'utf8'))
if (expected.size === 0) {
  console.error('负向夹具里没有任何 [NEG-n] 标记，拒绝在「无断言」的情况下通过。')
  process.exit(1)
}

const result = spawnSync(process.execPath, [vueTsc, '--noEmit', '-p', project], { cwd: root, encoding: 'utf8' })
const output = `${result.stdout || ''}${result.stderr || ''}`
const found = diagnostics(output)
const failures = []

if (result.status === 0) failures.push(`vue-tsc 在 ${project} 上意外通过（退出码 0）：负向夹具必须报错。`)
if (found.length !== expected.size) {
  failures.push(`诊断条数 ${found.length} ≠ 标记数 ${expected.size}：多出来的错误说明夹具/配置有问题，少了说明某条契约被放宽。`)
}

const byLine = new Map(found.map((item) => [item.line, item]))
for (const [marker, line] of expected) {
  const diagnosis = byLine.get(line)
  if (!diagnosis) {
    failures.push(`${marker}：第 ${line} 行没有出现类型错误（该契约没有被类型系统拦住）。`)
    continue
  }
  // 只接受「类型不可赋值 / 无匹配重载」：这才是类型契约生效的证据。
  // 「找不到模块」「语法错误」之类同样会失败，但不能算门禁有效。
  if (!/not assignable|No overload matches/.test(diagnosis.message)) {
    failures.push(`${marker}：第 ${line} 行的错误不是类型契约错误：${diagnosis.message}`)
  }
}

for (const item of found) {
  if (!item.file.endsWith('src/test/typecheck-negative.fixtures.ts')) {
    failures.push(`诊断落在夹具之外（${item.file}:${item.line}）：负向配置坏了，不是夹具生效。`)
  }
}

console.log(JSON.stringify({
  project,
  markers: [...expected.keys()],
  expectedLines: [...expected.values()],
  exitCode: result.status,
  diagnostics: found.map((item) => `${item.file}:${item.line} ${item.code} ${item.message}`),
  ok: failures.length === 0,
}))

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`)
  process.exitCode = 1
}
