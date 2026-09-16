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

test('角色目录来自服务端接口并按 code 归一化，缺名回退为角色码', () => {
  // 字段级权限的「角色」下拉不能用前端硬编码的角色列表：后端按 role_code 精确比对，
  // 目录外的角色码不会报错却永远不会命中主体，唯一事实来源只能是服务端角色目录。
  assert.match(source, /export async function listApplicationRoles\(\)/)
  assert.match(source, /const data = await request\('\/role-catalog'\)/)
  assert.match(source, /\.map\(\(role\) => \(\{ code: String\(role\?\.code \|\| ''\)\.trim\(\), name: String\(role\?\.name \|\| ''\)\.trim\(\) \|\| String\(role\?\.code \|\| ''\)\.trim\(\) \}\)\)/)
  assert.match(source, /\.filter\(\(role\) => role\.code\)/)
  // 端点必须落在项目后端前缀下，开发代理与生产 Nginx 才会转发到 project-api。
  assert.match(source, /API_BASE_URL = \(runtimeEnv\.VITE_PROJECT_API_BASE_URL \|\| `\$\{PUBLIC_PATH_PREFIX\}\/api\/v1`\)/)
})

test('规则编辑器从服务端读取自动化事件与 SLA 状态白名单', () => {
  assert.match(source, /export async function listRuleConfigurationCatalog\(\)/)
  assert.match(source, /const data = await request\('\/rule-configuration-catalog'\)/)
  assert.match(source, /automation_triggers: normalize\(data\?\.automation_triggers\)/)
  assert.match(source, /sla_statuses: normalize\(data\?\.sla_statuses\)/)
  assert.match(source, /\.filter\(\(item\) => item\.value\)/)
})

test('项目会话失效时只启动一次 OIDC 登录，Claims 错误不会循环跳转', () => {
  assert.match(source, /if \(response\.status === 401\)[\s\S]*startProjectLogin\(\)/)
  assert.match(source, /if \(shouldStartSubsystemLogin\(error\)\) startProjectLogin\(\)/)
  assert.match(source, /if \(loginRedirectStarted\) return/)
  assert.match(source, /window\.location\.replace\(`\$\{PUBLIC_PATH_PREFIX\}\/auth\/login\$\{prompt\}`\)/)
})

test('平台浏览器切换用户时清理项目系统本地会话并强制重新经过 Broker', () => {
  assert.match(source, /await clearProjectLocalSession\(\); startProjectLogin\(\{ force: true \}\)/)
  assert.match(source, /const prompt = force \? '\?prompt=login' : ''/)
  assert.match(source, /\/auth\/local-logout/)
})

test('项目路由只建立 OIDC 会话，权限与 Data Scope 由项目 API 执行', () => {
  assert.match(routerSource, /path: '\/project_management\/:section\?'/)
  assert.match(routerSource, /component: ProjectManagementView/)
  assert.match(routerSource, /requiresProjectSession: true/)
  assert.match(routerSource, /await ensureProjectSession\(\)/)
  assert.doesNotMatch(routerSource, /session\.permissions[\s\S]*includes\('project\.read'\)/)
})

test('Nginx 单独转发项目系统的就绪检查，避免被 SPA 兜底成假绿', () => {
  // /readyz 不在 /api/ 前缀下：没有精确匹配时会被 try_files 兜底返回 200 index.html，
  // 于是"库结构落后于代码"的部署在门禁上看起来是就绪的。
  assert.match(nginxSource, /location = \/project_management\/readyz \{\s*proxy_pass http:\/\/\$project_backend\/readyz;/)
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
  // 启停按配置类型定位到对应真实配置表，因此 PATCH 必须携带 kind。
  assert.match(source, /request\(`\/rules\/\$\{encodeURIComponent\(id\)\}\?kind=\$\{encodeURIComponent\(kind\)\}`, \{ method: 'PATCH'/)
  // 整行编辑走 PUT，可更新该配置类型专属字段。
  assert.match(source, /request\(`\/rules\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'PUT'/)
})

test('项目交付闭环调用真实后端接口而非本地模拟', () => {
  // /check-in 已删除：手工填写经纬度没有证明力，现场记录自身即进入"实施中"。
  // /field-complete 由项目级改为按服务项推进。
  for (const path of [
    '/team-assignment', '/execution-assignment',
    '/implementation-plan', '/preparation', '/field-records', '/deviations', '/review',
    '/field-complete', '/delivery-events', '/capabilities',
  ]) assert.match(source, new RegExp(path.replaceAll('/', '\\/')))
  assert.doesNotMatch(source, /\/check-in/)
  assert.match(source, /service-items\/\$\{encodeURIComponent\(itemID\)\}\/field-complete/)
})

test('项目列表将 keyword 兼容转换为后端实际读取的 q 参数', () => {
  assert.match(source, /if \(query\.q === undefined && query\.keyword !== undefined\) query\.q = query\.keyword/)
  assert.match(source, /delete query\.keyword/)
  assert.match(source, /new URLSearchParams\(Object\.entries\(query\)/)
})

test('已审批合同通过项目后端同源接口读取', () => {
  assert.match(source, /export async function listApprovedContracts\(params = \{\}\)/)
  assert.match(source, /request\(`\/approved-contracts\$\{search \? `\?\$\{search\}` : ''\}`\)/)
  assert.match(source, /return Array\.isArray\(data\) \? data : \[\]/)
  assert.doesNotMatch(source, /contract_management\/api\/v1\/approved-contracts/)
})

test('资质能力更新、CSV 导入导出使用后端接口，上传不携带 JSON 内容类型', () => {
  assert.match(source, /options\.body && !\(options\.body instanceof FormData\)/)
  assert.match(source, /request\('\/capabilities', \{ method: 'PUT', body: JSON\.stringify\(payload\) \}\)/)
  assert.match(source, /formData\.append\('file', file\)/)
  assert.match(source, /request\('\/capabilities\/import', \{ method: 'POST', body: formData \}\)/)
  assert.match(source, /fetch\(`\$\{API_BASE_URL\}\/capabilities\/export/)
  assert.match(source, /filename\*?=\(?:UTF-8''|"\)\?\(\[\^";\]\+\)/i)
  assert.match(source, /return \{ blob: await response\.blob\(\), filename \}/)
})

test('人员姓名批量解析走独立端点，并对 user_id 去重后编码', () => {
  // 负责人目录只支持单个 user_id 查询，因此由服务端聚合成一次批量请求。
  assert.match(source, /export async function resolvePersonnelNames\(ids = \[\]\)/)
  assert.match(source, /request\(`\/personnel\/names\?user_ids=\$\{encodeURIComponent\(unique\.join\(','\)\)\}`\)/)
  assert.match(source, /new Set\(\(Array\.isArray\(ids\) \? ids : \[\]\)/)
  // 没有可解析的 ID 时不发请求。
  assert.match(source, /if \(!unique\.length\) return \{\}/)
})

test('人员目录按重复 role_code 参数查询，数组参数不会被压成逗号串', () => {
  // 基础平台目录只用于新建人员资质档案等身份选择；数组参数仍必须按平台契约发送。
  assert.match(source, /export async function listPersonnel\(params = \{\}\)/)
  assert.match(source, /for \(const item of Array\.isArray\(value\) \? value : \[value\]\)/)
  assert.match(source, /search\.append\(key, item\)/)
  assert.match(source, /request\(`\/personnel\$\{query \? `\?\$\{query\}` : ''\}`\)/)
})

test('任务分配人员只查询项目人员资质库', () => {
  assert.match(source, /export async function listQualifiedPersonnel\(params = \{\}\)/)
  assert.match(source, /request\(`\/qualified-personnel\$\{query \? `\?\$\{query\}` : ''\}`\)/)
  assert.match(source, /return data && Array\.isArray\(data\.items\) \? data : \{ items: \[\], total: 0 \}/)
})

test('人员身份复核调用独立端点', () => {
  assert.match(source, /export function syncPersonnelIdentities\(\)/)
  assert.match(source, /request\('\/capabilities\/sync-identities', \{ method: 'POST' \}\)/)
})

test('列表接口统一解包分页 envelope，未分页时拿到完整集合', () => {
  // 后端列表接口统一返回 {items,total,page,page_size}；page_size 未指定时 items 即全量。
  assert.match(source, /function unwrapPage\(data\)/)
  assert.match(source, /if \(Array\.isArray\(data\)\) return \{ items: data, total: data\.length \}/)
  assert.match(source, /if \(data && Array\.isArray\(data\.items\)\)/)
  // 三个列表都走解包：服务项与设备是下拉数据源，必须仍是完整集合。
  assert.equal((source.match(/return unwrapPage\(data\)\.items/g) || []).length, 3)
  assert.match(source, /export async function listProjectsPage\(params = \{\}\)/)
  assert.match(source, /return unwrapPage\(await request\(`\/projects\$\{search \? `\?\$\{search\}` : ''\}`\)\)/)
})

test('前端 API 不再暴露已下线的站点档案维护接口', () => {
  assert.doesNotMatch(source, /export async function listSites/)
  assert.doesNotMatch(source, /export function upsertSite/)
  assert.doesNotMatch(source, /export function deleteSite/)
  assert.doesNotMatch(source, /request\(['"`]\/sites/)
})
