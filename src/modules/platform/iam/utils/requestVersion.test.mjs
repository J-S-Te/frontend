import assert from 'node:assert/strict'
import test from 'node:test'
import { isCurrentAuthorizationRequest } from './requestVersion.js'

test('authorization request stays current only while version and subject match', () => {
  const request = { version: 4, subjectType: 'USER', subjectId: 'user-1', applicationCode: 'platform' }

  assert.equal(isCurrentAuthorizationRequest(request, { ...request }), true)
  assert.equal(isCurrentAuthorizationRequest(request, { ...request, version: 5 }), false)
  assert.equal(isCurrentAuthorizationRequest(request, { ...request, subjectId: 'user-2' }), false)
  assert.equal(isCurrentAuthorizationRequest(request, { ...request, applicationCode: 'contract_management' }), false)
})
