import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 首屏性能回归守卫：Vite 产物（/assets/*，文件名带内容哈希）合计约 1.55 MiB。
// 线上曾实测到两个问题——整条链路没有压缩（带 Accept-Encoding: gzip 仍返原大小），
// 且 `location /` 的 no-store 覆盖了带哈希的静态资源，导致每次导航、每个子系统
// 都要重下整包。本测试只做静态校验（多数环境没有 nginx 二进制，无法跑 `nginx -t`），
// 确认压缩开关、静态资源强缓存与 HTML 不缓存的边界没有被后续改动悄悄改回去。
const config = readFileSync(fileURLToPath(new URL('./default.conf', import.meta.url)), 'utf8')

const httpContext = config.slice(0, config.indexOf('server {'))
const assetsLocation = /location \^~ \/assets\/ \{([\s\S]*?)\n {4}\}/
// 断言只针对生效指令，注释里可以自由讨论 @spa/no-store 这些被排除的行为。
const activeDirectives = (block) =>
  block
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .join('\n')

test('http 上下文开启 gzip 并覆盖代理链路', () => {
  for (const directive of [
    /^gzip on;$/m,
    /^gzip_vary on;$/m,
    /^gzip_comp_level 5;$/m,
    /^gzip_min_length 1024;$/m,
    // 内层 127.0.0.1:8088 与外层网关都是反代链路，gzip_proxied 缺省 off 会让压缩整体失效。
    /^gzip_proxied any;$/m,
  ]) {
    assert.match(httpContext, directive, `gzip 指令必须在 http 上下文声明：${directive}`)
  }
})

test('gzip_types 覆盖文本类静态资源，且不重复压缩已压缩类型', () => {
  const line = httpContext.match(/^gzip_types[^\n]*$/m)
  assert.ok(line, '缺少 gzip_types')
  for (const type of [
    'text/css',
    'application/javascript',
    'text/javascript',
    'application/json',
    'application/xml',
    'image/svg+xml',
    'application/wasm',
  ]) {
    assert.ok(line[0].replace(/;$/, '').split(/\s+/).includes(type), `gzip_types 必须包含 ${type}`)
  }
  // 图片/字体本身已压缩，再压只是白烧 CPU（text/html 由 nginx 内建，无需列出）。
  assert.doesNotMatch(line[0], /image\/(png|jpeg|webp|avif|gif)|font\/|woff2?|video\//)
})

test('/assets/ 静态资源长期强缓存，且优先级不被 location / 或正则 location 抢占', () => {
  const block = config.match(assetsLocation)
  assert.ok(block, '缺少 location ^~ /assets/')
  // `^~` 而非普通前缀：命中后不再尝试正则 location（portal-apps.d 里由脚本生成的
  // 正则 location 可能包含 /assets/ 子串），保证哈希资源永远走强缓存分支。
  assert.match(block[1], /expires 1y;/)
  // 刻意不带 always：否则缺失资源的 404 也会被 "1 年 immutable" 钉进浏览器。
  assert.match(block[1], /add_header Cache-Control "public, max-age=31536000, immutable";\n/)
  assert.doesNotMatch(block[1], /Cache-Control "public[^"]*" always;/, '静态资源的 Cache-Control 不得使用 always（会把 404 也缓存一年）')
  assert.match(block[1], /add_header X-Content-Type-Options "nosniff" always;/)
  // 子 location 的 add_header 是覆盖而非合并，所以 no-store 绝不能出现在这里。
  assert.doesNotMatch(activeDirectives(block[1]), /no-store/)
  assert.ok(
    config.indexOf('location ^~ /assets/') < config.indexOf('\n    location / {'),
    'location ^~ /assets/ 必须写在 location / 之前，便于阅读前缀优先级',
  )
})

test('缺失的静态资源返回 404，不回落 SPA 的 index.html', () => {
  const block = config.match(assetsLocation)
  assert.ok(block, '缺少 location ^~ /assets/')
  assert.match(block[1], /try_files \$uri =404;/)
  assert.doesNotMatch(activeDirectives(block[1]), /@spa/, '静态资源缺失时不得回落 SPA（会以 200 HTML 污染缓存并触发 MIME 报错）')
})

test('HTML 入口仍然 no-store，缓存边界只对 /assets/ 放宽', () => {
  // HTML 携带登录态相关导航状态，必须继续 no-store；放宽只针对带哈希的静态资源。
  assert.match(config, /location = \/index\.html \{[\s\S]*?Cache-Control "no-store" always;/)
  assert.match(config, /location \/ \{[\s\S]*?Cache-Control "no-store" always;/)
  const noStoreLocations = config.match(/location[^\n{]*\{[^}]*no-store/g) || []
  assert.ok(noStoreLocations.length >= 6, 'SPA/子系统 HTML location 都必须保留 no-store')
  for (const snippet of noStoreLocations) {
    assert.doesNotMatch(snippet, /\/assets\//, 'no-store 不得落在 /assets/ 静态资源上')
  }
})
