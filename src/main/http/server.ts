import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { timingSafeEqual, createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { join, extname } from 'path'
import { existsSync } from 'fs'
import type { OpencodeSnapshotPayload } from '../../shared/types'

export interface DispatchArgs {
  profileId: string
  directory: string
  prompt: string
}

export type PermissionResponse = 'once' | 'always' | 'reject'

export interface HttpServerDeps {
  getSnapshot: () => OpencodeSnapshotPayload
  onSnapshotChange: (cb: () => void) => () => void
  dispatch: (args: DispatchArgs) => Promise<{ sessionId: string }>
  respond: (sessionId: string, permissionId: string, response: PermissionResponse) => Promise<void>
  abort: (sessionId: string) => Promise<void>
  getToken: () => string
  getMobileRoot: () => string
}

function safeTokenCompare(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

type Env = {
  Variables: {
    authSource: 'bearer' | 'cookie'
  }
}

export function createApp(deps: HttpServerDeps): Hono<Env> {
  const app = new Hono<Env>()

  // ── Rate limiter ────────────────────────────────────────────────────────
  const rateLimiter = new Map<string, { failures: number; blockedUntil: number }>()
  const FAILURE_WINDOW = 10
  const BLOCK_SECONDS = 60

  function getClientIp(req: { header: (h: string) => string | undefined }): string {
    return (req.header('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  }

  function checkRateLimit(ip: string): { blocked: boolean; retryAfter?: number } {
    const entry = rateLimiter.get(ip)
    if (!entry) return { blocked: false }
    const now = Date.now()
    if (entry.blockedUntil > now) {
      return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) }
    }
    return { blocked: false }
  }

  function recordFailure(ip: string): void {
    const now = Date.now()
    const entry = rateLimiter.get(ip) ?? { failures: 0, blockedUntil: 0 }
    entry.failures += 1
    if (entry.failures >= FAILURE_WINDOW) {
      entry.blockedUntil = now + BLOCK_SECONDS * 1000
      entry.failures = 0
    }
    rateLimiter.set(ip, entry)
  }

  function clearFailures(ip: string): void {
    rateLimiter.delete(ip)
  }

  // ── Middleware ──────────────────────────────────────────────────────────

  const authMiddleware = createMiddleware<Env>(async (c, next) => {
    const ip = getClientIp(c.req)
    const rateCheck = checkRateLimit(ip)
    if (rateCheck.blocked) {
      return c.json({ error: 'too many failed attempts', retryAfter: rateCheck.retryAfter }, 429)
    }

    const token = deps.getToken()
    const authHeader = c.req.header('authorization')
    let source: 'bearer' | 'cookie' | null = null
    let provided: string | null = null

    if (authHeader?.startsWith('Bearer ')) {
      provided = authHeader.slice(7)
      source = 'bearer'
    } else {
      const cookieHeader = c.req.header('cookie')
      if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)fd_token=([^;]*)/)
        if (match?.[1]) {
          provided = decodeURIComponent(match[1])
          source = 'cookie'
        }
      }
    }

    if (!provided || !source || !safeTokenCompare(provided, token)) {
      recordFailure(ip)
      return c.json({ error: 'unauthorized' }, 401)
    }

    clearFailures(ip)
    c.set('authSource', source)
    await next()
  })

  const bearerOnlyMiddleware = createMiddleware<Env>(async (c, next) => {
    if (c.get('authSource') !== 'bearer') {
      return c.json({ error: 'bearer token required for mutating operations' }, 403)
    }
    await next()
  })

  // ── Routes ──────────────────────────────────────────────────────────────

  // Pairing endpoint — not auth protected
  app.get('/pair', (c) => {
    const queryToken = c.req.query('token')
    if (!queryToken || !safeTokenCompare(queryToken, deps.getToken())) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    setCookie(c, 'fd_token', queryToken, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
    return c.redirect('/', 302)
  })

  // Snapshot endpoint
  app.get('/api/snapshot', authMiddleware, (c) => {
    return c.json(deps.getSnapshot())
  })

  // SSE events endpoint
  app.get('/api/events', authMiddleware, (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = deps.onSnapshotChange(() => {
        void stream.writeSSE({
          data: JSON.stringify(deps.getSnapshot()),
          event: 'snapshot'
        })
      })
      await stream.writeSSE({ data: JSON.stringify(deps.getSnapshot()), event: 'snapshot' })
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve)
      })
      unsub()
    })
  })

  // Dispatch endpoint — bearer only
  app.post('/api/dispatch', authMiddleware, bearerOnlyMiddleware, async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'body must be an object' }, 400)
    }
    const b = body as Record<string, unknown>
    if (typeof b['profileId'] !== 'string' || typeof b['directory'] !== 'string' || typeof b['prompt'] !== 'string') {
      return c.json({ error: 'profileId, directory, and prompt are required strings' }, 400)
    }
    const result = await deps.dispatch({
      profileId: b['profileId'],
      directory: b['directory'],
      prompt: b['prompt'],
    })
    return c.json({ sessionId: result.sessionId })
  })

  // Session respond endpoint — bearer only
  app.post('/api/session/:id/respond', authMiddleware, bearerOnlyMiddleware, async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'body must be an object' }, 400)
    }
    const b = body as Record<string, unknown>
    if (typeof b['permissionId'] !== 'string') {
      return c.json({ error: 'permissionId is required' }, 400)
    }
    if (b['response'] !== 'once' && b['response'] !== 'always' && b['response'] !== 'reject') {
      return c.json({ error: 'response must be once, always, or reject' }, 400)
    }
    const sessionId = c.req.param('id')
    await deps.respond(sessionId, b['permissionId'], b['response'] as PermissionResponse)
    return c.json({ ok: true })
  })

  // Session abort endpoint — bearer only
  app.post('/api/session/:id/abort', authMiddleware, bearerOnlyMiddleware, async (c) => {
    const sessionId = c.req.param('id')
    await deps.abort(sessionId)
    return c.json({ ok: true })
  })

  // Static file serving (mobile client)
  app.get('/*', async (c) => {
    const mobileRoot = deps.getMobileRoot()
    const filePath = c.req.path === '/' ? '/index.html' : c.req.path
    // Security: prevent path traversal
    const resolved = join(mobileRoot, filePath)
    if (!resolved.startsWith(mobileRoot)) {
      return c.text('Forbidden', 403)
    }
    if (!existsSync(resolved)) {
      const indexPath = join(mobileRoot, 'index.html')
      if (!existsSync(indexPath)) return c.text('Mobile client not built', 503)
      const html = await readFile(indexPath, 'utf8')
      return c.html(html)
    }
    const content = await readFile(resolved)
    const ext = extname(resolved).toLowerCase()
    return new Response(content, {
      headers: { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' }
    })
  })

  return app
}
