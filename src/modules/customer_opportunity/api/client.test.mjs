import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCRMLoginURL } from './client.js'

test('CRM login URL preserves the complete same-origin return path', () => {
  assert.equal(
    buildCRMLoginURL({ pathname: '/customer-opportunity/customers', search: '?page=2', hash: '#detail' }),
    '/customer-opportunity/auth/login?return_to=%2Fcustomer-opportunity%2Fcustomers%3Fpage%3D2%23detail',
  )
})
