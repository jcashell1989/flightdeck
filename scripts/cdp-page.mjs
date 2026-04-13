/**
 * Minimal CDP page wrapper for Electron 41+ (Chrome 146).
 *
 * Playwright's connectOverCDP hangs because Chrome 146 doesn't respond to
 * Target.setAutoAttach the way Playwright expects. This module uses Node's
 * built-in WebSocket (Node 21+) to connect directly to the page-level CDP
 * endpoint, bypassing Playwright entirely.
 *
 * The exported API surface mirrors the Playwright Page/Locator API used by
 * uat.mjs so no test logic needs to change.
 */
import { writeFileSync } from 'fs'

// CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
const MODIFIERS = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }
const KEY_CODES = {
  Escape: 27, Tab: 9, Enter: 13, Backspace: 8, Space: 32,
  0: 48, 1: 49, 2: 50, 3: 51, 4: 52, 5: 53, 6: 54, 7: 55, 8: 56, 9: 57,
  a: 65, b: 66, c: 67, d: 68, e: 69, f: 70, g: 71, h: 72, i: 73, j: 74,
  k: 75, l: 76, m: 77, n: 78, o: 79, p: 80, q: 81, r: 82, s: 83, t: 84,
  u: 85, v: 86, w: 87, x: 88, y: 89, z: 90,
}

// ── Selector helpers ──────────────────────────────────────────────────────────

function buildSelectorExpr(sel) {
  if (sel.startsWith('text=')) {
    const raw = sel.slice(5)
    const reMatch = raw.match(/^\/(.+)\/([gimsuy]*)$/)
    if (reMatch) {
      const [, pattern, flags] = reMatch
      return `Array.from(document.querySelectorAll('*')).filter(el => {
        try { return new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)}).test(el.innerText ?? '') }
        catch { return false }
      })`
    }
    return `Array.from(document.querySelectorAll('*')).filter(el => (el.innerText ?? '').includes(${JSON.stringify(raw)}))`
  }
  // Regular CSS — wrap in try/catch so invalid selectors return []
  return `(() => { try { return Array.from(document.querySelectorAll(${JSON.stringify(sel)})) } catch { return [] } })()`
}

function buildFilterExpr(baseExpr, filter) {
  if (!filter?.hasText) return baseExpr
  const ht = filter.hasText
  if (ht instanceof RegExp) {
    return `(${baseExpr}).filter(el => {
      try { return new RegExp(${JSON.stringify(ht.source)}, ${JSON.stringify(ht.flags)}).test(el.innerText ?? '') }
      catch { return false }
    })`
  }
  return `(${baseExpr}).filter(el => (el.innerText ?? '').includes(${JSON.stringify(String(ht))}))`
}

// ── CDPLocator ────────────────────────────────────────────────────────────────

class CDPLocator {
  constructor(page, sel, filterOpt = null, index = null) {
    this._page = page
    this._sel = sel
    this._filter = filterOpt
    this._index = index
  }

  _expr() {
    let expr = buildSelectorExpr(this._sel)
    if (this._filter) expr = buildFilterExpr(expr, this._filter)
    if (this._index !== null) {
      // Wrap the nth element in an array; return [] if out of bounds
      expr = `(() => { const el = (${expr})[${this._index}]; return el ? [el] : [] })()`
    }
    return expr
  }

  filter(opts) {
    return new CDPLocator(this._page, this._sel, opts, this._index)
  }

  first() {
    return new CDPLocator(this._page, this._sel, this._filter, 0)
  }

  async count() {
    try {
      const n = await this._page.evaluate(`(${this._expr()}).length`)
      return typeof n === 'number' ? n : 0
    } catch { return 0 }
  }

  async all() {
    try {
      const n = await this.count()
      return Array.from({ length: n }, (_, i) =>
        new CDPLocator(this._page, this._sel, this._filter, i)
      )
    } catch { return [] }
  }

  async click() {
    const boundsStr = await this._page.evaluate(`
      (() => {
        const el = (${this._expr()})[0]
        if (!el) return null
        const r = el.getBoundingClientRect()
        return JSON.stringify({left: r.left, top: r.top, width: r.width, height: r.height})
      })()
    `).catch(() => null)
    if (!boundsStr) throw new Error(`CDPLocator.click: element not found — ${this._sel}`)
    const b = JSON.parse(boundsStr)
    await this._page.mouse.click(b.left + b.width / 2, b.top + b.height / 2)
  }

  async fill(text) {
    // Click to focus, Ctrl+A to select all, then insertText (fires React input events)
    await this.click()
    const page = this._page
    const ctrlA = { key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 }
    await page._send('Input.dispatchKeyEvent', { type: 'keyDown', ...ctrlA })
    await page._send('Input.dispatchKeyEvent', { type: 'keyUp', ...ctrlA })
    await page._send('Input.insertText', { text })
    // Trigger React's synthetic input event so state updates
    await page.evaluate(`
      (() => {
        const el = (${this._expr()})[0]
        if (!el) return
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (nativeInputSetter) nativeInputSetter.call(el, ${JSON.stringify(text)})
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })()
    `).catch(() => {})
  }
}

// ── CDP page factory ──────────────────────────────────────────────────────────

export async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let cmdId = 1
    const pending = new Map()
    const consoleListeners = []

    const page = {
      _ws: ws,

      _send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = cmdId++
          const timer = setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id)
              rej(new Error(`CDP timeout (10s): ${method}`))
            }
          }, 10000)
          pending.set(id, { res, rej, timer })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },

      async evaluate(fnOrExpr) {
        const expr = typeof fnOrExpr === 'function'
          ? `(${fnOrExpr.toString()})()`
          : String(fnOrExpr)
        try {
          const r = await this._send('Runtime.evaluate', {
            expression: expr,
            returnByValue: true,
            awaitPromise: false,
          })
          if (r.exceptionDetails) return undefined
          return r.result?.value
        } catch { return undefined }
      },

      async title() {
        return this.evaluate('document.title')
      },

      async screenshot({ path: p, fullPage = false } = {}) {
        try {
          const r = await this._send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: fullPage,
          })
          if (p && r?.data) writeFileSync(p, Buffer.from(r.data, 'base64'))
        } catch { /* screenshots are best-effort */ }
      },

      on(event, cb) {
        if (event === 'console') consoleListeners.push(cb)
      },

      locator(sel) {
        return new CDPLocator(page, sel)
      },

      async click(sel) {
        if (!sel || sel === 'body') {
          // Blur active element without clicking interactive content at center-screen
          await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
        } else {
          await page.locator(sel).first().click()
        }
      },

      keyboard: {
        press: async (key) => {
          const parts = key.split('+')
          let modifiers = 0
          const keyName = parts[parts.length - 1]
          for (let i = 0; i < parts.length - 1; i++) {
            modifiers |= MODIFIERS[parts[i]] ?? 0
          }
          // Uppercase letter → shift modifier
          const isUpper = keyName.length === 1 && keyName >= 'A' && keyName <= 'Z'
          if (isUpper) modifiers |= 8
          const lk = keyName.toLowerCase()
          const keyCode = KEY_CODES[lk] ?? KEY_CODES[keyName] ?? 0
          const code = keyName.length === 1 ? `Key${keyName.toUpperCase()}` : keyName
          const text = keyName.length === 1 ? keyName : undefined
          const base = { modifiers, key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
          await page._send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) })
          if (text) {
            await page._send('Input.dispatchKeyEvent', { type: 'char', modifiers, key: text, text })
          }
          await page._send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
        }
      },

      mouse: {
        click: async (x, y, opts = {}) => {
          const base = { x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1, clickCount: 1, modifiers: 0, ...opts }
          await page._send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' })
          await page._send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' })
        }
      },

      close: async () => ws.close(),
    }

    ws.onmessage = (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { res, rej, timer } = pending.get(msg.id)
        clearTimeout(timer)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(msg.error.message))
        else res(msg.result ?? {})
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const args = msg.params?.args ?? []
        const text = args.map(a => a.value !== undefined ? String(a.value) : a.description ?? '').join(' ')
        const type = msg.params?.type ?? 'log'
        consoleListeners.forEach(cb => cb({ type: () => type, text: () => text }))
      }
    }

    ws.onerror = (err) => reject(new Error(`CDP WebSocket error: ${err.message ?? String(err)}`))

    ws.onopen = async () => {
      try {
        await Promise.all([
          page._send('Runtime.enable'),
          page._send('Page.enable'),
        ])
        resolve(page)
      } catch (e) {
        reject(e)
      }
    }
  })
}

export async function getPageCDPUrl(host = 'http://localhost:9222') {
  const targets = await fetch(`${host}/json/list`).then(r => r.json())
  const t = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
    ?? targets.find(t => t.webSocketDebuggerUrl)
  if (!t) throw new Error(`No CDP target found at ${host}/json/list. Is the app running with --remote-debugging-port=9222?`)
  return t.webSocketDebuggerUrl
}
