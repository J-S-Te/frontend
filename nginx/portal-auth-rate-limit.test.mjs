import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 安全审计 M-10：Portal 匿名登录入口（/customer-portal/auth/、= /customer-portal/activate）
// 必须同时受网关限流保护。本测试只做静态校验（环境中没有 nginx 二进制时无法执行
// `nginx -t`）：确认限流区、键和 location 归属，防止后续改动悄悄移除防护。
const config = readFileSync(fileURLToPath(new URL('./default.conf', import.meta.url)), 'utf8')

const portalAuthLocation = /location \/customer-portal\/auth\/ \{([\s\S]*?)\n {4}\}/
const portalActivateLocation = /location = \/customer-portal\/activate \{([\s\S]*?)\n {4}\}/

test('门户登录限流区使用外层已解析的客户端地址', () => {
  const zones = config.match(/limit_req_zone[^\n]*/g) || []
  assert.equal(zones.length, 1, '只应有一个 limit_req_zone，避免重复定义同名区')
  assert.match(
    zones[0],
    /limit_req_zone \$inner_client_ip zone=portal_auth:10m rate=20r\/m;/,
    '限流键必须是 $inner_client_ip（$remote_addr 在内层恒为回环，会把全站压进一个桶）',
  )
  assert.doesNotMatch(config, /limit_req_zone\s+\$binary_remote_addr/, '不得使用 $binary_remote_addr 作为门户限流键')
})

test('门户登录与激活 location 都启用了限流并返回 429', () => {
  for (const [name, pattern] of [
    ['/customer-portal/auth/', portalAuthLocation],
    ['/customer-portal/activate', portalActivateLocation],
  ]) {
    const match = config.match(pattern)
    assert.ok(match, `${name} location 缺失`)
    assert.match(match[1], /limit_req zone=portal_auth burst=10 nodelay;/, `${name} 未启用 portal_auth 限流`)
    assert.match(match[1], /limit_req_status 429;/, `${name} 未显式返回 429`)
    assert.match(match[1], /proxy_set_header X-Real-IP \$inner_client_ip;/, `${name} 必须继续透传真实客户端地址`)
  }
})

test('外层网关模板不直接暴露门户登录路径，限流由内层统一执行', () => {
  for (const name of ['gateway-http.conf.template', 'gateway-https.conf.template']) {
    const source = readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')
    // 外层只有通用 location / 与文件网关等专用 location，门户路径全部转给内层 127.0.0.1:8088，
    // 因此在 default.conf 里统一限流即可覆盖 HTTP/HTTPS 两种入站方式。
    assert.doesNotMatch(source, /location[^\n]*\/customer-portal\/auth\//, `${name} 不应单独定义门户登录路径`)
    assert.doesNotMatch(source, /location[^\n]*\/customer-portal\/activate/, `${name} 不应单独定义门户激活路径`)
    assert.match(source, /proxy_pass http:\/\/127\.0\.0\.1:8088;/, `${name} 必须把业务请求转发给内层服务`)
  }
})
