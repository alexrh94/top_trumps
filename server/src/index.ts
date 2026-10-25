import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGameServer, listen, parsePort } from './server.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const port = parsePort(process.env.PORT)
const gameServer = createGameServer(join(root, 'dist', 'client'))
const actualPort = await listen(gameServer, port)

console.log(`Top Trumps listening on http://localhost:${actualPort}`)
