import assert from 'node:assert/strict'
import test from 'node:test'

import { ipSourceLabel, mapAuditEvent } from './auditEvents.js'

// 统一审计来源协议：列表默认展示"操作 IP"，详情分别展示登录 IP、操作 IP、投递地址和来源标记。
// 三者含义不同，不能互相顶替；缺失时必须显式标为"未采集／来源未知"。
test('审计事件映射区分登录地址、操作地址与投递地址', () => {
  const mapped = mapAuditEvent({
    event_id: 'event-1',
    client_ip: '10.8.0.5',
    login_ip: '203.0.113.10',
    ingest_peer_ip: '172.20.0.9',
    ip_source: 'TRUSTED_PROXY',
  })

  assert.equal(mapped.ip, '10.8.0.5')
  assert.equal(mapped.loginIp, '203.0.113.10')
  assert.equal(mapped.ingestPeerIp, '172.20.0.9')
  assert.equal(mapped.ipSource, 'TRUSTED_PROXY')
  assert.equal(mapped.ipSourceLabel, '可信代理解析')
})

test('缺少地址时显示未采集而不是猜测', () => {
  const mapped = mapAuditEvent({ event_id: 'event-2', ip_source: 'UNKNOWN' })
  assert.equal(mapped.ip, '')
  assert.equal(mapped.loginIp, '')
  assert.equal(mapped.ingestPeerIp, '')
  assert.equal(mapped.ipSourceLabel, '未采集／来源未知')
})

test('历史记录标注旧口径', () => {
  assert.equal(ipSourceLabel('LEGACY_RECORD'), '历史记录（旧口径）')
  assert.equal(ipSourceLabel('LEGACY_PROTOCOL'), '旧协议上报')
  assert.equal(ipSourceLabel(''), '未采集／来源未知')
})

// 批次 3：摄取健康度接口必须存在且只读（GET），供审计页健康卡片使用。
test('审计摄取健康度接口可按需导出调用', async () => {
  const module = await import('./auditEvents.js')
  assert.equal(typeof module.getAuditIngestionHealth, 'function')
})
