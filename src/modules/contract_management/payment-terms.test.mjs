import assert from 'node:assert/strict'
import test from 'node:test'
import { hydrateContractDraft } from './utils/contractDraft.js'
import { normalizePaymentTerms, paymentAmountMinor } from './utils/paymentTerms.js'

test('existing structured payment terms are restored without aliasing or synthetic installments', () => {
  const current = { id: 'draft', status: 'draft', can_edit_draft: true, amount_minor: 10000, currency: 'CNY', payment_terms: [{ installment_no: 1, due_date: '2026-12-01', amount: '100.00' }] }
  const form = hydrateContractDraft(current)
  assert.deepEqual(form.payment_terms, current.payment_terms)
  form.payment_terms[0].amount = '90.00'
  assert.equal(current.payment_terms[0].amount, '100.00')
  assert.deepEqual(hydrateContractDraft({ ...current, payment_terms: undefined }).payment_terms, [])
})

test('decimal amounts and payment totals remain exact without rounding', () => {
  assert.equal(paymentAmountMinor('0.29'), 29)
  const terms = [{ installment_no: 2, due_date: '2027-01-01', amount: '0.20' }, { installment_no: 1, due_date: '2026-12-01', amount: '0.1' }]
  assert.deepEqual(normalizePaymentTerms(terms, '0.30', 'CNY').map((term) => term.amount), ['0.10', '0.20'])
  assert.equal(terms[0].installment_no, 2)
  assert.deepEqual(normalizePaymentTerms([], '', 'CNY'), [])
  for (const amount of ['1.001', '1e2', '-1', '90071992547409.92', '']) assert.throws(() => paymentAmountMinor(amount))
})

test('invalid date, duplicate number, currency and amount changes reject before submission', () => {
  const terms = [{ installment_no: 1, due_date: '2028-02-29', amount: '100.00' }]
  assert.throws(() => normalizePaymentTerms(terms, '99.99', 'CNY'), /合计/)
  assert.throws(() => normalizePaymentTerms(terms, '100', '123'), /币种/)
  assert.throws(() => normalizePaymentTerms([{ ...terms[0], due_date: '2027-02-29' }], '100', 'CNY'), /到期日/)
  assert.throws(() => normalizePaymentTerms([{ ...terms[0], installment_no: 0 }], '100', 'CNY'), /分期号/)
  assert.throws(() => normalizePaymentTerms([terms[0], terms[0]], '200', 'CNY'), /分期号/)
})
