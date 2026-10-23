import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const css = await readFile(new URL('./styles/contract-management.css', import.meta.url), 'utf8')

test('new contract form marks required fields and explains the marker', () => {
  assert.match(source, /contract-form-required-hint/)
  assert.match(source, /带 <strong>\*<\/strong> 的为必填项/)
  assert.match(css, /label:has\(input\[required\]\) > span::after/)
  assert.match(css, /label:has\(select\[required\]\) > span::after/)
  assert.match(css, /label:has\(textarea\[required\]\) > span::after/)
  assert.match(css, /\.is-required > span::after/)
  assert.match(source, /:class="\{ 'is-required': isExternalContractMode \|\| newContract\.payment_terms\.length > 0 \}"/)
})

test('contract and customer text inputs carry explicit length limits', () => {
  for (const [field, limit] of [
    ['newContract.title', 255],
    ['serviceItem.name', 255],
    ['serviceItem.site', 255],
    ['serviceItem.batch', 120],
    ['serviceItem.requirement', 1000],
    ['newContract.customer_name', 255],
    ['newContract.customer_address', 500],
    ['newContract.customer_contact', 128],
    ['newContract.customer_phone', 64],
    ['newContract.template_values[field.name]', 2000],
    ['approvalComment', 2000],
  ]) {
    const tag = source.match(new RegExp(`<input[^>]*v-model="${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`))?.[0] || source.match(new RegExp(`<textarea[^>]*v-model="${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`))?.[0]
    assert.ok(tag, `missing input for ${field}`)
    assert.match(tag, new RegExp(`maxlength="${limit}"`), `${field} missing maxlength=${limit}`)
  }
  assert.match(source, /max="90071992547409\.91"/)
  assert.match(source, /pattern="\[A-Za-z\]\{3\}"/)
  assert.match(source, /maxlength="20" pattern="\[0-9\]\{1,15\}/)
})

test('all free-text contract inputs have a length or numeric bound', () => {
  const inputs = source.match(/<input\b[^>]*>/g) || []
  const violations = inputs.filter(tag => {
    if (/\btype="(checkbox|radio|file|date|number|hidden)"/.test(tag)) return false
    if (/\breadonly\b/.test(tag)) return false
    if (/:type="[^"]*'number'/.test(tag)) return false
    return !/\bmaxlength="/.test(tag)
  })
  assert.deepEqual(violations, [], `inputs without compliance limits: ${violations.join('\n')}`)
})
