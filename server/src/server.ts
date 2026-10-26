import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { listDecks, loadDeck, type Deck, type DeckSummary } from './deck.js'
import { createGame, nextTurn, playAttribute, removePlayer, viewFor, type GameState } from './game.js'
import { generateUniqueRoomCode } from './roomCode.js'
import { createRoomStore, type PublicRoom, type RoomChange } from './rooms.js'
import { contentTypeFor, resolveClientFile } from './static.js'

const EMPTY_ROOM_MS = 15_000
const NICKNAME_LIMIT = 24

export interface GameServer {
  httpServer: http.Server
  wss: WebSocketServer
}

export function parsePort(value: string | undefined, fallback = 3000): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`)
  }
  return port
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ClientMessage =
  | { type: 'create_room'; nickname: string }
  | { type: 'join_room'; code: string; nickname: string }
  | { type: 'select_deck'; deckId: string }
  | { type: 'start_game'; deckId: string | null }
  | { type: 'choose_attribute'; attributeIndex: number }
  | { type: 'next_turn' }
  | { type: 'leave_room' }

export function cleanNickname(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICKNAME_LIMIT)
}

function readNickname(value: unknown): string {
  return typeof value === 'string' ? cleanNickname(value) : ''
}

function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'create_room') {
    return { type: 'create_room', nickname: readNickname(value.nickname) }
  }
  if (value.type === 'leave_room') return { type: 'leave_room' }
  if (value.type === 'join_room' && typeof value.code === 'string') {
    return { type: 'join_room', code: value.code, nickname: readNickname(value.nickname) }
  }
  if (value.type === 'select_deck' && typeof value.deckId === 'string') {
    return { type: 'select_deck', deckId: value.deckId }
  }
  if (value.type === 'start_game') {
    return { type: 'start_game', deckId: typeof value.deckId === 'string' ? value.deckId : null }
  }
  if (value.type === 'choose_attribute' && typeof value.attributeIndex === 'number') {
    return { type: 'choose_attribute', attributeIndex: value.attributeIndex }
  }
  if (value.type === 'next_turn') return { type: 'next_turn' }
  return null
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

export function createGameServer(
  clientDir: string,
  decksDir: string,
  emptyRoomMs = EMPTY_ROOM_MS,
  random: () => number = Math.random,
): GameServer {
  const rooms = createRoomStore()
  const games = new Map<string, GameState>()
  const sockets = new Map<string, WebSocket>()
  const nicknames = new Map<string, string>()
  const expirations = new Map<string, NodeJS.Timeout>()

  const httpServer = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }

    const resolved = resolveClientFile(clientDir, req.url ?? '/')
    if (!resolved.ok) {
      res.writeHead(resolved.status)
      res.end(resolved.status === 400 ? 'Bad request' : 'Not found')
      return
    }

    res.writeHead(200, { 'Content-Type': contentTypeFor(resolved.filePath) })
    if (req.method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(resolved.filePath).pipe(res)
  })

  httpServer.on('close', () => {
    for (const timer of expirations.values()) clearTimeout(timer)
    expirations.clear()
  })

  function send(socket: WebSocket, message: object): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }

  function publish(room: PublicRoom | null): void {
    if (!room) return
    cancelExpiry(room.code)
    const message = {
      type: 'room',
      code: room.code,
      deckId: room.deckId,
      hostId: room.hostId,
      playerIds: room.playerIds,
      players: room.playerIds.map((id) => ({
        id,
        nickname: nicknames.get(id) ?? '',
      })),
    }
    for (const playerId of room.playerIds) {
      const socket = sockets.get(playerId)
      if (socket) send(socket, message)
    }

    const game = games.get(room.code)
    if (!game) return
    for (const playerId of room.playerIds) {
      const socket = sockets.get(playerId)
      if (socket) send(socket, { type: 'game', ...viewFor(game, playerId) })
    }
  }

  function cancelExpiry(code: string): void {
    const timer = expirations.get(code)
    if (!timer) return
    clearTimeout(timer)
    expirations.delete(code)
  }

  function scheduleExpiry(code: string): void {
    cancelExpiry(code)
    const timer = setTimeout(() => {
      expirations.delete(code)
      rooms.drop(code)
    }, emptyRoomMs)
    timer.unref()
    expirations.set(code, timer)
  }

  function publishChange(change: RoomChange | null): void {
    if (!change?.room) return
    if (change.room.playerIds.length === 0) {
      games.delete(change.code)
      scheduleExpiry(change.code)
      return
    }
    const game = games.get(change.code)
    if (game) {
      for (const playerId of [...game.order]) {
        if (!change.room.playerIds.includes(playerId)) removePlayer(game, playerId)
      }
    }
    cancelExpiry(change.code)
    publish(change.room)
  }

  function readDeck(deckId: string): { ok: true; deck: Deck } | { ok: false; error: string } {
    if (!/^[A-Za-z0-9_-]+$/.test(deckId)) {
      return { ok: false, error: 'That deck is not available.' }
    }

    let summaries: DeckSummary[]
    try {
      summaries = listDecks(decksDir)
    } catch {
      return { ok: false, error: 'The deck list could not be read.' }
    }
    if (!summaries.some((deck) => deck.id === deckId)) {
      return { ok: false, error: 'That deck is not available.' }
    }

    try {
      return { ok: true, deck: loadDeck(join(decksDir, `${deckId}.json`)) }
    } catch {
      return { ok: false, error: 'That deck is not available.' }
    }
  }

  function sendDeckList(socket: WebSocket): void {
    let decks: DeckSummary[]
    try {
      decks = listDecks(decksDir)
    } catch {
      send(socket, { type: 'error', message: 'The deck list could not be read.' })
      decks = []
    }
    send(socket, { type: 'decks', decks })
  }

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  wss.on('connection', (socket: WebSocket) => {
    const playerId = randomUUID()
    sockets.set(playerId, socket)
    send(socket, { type: 'connected', playerId })
    sendDeckList(socket)

    socket.on('message', (data) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawDataToString(data))
      } catch {
        send(socket, { type: 'error', message: 'Unreadable message.' })
        return
      }

      const message = parseClientMessage(parsed)
      if (!message) {
        send(socket, { type: 'error', message: 'Unreadable message.' })
        return
      }

      if (message.type === 'create_room') {
        const code = generateUniqueRoomCode((candidate) => rooms.has(candidate))
        if (!code) {
          send(socket, { type: 'error', message: 'Could not create a room. Try again.' })
          return
        }
        const result = rooms.create(playerId, code)
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        nicknames.set(playerId, message.nickname)
        publishChange(result.previous)
        publish(result.room)
        return
      }

      if (message.type === 'join_room') {
        const result = rooms.join(playerId, message.code)
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        nicknames.set(playerId, message.nickname)
        publishChange(result.previous)
        publish(result.room)
        return
      }

      if (message.type === 'select_deck') {
        const currentCode = rooms.codeFor(playerId)
        if (currentCode && games.has(currentCode)) {
          send(socket, { type: 'error', message: 'The game has already started.' })
          return
        }
        let knownDeckIds: Set<string>
        try {
          knownDeckIds = new Set(listDecks(decksDir).map((deck) => deck.id))
        } catch {
          send(socket, { type: 'error', message: 'The deck list could not be read.' })
          return
        }
        const result = rooms.selectDeck(playerId, message.deckId, knownDeckIds)
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        publish(result.room)
        return
      }

      if (message.type === 'start_game') {
        const code = rooms.codeFor(playerId)
        const current = code ? rooms.get(code) : undefined
        if (!current || !code) {
          send(socket, { type: 'error', message: 'Join a room before starting a game.' })
          return
        }
        if (current.hostId !== playerId) {
          send(socket, { type: 'error', message: 'Only the host can start the game.' })
          return
        }
        const existing = games.get(code)
        if (existing && existing.phase !== 'finished') {
          send(socket, { type: 'error', message: 'The game has already started.' })
          return
        }
        if (current.playerIds.length < 2) {
          send(socket, { type: 'error', message: 'At least two players are needed to start.' })
          return
        }

        const deckId = message.deckId ?? current.deckId
        if (!deckId) {
          send(socket, { type: 'error', message: 'Choose a deck before starting.' })
          return
        }
        const loaded = readDeck(deckId)
        if (!loaded.ok) {
          send(socket, { type: 'error', message: loaded.error })
          return
        }
        const created = createGame(current.playerIds, loaded.deck, random)
        if (!created.ok) {
          send(socket, { type: 'error', message: created.error })
          return
        }

        let room = current
        if (deckId !== current.deckId) {
          let knownDeckIds: Set<string>
          try {
            knownDeckIds = new Set(listDecks(decksDir).map((deck) => deck.id))
          } catch {
            send(socket, { type: 'error', message: 'The deck list could not be read.' })
            return
          }
          const selected = rooms.selectDeck(playerId, deckId, knownDeckIds)
          if (!selected.ok) {
            send(socket, { type: 'error', message: selected.error })
            return
          }
          room = selected.room
        }

        games.set(code, created.game)
        publish(room)
        return
      }

      if (message.type === 'choose_attribute') {
        const code = rooms.codeFor(playerId)
        const game = code ? games.get(code) : undefined
        if (!game || !code) {
          send(socket, { type: 'error', message: 'The game has not started.' })
          return
        }
        const result = playAttribute(game, playerId, message.attributeIndex)
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        const room = rooms.get(code)
        if (room) publish(room)
        return
      }

      if (message.type === 'next_turn') {
        const code = rooms.codeFor(playerId)
        const game = code ? games.get(code) : undefined
        const room = code ? rooms.get(code) : undefined
        if (!game || !room) {
          send(socket, { type: 'error', message: 'The game has not started.' })
          return
        }
        if (room.hostId !== playerId) {
          send(socket, { type: 'error', message: 'Only the host can start the next turn.' })
          return
        }
        const result = nextTurn(game)
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        publish(room)
        return
      }

      publishChange(rooms.leave(playerId))
    })

    socket.on('close', () => {
      sockets.delete(playerId)
      nicknames.delete(playerId)
      publishChange(rooms.leave(playerId))
    })
  })

  return { httpServer, wss }
}

export function listen(gameServer: GameServer, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      gameServer.httpServer.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      gameServer.httpServer.off('error', onError)
      const address = gameServer.httpServer.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    }

    gameServer.httpServer.once('error', onError)
    gameServer.httpServer.once('listening', onListening)
    gameServer.httpServer.listen(port)
  })
}

export function closeGameServer(gameServer: GameServer): Promise<void> {
  for (const client of gameServer.wss.clients) {
    client.close()
  }

  return new Promise((resolve, reject) => {
    gameServer.wss.close((websocketError) => {
      gameServer.httpServer.close((httpError) => {
        const error = websocketError ?? httpError
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  })
}
