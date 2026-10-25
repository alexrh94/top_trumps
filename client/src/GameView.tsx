import { useState } from 'react'
import type { GamePlay, RoomState, TableState } from './useGameServer'

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
  const best = table.lastResult ? Math.max(...table.lastResult.plays.map((play) => play.value)) : null

  function confirm() {
    if (selected === null || locked) return
    if (onChoose(selected)) setPendingKey(turnKey)
  }

  return (
    <>
      <header className="table-head">
        <div>
          <p className="eyebrow">Room {room.code}</p>
          <h1 aria-live="polite">{heading(table, room, playerId)}</h1>
          <p className="lede">{subhead(table, yourTurn, watching)}</p>
        </div>
        <button type="button" className="table-leave" onClick={onLeave}>
          Leave room
        </button>
      </header>

      {watching && <p className="lede watch">You joined after the deal, so you're watching this game.</p>}

      <section className="seats" aria-label="Other players">
        {opponents.map((player) => (
          <article
            key={player.id}
            className={table.currentPlayerId === player.id ? 'seat is-turn' : 'seat'}
            aria-current={table.currentPlayerId === player.id ? 'true' : undefined}
          >
            <h2>{playerName(player.id, room, playerId)}</h2>
            <p className="turn-flag">{table.currentPlayerId === player.id ? 'Their turn' : ''}</p>
            <CardFan count={player.count} />
            <p className="count">{cardsLabel(player.count)}</p>
          </article>
        ))}
      </section>

      <section className="center">
        {table.lastResult && (
          <div className="reveal">
            <h2 className="verdict" role="status">
              {verdict(table, room, playerId)}
            </h2>
            <div className="reveal-row">
              {table.lastResult.plays.map((play) => (
                <RevealCard
                  key={play.id}
                  play={play}
                  attributes={table.attributes}
                  label={revealLabel(play, table, room, playerId, best)}
                  won={play.id === table.lastResult?.winnerId}
                  highlighted={table.lastResult?.attributeIndex ?? -1}
                />
              ))}
            </div>
          </div>
        )}
        <div className={table.tiePileCount > 0 ? 'pile has-cards' : 'pile'} aria-label="Middle pile">
          <h2>Middle pile</h2>
          <CardFan count={table.tiePileCount} />
          <p className="count">{table.tiePileCount === 0 ? 'Empty' : cardsLabel(table.tiePileCount)}</p>
        </div>
      </section>

      {!watching && (
        <section className={yourTurn ? 'self is-turn' : 'self'} aria-current={yourTurn ? 'true' : undefined}>
          <div className="self-copy">
            <h2>Your hand</h2>
            <p className="turn-flag">{yourTurn ? 'Choose a stat' : table.phase === 'playing' ? 'Face down for everyone else' : ''}</p>
            <p className="count">{cardsLabel(table.you.count)}</p>
          </div>
          <div className="own-row">
            {table.you.count > 1 && <CardFan count={table.you.count - 1} />}
            {table.you.topCard ? (
              <article className="playing-card">
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
          </div>
        </section>
      )}

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}
    </>
  )
}

function RevealCard({
  play,
  attributes,
  label,
  won,
  highlighted,
}: {
  play: GamePlay
  attributes: string[]
  label: string
  won: boolean
  highlighted: number
}) {
  return (
    <article className={won ? 'playing-card won' : 'playing-card'}>
      <p className="who">{label}</p>
      <h3>{play.name}</h3>
      <StatRows attributes={attributes} values={play.values} highlighted={highlighted} />
    </article>
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

function CardFan({ count }: { count: number }) {
  if (count <= 0) return <div className="fan empty" aria-hidden="true" />
  const step = 1.15
  return (
    <div className="fan" style={{ width: `${3 + (count - 1) * step}rem` }} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} style={{ left: `${index * step}rem` }} />
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

function subhead(table: TableState, yourTurn: boolean, watching: boolean): string {
  if (table.phase === 'finished') return 'Every remaining card is in one hand.'
  if (watching) return 'Hands stay face down until a stat is called.'
  if (yourTurn) return 'Pick a stat on your top card, then confirm it.'
  return 'Your top card stays visible. Everyone else is face down until the stat is called.'
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

function revealLabel(play: GamePlay, table: TableState, room: RoomState, playerId: string, best: number | null): string {
  const name = playerName(play.id, room, playerId)
  if (play.id === table.lastResult?.winnerId) return `${name} · wins`
  if (table.lastResult?.winnerId === null && play.value === best) return `${name} · tie`
  return name
}
