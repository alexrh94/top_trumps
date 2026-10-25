import { useState, type FormEvent } from 'react'
import {
  readNickname,
  useGameServer,
  type Connection,
  type DeckChoice,
  type RoomPlayer,
  type RoomState,
} from './useGameServer'

const ROOM_CODE = /^[A-Z]{4}$/

export function App() {
  const game = useGameServer()

  return (
    <main className="lobby">
      <div className="cards" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {game.room && game.playerId ? (
        <RoomView
          room={game.room}
          playerId={game.playerId}
          decks={game.decks}
          notice={game.notice}
          onSelectDeck={game.selectDeck}
          onLeave={game.leaveRoom}
        />
      ) : (
        <LobbyView
          notice={game.notice}
          connection={game.connection}
          onCreate={game.createRoom}
          onJoin={game.joinRoom}
        />
      )}
    </main>
  )
}

function LobbyView({
  notice,
  connection,
  onCreate,
  onJoin,
}: {
  notice: string
  connection: Connection
  onCreate: (nickname: string) => void
  onJoin: (code: string, nickname: string) => void
}) {
  const [nickname, setNickname] = useState(readNickname)
  const [roomCode, setRoomCode] = useState('')
  const [localMessage, setLocalMessage] = useState<string | null>(null)
  const connected = connection === 'open'
  const message = connected ? (localMessage ?? notice) : notice

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = roomCode.trim().toUpperCase()
    if (!ROOM_CODE.test(code)) {
      setLocalMessage('Room codes are four letters, like ABCD.')
      return
    }
    setLocalMessage(null)
    onJoin(code, nickname)
  }

  return (
    <>
      <p className="eyebrow">Online card game</p>
      <h1>Top Trumps</h1>
      <p className="lede">
        Each player gets an equal share of the deck. Call a stat on your top card, and the highest value wins the pile.
      </p>
      <form className="join" onSubmit={handleSubmit}>
        <label htmlFor="nickname">Nickname</label>
        <input
          id="nickname"
          className="name"
          name="nickname"
          value={nickname}
          autoComplete="nickname"
          maxLength={24}
          placeholder="Alex"
          onChange={(event) => setNickname(event.target.value)}
        />
        <label htmlFor="room-code">Room code</label>
        <div className="join-row">
          <input
            id="room-code"
            className="code"
            name="roomCode"
            value={roomCode}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={4}
            placeholder="ABCD"
            onChange={(event) => {
              setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))
            }}
          />
          <button type="submit" disabled={!connected}>
            Join room
          </button>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setLocalMessage(null)
            onCreate(nickname)
          }}
          disabled={!connected}
        >
          Create room
        </button>
        <p className="status" role="status">
          {message}
        </p>
      </form>
    </>
  )
}

function RoomView({
  room,
  playerId,
  decks,
  notice,
  onSelectDeck,
  onLeave,
}: {
  room: RoomState
  playerId: string
  decks: DeckChoice[]
  notice: string
  onSelectDeck: (deckId: string) => void
  onLeave: () => void
}) {
  const isHost = room.hostId === playerId
  const hint = room.deckId
    ? ''
    : isHost
      ? 'Choose a deck for this room.'
      : 'Waiting for the host to choose a deck.'
  const message = notice || hint

  return (
    <>
      <p className="eyebrow">Room code</p>
      <h1 className="room-code">{room.code}</h1>
      <p className="lede">Share this code with the other players. The host chooses the deck.</p>
      <section className="join">
        <div className="field">
          <label htmlFor="deck">Deck</label>
          {decks.length === 0 ? (
            <p className="status">No decks are available.</p>
          ) : (
            <select
              id="deck"
              name="deck"
              value={room.deckId ?? ''}
              disabled={!isHost}
              onChange={(event) => {
                if (event.target.value) onSelectDeck(event.target.value)
              }}
            >
              <option value="" disabled>
                Select a deck
              </option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <h2 className="section">Players</h2>
        <ul className="players">
          {room.players.map((player, index) => (
            <li key={player.id}>{playerLabel(player, index, playerId, room.hostId)}</li>
          ))}
        </ul>
        <button type="button" className="secondary" onClick={onLeave}>
          Leave room
        </button>
        <p className="status" role="status">
          {message}
        </p>
      </section>
    </>
  )
}

function playerLabel(player: RoomPlayer, index: number, playerId: string, hostId: string): string {
  const named = player.nickname !== ''
  const name = named ? player.nickname : player.id === playerId ? 'You' : `Player ${index + 1}`
  const label = named && player.id === playerId ? `${name} (you)` : name
  return player.id === hostId ? `${label}, host` : label
}
