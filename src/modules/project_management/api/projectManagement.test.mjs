import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./projectManagement.js', import.meta.url), 'utf8')
const routerSource = await readFile(new URL('../../../router/index.js', import.meta.url), 'utf8')
const viteSource = await readFile(new URL('../../../../vite.config.js', import.meta.url), 'utf8')
const nginxSource = await readFile(new URL('../../../../nginx/default.conf', import.meta.url), 'utf8')

test('项目管理客户端使用独立同源 API 和 Cookie 会话', () => {
  assert.match(source, /VITE_PROJECT_API_BASE_URL/)
  assert.match(source, /credentials: 'include'/)
  assert.match(source, /request\('\/auth\/me'\)/)
})

test('任意项目 API 的 401 只启动一次 OIDC 登录', () => {
  assert.match(source, /if \(response\.status === 401\)[\s\S]*startProjectLogin\(\)/)
  assert.match(source, /if \(loginRedirectStarted\) return/)
  assert.match(source, /window\.location\.replace\(`\$\{PUBLIC_PATH_PREFIX\}\/auth\/login`\)/)
})

test('平台浏览器切换用户时清理项目系统本地会话', () => {
  assert.match(source, /await clearProjectLocalSession\(\); startProjectLogin\(\)/)
  assert.match(source, /\/auth\/local-logout/)
})

test('项目路由在渲染页面前建立项目 OIDC 会话并校验读取权限', () => {
  assert.match(routerSource, /path: '\/project_management\/:section\?'/)
  assert.match(routerSource, /component: ProjectManagementView/)
  assert.match(routerSource, /requiresProjectSession: true/)
  assert.match(routerSource, /await ensureProjectSession\(\)/)
  assert.match(routerSource, /includes\('project\.read'\)/)
})

test('开发服务器和生产 Nginx 只把项目后端路径转发给 project-api', () => {
  assert.match(viteSource, /DEFAULT_PROJECT_API_PROXY_TARGET = 'http:\/\/127\.0\.0\.1:8082'/)
  assert.match(viteSource, /for \(const path of PROJECT_BACKEND_PATHS\)/)
  assert.match(viteSource, /replace\(\/\^\\\/project_management\//)
  assert.match(nginxSource, /set \$project_backend project-api:8082;/)
  assert.match(nginxSource, /location \/project_management\/api\//)
  assert.match(nginxSource, /location = \/project_management\/logged-out/)
  assert.match(nginxSource, /location \/project_management\/ \{[\s\S]*try_files \$uri \$uri\/ @spa;/)
})

test('服务项确认与规则切换使用后端写接口', () => {
  assert.match(source, /request\('\/service-items\/confirm', \{ method: 'POST'/)
  assert.match(source, /request\(`\/rules\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'PATCH'/)
})

test('项目交付闭环调用真实后端接口而非本地模拟', () => {
  for (const path of [
    '/contracts/activate', '/decomposition-adjustments', '/team-assignment', '/execution-assignment',
    '/implementation-plan', '/preparation', '/check-in', '/field-records', '/deviations', '/review',
    '/field-complete', '/delivery-events', '/capabilities',
  ]) assert.match(source, new RegExp(path.replaceAll('/', '\\/')))
})
