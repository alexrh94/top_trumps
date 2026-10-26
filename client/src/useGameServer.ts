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

export interface GameCard {
  name: string
  values: number[]
}

export interface GameSeat {
  id: string
  count: number
}

export interface GamePlay {
  id: string
  name: string
  values: number[]
  value: number
}

export interface GameResult {
  attributeIndex: number
  winnerId: string | null
  awardedPile: number
  plays: GamePlay[]
}

export interface TableState {
  phase: 'playing' | 'finished'
  attributes: string[]
  currentPlayerId: string | null
  tiePileCount: number
  winnerId: string | null
  you: { count: number; topCard: GameCard | null }
  players: GameSeat[]
  lastResult: GameResult | null
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isGameCard(value: unknown): value is GameCard {
  return isRecord(value) && typeof value.name === 'string' && Array.isArray(value.values) && value.values.every(isFiniteNumber)
}

function isGameSeat(value: unknown): value is GameSeat {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.count === 'number' &&
    Number.isInteger(value.count) &&
    value.count >= 0
  )
}

function isGamePlay(value: unknown): value is GamePlay {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.values) &&
    value.values.every(isFiniteNumber) &&
    isFiniteNumber(value.value)
  )
}

function readTable(value: unknown): TableState | null {
  if (!isRecord(value) || value.type !== 'game') return null
  if (value.phase !== 'playing' && value.phase !== 'finished') return null
  if (!isStringArray(value.attributes)) return null
  if (typeof value.currentPlayerId !== 'string' && value.currentPlayerId !== null) return null
  if (typeof value.tiePileCount !== 'number' || !Number.isInteger(value.tiePileCount) || value.tiePileCount < 0) {
    return null
  }
  if (typeof value.winnerId !== 'string' && value.winnerId !== null) return null
  if (!isRecord(value.you) || typeof value.you.count !== 'number' || !Number.isInteger(value.you.count)) return null
  if (value.you.count < 0) return null
  if (value.you.topCard !== null && !isGameCard(value.you.topCard)) return null
  if (!Array.isArray(value.players)) return null

  const players: GameSeat[] = []
  for (const player of value.players) {
    if (!isGameSeat(player)) return null
    players.push({ id: player.id, count: player.count })
  }

  let lastResult: GameResult | null = null
  if (value.lastResult !== null) {
    if (!isRecord(value.lastResult)) return null
    const result = value.lastResult
    if (typeof result.attributeIndex !== 'number' || !Number.isInteger(result.attributeIndex)) return null
    if (typeof result.winnerId !== 'string' && result.winnerId !== null) return null
    if (typeof result.awardedPile !== 'number' || !Number.isInteger(result.awardedPile) || result.awardedPile < 0) {
      return null
    }
    if (!Array.isArray(result.plays)) return null
    const plays: GamePlay[] = []
    for (const play of result.plays) {
      if (!isGamePlay(play)) return null
      plays.push({ id: play.id, name: play.name, values: [...play.values], value: play.value })
    }
    lastResult = {
      attributeIndex: result.attributeIndex,
      winnerId: result.winnerId,
      awardedPile: result.awardedPile,
      plays,
    }
  }

  const topCard = value.you.topCard
  return {
    phase: value.phase,
    attributes: [...value.attributes],
    currentPlayerId: value.currentPlayerId,
    tiePileCount: value.tiePileCount,
    winnerId: value.winnerId,
    you: {
      count: value.you.count,
      topCard: isGameCard(topCard) ? { name: topCard.name, values: [...topCard.values] } : null,
    },
    players,
    lastResult,
  }
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
  const [table, setTable] = useState<TableState | null>(null)
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
        if (roomRef.current?.code !== next.code) setTable(null)
        rememberRoom(next)
        const path = `/room/${next.code}`
        if (window.location.pathname !== path) {
          window.history.pushState(null, '', path)
        }
        setNotice('')
        return
      }

      const tableState = readTable(message)
      if (message.type === 'game') {
        if (tableState && acceptRoomRef.current) {
          setTable(tableState)
          setNotice('')
        }
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
      setTable(null)
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
      setTable(null)
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
    setTable(null)
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/')
    }
    setNotice('Ask the host for a four-letter code, or create a room.')
  }, [rememberRoom, send])

  const startGame = useCallback(
    (deckId?: string) => {
      const message = typeof deckId === 'string' ? { type: 'start_game', deckId } : { type: 'start_game' }
      if (!send(message)) return false
      setNotice('')
      return true
    },
    [send],
  )

  const chooseAttribute = useCallback(
    (attributeIndex: number) => {
      if (!send({ type: 'choose_attribute', attributeIndex })) return false
      setNotice('')
      return true
    },
    [send],
  )

  return {
    connection,
    playerId,
    decks,
    room,
    table,
    notice,
    createRoom,
    joinRoom,
    selectDeck,
    leaveRoom,
    startGame,
    chooseAttribute,
  }
}
