import { EventEmitter } from 'events'
import { type Server } from 'http'
import { serve } from '@hono/node-server'
import { createApp, type HttpServerDeps } from './server'

export class HttpServer extends EventEmitter {
  private server: Server | null = null
  private deps: HttpServerDeps

  constructor(deps: HttpServerDeps) {
    super()
    this.deps = deps
  }

  async start(host: string, port: number): Promise<void> {
    if (this.server) await this.stop()
    const app = createApp(this.deps)
    return new Promise<void>((resolve, reject) => {
      try {
        this.server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
          console.log(`[HttpServer] listening on http://${info.address}:${info.port}`)
          this.emit('listening', { host: info.address, port: info.port })
          resolve()
        }) as unknown as Server
        this.server.on('error', (err: NodeJS.ErrnoException) => {
          console.error('[HttpServer] error:', err.message)
          this.emit('error', err)
          reject(err)
        })
      } catch (err) {
        reject(err)
      }
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.server = null
        this.emit('stopped')
        resolve()
      })
    })
  }

  async restart(host: string, port: number): Promise<void> {
    await this.stop()
    await this.start(host, port)
  }
}
