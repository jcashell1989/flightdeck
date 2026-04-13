import { safeHandle } from './_helpers'
import { analyticsMonitor } from '../analytics/monitor'

type BroadcastFn = (channel: string, payload: unknown) => void

export function register(broadcast: BroadcastFn): void {
  safeHandle('analytics:summary', () => analyticsMonitor.getSummary())
  analyticsMonitor.on('change', () => {
    broadcast('analytics:summary', analyticsMonitor.getSummary())
  })
}
