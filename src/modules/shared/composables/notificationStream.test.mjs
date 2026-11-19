import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createNotificationStream } from './notificationStream.js'

test('shares the connection, coalesces committed changes and reconciles after reconnect', async () => {
  const connections = []
  const observe = createNotificationStream({
    connect: () => {
      const source = new EventEmitter()
      source.addEventListener = source.on.bind(source)
      source.close = () => { source.closed = true }
      connections.push(source)
      return source
    },
    coalesceMs: 0,
  })
  const refreshes = [0, 0]
  const unsubFirst = observe(() => { refreshes[0]++ })
  const unsubSecond = observe(() => { refreshes[1]++ })
  const [source] = connections
  assert.equal(connections.length, 1)
  source.emit('ready')
  source.emit('inbox-changed')
  source.emit('inbox-changed')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(refreshes, [1, 1])

  source.emit('error')
  source.emit('ready')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(refreshes, [2, 2])
  unsubFirst()
  assert.equal(source.closed, undefined)
  unsubSecond()
  assert.equal(source.closed, true)
})
