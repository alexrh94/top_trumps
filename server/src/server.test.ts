import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { WebSocket, type RawData } from 'ws'
import { cleanNickname, closeGameServer, createGameServer, listen, parsePort } from './server.js'

const sampleDecksDir = fileURLToPath(new URL('../../decks', import.meta.url))

test('cleanNickname trims, collapses spaces, and limits the length', () => {
  assert.equal(cleanNickname('  Alex   Rider  '), 'Alex Rider')
  assert.equal(cleanNickname('A'.repeat(40)), 'A'.repeat(24))
  assert.equal(cleanNickname(' \n Sam \t '), 'Sam')
  assert.equal(cleanNickname('   '), '')
})

test('parsePort accepts empty values and rejects out-of-range ports', () => {
  assert.equal(parsePort(undefined), 3000)
  assert.equal(parsePort('  '), 3000)
  assert.equal(parsePort('8080'), 8080)
  assert.throws(() => parsePort('70000'), /Invalid PORT/)
  assert.throws(() => parsePort('abc'), /Invalid PORT/)
})

function track(socket: WebSocket) {
  const messages: unknown[] = []
  const waiters: Array<(message: unknown) => void> = []

  socket.on('message', (data: RawData) => {
    const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString()
    const message: unknown = JSON.parse(text)
    const waiter = waiters.shift()
    if (waiter) waiter(message)
    else messages.push(message)
  })

  return {
    next(): Promise<unknown> {
      const queued = messages.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    },
    send(message: unknown) {
      socket.send(JSON.stringify(message))
    },
  }
}

test('createGameServer serves the client and accepts a websocket', async () => {
  const clientDir = mkdtempSync(join(tmpdir(), 'top-trumps-serve-'))
  const decksDir = mkdtempSync(join(tmpdir(), 'top-trumps-decks-'))
  writeFileSync(join(clientDir, 'index.html'), '<h1>Top Trumps</h1>')

  const gameServer = createGameServer(clientDir, decksDir)
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
    const client = track(socket)
    const connected = await client.next()
    assert.equal(typeof connected === 'object' && connected !== null && 'playerId' in connected, true)
    if (typeof connected === 'object' && connected !== null && 'type' in connected && 'playerId' in connected) {
      assert.equal(connected.type, 'connected')
      assert.equal(typeof connected.playerId, 'string')
    }
    assert.deepEqual(await client.next(), { type: 'decks', decks: [] })
    socket.close()
  } finally {
    await closeGameServer(gameServer)
  }
})

test('an empty room closes after its grace period', async () => {
  const clientDir = mkdtempSync(join(tmpdir(), 'top-trumps-serve-'))
  writeFileSync(join(clientDir, 'index.html'), '<h1>Top Trumps</h1>')
  const gameServer = createGameServer(clientDir, sampleDecksDir, 40)
  const port = await listen(gameServer, 0)
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  const client = track(socket)

  try {
    await client.next()
    await client.next()
    client.send({ type: 'create_room' })
    const created = await client.next()
    const code = isRecord(created) && typeof created.code === 'string' ? created.code : ''
    await new Promise((resolve) => {
      socket.once('close', resolve)
      socket.close()
    })
    await new Promise((resolve) => setTimeout(resolve, 80))

    const lateSocket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const late = track(lateSocket)
    await late.next()
    await late.next()
    late.send({ type: 'join_room', code })
    assert.deepEqual(await late.next(), { type: 'error', message: `No room with code ${code}.` })
    lateSocket.close()
  } finally {
    socket.close()
    await closeGameServer(gameServer)
  }
})

test('players can create a room, choose a deck, and join it', async () => {
  const clientDir = mkdtempSync(join(tmpdir(), 'top-trumps-serve-'))
  writeFileSync(join(clientDir, 'index.html'), '<h1>Top Trumps</h1>')

  const gameServer = createGameServer(clientDir, sampleDecksDir)
  const port = await listen(gameServer, 0)
  const url = `ws://127.0.0.1:${port}/ws`

  const hostSocket = new WebSocket(url)
  const guestSocket = new WebSocket(url)
  const host = track(hostSocket)
  const guest = track(guestSocket)

  try {
    const hostConnected = await host.next()
    const guestConnected = await guest.next()
    assert.equal(isRecord(hostConnected) && hostConnected.type, 'connected')
    assert.equal(isRecord(guestConnected) && guestConnected.type, 'connected')
    const hostId = isRecord(hostConnected) && typeof hostConnected.playerId === 'string' ? hostConnected.playerId : ''
    const guestId = isRecord(guestConnected) && typeof guestConnected.playerId === 'string' ? guestConnected.playerId : ''

    const hostDecks = await host.next()
    const guestDecks = await guest.next()
    assert.equal(isRecord(hostDecks) && hostDecks.type, 'decks')
    assert.equal(isRecord(guestDecks) && guestDecks.type, 'decks')
    assert.equal(isRecord(hostDecks) && Array.isArray(hostDecks.decks), true)
    if (isRecord(hostDecks) && Array.isArray(hostDecks.decks)) {
      assert.ok(hostDecks.decks.some((deck) => isRecord(deck) && deck.id === 'dinosaurs' && deck.name === 'Dinosaurs'))
    }

    host.send({ type: 'create_room', nickname: '  Alex  ' })
    const created = await host.next()
    assert.equal(isRecord(created) && created.type, 'room')
    assert.equal(isRecord(created) && typeof created.code === 'string' && /^[A-Z]{4}$/.test(created.code), true)
    const code = isRecord(created) && typeof created.code === 'string' ? created.code : ''
    assert.equal(isRecord(created) && created.hostId, hostId)
    assert.equal(isRecord(created) && created.deckId, null)
    assert.deepEqual(isRecord(created) ? created.playerIds : [], [hostId])
    assert.deepEqual(nicknamesOf(created), ['Alex'])

    guest.send({ type: 'join_room', code: code.toLowerCase(), nickname: `${'S'.repeat(40)}` })
    const hostSawJoin = await host.next()
    const guestSawJoin = await guest.next()
    assert.deepEqual(isRecord(hostSawJoin) ? hostSawJoin.playerIds : [], [hostId, guestId])
    assert.deepEqual(isRecord(guestSawJoin) ? guestSawJoin.playerIds : [], [hostId, guestId])
    assert.deepEqual(nicknamesOf(guestSawJoin), ['Alex', 'S'.repeat(24)])

    guest.send({ type: 'select_deck', deckId: 'dinosaurs' })
    const guestDenied = await guest.next()
    assert.deepEqual(guestDenied, { type: 'error', message: 'Only the host can choose the deck.' })

    host.send({ type: 'select_deck', deckId: 'dinosaurs' })
    const hostSawDeck = await host.next()
    const guestSawDeck = await guest.next()
    assert.equal(isRecord(hostSawDeck) && hostSawDeck.deckId, 'dinosaurs')
    assert.equal(isRecord(guestSawDeck) && guestSawDeck.deckId, 'dinosaurs')

    guest.send({ type: 'nope' })
    assert.deepEqual(await guest.next(), { type: 'error', message: 'Unreadable message.' })

    guestSocket.send('not-json')
    assert.deepEqual(await guest.next(), { type: 'error', message: 'Unreadable message.' })

    guest.send({ type: 'leave_room' })
    const hostSawLeave = await host.next()
    assert.deepEqual(isRecord(hostSawLeave) ? hostSawLeave.playerIds : [], [hostId])
    assert.equal(isRecord(hostSawLeave) && hostSawLeave.deckId, 'dinosaurs')

    guest.send({ type: 'join_room', code })
    const hostSawRejoin = await host.next()
    const guestSawRejoin = await guest.next()
    assert.deepEqual(isRecord(hostSawRejoin) ? hostSawRejoin.playerIds : [], [hostId, guestId])
    assert.deepEqual(isRecord(guestSawRejoin) ? guestSawRejoin.playerIds : [], [hostId, guestId])

    hostSocket.close()
    const guestSawHostLeave = await guest.next()
    assert.equal(isRecord(guestSawHostLeave) && guestSawHostLeave.hostId, guestId)
    assert.deepEqual(isRecord(guestSawHostLeave) ? guestSawHostLeave.playerIds : [], [guestId])
    assert.equal(isRecord(guestSawHostLeave) && guestSawHostLeave.deckId, 'dinosaurs')

    const strangerSocket = new WebSocket(url)
    const stranger = track(strangerSocket)
    await stranger.next()
    await stranger.next()
    const missingCode = code === 'ZZZZ' ? 'YYYY' : 'ZZZZ'
    stranger.send({ type: 'join_room', code: missingCode })
    const missing = await stranger.next()
    assert.deepEqual(missing, { type: 'error', message: `No room with code ${missingCode}.` })
    strangerSocket.close()

    await new Promise((resolve) => {
      guestSocket.once('close', resolve)
      guestSocket.close()
    })

    const returningSocket = new WebSocket(url)
    const returning = track(returningSocket)
    const returningConnected = await returning.next()
    await returning.next()
    const returningId =
      isRecord(returningConnected) && typeof returningConnected.playerId === 'string' ? returningConnected.playerId : ''
    returning.send({ type: 'join_room', code })
    const restored = await returning.next()
    assert.equal(isRecord(restored) && restored.hostId, returningId)
    assert.equal(isRecord(restored) && restored.deckId, 'dinosaurs')
    assert.deepEqual(isRecord(restored) ? restored.playerIds : [], [returningId])
    returningSocket.close()
  } finally {
    hostSocket.close()
    guestSocket.close()
    await closeGameServer(gameServer)
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nicknamesOf(message: unknown): string[] {
  if (!isRecord(message) || !Array.isArray(message.players)) return []
  return message.players.map((player) =>
    isRecord(player) && typeof player.nickname === 'string' ? player.nickname : '',
  )
}
