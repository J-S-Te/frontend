import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// AUD-2026-023（补）：HTTPS 模板 80 端口跳转服务器上的 server 级 return 在 nginx 的
// server 重写阶段执行，早于 location 选择，因此 location /file-gateway/ 内的脱敏
// access_log 对这条 308 不生效——文件网关票据 query 会经默认格式的 $request 落盘。
// 这里锁定"跳转服务器使用按路径脱敏的 server 级日志格式"这一修复。
const template = readFileSync(fileURLToPath(new URL('./gateway-https.conf.template', import.meta.url)), 'utf8')

test('跳转服务器按路径脱敏文件网关票据 query', () => {
  assert.match(template, /map \$uri \$redirect_request_target \{/)
  assert.match(template, /~\^\/file-gateway\/ \$uri;/)
  assert.match(template, /log_format redirect_no_ticket/)
  assert.match(template, /access_log \/var\/log\/nginx\/access\.log redirect_no_ticket;/)
})

test('脱敏只影响日志，跳转仍携带原始请求 URI', () => {
  assert.match(template, /return 308 https:\/\/\$host\$request_uri;/)
  assert.match(template, /default\s+\$request_uri;/)
})

test('脱敏日志指令位于跳转服务器的 server 级 return 之前', () => {
  const serverStart = template.indexOf('listen 80 default_server;')
  assert.ok(serverStart > 0, '未找到 80 端口跳转服务器')
  const serverBlock = template.slice(serverStart)
  const accessLogIndex = serverBlock.indexOf('access_log /var/log/nginx/access.log redirect_no_ticket;')
  const serverReturnIndex = serverBlock.indexOf('\n    return 308 https://$host$request_uri;')
  assert.ok(accessLogIndex > 0, '跳转服务器缺少 server 级脱敏 access_log')
  assert.ok(serverReturnIndex > accessLogIndex, 'access_log 必须在 server 级 return 之前声明')
})

test('map 与 log_format 名称在全部模板中唯一，避免重复指令', () => {
  const directory = fileURLToPath(new URL('.', import.meta.url))
  const files = readdirSync(directory).filter((name) => name.endsWith('.conf') || name.endsWith('.template'))
  let mapHits = 0
  let formatHits = 0
  for (const name of files) {
    const content = readFileSync(`${directory}${name}`, 'utf8')
    mapHits += (content.match(/map \$uri \$redirect_request_target/g) || []).length
    formatHits += (content.match(/log_format redirect_no_ticket/g) || []).length
  }
  assert.equal(mapHits, 1, 'redirect_request_target 只能定义一次')
  assert.equal(formatHits, 1, 'redirect_no_ticket 只能定义一次')
})
