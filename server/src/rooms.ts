import { isValidRoomCode } from './roomCode.js'

export interface PublicRoom {
  code: string
  hostId: string
  deckId: string | null
  playerIds: string[]
}

export interface RoomChange {
  code: string
  room: PublicRoom | null
}

export type RoomResult =
  | { ok: true; room: PublicRoom; previous: RoomChange | null }
  | { ok: false; error: string }

export interface RoomStore {
  create(hostId: string, code: string): RoomResult
  join(playerId: string, code: string): RoomResult
  selectDeck(playerId: string, deckId: string, knownDeckIds: ReadonlySet<string>): RoomResult
  leave(playerId: string): RoomChange | null
  drop(code: string): boolean
  get(code: string): PublicRoom | undefined
  has(code: string): boolean
  codeFor(playerId: string): string | undefined
}

interface InternalRoom {
  code: string
  hostId: string
  deckId: string | null
  playerIds: string[]
}

function snapshot(room: InternalRoom): PublicRoom {
  return {
    code: room.code,
    hostId: room.hostId,
    deckId: room.deckId,
    playerIds: [...room.playerIds],
  }
}

export function createRoomStore(): RoomStore {
  const rooms = new Map<string, InternalRoom>()
  const membership = new Map<string, string>()

  function removePlayer(playerId: string): RoomChange | null {
    const code = membership.get(playerId)
    if (!code) return null

    membership.delete(playerId)
    const room = rooms.get(code)
    if (!room) return { code, room: null }

    room.playerIds = room.playerIds.filter((id) => id !== playerId)
    if (room.playerIds.length === 0) {
      room.hostId = ''
      return { code, room: snapshot(room) }
    }

    if (room.hostId === playerId) {
      room.hostId = room.playerIds[0] ?? room.hostId
    }

    return { code, room: snapshot(room) }
  }

  return {
    has(code) {
      return rooms.has(code)
    },

    get(code) {
      const room = rooms.get(code)
      return room ? snapshot(room) : undefined
    },

    create(hostId, code) {
      if (!isValidRoomCode(code)) {
        return { ok: false, error: 'Room codes are four letters, like ABCD.' }
      }
      if (rooms.has(code)) {
        return { ok: false, error: 'That room code is already in use.' }
      }

      const previous = removePlayer(hostId)
      const room: InternalRoom = {
        code,
        hostId,
        deckId: null,
        playerIds: [hostId],
      }
      rooms.set(code, room)
      membership.set(hostId, code)
      return { ok: true, room: snapshot(room), previous }
    },

    join(playerId, code) {
      const normalized = code.trim().toUpperCase()
      if (!isValidRoomCode(normalized)) {
        return { ok: false, error: 'Room codes are four letters, like ABCD.' }
      }

      const room = rooms.get(normalized)
      if (!room) {
        return { ok: false, error: `No room with code ${normalized}.` }
      }

      if (membership.get(playerId) === normalized) {
        return { ok: true, room: snapshot(room), previous: null }
      }

      const previous = removePlayer(playerId)
      if (room.playerIds.length === 0) room.hostId = playerId
      room.playerIds.push(playerId)
      membership.set(playerId, normalized)
      return { ok: true, room: snapshot(room), previous }
    },

    selectDeck(playerId, deckId, knownDeckIds) {
      const code = membership.get(playerId)
      const room = code ? rooms.get(code) : undefined
      if (!room) {
        return { ok: false, error: 'Join a room before choosing a deck.' }
      }
      if (room.hostId !== playerId) {
        return { ok: false, error: 'Only the host can choose the deck.' }
      }
      if (!knownDeckIds.has(deckId)) {
        return { ok: false, error: 'That deck is not available.' }
      }

      room.deckId = deckId
      return { ok: true, room: snapshot(room), previous: null }
    },

    leave(playerId) {
      return removePlayer(playerId)
    },

    drop(code) {
      const room = rooms.get(code)
      if (!room || room.playerIds.length > 0) return false
      rooms.delete(code)
      return true
    },

    codeFor(playerId) {
      return membership.get(playerId)
    },
  }
}
