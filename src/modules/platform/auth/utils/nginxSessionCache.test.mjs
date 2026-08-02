import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const nginxSource = await readFile(new URL('../../../../../nginx/default.conf', import.meta.url), 'utf8')

test('SPA entry documents are not cached across browser account switches', () => {
  assert.match(nginxSource, /location = \/index\.html \{[\s\S]*Cache-Control "no-store"/)
  assert.match(nginxSource, /location \/ \{\s*add_header Cache-Control "no-store" always;[\s\S]*try_files \$uri \$uri\/ @spa;/)
  assert.match(nginxSource, /location \/contract_management\/ \{\s*add_header Cache-Control "no-store" always;[\s\S]*try_files \$uri \$uri\/ @spa;/)
  assert.match(nginxSource, /location @spa \{\s*add_header Cache-Control "no-store" always;[\s\S]*try_files \/index\.html =404;/)
})
