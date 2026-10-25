import { useCallback, useEffect, useRef, useState } from 'react'

export interface DeckChoice {
  id: string
  name: string
}

export interface RoomPlayer {
  id: string
  nickname: string
}

export interface RoomState {
  code: string
  deckId: string | null
  hostId: string
  players: RoomPlayer[]
}

export type Connection = 'connecting' | 'open' | 'closed'

interface ServerEvent {
  type: string
  playerId?: unknown
  decks?: unknown
  code?: unknown
  deckId?: unknown
  hostId?: unknown
  players?: unknown
  message?: unknown
}

const NICKNAME_KEY = 'top-trumps-nickname'

export function readNickname(): string {
  try {
    return sessionStorage.getItem(NICKNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeNickname(nickname: string) {
  try {
    sessionStorage.setItem(NICKNAME_KEY, nickname)
  } catch {
    // The nickname still goes to the server for this visit.
  }
}

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function roomCodeFromPath(pathname: string): string | null {
  const match = /^\/room\/([A-Za-z]{4})\/?$/.exec(pathname)
  return match?.[1] ? match[1].toUpperCase() : null
}

function isDeckChoice(value: unknown): value is DeckChoice {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.name === 'string'
}

function isRoomPlayer(value: unknown): value is RoomPlayer {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.nickname === 'string'
}

function isRoomState(value: ServerEvent): value is ServerEvent & RoomState {
  return (
    value.type === 'room' &&
    typeof value.code === 'string' &&
    (typeof value.deckId === 'string' || value.deckId === null) &&
    typeof value.hostId === 'string' &&
    Array.isArray(value.players) &&
    value.players.every(isRoomPlayer)
  )
}

export function useGameServer() {
  const [connection, setConnection] = useState<Connection>('connecting')
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [decks, setDecks] = useState<DeckChoice[]>([])
  const [room, setRoom] = useState<RoomState | null>(null)
  const [notice, setNotice] = useState('Connecting to the game server…')
  const socketRef = useRef<WebSocket | null>(null)
  const roomRef = useRef<RoomState | null>(null)
  const acceptRoomRef = useRef(true)

  const rememberRoom = useCallback((next: RoomState | null) => {
    roomRef.current = next
    setRoom(next)
  }, [])

  const send = useCallback((message: object) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setNotice('The game server is not connected.')
      return false
    }
    socket.send(JSON.stringify(message))
    return true
  }, [])

  useEffect(() => {
    const socket = new WebSocket(socketUrl())
    socketRef.current = socket
    let active = true

    socket.addEventListener('open', () => {
      if (!active) return
      setConnection('open')
      const code = roomCodeFromPath(window.location.pathname)
      if (code) {
        acceptRoomRef.current = true
        setNotice(`Joining room ${code}…`)
        socket.send(JSON.stringify({ type: 'join_room', code, nickname: readNickname() }))
        return
      }
      setNotice('Ask the host for a four-letter code, or create a room.')
    })

    socket.addEventListener('message', (event) => {
      if (!active) return
      let message: ServerEvent
      try {
        message = JSON.parse(String(event.data)) as ServerEvent
      } catch {
        return
      }

      if (message.type === 'connected' && typeof message.playerId === 'string') {
        setPlayerId(message.playerId)
        return
      }

      if (message.type === 'decks' && Array.isArray(message.decks)) {
        setDecks(message.decks.filter(isDeckChoice))
        return
      }

      if (isRoomState(message)) {
        if (!acceptRoomRef.current) return
        const next = {
          code: message.code,
          deckId: message.deckId,
          hostId: message.hostId,
          players: message.players,
        }
        rememberRoom(next)
        const path = `/room/${next.code}`
        if (window.location.pathname !== path) {
          window.history.pushState(null, '', path)
        }
        setNotice('')
        return
      }

      if (message.type === 'error' && typeof message.message === 'string') {
        setNotice(message.message)
        if (!roomRef.current && roomCodeFromPath(window.location.pathname)) {
          window.history.replaceState(null, '', '/')
        }
      }
    })

    socket.addEventListener('close', () => {
      if (!active) return
      setConnection('closed')
      rememberRoom(null)
      setNotice('The game server disconnected.')
      if (window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/')
      }
    })

    return () => {
      active = false
      if (socketRef.current === socket) socketRef.current = null
      socket.close()
    }
  }, [rememberRoom])

  useEffect(() => {
    function onPopState() {
      const code = roomCodeFromPath(window.location.pathname)
      if (code) {
        acceptRoomRef.current = true
        setNotice(`Joining room ${code}…`)
        send({ type: 'join_room', code, nickname: readNickname() })
        return
      }
      acceptRoomRef.current = false
      send({ type: 'leave_room' })
      rememberRoom(null)
      setNotice('Ask the host for a four-letter code, or create a room.')
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [rememberRoom, send])

  const createRoom = useCallback(
    (nickname: string) => {
      const name = nickname.trim()
      writeNickname(name)
      acceptRoomRef.current = true
      if (!send({ type: 'create_room', nickname: name })) return
      setNotice('Creating a room…')
    },
    [send],
  )

  const joinRoom = useCallback(
    (code: string, nickname: string) => {
      const name = nickname.trim()
      writeNickname(name)
      acceptRoomRef.current = true
      if (!send({ type: 'join_room', code, nickname: name })) return
      setNotice(`Joining room ${code}…`)
    },
    [send],
  )

  const selectDeck = useCallback(
    (deckId: string) => {
      if (!send({ type: 'select_deck', deckId })) return
      setNotice('')
    },
    [send],
  )

  const leaveRoom = useCallback(() => {
    acceptRoomRef.current = false
    send({ type: 'leave_room' })
    rememberRoom(null)
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/')
    }
    setNotice('Ask the host for a four-letter code, or create a room.')
  }, [rememberRoom, send])

  return { connection, playerId, decks, room, notice, createRoom, joinRoom, selectDeck, leaveRoom }
}
