import { canonicalValue, createFormSnapshot, hasUnsavedChanges } from './unsavedChanges.js'

const cases = []
function test(name, fn) { cases.push({ name, fn }) }

test('canonical snapshots ignore object key order', () => {
  const a = createFormSnapshot({ name: 'A', nested: { b: 2, a: 1 } })
  const b = createFormSnapshot({ nested: { a: 1, b: 2 }, name: 'A' })
  if (a !== b) throw new Error('key order changed the snapshot')
})

test('canonical snapshots preserve array order', () => {
  const a = createFormSnapshot({ rows: [1, 2] })
  const b = createFormSnapshot({ rows: [2, 1] })
  if (a === b) throw new Error('array order was ignored')
})

test('unsaved changes detect edits and reset state', () => {
  const initial = createFormSnapshot({ name: 'A', rows: [{ value: 'x' }] })
  if (hasUnsavedChanges(initial, { name: 'A', rows: [{ value: 'x' }] })) throw new Error('clean form reported dirty')
  if (!hasUnsavedChanges(initial, { name: 'B', rows: [{ value: 'x' }] })) throw new Error('edited form reported clean')
})

test('undefined and function values do not create dirty state', () => {
  const initial = createFormSnapshot({ name: 'A' })
  if (hasUnsavedChanges(initial, { name: 'A', optional: undefined, submit: () => {} })) {
    throw new Error('non-data fields changed the snapshot')
  }
})

test('canonicalValue does not mutate input', () => {
  const value = { z: 1, a: { y: 2, b: 3 } }
  const before = JSON.stringify(value)
  canonicalValue(value)
  if (JSON.stringify(value) !== before) throw new Error('canonicalValue mutated input')
})

let failed = 0
for (const item of cases) {
  try {
    item.fn()
    console.log(`ok - ${item.name}`)
  } catch (error) {
    failed += 1
    console.error(`not ok - ${item.name}: ${error.message}`)
  }
}
if (failed) process.exitCode = 1
