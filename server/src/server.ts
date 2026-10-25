import { createReadStream } from 'node:fs'
import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { contentTypeFor, resolveClientFile } from './static.js'

export interface GameServer {
  httpServer: http.Server
  wss: WebSocketServer
}

export function parsePort(value: string | undefined, fallback = 3000): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`)
  }
  return port
}

export function createGameServer(clientDir: string): GameServer {
  const httpServer = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }

    const resolved = resolveClientFile(clientDir, req.url ?? '/')
    if (!resolved.ok) {
      res.writeHead(resolved.status)
      res.end(resolved.status === 400 ? 'Bad request' : 'Not found')
      return
    }

    res.writeHead(200, { 'Content-Type': contentTypeFor(resolved.filePath) })
    if (req.method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(resolved.filePath).pipe(res)
  })

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  wss.on('connection', (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: 'connected' }))
  })

  return { httpServer, wss }
}

export function listen(gameServer: GameServer, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      gameServer.httpServer.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      gameServer.httpServer.off('error', onError)
      const address = gameServer.httpServer.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    }

    gameServer.httpServer.once('error', onError)
    gameServer.httpServer.once('listening', onListening)
    gameServer.httpServer.listen(port)
  })
}

export function closeGameServer(gameServer: GameServer): Promise<void> {
  for (const client of gameServer.wss.clients) {
    client.close()
  }

  return new Promise((resolve, reject) => {
    gameServer.wss.close((websocketError) => {
      gameServer.httpServer.close((httpError) => {
        const error = websocketError ?? httpError
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  })
}
