import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { closeGameServer, createGameServer, listen, parsePort } from './server.js'

test('parsePort accepts empty values and rejects out-of-range ports', () => {
  assert.equal(parsePort(undefined), 3000)
  assert.equal(parsePort('  '), 3000)
  assert.equal(parsePort('8080'), 8080)
  assert.throws(() => parsePort('70000'), /Invalid PORT/)
  assert.throws(() => parsePort('abc'), /Invalid PORT/)
})

test('createGameServer serves the client and accepts a websocket', async () => {
  const clientDir = mkdtempSync(join(tmpdir(), 'top-trumps-serve-'))
  writeFileSync(join(clientDir, 'index.html'), '<h1>Top Trumps</h1>')

  const gameServer = createGameServer(clientDir)
  const port = await listen(gameServer, 0)

  try {
    const page = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /Top Trumps/)

    const head = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')

    const missing = await fetch(`http://127.0.0.1:${port}/missing.js`)
    assert.equal(missing.status, 404)

    const rejected = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })
    assert.equal(rejected.status, 405)

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const payload = await new Promise<string>((resolve, reject) => {
      socket.once('message', (data) => resolve(data.toString()))
      socket.once('error', reject)
    })
    assert.deepEqual(JSON.parse(payload), { type: 'connected' })
    socket.close()
  } finally {
    await closeGameServer(gameServer)
  }
})
