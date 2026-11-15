import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// 多浏览器显示回归：这些点都来自真实 Chromium / Firefox / WebKit 渲染差异，
// 改回旧写法不会让单测失败，因此在这里锁住。
const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('WebKit 原生 select 的 option 文本不得撑宽表单栅格', async () => {
  const css = await read('../modules/shared/styles/global-ux.css')
  assert.match(css, /option 文本会被计入/)
  assert.match(css, /select \{ overflow-x: clip; \}/)
})

test('窄屏 IAM 操作按钮按内容宽度换行，不再等分挤压长标签', async () => {
  const css = await read('../modules/platform/iam/styles/iam-settings.css')
  assert.match(css, /\.iam-panel-actions \.console-button \{ flex: 0 0 auto; max-width: 100%; \}/)
})

test('窄屏控制台面包屑为 WebKit 保留完整分区名', async () => {
  const css = await read('../modules/platform/styles/platform-console.css')
  assert.match(css, /\.console-page--platform \.console-crumb strong \{[\s\S]{0,120}?font-size: 12px;/)
})

test('门户声明支持 Chrome、Edge、Firefox 与 Safari', async () => {
  const view = await read('../modules/platform/views/SubsystemPortalView.vue')
  assert.match(view, /Chrome \/ Edge \/ Firefox \/ Safari 最新版/)
})
