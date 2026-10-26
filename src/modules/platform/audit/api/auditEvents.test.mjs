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

// 统一审计方案 §4.1：详情必须能展示稳定身份与来源，缺字段时如实标注而不是留空横线。
test('mapAuditEvent 暴露稳定身份、主体类型与登录地址来源', () => {
  const mapped = mapAuditEvent({
    event_id: 'evt-1',
    operator_display_name: '张三',
    actor_id: 'user-1',
    actor_type: 'SYSTEM',
    reason_code: 'OK',
    business_id: 'biz-1',
    received_at: '2026-10-25T02:03:04Z',
    login_ip: '198.51.100.7',
    login_ip_source: 'TRUSTED_PROXY',
  })
  assert.equal(mapped.actorId, 'user-1')
  assert.equal(mapped.actorType, 'SYSTEM')
  assert.equal(mapped.actorTypeLabel, '系统自动执行')
  assert.equal(mapped.reasonCode, 'OK')
  assert.equal(mapped.businessId, 'biz-1')
  assert.equal(mapped.receivedAt, '2026-10-25T02:03:04Z')
  assert.equal(mapped.loginIpSourceLabel, '可信代理解析')
  assert.equal(mapped.operator, '张三')
})

test('历史事件缺登录地址来源时显示“历史记录无此字段”', () => {
  const mapped = mapAuditEvent({ event_id: 'evt-2' })
  assert.equal(mapped.loginIpSource, '')
  assert.equal(mapped.loginIpSourceLabel, '历史记录无此字段')
  assert.equal(mapped.actorTypeLabel, '未标注主体类型')
})

// 统一审计方案 §4.1：未知 action 必须保留原编码，界面不做中文猜测。
test('未知 action 保留原编码', () => {
  const mapped = mapAuditEvent({ event_id: 'evt-3', action: 'SETTLEMENT_UNKNOWN_FUTURE_ACTION' })
  assert.equal(mapped.action, 'SETTLEMENT_UNKNOWN_FUTURE_ACTION')
  assert.equal(mapped.type, 'SETTLEMENT_UNKNOWN_FUTURE_ACTION')
})

// 已知 action 同样不改变编码：展示层只做标签映射，不重写事件身份。
test('已知 action 不被改写', () => {
  const mapped = mapAuditEvent({ event_id: 'evt-4', action: 'SETTLEMENT_INVOICE_ISSUED', action_type: 'SETTLEMENT' })
  assert.equal(mapped.action, 'SETTLEMENT_INVOICE_ISSUED')
  assert.equal(mapped.type, 'SETTLEMENT')
})

// 详情五块分区依赖对象 ID 映射：缺失时不能把空串当成已采集。
test('对象 ID 与对象类型分别映射', () => {
  const mapped = mapAuditEvent({ event_id: 'evt-5', resource_type: 'contract', resource_id: 'CON-1' })
  assert.equal(mapped.resource, 'contract')
  assert.equal(mapped.resourceId, 'CON-1')
  assert.equal(mapAuditEvent({ event_id: 'evt-6' }).resourceId, '')
})
