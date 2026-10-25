This repo is to reproduce a lightweight but customisable version of the card game Top Trumps. This is a game in which a deck of cards exists with each card having N attributes, usually 5-7. Each attribute is numerical, and each player in the game is equally distributed cards from the deck of typically 30. A turn proceeds by having the players whose turn it currently is selecting one of these attributes and declaring it's value from the card at the top of his hand. Every other player similarly calls out their value of the same attribute and the winner of the turn is the player with the highest value. In the case of a tie all cards in the turn go to the middle pile and are collected by the winner of the next successful turn. The winner of the full game is the one who gets all of the cards in his hand.

Players join a room with a five-character code such as `A1B2C`. The host picks the deck, and that room plays the rules above.

## Architecture

The repo is one npm package at the root (`"type": "module"`). It needs Node.js 20.19 or newer, or Node.js 22.12 or newer. The client is built locally with Vite and the Node.js server serves that build.

- `client/` is the React and TypeScript UI. Vite's root is this directory (`client/vite.config.ts`), and `npm run build` writes the production files to `dist/client`. The dev server listens on port 5173 and proxies `/ws` to `http://localhost:3000`. The lobby checks that a room code matches the `A1B2C` shape.
- `server/` is the Node.js HTTP and WebSocket server, using the `ws` package. `server/src/index.ts` serves `dist/client` and listens on `PORT`, which defaults to 3000.
  - `server.ts` creates the HTTP server and a WebSocket server on `/ws`. A new socket receives `{ "type": "connected" }`.
  - `static.ts` resolves client files inside the build directory, blocks paths that escape it, and falls back to `index.html` for application routes such as `/room/A1B2C`.
  - `deck.ts` validates a deck object and loads one from disk. A deck needs a name, at least one unique attribute, and at least two cards whose numeric values line up with those attributes.
  - `roomCode.ts` generates and checks room codes in the form letter, digit, letter, digit, letter.
- `decks/` holds the JSON decks the server validates. `decks/dinosaurs.json` is the sample deck.

Dealing cards, taking turns, and awarding the tie pile are still to be built on this server. Keep that game logic on the server, and keep the client as the UI that talks to it over WebSockets.

Unit tests cover server logic only. They live beside the server modules as `server/src/*.test.ts` and run with `node:test` through `tsx`. Test every server function with at least one test.

## Commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `npm run dev:client` | Vite dev server on port 5173, proxying `/ws` to the game server |
| `npm run dev:server` | Game server with reload, on port 3000 |
| `npm run build` | Typecheck and compile the client into `dist/client` |
| `npm run build:client` | Same as `npm run build` |
| `npm start` | Serve the built client over HTTP and WebSocket |
| `npm test` | Server unit tests |
| `npm run typecheck` | Typecheck the client and the server without emitting files |
