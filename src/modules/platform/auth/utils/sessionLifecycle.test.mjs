import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./sessionLifecycle.js', import.meta.url), 'utf8')
const authSource = await readFile(new URL('../api/auth.js', import.meta.url), 'utf8')

test('real browser activity immediately reaches the server and renews only the browser session', () => {
  assert.match(source, /recordSessionActivity, refreshCurrentSession/)
  assert.match(source, /lastServerTouchAt = 0/)
  assert.match(source, /Math\.floor\(timeoutSeconds \* 1000 \/ 3\)/)
  assert.match(source, /SESSION_REFRESH_INTERVAL_MS = 10 \* 60 \* 1000/)
  assert.match(source, /touchedAt - lastSessionRefreshAt >= SESSION_REFRESH_INTERVAL_MS/)
  assert.match(source, /await refreshCurrentSession\(\)/)
  assert.match(authSource, /export async function refreshCurrentSession\(\)/)
  assert.match(authSource, /'\/auth\/token\/refresh'/)
})

test('background authorization refresh is not used as a session activity signal', () => {
  assert.match(source, /ACTIVITY_EVENTS = \['pointerdown', 'keydown', 'scroll', 'touchstart'\]/)
  assert.match(source, /后台接口请求和轮询不能延长会话/)
})
