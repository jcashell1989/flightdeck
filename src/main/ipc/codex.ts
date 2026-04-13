import { safeHandle } from './_helpers'
import { codexMonitor } from '../codex/monitor'

type BroadcastFn = (channel: string, payload: unknown) => void

export function register(broadcast: BroadcastFn): void {
  safeHandle('codex:snapshot', () => codexMonitor.getSnapshot())
  codexMonitor.on('change', () => {
    broadcast('codex:snapshot', codexMonitor.getSnapshot())
  })
}
