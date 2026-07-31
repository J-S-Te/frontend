import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DICTIONARY_ENTRY_PERMISSIONS,
  DICTIONARY_PERMISSIONS,
} from './dictionaryPermissions.js'

test('dictionary permission constants match the backend routes', () => {
  assert.deepEqual(DICTIONARY_PERMISSIONS, {
    dictionaryRead: 'platform:dictionary:read',
    dictionaryCreate: 'platform:dictionary:create',
    dictionaryUpdate: 'platform:dictionary:update',
    itemRead: 'platform:dictionary-item:read',
    itemCreate: 'platform:dictionary-item:create',
    itemUpdate: 'platform:dictionary-item:update',
  })
  assert.deepEqual(DICTIONARY_ENTRY_PERMISSIONS, Object.values(DICTIONARY_PERMISSIONS))
})
