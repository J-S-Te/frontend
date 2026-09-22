import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const platformRoot = new URL('./platform/', import.meta.url)
const readPlatformFile = (path) => readFile(new URL(path, platformRoot), 'utf8')

test('基础平台入口页遵循克制且性能受控的 UniLab 视觉规范', async () => {
  const [login, passwordChange, mainCSS, portal, portalCSS] = await Promise.all([
    readPlatformFile('auth/views/LoginView.vue'),
    readPlatformFile('auth/views/ForcePasswordChangeView.vue'),
    readPlatformFile('shared/styles/main.css'),
    readPlatformFile('views/SubsystemPortalView.vue'),
    readPlatformFile('styles/subsystem-portal.css'),
  ])

  assert.doesNotMatch(`${login}\n${passwordChange}`, /brand-(?:grid|glow)/)
  assert.doesNotMatch(mainCSS, /\.brand-(?:grid|glow)|\.login-button[^}]*linear-gradient/s)
  assert.match(login, />无法登录？<\/button>/)
  assert.match(login, /记住账号（不保存密码）/)
  assert.match(login, /大写锁定已开启/)
  assert.match(login, /统一身份认证服务/)
  assert.doesNotMatch(login, /安全服务运行中|WELCOME BACK|登 录/)
  assert.match(mainCSS, /width:\s*clamp\(520px, 35vw, 680px\)/)
  assert.match(mainCSS, /\.input-wrap input:-webkit-autofill/)
  assert.match(portal, /const particleCount = Math\.max\(16, Math\.min\(48,/)
  assert.match(portal, /document\.visibilityState === 'visible'/)
  assert.match(portal, /prefers-reduced-motion: reduce/)
  assert.match(portal, /requestAnimationFrame\(drawParticleFrame\)/)
  assert.match(portal, /function handleCardPointerMove\(event\)/)
  assert.match(portal, /basic-platform\.portal-theme/)
  assert.match(portal, /prefers-color-scheme: dark/)
  assert.match(portalCSS, /\.subsystem-portal\[data-theme='light'\]/)
  assert.match(portalCSS, /--portal-bg:\s*#050914/)
  assert.match(portalCSS, /height:\s*100dvh/)
  assert.match(portalCSS, /--portal-grid-max-height/)
  assert.match(portal, /visibleSubsystems/)
  assert.match(portal, /portalTotalPages > 1/)
  assert.doesNotMatch(portalCSS, /backdrop-filter/)
})

test('控制台与 IAM 只引用全局设计变量，不再复制基础色板', async () => {
  const [mainCSS, consoleCSS, iamCSS] = await Promise.all([
    readPlatformFile('shared/styles/main.css'),
    readPlatformFile('styles/console.css'),
    readPlatformFile('iam/styles/iam-settings.css'),
  ])

  assert.match(mainCSS, /--primary:\s*#2563eb/)
  assert.match(mainCSS, /--radius-panel:\s*14px/)
  assert.match(mainCSS, /--shadow-modal:/)
  assert.match(consoleCSS, /--p:\s*var\(--primary\)/)
  assert.match(iamCSS, /--ink-1:\s*var\(--text\)/)
  assert.doesNotMatch(consoleCSS, /transition:\s*all/)
  assert.equal((consoleCSS.match(/^\.console-modal-backdrop\s*\{/gm) || []).length, 1)
})
