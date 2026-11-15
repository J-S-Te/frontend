import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// 首屏加载性能的静态回归：这些依赖一旦被改回静态 import，就会重新进入登录页/
// 门户/所有子系统的首屏分块，浏览器和构建产物体积不会给出失败信号，因此在这里锁住。
const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('行政区划与拼音库只在城市选择器出现时按需加载', async () => {
  const cities = await read('../modules/reimbursement/cities.js')
  assert.doesNotMatch(cities, /^import .*@vant\/area-data/m, 'area-data 不得静态进入报销首屏')
  assert.doesNotMatch(cities, /^import .*pinyin-pro/m, 'pinyin 不得静态进入报销首屏')
  assert.match(cities, /import\('@vant\/area-data'\)/)
  assert.match(cities, /import\('pinyin-pro'\)/)

  const vite = await read('../../vite.config.js')
  assert.match(vite, /@vant\/area-data[\s\S]{0,80}return 'area-data'/, '行政区划数据应独立成块')
})

test('平台控制台设置面板按需加载，审计页不携带设置模块', async () => {
  const view = await read('../modules/platform/views/PlatformConsoleView.vue')
  assert.match(view, /defineAsyncComponent/)
  for (const name of [
    'IamSettingsModule', 'PersonnelChangeCenter', 'PublicAccessSettingsModule', 'NotificationCenterModule',
    'ConfigurationCenterModule', 'FileTaskOperationsModule', 'CommercialLicenseView', 'LoginSecurityModule',
    'DictionaryManagementModule', 'SubsystemOnboardingModule', 'SubsystemAccessWizard',
  ]) {
    assert.match(view, new RegExp(`const ${name} = asyncPanel\\(`), `${name} 必须按需加载`)
  }
})

test('门户在鼠标悬停或键盘聚焦时预取目标子系统视图', async () => {
  const portal = await read('../modules/platform/views/SubsystemPortalView.vue')
  assert.match(portal, /function prefetchSubsystemView\(/)
  assert.match(portal, /@pointerenter="prefetchSubsystemView\(subsystem, \$event\)"/)
  assert.match(portal, /@focus="prefetchSubsystemView\(subsystem, \$event\)"/)
  assert.match(portal, /router\.resolve\(routeLocation\)/)
  // 门户首屏完成后对当前页前几张卡片做空闲预取，但必须尊重 2G/省流量模式。
  assert.match(portal, /function scheduleIdlePrefetch\(/)
  assert.match(portal, /connection\?\.saveData/)
  assert.match(portal, /effectiveType/)
  assert.match(portal, /\}, 1800\)/)
  assert.match(portal, /resolve\(\).*\.components\.default|components\?\.default/, '预取应复用路由的懒加载函数')
})
