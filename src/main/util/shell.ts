import { execFile } from 'child_process'
import type { OpencodeInstanceClient } from '../opencode/client'
import type { ProcessResult } from '../../shared/types'

export function runCmd(
  cmd: string,
  args: string[],
  cwd: string
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          code: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0
        })
      }
    )
  })
}

/**
 * Reject paths that are empty, non-absolute, contain NULs, or start with a
 * dash — execFile avoids shell injection, but both git and td will interpret
 * a leading-dash path as an option flag.
 */
export function validPath(p: string): boolean {
  return typeof p === 'string' && p.length > 0 && p.startsWith('/') && !p.includes('\0')
}

/**
 * Wait for an OpencodeInstanceClient to reach 'connected' status.
 * Uses .on (not .once) so intermediate 'reconnecting'/'connecting' events
 * don't consume the listener before 'connected' arrives.
 */
export async function waitForClientConnected(
  client: OpencodeInstanceClient,
  timeoutMs = 8000
): Promise<void> {
  if (client.snapshot().status === 'connected') return
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off('status', onStatus)
      reject(new Error('opencode client connect timeout'))
    }, timeoutMs)
    function onStatus(ev: { status: string }): void {
      if (ev.status === 'connected') {
        clearTimeout(timeout)
        client.off('status', onStatus)
        resolve()
      } else if (ev.status === 'error') {
        clearTimeout(timeout)
        client.off('status', onStatus)
        reject(new Error('opencode client error'))
      }
    }
    client.on('status', onStatus)
  })
}
