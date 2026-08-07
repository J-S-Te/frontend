import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./SubsystemPortalView.vue', import.meta.url), 'utf8')

test('internal subsystems open as a new page without replacing the portal', () => {
  const openSubsystem = source.slice(source.indexOf('function openSubsystem'), source.indexOf('function handleCardPointerMove'))
  assert.match(openSubsystem, /router\.resolve\(subsystem\.route\)/)
  assert.match(openSubsystem, /window\.open\(targetURL, '_blank', 'noopener,noreferrer'\)/)
})

test('external subsystem addresses still open in a new tab', () => {
  assert.match(source, /window\.open\(subsystem\.publicURL, '_blank', 'noopener,noreferrer'\)/)
})
