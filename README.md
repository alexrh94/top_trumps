# Top Trumps

An online version of the card game Top Trumps. Each card has a set of numeric attributes, and on a turn the current player picks one attribute to compare. The highest value wins the cards in play; ties go to a middle pile that the next winner collects. The game ends when one player holds every card.

Players join a room with a four-letter code. The host picks a deck, and the room plays from there.

## Architecture

The repo is a single npm package. The client and server are separate TypeScript projects and do not import each other.

The client in `client/` is a React app built with Vite. In development it runs on port 5173 and proxies WebSocket traffic to the game server. The server in `server/` is a Node.js HTTP server that also hosts a WebSocket endpoint (`ws`) on `/ws`. It owns rooms, deck selection, and the game itself; the client is only the UI. Deck files live in `decks/` and are sent to clients over the socket, not as static files.

A production build writes the client to `dist/client`. The same server then serves those files and the WebSocket from one process.

Requires Node.js 22.12 or newer.

## Run locally

Install dependencies from the repository root:

```bash
npm install
```

Start the client and the server in two terminals:

```bash
npm run dev:client
```

```bash
npm run dev:server
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies the game connection to the server on port 3000.

## Production

Build the client, then start the server. It serves the built files and the WebSocket on port 3000:

```bash
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000).
