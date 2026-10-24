import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
// 扫描源码树，排除依赖、本地快照和生成产物。
const excludedDirectories = new Set(['node_modules', '.git', '.mimosa', 'dist', 'coverage'])
const files = []

function discover(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) discover(path)
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(relative(root, path))
  }
}

discover(root)
files.sort()

if (process.argv[2] === '--list') {
  console.log(JSON.stringify(files, null, 2))
} else if (files.length === 0) {
  console.error('No *.test.mjs files found; refusing to pass an empty test gate.')
  process.exitCode = 1
} else {
  console.log(`Discovered ${files.length} test files.`)
  // 显式 argv 避免 shell 通配符差异，并保留包含空格的路径。
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
}
