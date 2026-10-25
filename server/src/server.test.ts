import assert from 'node:assert/strict'
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
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
    get queued(): number {
      return messages.length
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

test('the host deals a private game and the last player takes the cards', async () => {
  const clientDir = mkdtempSync(join(tmpdir(), 'top-trumps-serve-'))
  writeFileSync(join(clientDir, 'index.html'), '<h1>Top Trumps</h1>')
  const gameServer = createGameServer(clientDir, sampleDecksDir, undefined, () => 0.999999999)
  const port = await listen(gameServer, 0)
  const url = `ws://127.0.0.1:${port}/ws`
  const hostSocket = new WebSocket(url)
  const guestSocket = new WebSocket(url)
  const strangerSocket = new WebSocket(url)
  const host = track(hostSocket)
  const guest = track(guestSocket)
  const stranger = track(strangerSocket)

  try {
    const hostConnected = requireRecord(await host.next())
    const guestConnected = requireRecord(await guest.next())
    await stranger.next()
    await host.next()
    await guest.next()
    await stranger.next()
    const hostId = stringField(hostConnected, 'playerId')

    stranger.send({ type: 'start_game' })
    assert.deepEqual(await stranger.next(), { type: 'error', message: 'Join a room before starting a game.' })

    host.send({ type: 'create_room', nickname: 'Alex' })
    const created = requireRecord(await host.next())
    const code = stringField(created, 'code')

    host.send({ type: 'start_game' })
    assert.deepEqual(await host.next(), { type: 'error', message: 'At least two players are needed to start.' })

    guest.send({ type: 'join_room', code, nickname: 'Sam' })
    await host.next()
    await guest.next()

    host.send({ type: 'start_game' })
    assert.deepEqual(await host.next(), { type: 'error', message: 'Choose a deck before starting.' })
    guest.send({ type: 'start_game' })
    assert.deepEqual(await guest.next(), { type: 'error', message: 'Only the host can start the game.' })
    guest.send({ type: 'choose_attribute', attributeIndex: 0 })
    assert.deepEqual(await guest.next(), { type: 'error', message: 'The game has not started.' })

    host.send({ type: 'select_deck', deckId: 'dinosaurs' })
    await host.next()
    await guest.next()
    guest.send({ type: 'start_game' })
    assert.deepEqual(await guest.next(), { type: 'error', message: 'Only the host can start the game.' })

    host.send({ type: 'start_game' })
    const hostDeal = await nextGame(host)
    const guestDeal = await nextGame(guest)
    assert.equal(hostDeal.phase, 'playing')
    assert.equal(hostDeal.currentPlayerId, hostId)
    assert.equal(Array.isArray(hostDeal.attributes) && hostDeal.attributes[0], 'Height')
    assert.equal(youCount(hostDeal), 4)
    assert.equal(youCount(guestDeal), 4)
    assert.equal(topName(hostDeal), 'Tyrannosaurus')
    assert.equal(topName(guestDeal), 'Triceratops')
    assert.equal(hostDeal.tiePileCount, 0)
    assert.equal(hostDeal.lastResult, null)
    assert.equal(JSON.stringify(hostDeal).includes('Triceratops'), false)
    assert.equal(JSON.stringify(hostDeal).includes('Velociraptor'), false)
    assert.equal(JSON.stringify(guestDeal).includes('Tyrannosaurus'), false)
    assert.equal(JSON.stringify(guestDeal).includes('Brachiosaurus'), false)

    guest.send({ type: 'choose_attribute', attributeIndex: 0 })
    assert.deepEqual(await guest.next(), { type: 'error', message: 'It is not your turn.' })
    host.send({ type: 'select_deck', deckId: 'dinosaurs' })
    assert.deepEqual(await host.next(), { type: 'error', message: 'The game has already started.' })

    guestSocket.close()
    const hostRoom = requireRecord(await host.next())
    assert.deepEqual(hostRoom.playerIds, [hostId])
    const ended = requireRecord(await host.next())
    assert.equal(ended.type, 'game')
    assert.equal(ended.phase, 'finished')
    assert.equal(ended.winnerId, hostId)
    assert.equal(youCount(ended), 8)
    assert.equal(ended.tiePileCount, 0)
    assert.deepEqual(ended.players, [{ id: hostId, count: 8 }])

    await new Promise((resolve) => {
      hostSocket.once('close', resolve)
      hostSocket.close()
    })

    const returningSocket = new WebSocket(url)
    const returning = track(returningSocket)
    await returning.next()
    await returning.next()
    returning.send({ type: 'join_room', code, nickname: 'Alex' })
    const restored = requireRecord(await returning.next())
    assert.equal(restored.type, 'room')
    assert.equal(restored.deckId, 'dinosaurs')
    assert.equal(returning.queued, 0)
    returningSocket.close()
  } finally {
    hostSocket.close()
    guestSocket.close()
    strangerSocket.close()
    await closeGameServer(gameServer)
  }
})

test('a draw leaves a middle pile and the next winner collects it', async () => {
  const clientDir = mkdtempSync(join(tmpdir(), 'top-trumps-serve-'))
  const decksDir = mkdtempSync(join(tmpdir(), 'top-trumps-decks-'))
  writeFileSync(join(clientDir, 'index.html'), '<h1>Top Trumps</h1>')
  writeFileSync(
    join(decksDir, 'duel.json'),
    JSON.stringify({
      name: 'Duel',
      attributes: ['Power', 'Speed'],
      cards: [
        { name: 'Red', values: [2, 1] },
        { name: 'Blue', values: [2, 5] },
        { name: 'Green', values: [4, 3] },
        { name: 'Gold', values: [0, 9] },
      ],
    }),
  )

  const gameServer = createGameServer(clientDir, decksDir, undefined, () => 0.999999999)
  const port = await listen(gameServer, 0)
  const url = `ws://127.0.0.1:${port}/ws`
  const hostSocket = new WebSocket(url)
  const guestSocket = new WebSocket(url)
  const host = track(hostSocket)
  const guest = track(guestSocket)

  try {
    const hostConnected = requireRecord(await host.next())
    const guestConnected = requireRecord(await guest.next())
    await host.next()
    await guest.next()
    const hostId = stringField(hostConnected, 'playerId')
    const guestId = stringField(guestConnected, 'playerId')

    host.send({ type: 'create_room', nickname: 'Alex' })
    const created = requireRecord(await host.next())
    const code = stringField(created, 'code')
    guest.send({ type: 'join_room', code, nickname: 'Sam' })
    await host.next()
    await guest.next()
    host.send({ type: 'select_deck', deckId: 'duel' })
    await host.next()
    await guest.next()

    unlinkSync(join(decksDir, 'duel.json'))
    host.send({ type: 'start_game' })
    assert.deepEqual(await host.next(), { type: 'error', message: 'That deck is not available.' })
    writeFileSync(
      join(decksDir, 'duel.json'),
      JSON.stringify({
        name: 'Duel',
        attributes: ['Power', 'Speed'],
        cards: [
          { name: 'Red', values: [2, 1] },
          { name: 'Blue', values: [2, 5] },
          { name: 'Green', values: [4, 3] },
          { name: 'Gold', values: [0, 9] },
        ],
      }),
    )

    host.send({ type: 'start_game' })
    const hostDeal = await nextGame(host)
    const guestDeal = await nextGame(guest)
    assert.equal(topName(hostDeal), 'Red')
    assert.equal(topName(guestDeal), 'Blue')
    assert.equal(JSON.stringify(hostDeal).includes('Gold'), false)
    assert.equal(JSON.stringify(guestDeal).includes('Green'), false)

    host.send({ type: 'choose_attribute', attributeIndex: 1.5 })
    assert.deepEqual(await host.next(), { type: 'error', message: "Choose one of the card's attributes." })
    host.send({ type: 'choose_attribute', attributeIndex: 0 })
    const hostDraw = await nextGame(host)
    const guestDraw = await nextGame(guest)
    assert.equal(hostDraw.currentPlayerId, guestId)
    assert.equal(hostDraw.tiePileCount, 2)
    assert.equal(isRecord(hostDraw.lastResult) && hostDraw.lastResult.winnerId, null)
    assert.equal(topName(hostDraw), 'Green')
    assert.equal(topName(guestDraw), 'Gold')
    assert.equal(JSON.stringify(hostDraw).includes('Gold'), false)
    assert.equal(JSON.stringify(guestDraw).includes('Green'), false)

    host.send({ type: 'choose_attribute', attributeIndex: 1 })
    assert.deepEqual(await host.next(), { type: 'error', message: 'It is not your turn.' })
    guest.send({ type: 'choose_attribute', attributeIndex: 1 })
    const hostWin = await nextGame(host)
    const guestWin = await nextGame(guest)
    assert.equal(hostWin.phase, 'finished')
    assert.equal(hostWin.winnerId, guestId)
    assert.equal(hostWin.currentPlayerId, null)
    assert.equal(hostWin.tiePileCount, 0)
    assert.equal(youCount(hostWin), 0)
    assert.equal(topName(hostWin), null)
    assert.equal(youCount(guestWin), 4)
    assert.equal(topName(guestWin), 'Green')
    assert.equal(isRecord(guestWin.lastResult) && guestWin.lastResult.winnerId, guestId)
    assert.equal(isRecord(guestWin.lastResult) && guestWin.lastResult.awardedPile, 2)
    assert.deepEqual(isRecord(guestWin.lastResult) ? guestWin.lastResult.plays : [], [
      { id: hostId, name: 'Green', values: [4, 3], value: 3 },
      { id: guestId, name: 'Gold', values: [0, 9], value: 9 },
    ])
  } finally {
    hostSocket.close()
    guestSocket.close()
    await closeGameServer(gameServer)
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.equal(isRecord(value), true)
  if (!isRecord(value)) throw new Error('expected a record')
  return value
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  assert.equal(typeof value, 'string')
  return typeof value === 'string' ? value : ''
}

function youCount(record: Record<string, unknown>): number {
  assert.equal(isRecord(record.you), true)
  if (!isRecord(record.you) || typeof record.you.count !== 'number') return -1
  return record.you.count
}

function topName(record: Record<string, unknown>): string | null {
  assert.equal(isRecord(record.you), true)
  if (!isRecord(record.you)) return null
  if (record.you.topCard === null) return null
  assert.equal(isRecord(record.you.topCard), true)
  if (!isRecord(record.you.topCard) || typeof record.you.topCard.name !== 'string') return null
  return record.you.topCard.name
}

async function nextGame(client: { next(): Promise<unknown> }): Promise<Record<string, unknown>> {
  const room = requireRecord(await client.next())
  assert.equal(room.type, 'room')
  const game = requireRecord(await client.next())
  assert.equal(game.type, 'game')
  return game
}

function nicknamesOf(message: unknown): string[] {
  if (!isRecord(message) || !Array.isArray(message.players)) return []
  return message.players.map((player) =>
    isRecord(player) && typeof player.nickname === 'string' ? player.nickname : '',
  )
}
