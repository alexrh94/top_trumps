import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import http from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { listDecks, type DeckSummary } from './deck.js'
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
  return null
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

export function createGameServer(clientDir: string, decksDir: string, emptyRoomMs = EMPTY_ROOM_MS): GameServer {
  const rooms = createRoomStore()
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
      scheduleExpiry(change.code)
      return
    }
    cancelExpiry(change.code)
    publish(change.room)
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
