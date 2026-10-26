import { useState } from 'react'
import type { RoomState, TableState } from './useGameServer'

export function GameView({
  room,
  playerId,
  table,
  notice,
  onChoose,
  onLeave,
}: {
  room: RoomState
  playerId: string
  table: TableState
  notice: string
  onChoose: (attributeIndex: number) => boolean
  onLeave: () => void
}) {
  const yourTurn = table.phase === 'playing' && table.currentPlayerId === playerId
  const turnKey = [
    table.phase,
    table.currentPlayerId ?? '',
    table.you.topCard?.name ?? '',
    table.lastResult?.winnerId ?? '',
    String(table.lastResult?.attributeIndex ?? ''),
    String(table.tiePileCount),
  ].join(':')
  const [selected, setSelected] = useState<number | null>(null)
  const [selectedKey, setSelectedKey] = useState(turnKey)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  if (selectedKey !== turnKey) {
    setSelectedKey(turnKey)
    setSelected(null)
    setPendingKey(null)
  }
  const locked = pendingKey === turnKey && notice === ''
  const watching = !table.players.some((player) => player.id === playerId)
  const opponents = table.players.filter((player) => player.id !== playerId)

  function confirm() {
    if (selected === null || locked) return
    if (onChoose(selected)) setPendingKey(turnKey)
  }

  return (
    <div className="play">
      <header className="play-bar">
        <p className="room-chip" aria-label={`Room ${room.code}`}>
          {room.code}
        </p>
        <div className="play-turn">
          <h1 aria-live="polite">{heading(table, room, playerId)}</h1>
          {table.lastResult && (
            <p className="verdict" role="status">
              {verdict(table, room, playerId)}
            </p>
          )}
          {table.lastResult && <p className="scoreline">{scoreline(table, room, playerId)}</p>}
          {watching && <p className="watch">You joined after the deal, so you're watching this game.</p>}
          {notice && (
            <p className="status play-notice" role="status">
              {notice}
            </p>
          )}
        </div>
        <button type="button" className="table-leave" onClick={onLeave}>
          Leave room
        </button>
      </header>

      <section className="play-row" aria-label="Players">
        <div className="seats">
          {opponents.map((player) => (
            <article
              key={player.id}
              className={table.currentPlayerId === player.id ? 'seat is-turn' : 'seat'}
              aria-current={table.currentPlayerId === player.id ? 'true' : undefined}
            >
              <h2>{playerName(player.id, room, playerId)}</h2>
              <CardStack count={player.count} />
              <p className="count">{cardsLabel(player.count)}</p>
            </article>
          ))}
        </div>
        <div className="pile" aria-label="Middle pile">
          <h2>Middle</h2>
          <CardStack count={table.tiePileCount} />
          <p className="count">{table.tiePileCount === 0 ? 'Empty' : cardsLabel(table.tiePileCount)}</p>
        </div>
      </section>

      {!watching && (
        <section
          className={yourTurn ? 'hand is-turn' : 'hand'}
          aria-current={yourTurn ? 'true' : undefined}
          aria-label="Your hand"
        >
          {table.you.topCard ? (
            <article className="playing-card">
              <p className="hand-count">{cardsLabel(table.you.count)}</p>
              <h3>{table.you.topCard.name}</h3>
              <StatRows
                attributes={table.attributes}
                values={table.you.topCard.values}
                selected={selected}
                interactive={yourTurn}
                disabled={locked}
                onSelect={setSelected}
              />
              {yourTurn && (
                <button type="button" className="confirm" disabled={selected === null || locked} onClick={confirm}>
                  {selected === null ? 'Confirm selection' : `Confirm ${table.attributes[selected] ?? 'stat'}`}
                </button>
              )}
            </article>
          ) : (
            <p className="empty-hand">You're out of cards.</p>
          )}
        </section>
      )}
    </div>
  )
}

function StatRows({
  attributes,
  values,
  highlighted = -1,
  selected = null,
  interactive = false,
  disabled = false,
  onSelect,
}: {
  attributes: string[]
  values: number[]
  highlighted?: number
  selected?: number | null
  interactive?: boolean
  disabled?: boolean
  onSelect?: (index: number) => void
}) {
  if (interactive) {
    return (
      <div className="stats">
        {attributes.map((attribute, index) => (
          <button
            key={attribute}
            type="button"
            className={selected === index ? 'attr selected' : 'attr'}
            aria-pressed={selected === index}
            disabled={disabled}
            onClick={() => onSelect?.(index)}
          >
            <span>{attribute}</span>
            <span>{values[index] ?? '—'}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <ul className="stats">
      {attributes.map((attribute, index) => (
        <li key={attribute} className={highlighted === index ? 'attr highlighted' : 'attr'}>
          <span>{attribute}</span>
          <span>{values[index] ?? '—'}</span>
        </li>
      ))}
    </ul>
  )
}

function CardStack({ count }: { count: number }) {
  if (count <= 0) return <div className="stack empty" aria-hidden="true" />
  const shown = Math.min(count, 3)
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: shown }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}

function cardsLabel(count: number): string {
  return count === 1 ? '1 card' : `${count} cards`
}

function playerName(id: string, room: RoomState, selfId: string): string {
  if (id === selfId) return 'You'
  const index = room.players.findIndex((player) => player.id === id)
  const player = index >= 0 ? room.players[index] : undefined
  if (player && player.nickname !== '') return player.nickname
  return `Player ${index >= 0 ? index + 1 : '?'}`
}

function heading(table: TableState, room: RoomState, playerId: string): string {
  if (table.phase === 'finished') {
    if (!table.winnerId) return 'The game is a draw'
    if (table.winnerId === playerId) return 'You win'
    return `${playerName(table.winnerId, room, playerId)} wins`
  }
  if (table.currentPlayerId === playerId) return 'Your turn'
  if (table.currentPlayerId) return `${playerName(table.currentPlayerId, room, playerId)}'s turn`
  return 'Top Trumps'
}

function scoreline(table: TableState, room: RoomState, playerId: string): string {
  const result = table.lastResult
  if (!result) return ''
  return result.plays.map((play) => `${playerName(play.id, room, playerId)} ${play.value}`).join(' · ')
}

function verdict(table: TableState, room: RoomState, playerId: string): string {
  const result = table.lastResult
  if (!result) return ''
  const attribute = table.attributes[result.attributeIndex] ?? 'that stat'
  if (result.winnerId === null) {
    if (table.phase === 'finished' && table.winnerId === playerId) {
      return `Draw on ${attribute}. You take the middle pile and win the game.`
    }
    if (table.phase === 'finished' && table.winnerId) {
      return `Draw on ${attribute}. ${playerName(table.winnerId, room, playerId)} takes the middle pile and wins the game.`
    }
    if (table.phase === 'finished') return `Draw on ${attribute}. The game is a draw.`
    return `Draw on ${attribute}. The cards go to the middle.`
  }

  const pile = result.awardedPile > 0 ? ', including the middle pile' : ''
  const game = table.phase === 'finished' ? ' The game is over.' : ''
  if (result.winnerId === playerId) return `You win the round on ${attribute}${pile}.${game}`
  return `${playerName(result.winnerId, room, playerId)} wins the round on ${attribute}${pile}.${game}`
}

