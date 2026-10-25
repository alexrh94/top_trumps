This repo is to reproduce a lightweight but customisable version of the card game Top Trumps. This is a game in which a deck of cards exists with each card having N attributes, usually 5-7. Each attribute is numerical, and each player in the game is equally distributed cards from the deck of typically 30. A turn proceeds by having the players whose turn it currently is selecting one of these attributes and declaring it's value from the card at the top of his hand. Every other player similarly calls out their value of the same attribute and the winner of the turn is the player with the highest value. In the case of a tie all cards in the turn go to the middle pile and are collected by the winner of the next successful turn. The winner of the full game is the one who gets all of the cards in his hand.

Players join a room with a four-letter code such as `ABCD`. The host picks the deck, and that room plays the rules above.

## Architecture

The repo is one npm package at the root (`"type": "module"`). It needs Node.js 20.19 or newer, or Node.js 22.12 or newer. The client is built locally with Vite and the Node.js server serves that build. The client and server have separate TypeScript configs, so do not import server modules into the client.

- `client/` is the React and TypeScript UI. Vite's root is this directory (`client/vite.config.ts`), and `npm run build` writes the production files to `dist/client`. The dev server listens on port 5173 and proxies `/ws` to `http://localhost:3000`. `App.tsx` is the lobby and the room screen. `useGameServer.ts` owns the WebSocket.
- `server/` is the Node.js HTTP and WebSocket server, using the `ws` package. `server/src/index.ts` serves `dist/client`, reads `decks/`, and listens on `PORT`, which defaults to 3000.
  - `server.ts` creates the HTTP server and a WebSocket server on `/ws`. It turns socket messages into room changes and is the only place that knows which socket belongs to which player.
  - `static.ts` resolves client files inside the build directory, blocks paths that escape it, and falls back to `index.html` for application routes such as `/room/ABCD`.
  - `deck.ts` validates a deck object, loads one from disk, and lists the decks in a directory. A deck needs a name, at least one unique attribute, and at least two cards whose numeric values line up with those attributes. `listDecks` uses each `*.json` file name without the extension as the id (`dinosaurs.json` becomes `dinosaurs`) and the deck's own name as the label. A non-JSON file is ignored. An invalid JSON deck makes the whole list throw.
  - `roomCode.ts` generates and checks room codes made of four uppercase letters. The server generates the code when a room is created and skips codes that are already taken, including rooms waiting out their empty-room grace period.
  - `rooms.ts` keeps membership only: who is in a room, who the host is, and which deck id is selected. Nicknames live on the socket in `server.ts`, not in the room store.
- `decks/` holds the JSON decks the server validates. `decks/dinosaurs.json` is the sample deck. Deck files are not served as static HTTP files. The client only hears about them over the socket.

Dealing cards, taking turns, and awarding the tie pile are still to be built on this server. Keep that game logic on the server, and keep the client as the UI that talks to it over WebSockets.

## Rooms

The lobby has a nickname box above the room code. Both are optional to start a game: an empty nickname is allowed, and Join is what checks the code. Creating a room or joining one sends the current nickname. The client stores it in `sessionStorage` under `top-trumps-nickname`, so leaving or refreshing can send the same name again. The server trims it, collapses whitespace, strips control characters, and keeps at most 24 characters. Duplicate nicknames are allowed. On the room screen a blank name is shown as "You" or "Player N"; a set name is shown as typed, with "(you)" on your own row and ", host" on the host.

The player who creates the room is the host. Only the host can choose a deck, and the choice has to be an id from the current deck list. The chosen deck starts unset. A player is in at most one room: creating or joining another room removes them from the previous one and tells whoever is left.

If the host leaves, the next player in join order becomes host and the chosen deck stays. When the last player leaves, the room stays open for 15 seconds so a refresh of `/room/ABCD` can rejoin the same code, keep the deck, and become host. After that the room is deleted. Joining a code that does not exist stays on the lobby with an error.

The browser address is `/room/` plus the code. The socket client joins that code on connect, using the stored nickname. Both Vite and the static server serve `index.html` for that path.

## WebSocket messages

A new socket receives `{ "type": "connected", "playerId": "..." }` and then `{ "type": "decks", "decks": [{ "id": "dinosaurs", "name": "Dinosaurs" }] }`.

Client messages:

| Message | Meaning |
| --- | --- |
| `{ "type": "create_room", "nickname": "Alex" }` | Open a room. The server picks the code. |
| `{ "type": "join_room", "code": "ABCD", "nickname": "Sam" }` | Join a room. The code is trimmed and uppercased. |
| `{ "type": "select_deck", "deckId": "dinosaurs" }` | Host chooses the deck. |
| `{ "type": "leave_room" }` | Leave the current room. |

A room update is `{ "type": "room", "code": "ABCD", "deckId": null, "hostId": "...", "playerIds": ["..."], "players": [{ "id": "...", "nickname": "Alex" }] }`. `deckId` is `null` until the host chooses. `playerIds` is join order and matches `players`. Failures are `{ "type": "error", "message": "..." }`, including an unknown code, a guest choosing the deck, or an unknown deck id. A failed join does not change the nickname already stored for that socket.

## Tests

Unit tests cover server logic only. They live beside the server modules as `server/src/*.test.ts` and run with `node:test` through `tsx`. Test every server function with at least one test. `npm test` lists those files explicitly, so a new test file has to be added to the `test` script in `package.json`.

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
