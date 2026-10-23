import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// AUD-IP-2026：前端容器内的业务路由（127.0.0.1:8088）承接的是外层网关的同进程转发，
// 它的 $remote_addr 恒为 127.0.0.1。若内层继续用 $remote_addr 覆盖 X-Real-IP，后端与
// 审计只能看到回环地址。内层必须透传外层按可信代理解析后的地址。
const config = readFileSync(fileURLToPath(new URL('./default.conf', import.meta.url)), 'utf8')

test('内层网关透传外层已解析的客户端地址', () => {
  assert.match(config, /map \$http_x_real_ip \$inner_client_ip \{/)
  assert.match(config, /""\s+\$remote_addr;/)
})

test('内层不再用 loopback 覆盖 X-Real-IP', () => {
  assert.doesNotMatch(config, /proxy_set_header X-Real-IP \$remote_addr;/)
  assert.ok(
    (config.match(/proxy_set_header X-Real-IP \$inner_client_ip;/g) || []).length >= 10,
    '所有 upstream location 都必须使用透传变量',
  )
})

test('外层网关负责解析并下传 X-Real-IP', () => {
  const https = readFileSync(fileURLToPath(new URL('./gateway-https.conf.template', import.meta.url)), 'utf8')
  const http = readFileSync(fileURLToPath(new URL('./gateway-http.conf.template', import.meta.url)), 'utf8')
  for (const name of ['gateway-https.conf.template', 'gateway-http.conf.template']) {
    const source = name === 'gateway-https.conf.template' ? https : http
    assert.match(source, /proxy_set_header X-Real-IP \$remote_addr;/, `${name} 必须在公网入口解析客户端地址`)
  }
})
