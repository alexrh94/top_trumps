import { useState, type FormEvent } from 'react'

const ROOM_CODE = /^[A-Z][0-9][A-Z][0-9][A-Z]$/

export function App() {
  const [roomCode, setRoomCode] = useState('')
  const [message, setMessage] = useState('Ask the host for a code such as A1B2C.')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = roomCode.trim().toUpperCase()
    if (!ROOM_CODE.test(code)) {
      setMessage('Room codes are five characters, like A1B2C.')
      return
    }
    setMessage(`Room ${code} is ready to join when the game server is running.`)
  }

  return (
    <main className="lobby">
      <div className="cards" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="eyebrow">Online card game</p>
      <h1>Top Trumps</h1>
      <p className="lede">
        Each player gets an equal share of the deck. Call a stat on your top card, and the highest value wins the pile.
      </p>
      <form className="join" onSubmit={handleSubmit}>
        <label htmlFor="room-code">Room code</label>
        <div className="join-row">
          <input
            id="room-code"
            name="roomCode"
            value={roomCode}
            autoComplete="off"
            spellCheck={false}
            maxLength={5}
            placeholder="A1B2C"
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
          />
          <button type="submit">Join room</button>
        </div>
        <p className="status" role="status">
          {message}
        </p>
      </form>
    </main>
  )
}
