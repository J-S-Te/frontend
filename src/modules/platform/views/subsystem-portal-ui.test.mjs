import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./SubsystemPortalView.vue', import.meta.url), 'utf8')

test('internal subsystems open as a new page and fall back when popups are blocked', () => {
  const openSubsystem = source.slice(source.indexOf('function openSubsystem'), source.indexOf('function handleCardPointerMove'))
  assert.match(openSubsystem, /router\.resolve\(subsystem\.route\)/)
  assert.match(source, /function openSubsystemTarget\(targetURL\)/)
  assert.match(source, /window\.open\('', '_blank'\)/)
  assert.match(source, /opened\.opener = null\s*opened\.location\.replace\(target\)\s*return true/)
  assert.match(source, /window\.location\.assign\(target\)/)
  assert.doesNotMatch(source, /window\.open\(target, '_blank', 'noopener,noreferrer'\)/)
})

test('external subsystem addresses use the same popup fallback', () => {
  const openSubsystem = source.slice(source.indexOf('function openSubsystem'), source.indexOf('function handleCardPointerMove'))
  assert.match(openSubsystem, /openSubsystemTarget\(subsystem\.publicURL\)/)
  assert.match(openSubsystem, /openSubsystemTarget\(targetURL\)/)
})
