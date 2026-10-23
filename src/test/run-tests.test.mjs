import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const packageSource = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const runnerUrl = new URL('./run-tests.mjs', import.meta.url)
// 子进程 CLI 样例独立运行 Node，不在父级 node:test 工作进程内执行。
const childEnv = { ...process.env }
delete childEnv.NODE_TEST_CONTEXT

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'frontend-test-discovery-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  write('package.json', JSON.stringify({ type: 'module', scripts: { test: packageSource.scripts.test } }))
  if (existsSync(runnerUrl)) write('src/test/run-tests.mjs', readFileSync(runnerUrl, 'utf8'))
  for (const [path, content] of Object.entries(files)) write(path, content)
  return root
}

const passing = "import test from 'node:test'; test('fixture passes', () => {})\n"
const failing = "import test from 'node:test'; import assert from 'node:assert/strict'; test('nested sentinel fails', () => assert.fail('DISCOVERY_SENTINEL'))\n"

// 未来新增目录必须通过 Docker 使用的同一 npm 门禁，无需修改通配符列表。
test('npm test discovers a failing test in a newly nested directory', (t) => {
  const root = fixture(t, {
    'src/modules/discovery.test.mjs': passing,
    'src/future/arbitrary/depth/missed.test.mjs': failing,
  })
  const result = spawnSync('npm', ['test', '--', '--test-reporter=tap'], { cwd: root, encoding: 'utf8', env: childEnv })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout + result.stderr, /DISCOVERY_SENTINEL/)
})

test('recursive discovery is sorted and excludes dependency, cache and output directories', (t) => {
  const root = fixture(t, {
    'src/z/deep/z.test.mjs': passing,
    'nginx/a.test.mjs': passing,
    'new area/nested/b.test.mjs': passing,
    'src/a.test.mjs': passing,
    'node_modules/dependency.test.mjs': failing,
    'src/nested/node_modules/dependency.test.mjs': failing,
    '.mimosa/old.test.mjs': failing,
    'src/nested/.mimosa/old.test.mjs': failing,
    '.git/internal.test.mjs': failing,
    'dist/generated.test.mjs': failing,
    'coverage/generated.test.mjs': failing,
    'src/not-a-test.mjs': failing,
  })
  const result = spawnSync(process.execPath, ['src/test/run-tests.mjs', '--list'], { cwd: root, encoding: 'utf8', env: childEnv })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [
    'new area/nested/b.test.mjs', 'nginx/a.test.mjs', 'src/a.test.mjs', 'src/z/deep/z.test.mjs',
  ])
})

test('npm test executes every discovered file including paths containing spaces', (t) => {
  const root = fixture(t, {
    'src/modules/discovery.test.mjs': passing,
    'new area/deeper path/another.test.mjs': passing,
    'nginx/check.test.mjs': passing,
    'node_modules/skip.test.mjs': failing,
    '.mimosa/skip.test.mjs': failing,
  })
  const result = spawnSync('npm', ['test', '--', '--test-reporter=tap'], { cwd: root, encoding: 'utf8', env: childEnv })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /# tests 3\b/)
  assert.match(result.stdout, /# pass 3\b/)
  assert.match(result.stdout, /# fail 0\b/)
})

test('npm test fails closed if discovery finds no tests', (t) => {
  const root = fixture(t, { 'node_modules/skip.test.mjs': passing })
  const result = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8', env: childEnv })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /No \*\.test\.mjs files found/)
})
