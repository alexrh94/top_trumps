import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Deck } from './deck.js'
import { createGame, nextTurn, playAttribute, removePlayer, viewFor, type GameState } from './game.js'

const identity = () => 0.999999999

function deck(cards: Deck['cards'], attributes: string[] = ['A', 'B']): Deck {
  return { name: 'Test', attributes, cards }
}

function started(playerIds: string[], cards: Deck['cards'], attributes?: string[], random: () => number = identity): GameState {
  const created = createGame(playerIds, deck(cards, attributes), random)
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('expected a game')
  return created.game
}

function names(game: GameState, playerId: string): string[] {
  return (game.hands.get(playerId) ?? []).map((card) => card.name)
}

test('createGame deals equal hands and leaves a short remainder undealt', () => {
  const game = started(['a', 'b'], [
    { name: 'One', values: [1, 9] },
    { name: 'Two', values: [1, 3] },
    { name: 'Three', values: [5, 4] },
    { name: 'Four', values: [0, 8] },
    { name: 'Five', values: [4, 2] },
  ])

  assert.deepEqual(names(game, 'a'), ['One', 'Three'])
  assert.deepEqual(names(game, 'b'), ['Two', 'Four'])
  assert.equal(JSON.stringify([...game.hands.values()]).includes('Five'), false)
  assert.equal(game.order[game.turn], 'a')
  assert.deepEqual(game.attributes, ['A', 'B'])

  const view = viewFor(game, 'a')
  assert.equal(view.you.topCard?.name, 'One')
  assert.equal(JSON.stringify(view).includes('Two'), false)
  assert.equal(JSON.stringify(view).includes('Three'), false)
  view.you.topCard!.values[0] = 999
  assert.equal(game.hands.get('a')?.[0]?.values[0], 1)
})

test('createGame shuffles with the supplied random source', () => {
  const game = started(
    ['a', 'b'],
    [
      { name: 'One', values: [1] },
      { name: 'Two', values: [2] },
      { name: 'Three', values: [3] },
      { name: 'Four', values: [4] },
    ],
    ['A'],
    () => 0,
  )

  assert.deepEqual(names(game, 'a'), ['Two', 'Four'])
  assert.deepEqual(names(game, 'b'), ['Three', 'One'])
})

test('createGame rejects too few players or too few cards', () => {
  const cards = [
    { name: 'One', values: [1] },
    { name: 'Two', values: [2] },
  ]
  assert.equal(createGame(['a'], deck(cards, ['A'])).ok, false)
  assert.equal(createGame(['a', 'b', 'c'], deck(cards, ['A'])).ok, false)
})

test('playAttribute leaves the trick on the table until the next turn', () => {
  const game = started(['a', 'b'], [
    { name: 'One', values: [1, 9] },
    { name: 'Two', values: [1, 3] },
    { name: 'Three', values: [5, 4] },
    { name: 'Four', values: [0, 8] },
  ])

  assert.deepEqual(playAttribute(game, 'b', 1), { ok: false, error: 'It is not your turn.' })
  assert.deepEqual(names(game, 'a'), ['One', 'Three'])
  assert.deepEqual(playAttribute(game, 'a', 1.5), { ok: false, error: "Choose one of the card's attributes." })
  assert.deepEqual(playAttribute(game, 'a', -1), { ok: false, error: "Choose one of the card's attributes." })
  assert.deepEqual(playAttribute(game, 'a', 2), { ok: false, error: "Choose one of the card's attributes." })
  assert.deepEqual(nextTurn(game), { ok: false, error: 'There is no turn to continue.' })

  assert.deepEqual(playAttribute(game, 'a', 1), { ok: true })
  assert.equal(game.phase, 'reveal')
  assert.deepEqual(names(game, 'a'), ['Three'])
  assert.deepEqual(names(game, 'b'), ['Four'])
  assert.equal(game.tiePile.length, 0)
  assert.equal(game.order[game.turn], 'a')
  assert.deepEqual(playAttribute(game, 'b', 1), { ok: false, error: 'The cards are still on the table.' })
  assert.deepEqual(names(game, 'b'), ['Four'])

  const view = viewFor(game, 'b')
  assert.equal(view.phase, 'reveal')
  assert.equal(view.currentPlayerId, 'a')
  assert.equal(view.you.topCard?.name, 'Four')
  assert.equal(view.you.count, 1)
  assert.deepEqual(view.lastResult, {
    attributeIndex: 1,
    winnerId: 'a',
    awardedPile: 0,
    plays: [
      { id: 'a', name: 'One', values: [1, 9], value: 9 },
      { id: 'b', name: 'Two', values: [1, 3], value: 3 },
    ],
  })
  assert.equal(JSON.stringify(view).includes('Three'), false)

  assert.deepEqual(nextTurn(game), { ok: true })
  assert.equal(game.phase, 'playing')
  assert.deepEqual(names(game, 'a'), ['Three', 'One', 'Two'])
  assert.deepEqual(names(game, 'b'), ['Four'])
  assert.equal(game.tiePile.length, 0)
  assert.equal(game.order[game.turn], 'b')
  assert.equal(game.lastResult, null)

  const next = viewFor(game, 'b')
  assert.equal(next.currentPlayerId, 'b')
  assert.equal(next.you.topCard?.name, 'Four')
  assert.equal(next.lastResult, null)
  assert.equal(JSON.stringify(next).includes('Three'), false)
  assert.equal(JSON.stringify(next).includes('One'), false)
})

test('a draw parks every card in the middle and the next winner collects them', () => {
  const game = started(['a', 'b'], [
    { name: 'One', values: [1, 9] },
    { name: 'Two', values: [1, 3] },
    { name: 'Three', values: [5, 4] },
    { name: 'Four', values: [0, 8] },
  ])

  assert.equal(playAttribute(game, 'a', 0).ok, true)
  assert.equal(game.phase, 'reveal')
  assert.deepEqual(names(game, 'a'), ['Three'])
  assert.deepEqual(names(game, 'b'), ['Four'])
  assert.equal(game.tiePile.length, 0)
  assert.equal(game.lastResult?.winnerId, null)
  assert.equal(viewFor(game, 'a').tiePileCount, 0)

  assert.equal(nextTurn(game).ok, true)
  assert.deepEqual(
    game.tiePile.map((card) => card.name),
    ['One', 'Two'],
  )
  assert.equal(game.order[game.turn], 'b')
  assert.equal(game.phase, 'playing')
  assert.equal(viewFor(game, 'a').tiePileCount, 2)

  assert.equal(playAttribute(game, 'b', 1).ok, true)
  assert.equal(game.phase, 'reveal')
  assert.equal(game.lastResult?.awardedPile, 2)
  assert.equal(viewFor(game, 'b').tiePileCount, 2)
  assert.equal(nextTurn(game).ok, true)
  assert.deepEqual(names(game, 'b'), ['Three', 'Four', 'One', 'Two'])
  assert.deepEqual(names(game, 'a'), [])
  assert.equal(game.tiePile.length, 0)
  assert.equal(game.phase, 'finished')
  assert.equal(game.winnerId, 'b')
  assert.equal(game.lastResult?.awardedPile, 2)

  const finished = viewFor(game, 'b')
  assert.equal(finished.phase, 'finished')
  assert.equal(finished.currentPlayerId, null)
  assert.equal(finished.winnerId, 'b')
  assert.equal(finished.you.count, 4)
  assert.equal(finished.you.topCard?.name, 'Three')
  assert.deepEqual(playAttribute(game, 'b', 1), { ok: false, error: 'The game is already over.' })
  assert.deepEqual(names(game, 'b'), ['Three', 'Four', 'One', 'Two'])
})

test('a shared high value is a draw even when another card is lower', () => {
  const game = started(
    ['a', 'b', 'c'],
    [
      { name: 'A1', values: [5] },
      { name: 'B1', values: [5] },
      { name: 'C1', values: [1] },
      { name: 'A2', values: [2] },
      { name: 'B2', values: [3] },
      { name: 'C2', values: [4] },
    ],
    ['A'],
  )

  assert.equal(playAttribute(game, 'a', 0).ok, true)
  assert.equal(game.phase, 'reveal')
  assert.equal(game.lastResult?.winnerId, null)
  assert.equal(game.tiePile.length, 0)
  assert.equal(nextTurn(game).ok, true)
  assert.deepEqual(
    game.tiePile.map((card) => card.name),
    ['A1', 'B1', 'C1'],
  )
  assert.deepEqual(names(game, 'a'), ['A2'])
  assert.deepEqual(names(game, 'b'), ['B2'])
  assert.deepEqual(names(game, 'c'), ['C2'])
})

test('the highest value wins when the numbers are negative', () => {
  const game = started(
    ['a', 'b'],
    [
      { name: 'Low', values: [-2] },
      { name: 'Lower', values: [-5] },
    ],
    ['A'],
  )

  assert.equal(playAttribute(game, 'a', 0).ok, true)
  assert.equal(game.phase, 'reveal')
  assert.equal(game.winnerId, null)
  assert.equal(nextTurn(game).ok, true)
  assert.equal(game.winnerId, 'a')
  assert.equal(game.phase, 'finished')
  assert.deepEqual(names(game, 'a'), ['Low', 'Lower'])
})

test('a draw that knocks out every opponent awards the pile and the game', () => {
  const game = started(
    ['a', 'b'],
    [
      { name: 'A1', values: [5] },
      { name: 'B1', values: [4] },
      { name: 'A2', values: [1] },
      { name: 'B2', values: [1] },
      { name: 'A3', values: [2] },
      { name: 'B3', values: [2] },
    ],
    ['A'],
  )

  assert.equal(playAttribute(game, 'a', 0).ok, true)
  assert.equal(nextTurn(game).ok, true)
  assert.equal(game.winnerId, null)
  assert.equal(playAttribute(game, 'b', 0).ok, true)
  assert.equal(game.lastResult?.winnerId, null)
  assert.equal(nextTurn(game).ok, true)
  assert.equal(playAttribute(game, 'a', 0).ok, true)
  assert.equal(game.phase, 'reveal')
  assert.equal(game.lastResult?.winnerId, null)
  assert.equal(nextTurn(game).ok, true)
  assert.equal(game.phase, 'finished')
  assert.equal(game.winnerId, 'a')
  assert.equal(game.lastResult?.winnerId, null)
  assert.equal(game.tiePile.length, 0)
  assert.deepEqual(names(game, 'a'), ['A1', 'B1', 'A2', 'B2', 'A3', 'B3'])
  assert.deepEqual(names(game, 'b'), [])
})

test('the last cards tying ends the game as a draw', () => {
  const game = started(
    ['a', 'b'],
    [
      { name: 'One', values: [4] },
      { name: 'Two', values: [4] },
    ],
    ['A'],
  )

  assert.equal(playAttribute(game, 'a', 0).ok, true)
  assert.equal(game.phase, 'reveal')
  assert.equal(viewFor(game, 'a').you.count, 0)
  assert.equal(viewFor(game, 'a').tiePileCount, 0)
  assert.equal(nextTurn(game).ok, true)
  assert.equal(game.phase, 'finished')
  assert.equal(game.winnerId, null)
  assert.deepEqual(
    game.tiePile.map((card) => card.name),
    ['One', 'Two'],
  )
  assert.equal(viewFor(game, 'a').you.count, 0)
  assert.equal(viewFor(game, 'a').tiePileCount, 2)
})

test('players with no cards are skipped and do not play a card', () => {
  const game = started(
    ['a', 'b', 'c'],
    [
      { name: 'A1', values: [1] },
      { name: 'B1', values: [9] },
      { name: 'C1', values: [3] },
      { name: 'A2', values: [7] },
      { name: 'B2', values: [4] },
      { name: 'C2', values: [2] },
    ],
    ['A'],
  )

  assert.equal(playAttribute(game, 'a', 0).ok, true)
  assert.equal(game.phase, 'reveal')
  assert.equal(game.order[game.turn], 'a')
  assert.equal(nextTurn(game).ok, true)
  assert.equal(game.order[game.turn], 'b')
  assert.equal(playAttribute(game, 'b', 0).ok, true)
  assert.equal(nextTurn(game).ok, true)
  assert.deepEqual(names(game, 'a'), ['A2', 'B2', 'C2'])
  assert.deepEqual(names(game, 'b'), ['A1', 'B1', 'C1'])
  assert.deepEqual(names(game, 'c'), [])
  assert.equal(viewFor(game, 'a').currentPlayerId, 'a')

  assert.equal(playAttribute(game, 'a', 0).ok, true)
  assert.deepEqual(
    game.lastResult?.plays.map((play) => play.card.name),
    ['A2', 'A1'],
  )
  assert.equal(game.lastResult?.winnerId, 'a')
  assert.equal(game.phase, 'reveal')
  assert.equal(game.order[game.turn], 'a')
  assert.equal(nextTurn(game).ok, true)
  assert.equal(game.order[game.turn], 'b')
  assert.equal(viewFor(game, 'c').players.find((player) => player.id === 'c')?.count, 0)
})

test('removePlayer parks that hand on the pile and the last player wins it', () => {
  const game = started(['a', 'b'], [
    { name: 'One', values: [1] },
    { name: 'Two', values: [2] },
    { name: 'Three', values: [3] },
    { name: 'Four', values: [4] },
  ], ['A'])
  const before = viewFor(game, 'a')
  removePlayer(game, 'missing')
  assert.deepEqual(viewFor(game, 'a'), before)

  removePlayer(game, 'b')
  assert.equal(game.phase, 'finished')
  assert.equal(game.winnerId, 'a')
  assert.deepEqual(names(game, 'a'), ['One', 'Three', 'Two', 'Four'])
  assert.equal(game.tiePile.length, 0)
  assert.deepEqual(
    viewFor(game, 'a').players.map((player) => player.id),
    ['a'],
  )
})

test('removePlayer hands the turn to the next seated player who still has cards', () => {
  const game = started(
    ['a', 'b', 'c'],
    [
      { name: 'A1', values: [1] },
      { name: 'B1', values: [2] },
      { name: 'C1', values: [3] },
      { name: 'A2', values: [4] },
      { name: 'B2', values: [5] },
      { name: 'C2', values: [6] },
    ],
    ['A'],
  )

  removePlayer(game, 'a')
  assert.equal(game.phase, 'playing')
  assert.equal(viewFor(game, 'b').currentPlayerId, 'b')
  assert.deepEqual(
    game.tiePile.map((card) => card.name),
    ['A1', 'A2'],
  )
  assert.deepEqual(names(game, 'b'), ['B1', 'B2'])
  assert.deepEqual(names(game, 'c'), ['C1', 'C2'])
})

test('leaving during a reveal collects the trick before passing the turn', () => {
  const game = started(
    ['a', 'b', 'c'],
    [
      { name: 'A1', values: [1] },
      { name: 'B1', values: [9] },
      { name: 'C1', values: [3] },
      { name: 'A2', values: [4] },
      { name: 'B2', values: [5] },
      { name: 'C2', values: [6] },
    ],
    ['A'],
  )

  assert.equal(playAttribute(game, 'a', 0).ok, true)
  removePlayer(game, 'c')
  assert.equal(game.phase, 'playing')
  assert.equal(game.lastResult, null)
  assert.equal(game.order[game.turn], 'b')
  assert.deepEqual(names(game, 'a'), ['A2'])
  assert.deepEqual(names(game, 'b'), ['B2', 'A1', 'B1', 'C1'])
  assert.deepEqual(
    game.tiePile.map((card) => card.name),
    ['C2'],
  )

  const chooserLeaves = started(
    ['a', 'b', 'c'],
    [
      { name: 'A1', values: [1] },
      { name: 'B1', values: [9] },
      { name: 'C1', values: [3] },
      { name: 'A2', values: [4] },
      { name: 'B2', values: [5] },
      { name: 'C2', values: [6] },
    ],
    ['A'],
  )
  assert.equal(playAttribute(chooserLeaves, 'a', 0).ok, true)
  removePlayer(chooserLeaves, 'a')
  assert.equal(chooserLeaves.phase, 'playing')
  assert.equal(chooserLeaves.lastResult, null)
  assert.equal(chooserLeaves.order[chooserLeaves.turn], 'b')
  assert.deepEqual(names(chooserLeaves, 'b'), ['B2', 'A1', 'B1', 'C1'])
  assert.deepEqual(names(chooserLeaves, 'c'), ['C2'])
  assert.deepEqual(
    chooserLeaves.tiePile.map((card) => card.name),
    ['A2'],
  )
})
