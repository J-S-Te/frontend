import assert from 'node:assert/strict'
import test from 'node:test'
import { access } from 'node:fs/promises'

// 用途：读取实际门户目标校验，缺少功能时提供明确失败。
// 参数：无。
// 返回值：生产实现导出；缺少功能时断言失败。
async function availabilityTools() {
  const url = new URL('./moduleAvailability.js', import.meta.url)
  assert.ok(await access(url).then(() => true, () => false), '缺少未编译本地入口的回环保护')
  return import(url)
}

test('未编译的本地系统及其子路径不能回退到当前 SPA', async () => {
  const { portalPublicURL } = await availabilityTools()
  for (const target of ['/project_management', '/project_management/dashboard',
    'https://app.example/project_management/?x=1', '//app.example/project_management']) {
    assert.equal(portalPublicURL(target, ['/project_management'], 'https://app.example'), '')
  }
})

test('独立站点和未知已登记应用保留后端 public_url', async () => {
  const { portalPublicURL } = await availabilityTools()
  for (const target of ['https://project.example/project_management/',
    '/external-system', '/project_management_extra']) {
    assert.equal(portalPublicURL(target, ['/project_management'], 'https://app.example'), target)
  }
})
