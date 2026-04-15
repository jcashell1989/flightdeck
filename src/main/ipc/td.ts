import { safeHandle } from './_helpers'
import { tdReader } from '../td/reader'
import { TD_DEFAULT_WATCH_KEY } from '../../shared/td'

type TdWatcherEntry = {
  refCount: number
  dispose: () => void
}

function watcherKey(cwd?: string): string {
  return cwd ? `cwd:${cwd}` : TD_DEFAULT_WATCH_KEY
}

export function createTdWatchManager(
  watchStateDir: (onChange: () => void, cwd?: string) => () => void,
  broadcast: (channel: string, payload: unknown) => void,
): { watch: (cwd?: string) => void; unwatch: (cwd?: string) => void; disposeAll: () => void } {
  const watchers = new Map<string, TdWatcherEntry>()

  return {
    watch(cwd?: string): void {
      const key = watcherKey(cwd)
      const current = watchers.get(key)
      if (current) {
        current.refCount += 1
        return
      }
      const dispose = watchStateDir(() => broadcast('td:change', { cwd: cwd ?? null }), cwd)
      watchers.set(key, { refCount: 1, dispose })
    },
    unwatch(cwd?: string): void {
      const key = watcherKey(cwd)
      const current = watchers.get(key)
      if (!current) return
      current.refCount -= 1
      if (current.refCount <= 0) {
        current.dispose()
        watchers.delete(key)
      }
    },
    disposeAll(): void {
      for (const watcher of watchers.values()) watcher.dispose()
      watchers.clear()
    },
  }
}

let _watchManager: ReturnType<typeof createTdWatchManager> | null = null

export function register(broadcast: (channel: string, payload: unknown) => void): void {
  _watchManager?.disposeAll()
  _watchManager = createTdWatchManager((onChange, cwd) => tdReader.watchStateDir(onChange, cwd), broadcast)
  safeHandle('td:list', async (_e, cwd?: string) => tdReader.list(cwd))
  safeHandle('td:show', async (_e, id: string, cwd?: string) => tdReader.show(id, cwd))
  safeHandle('td:start', async (_e, id: string, cwd?: string) => { await tdReader.start(id, cwd) })
  safeHandle('td:log', async (_e, id: string, message: string, cwd?: string) => { await tdReader.log(id, message, cwd) })
  safeHandle('td:handoff', async (_e, id: string, cwd?: string) => { await tdReader.handoff(id, cwd) })
  safeHandle('td:usage', async (_e, cwd?: string) => tdReader.usage(cwd))
  safeHandle('td:watch', async (_e, cwd?: string) => {
    _watchManager?.watch(cwd)
    return { ok: true }
  })

  safeHandle('td:unwatch', async (_e, cwd?: string) => {
    _watchManager?.unwatch(cwd)
    return { ok: true }
  })
}

export function dispose(): void {
  _watchManager?.disposeAll()
  _watchManager = null
}
