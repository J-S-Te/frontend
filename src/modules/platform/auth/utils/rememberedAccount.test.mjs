import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REMEMBERED_ACCOUNT_STORAGE_KEY,
  clearRememberedAccount,
  readRememberedAccount,
  writeRememberedAccount,
} from './rememberedAccount.js'
import { broadcastSessionEnded } from './sessionLifecycle.js'

function withMockBrowser(fn) {
  const store = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  try {
    fn(store)
  } finally {
    delete globalThis.window
  }
}

test('记住的账号写入/读取/清除基本行为 [SEC-X3]', () => {
  withMockBrowser((store) => {
    assert.equal(readRememberedAccount(), '')
    writeRememberedAccount('  alice@corp  ')
    assert.equal(readRememberedAccount(), 'alice@corp')
    assert.equal(store.get(REMEMBERED_ACCOUNT_STORAGE_KEY), 'alice@corp')
    writeRememberedAccount('')
    assert.equal(readRememberedAccount(), 'alice@corp', '空值写入不得清掉已有记忆')
    clearRememberedAccount()
    assert.equal(readRememberedAccount(), '')
    assert.equal(store.has(REMEMBERED_ACCOUNT_STORAGE_KEY), false)
  })
})

test('存储不可用时按无记忆账号处理，不抛错 [SEC-X3]', () => {
  assert.equal(readRememberedAccount(), '')
  writeRememberedAccount('alice')
  clearRememberedAccount()
})

test('会话终结广播会清除记住的账号（登出/超时/撤销共用漏斗）[SEC-X3 回归]', () => {
  withMockBrowser((store) => {
    writeRememberedAccount('alice')
    assert.equal(store.has(REMEMBERED_ACCOUNT_STORAGE_KEY), true)
    broadcastSessionEnded('manual-logout')
    assert.equal(
      store.has(REMEMBERED_ACCOUNT_STORAGE_KEY),
      false,
      'notifySessionEnded 漏斗必须在会话终结时清除 localStorage 账号',
    )
  })
})
