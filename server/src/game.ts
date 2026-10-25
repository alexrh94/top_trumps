import type { Deck } from './deck.js'

export interface Card {
  name: string
  values: number[]
}

export interface GameState {
  attributes: string[]
  order: string[]
  hands: Map<string, Card[]>
  turn: number
  tiePile: Card[]
  phase: 'playing' | 'finished'
  winnerId: string | null
  lastResult: TurnResult | null
}

export interface TurnResult {
  attributeIndex: number
  plays: Array<{ playerId: string; card: Card }>
  winnerId: string | null
  awardedPile: number
}

export interface PlayView {
  id: string
  name: string
  values: number[]
  value: number
}

export interface ResultView {
  attributeIndex: number
  winnerId: string | null
  awardedPile: number
  plays: PlayView[]
}

export interface GameView {
  phase: 'playing' | 'finished'
  attributes: string[]
  currentPlayerId: string | null
  tiePileCount: number
  winnerId: string | null
  you: { count: number; topCard: Card | null }
  players: Array<{ id: string; count: number }>
  lastResult: ResultView | null
}

export type NewGame = { ok: true; game: GameState } | { ok: false; error: string }

export type ActionResult = { ok: true } | { ok: false; error: string }

function copyCard(card: Card): Card {
  return { name: card.name, values: [...card.values] }
}

function handCount(game: GameState, playerId: string): number {
  return game.hands.get(playerId)?.length ?? 0
}

function activePlayers(game: GameState): string[] {
  return game.order.filter((id) => handCount(game, id) > 0)
}

function moveTurnTo(game: GameState, startIndex: number): void {
  const count = game.order.length
  if (count === 0) {
    game.turn = 0
    return
  }

  for (let step = 0; step < count; step += 1) {
    const index = (startIndex + step) % count
    const id = game.order[index]
    if (id && handCount(game, id) > 0) {
      game.turn = index
      return
    }
  }

  game.turn = ((startIndex % count) + count) % count
}

function finishIfDecided(game: GameState): boolean {
  const remaining = activePlayers(game)
  if (remaining.length > 1) return false

  const winner = remaining[0]
  if (winner) {
    const hand = game.hands.get(winner)
    if (hand && game.tiePile.length > 0) {
      hand.push(...game.tiePile)
      game.tiePile = []
    }
    game.winnerId = winner
    const index = game.order.indexOf(winner)
    if (index >= 0) game.turn = index
  } else {
    game.winnerId = null
  }

  game.phase = 'finished'
  return true
}

export function createGame(playerIds: readonly string[], deck: Deck, random: () => number = Math.random): NewGame {
  if (playerIds.length < 2) {
    return { ok: false, error: 'At least two players are needed to start.' }
  }

  const handSize = Math.floor(deck.cards.length / playerIds.length)
  if (handSize < 1) {
    return { ok: false, error: 'This deck does not have enough cards for every player.' }
  }

  const shuffled = shuffleCards(deck.cards, random)
  const hands = new Map<string, Card[]>()
  for (const id of playerIds) hands.set(id, [])

  const dealt = handSize * playerIds.length
  for (let index = 0; index < dealt; index += 1) {
    const card = shuffled[index]
    const playerId = playerIds[index % playerIds.length]
    if (!card || !playerId) continue
    hands.get(playerId)?.push(card)
  }

  return {
    ok: true,
    game: {
      attributes: [...deck.attributes],
      order: [...playerIds],
      hands,
      turn: 0,
      tiePile: [],
      phase: 'playing',
      winnerId: null,
      lastResult: null,
    },
  }
}

function shuffleCards(cards: readonly Card[], random: () => number): Card[] {
  const copy = cards.map(copyCard)
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const current = copy[index]
    const other = copy[swap]
    if (!current || !other) continue
    copy[index] = other
    copy[swap] = current
  }
  return copy
}

export function playAttribute(game: GameState, playerId: string, attributeIndex: number): ActionResult {
  if (game.phase !== 'playing') {
    return { ok: false, error: 'The game is already over.' }
  }

  const current = game.order[game.turn]
  if (current !== playerId) {
    return { ok: false, error: 'It is not your turn.' }
  }

  if (!Number.isInteger(attributeIndex) || attributeIndex < 0 || attributeIndex >= game.attributes.length) {
    return { ok: false, error: "Choose one of the card's attributes." }
  }

  const contenders = activePlayers(game)
  if (contenders.length < 2) {
    finishIfDecided(game)
    return { ok: true }
  }

  const plays: TurnResult['plays'] = []
  for (const id of contenders) {
    const card = game.hands.get(id)?.shift()
    if (!card) continue
    plays.push({ playerId: id, card })
  }

  let best = Number.NEGATIVE_INFINITY
  for (const play of plays) {
    const value = play.card.values[attributeIndex] ?? Number.NEGATIVE_INFINITY
    if (value > best) best = value
  }

  const winners = plays.filter((play) => (play.card.values[attributeIndex] ?? Number.NEGATIVE_INFINITY) === best)
  const winner = winners.length === 1 ? winners[0] : undefined

  if (winner) {
    const awardedPile = game.tiePile.length
    const won = [...plays.map((play) => play.card), ...game.tiePile]
    game.tiePile = []
    game.hands.get(winner.playerId)?.push(...won)
    game.lastResult = { attributeIndex, plays, winnerId: winner.playerId, awardedPile }
  } else {
    game.tiePile.push(...plays.map((play) => play.card))
    game.lastResult = { attributeIndex, plays, winnerId: null, awardedPile: 0 }
  }

  if (!finishIfDecided(game)) {
    moveTurnTo(game, game.turn + 1)
  }

  return { ok: true }
}

export function removePlayer(game: GameState, playerId: string): void {
  const index = game.order.indexOf(playerId)
  if (index < 0) return

  if (game.phase === 'finished') {
    game.order.splice(index, 1)
    game.hands.delete(playerId)
    if (game.turn >= game.order.length) game.turn = 0
    return
  }

  const currentId = game.order[game.turn]
  const held = game.hands.get(playerId)
  if (held && held.length > 0) game.tiePile.push(...held)
  game.hands.delete(playerId)
  game.order.splice(index, 1)

  if (game.order.length === 0) {
    game.phase = 'finished'
    game.winnerId = null
    game.turn = 0
    return
  }

  if (currentId === playerId) {
    moveTurnTo(game, index)
  } else {
    const next = currentId ? game.order.indexOf(currentId) : 0
    moveTurnTo(game, next < 0 ? 0 : next)
  }

  finishIfDecided(game)
}

export function viewFor(game: GameState, playerId: string): GameView {
  const hand = game.hands.get(playerId) ?? []
  const top = hand[0]
  const current = game.order[game.turn]
  const result = game.lastResult

  return {
    phase: game.phase,
    attributes: [...game.attributes],
    currentPlayerId: game.phase === 'playing' && current ? current : null,
    tiePileCount: game.tiePile.length,
    winnerId: game.winnerId,
    you: {
      count: hand.length,
      topCard: top ? copyCard(top) : null,
    },
    players: game.order.map((id) => ({ id, count: handCount(game, id) })),
    lastResult: result
      ? {
          attributeIndex: result.attributeIndex,
          winnerId: result.winnerId,
          awardedPile: result.awardedPile,
          plays: result.plays.map((play) => ({
            id: play.playerId,
            name: play.card.name,
            values: [...play.card.values],
            value: play.card.values[result.attributeIndex] ?? 0,
          })),
        }
      : null,
  }
}
