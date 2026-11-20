import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const nginx = await readFile(new URL('../../../nginx/default.conf', import.meta.url), 'utf8')

test('合同与 CRM 的 readiness 路径由 nginx 转发到真实后端', () => {
  assert.match(nginx, /location = \/contract_management\/readyz \{\s*proxy_pass http:\/\/\$contract_backend\/readyz;/)
  assert.match(nginx, /location = \/customer-opportunity\/readyz \{\s*proxy_pass http:\/\/\$customer_backend;/)
  assert.doesNotMatch(nginx, /location = \/contract_management\/readyz \{[^}]*try_files/)
})
