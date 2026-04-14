import { spawn } from 'child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { TdUsageResult } from '../../shared/types'

export interface TdTicket {
  id: string
  title: string
  description: string
  status: 'open' | 'in_progress' | 'in_review' | 'approved' | 'closed'
  priority: string
  type: string
  created_at: string
  updated_at: string
  implementer_session: string
  logs: Array<{ message: string; timestamp: string; type: string; session: string }>
}

function runTd(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('td', args, { cwd })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('close', (code: number) => {
      if (code !== 0) reject(new Error(err || `td exited ${code}`))
      else resolve(out)
    })
  })
}

export class TdReader {
  async list(cwd?: string): Promise<TdTicket[]> {
    const dir = cwd ?? process.cwd()
    try {
      const out = await runTd(['list', '--format', 'json'], dir)
      return JSON.parse(out) as TdTicket[]
    } catch {
      return []
    }
  }

  async show(id: string, cwd?: string): Promise<TdTicket | null> {
    const dir = cwd ?? process.cwd()
    try {
      const out = await runTd(['show', id, '--format', 'json'], dir)
      return JSON.parse(out) as TdTicket
    } catch {
      return null
    }
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
      return JSON.parse(out) as TdUsageResult
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
