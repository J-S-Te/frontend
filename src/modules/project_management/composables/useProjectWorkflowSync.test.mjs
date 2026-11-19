import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, effectScope, ref } from 'vue'
import * as workflow from './useProjectWorkflowSync.js'

const { useProjectWorkflowSync } = workflow

const wait = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms))

async function until(predicate) {
  const end = Date.now() + 400
  while (!predicate() && Date.now() < end) await wait(3)
  assert.ok(predicate(), 'expected asynchronous refresh did not occur')
}

test('reconciles only for the active route and merges changes that arrive during a read', async (t) => {
  const scope = effectScope()
  t.after(() => scope.stop())
  const context = ref('tenant:leader')
  const section = ref('project_detail')
  const projectID = ref('P1')
  const sources = [], applied = []
  let finish
  scope.run(() => useProjectWorkflowSync({
    enabled: computed(() => section.value !== 'notifications'), context, section, projectID,
    connect: (id) => {
      const source = new EventEmitter()
      source.id = id
      source.addEventListener = source.on.bind(source)
      source.close = () => { source.closed = true }
      sources.push(source)
      return source
    },
    coalesceMs: 0,
    refresh: async (target, current) => {
      if (!applied.length && target.projectID === 'P1') await new Promise(resolve => { finish = resolve })
      if (current()) applied.push(target.projectID)
    },
  }))
  const [first] = sources
  assert.equal(first.id, 'P1')
  first.emit('ready')
  await wait()
  first.emit('workflow-changed')
  first.emit('workflow-changed')
  await wait()
  projectID.value = 'P2'
  assert.equal(first.closed, true)
  sources[1].emit('ready')
  finish()
  await wait()
  assert.deepEqual(applied, ['P2'])
  sources[1].emit('workflow-changed')
  sources[1].emit('workflow-changed')
  await wait()
  assert.deepEqual(applied, ['P2', 'P2'])
  section.value = 'notifications'
  assert.equal(sources[1].closed, true)
  scope.stop()
})

test('rechecks the active view on reconnect, failed streams, and when a hidden tab becomes visible', async (t) => {
  const scope = effectScope()
  t.after(() => scope.stop())
  const visibility = new EventTarget()
  const section = ref('monitoring')
  const sources = []
  let reads = 0
  visibility.hidden = true
  scope.run(() => useProjectWorkflowSync({
    enabled: ref(true), context: ref('leader'), section, projectID: ref(''), visibility,
    coalesceMs: 0, fallbackMs: 40,
    connect: () => {
      const source = new EventEmitter()
      source.addEventListener = source.on.bind(source)
      source.close = () => {}
      sources.push(source)
      return source
    },
    refresh: async () => { reads++ },
  }))
  assert.equal(sources.length, 0)
  assert.equal(reads, 0)
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  const [source] = sources
  await until(() => reads === 1)
  source.emit('error')
  await until(() => reads === 2)
  source.emit('ready')
  await until(() => reads === 3)
  scope.stop()
})

test('preserves deliberately unchecked decomposition rows during an external update', () => {
  const current = [{ id: 'kept', status: '待确认', selected: false },
    { id: 'done', status: '待确认', selected: true }]
  const incoming = [{ id: 'kept', status: '待复核' }, { id: 'done', status: '待分配' },
    { id: 'new', status: '待确认' }]
  const result = workflow.reconcileWorkflowServiceItems(current, incoming)
  assert.deepEqual(result.map(({ id, selected }) => [id, selected]),
    [['kept', false], ['done', false], ['new', true]])
})
