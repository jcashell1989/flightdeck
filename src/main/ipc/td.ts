import { safeHandle } from './_helpers'
import { tdReader } from '../td/reader'

type TdWatcherEntry = {
  refCount: number
  dispose: () => void
}

const _tdWatchers = new Map<string, TdWatcherEntry>()

function watcherKey(cwd?: string): string {
  return cwd ? `cwd:${cwd}` : '\0default'
}

export function register(broadcast: (channel: string, payload: unknown) => void): void {
  safeHandle('td:list', async (_e, cwd?: string) => tdReader.list(cwd))
  safeHandle('td:show', async (_e, id: string, cwd?: string) => tdReader.show(id, cwd))
  safeHandle('td:start', async (_e, id: string, cwd?: string) => { await tdReader.start(id, cwd) })
  safeHandle('td:log', async (_e, id: string, message: string, cwd?: string) => { await tdReader.log(id, message, cwd) })
  safeHandle('td:handoff', async (_e, id: string, cwd?: string) => { await tdReader.handoff(id, cwd) })
  safeHandle('td:usage', async (_e, cwd?: string) => tdReader.usage(cwd))

  safeHandle('td:watch', async (_e, cwd?: string) => {
    const key = watcherKey(cwd)
    const current = _tdWatchers.get(key)
    if (current) {
      current.refCount += 1
      return { ok: true }
    }

    const dispose = tdReader.watchStateDir(() => broadcast('td:change', { cwd: cwd ?? null }), cwd)
    _tdWatchers.set(key, { refCount: 1, dispose })
    return { ok: true }
  })

  safeHandle('td:unwatch', async (_e, cwd?: string) => {
    const key = watcherKey(cwd)
    const current = _tdWatchers.get(key)
    if (!current) return { ok: true }
    current.refCount -= 1
    if (current.refCount <= 0) {
      current.dispose()
      _tdWatchers.delete(key)
    }
    return { ok: true }
  })
}

export function dispose(): void {
  for (const watcher of _tdWatchers.values()) watcher.dispose()
  _tdWatchers.clear()
}
