import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRoomStore } from './rooms.js'

const decks = new Set(['dinosaurs'])

test('create opens a room hosted by that player', () => {
  const store = createRoomStore()
  const created = store.create('host', 'ABCD')

  assert.equal(created.ok, true)
  if (!created.ok) return

  assert.equal(created.previous, null)
  assert.deepEqual(created.room, {
    code: 'ABCD',
    hostId: 'host',
    deckId: null,
    playerIds: ['host'],
  })
  assert.equal(store.has('ABCD'), true)

  created.room.playerIds.push('intruder')
  assert.deepEqual(store.get('ABCD')?.playerIds, ['host'])
})

test('create rejects a bad code and a code that is already taken', () => {
  const store = createRoomStore()
  assert.equal(store.create('host', 'ab').ok, false)
  assert.equal(store.create('host', 'ABCD').ok, true)
  assert.equal(store.create('other', 'ABCD').ok, false)
  assert.deepEqual(store.get('ABCD')?.playerIds, ['host'])
})

test('create moves the host out of the room they were already in', () => {
  const store = createRoomStore()
  assert.equal(store.create('host', 'ABCD').ok, true)
  assert.equal(store.join('other', 'ABCD').ok, true)

  const created = store.create('host', 'WXYZ')
  assert.equal(created.ok, true)
  if (!created.ok) return

  assert.equal(created.previous?.code, 'ABCD')
  assert.equal(created.previous?.room?.hostId, 'other')
  assert.deepEqual(created.previous?.room?.playerIds, ['other'])
  assert.deepEqual(store.get('WXYZ')?.playerIds, ['host'])
})

test('join adds a player and normalizes the code', () => {
  const store = createRoomStore()
  assert.equal(store.create('host', 'ABCD').ok, true)

  const joined = store.join('guest', ' abcd ')
  assert.equal(joined.ok, true)
  if (!joined.ok) return

  assert.deepEqual(joined.room.playerIds, ['host', 'guest'])
  assert.equal(store.join('guest', 'ABCD').ok, true)
  assert.deepEqual(store.get('ABCD')?.playerIds, ['host', 'guest'])
})

test('join rejects an unknown room and a player leaving another room is reported', () => {
  const store = createRoomStore()
  assert.equal(store.create('host', 'ABCD').ok, true)
  assert.equal(store.join('guest', 'ABCD').ok, true)
  assert.equal(store.create('other', 'WXYZ').ok, true)

  const missing = store.join('guest', 'ZZZZ')
  assert.equal(missing.ok, false)

  const moved = store.join('guest', 'WXYZ')
  assert.equal(moved.ok, true)
  if (!moved.ok) return

  assert.deepEqual(moved.previous?.room?.playerIds, ['host'])
  assert.deepEqual(store.get('WXYZ')?.playerIds, ['other', 'guest'])
})

test('selectDeck lets the host choose a known deck', () => {
  const store = createRoomStore()
  assert.equal(store.create('host', 'ABCD').ok, true)
  assert.equal(store.join('guest', 'ABCD').ok, true)

  assert.equal(store.selectDeck('guest', 'dinosaurs', decks).ok, false)
  assert.equal(store.selectDeck('host', 'missing', decks).ok, false)
  assert.equal(store.selectDeck('outsider', 'dinosaurs', decks).ok, false)

  const selected = store.selectDeck('host', 'dinosaurs', decks)
  assert.equal(selected.ok, true)
  if (!selected.ok) return
  assert.equal(selected.room.deckId, 'dinosaurs')
  assert.equal(store.get('ABCD')?.deckId, 'dinosaurs')
})

test('leave removes a player and hands the room to the next one', () => {
  const store = createRoomStore()
  assert.equal(store.create('host', 'ABCD').ok, true)
  assert.equal(store.join('guest', 'ABCD').ok, true)
  assert.equal(store.leave('missing'), null)

  const vacated = store.leave('host')
  assert.equal(vacated?.room?.hostId, 'guest')
  assert.deepEqual(vacated?.room?.playerIds, ['guest'])

  const closed = store.leave('guest')
  assert.equal(closed?.code, 'ABCD')
  assert.deepEqual(closed?.room?.playerIds, [])
  assert.equal(store.drop('ABCD'), true)
  assert.equal(store.get('ABCD'), undefined)
  assert.equal(store.has('ABCD'), false)
  assert.equal(store.drop('ABCD'), false)
})

test('codeFor reports the room a player is in', () => {
  const store = createRoomStore()
  assert.equal(store.codeFor('host'), undefined)
  assert.equal(store.create('host', 'ABCD').ok, true)
  assert.equal(store.codeFor('host'), 'ABCD')
  assert.equal(store.join('guest', 'ABCD').ok, true)
  assert.equal(store.codeFor('guest'), 'ABCD')
  store.leave('host')
  assert.equal(store.codeFor('host'), undefined)
  assert.equal(store.codeFor('guest'), 'ABCD')
})

test('join keeps the deck when the room is waiting for someone to return', () => {
  const store = createRoomStore()
  assert.equal(store.create('host', 'ABCD').ok, true)
  assert.equal(store.selectDeck('host', 'dinosaurs', decks).ok, true)
  assert.equal(store.leave('host')?.room?.playerIds.length, 0)

  const returned = store.join('host-again', 'ABCD')
  assert.equal(returned.ok, true)
  if (!returned.ok) return
  assert.equal(returned.room.hostId, 'host-again')
  assert.equal(returned.room.deckId, 'dinosaurs')
  assert.deepEqual(returned.room.playerIds, ['host-again'])
  assert.equal(store.drop('ABCD'), false)
})
