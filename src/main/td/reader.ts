import { spawn } from 'child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { TdTicket, TdUsageResult } from '../../shared/types'

function runTd(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('td', args, { cwd })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('error', (e: Error) => reject(e))
    proc.on('close', (code: number) => {
      if (code !== 0) reject(new Error(err || `td exited ${code}`))
      else resolve(out)
    })
  })
}

export function parseTdJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(`${context}: ${detail}`)
  }
}

export class TdReader {
  async list(cwd?: string): Promise<TdTicket[]> {
    const dir = cwd ?? process.cwd()
    let out: string
    try {
      out = await runTd(['list', '--format', 'json'], dir)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new Error(`td list failed: ${detail}`)
    }
    return parseTdJson<TdTicket[]>(out, 'failed to parse td list output')
  }

  async show(id: string, cwd?: string): Promise<TdTicket | null> {
    const dir = cwd ?? process.cwd()
    let out: string
    try {
      out = await runTd(['show', id, '--format', 'json'], dir)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new Error(`td show failed for ${id}: ${detail}`)
    }
    return parseTdJson<TdTicket>(out, `failed to parse td show output for ${id}`)
  }

  async start(id: string, cwd?: string): Promise<void> {
    const dir = cwd ?? process.cwd()
    await runTd(['start', id], dir)
  }

  async log(id: string, message: string, cwd?: string): Promise<void> {
    const dir = cwd ?? process.cwd()
    await runTd(['log', id, message], dir)
  }

  async handoff(id: string, cwd?: string): Promise<void> {
    const dir = cwd ?? process.cwd()
    await runTd(['handoff', id], dir)
  }

  async usage(cwd?: string): Promise<TdUsageResult> {
    const dir = cwd ?? process.cwd()
    try {
      const out = await runTd(['usage', '--json'], dir)
      const raw = JSON.parse(out) as Partial<TdUsageResult> & { focused?: TdTicket | null }
      return {
        focused: raw.focused ?? null,
        in_progress: raw.in_progress ?? [],
        ready: raw.ready ?? [],
        reviewable: raw.reviewable ?? [],
      }
    } catch {
      return { focused: null, in_progress: [], ready: [], reviewable: [] }
    }
  }

  watchStateDir(onChange: () => void, cwd?: string): () => void {
    const dir = cwd ?? process.cwd()
    const tdDir = path.join(dir, '.td')

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    let watcher: fs.FSWatcher | null = null
    try {
      watcher = fs.watch(tdDir, { recursive: false }, () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(onChange, 300)
      })
    } catch {
      // .td directory may not exist yet — no-op
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      watcher?.close()
    }
  }
}

export const tdReader = new TdReader()
