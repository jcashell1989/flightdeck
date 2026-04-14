import { safeHandle } from './_helpers'
import { tdReader } from '../td/reader'

let _tdWatcherDispose: (() => void) | null = null

export function register(broadcast: (channel: string, payload: unknown) => void): void {
  safeHandle('td:list', async (_e, cwd?: string) => tdReader.list(cwd))
  safeHandle('td:show', async (_e, id: string, cwd?: string) => tdReader.show(id, cwd))
  safeHandle('td:start', async (_e, id: string, cwd?: string) => { await tdReader.start(id, cwd) })
  safeHandle('td:log', async (_e, id: string, message: string, cwd?: string) => { await tdReader.log(id, message, cwd) })
  safeHandle('td:handoff', async (_e, id: string, cwd?: string) => { await tdReader.handoff(id, cwd) })
  safeHandle('td:usage', async (_e, cwd?: string) => tdReader.usage(cwd))

  // Start watching .td/ for changes and push td:change to the renderer.
  _tdWatcherDispose = tdReader.watchStateDir(() => broadcast('td:change', null))
}

export function dispose(): void {
  _tdWatcherDispose?.()
  _tdWatcherDispose = null
}
