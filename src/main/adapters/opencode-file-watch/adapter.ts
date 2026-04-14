/**
 * OpencodeFileWatchAdapter — wraps OpencodeFileWatchMonitor for the adapter interface.
 *
 * Read-only: canDispatch = false. No send/abort.
 * snapshot() returns opencode TUI sessions from the SQLite db.
 */
import { EventEmitter } from 'events'
import { OpencodeFileWatchMonitor } from './monitor'
import type { Adapter, AdapterSnapshot } from '../types'

export class OpencodeFileWatchAdapter extends EventEmitter implements Adapter {
  readonly id = 'opencode-file-watch'
  readonly label = 'OpencodeFileWatch'
  readonly canDispatch = false

  private monitor: OpencodeFileWatchMonitor

  constructor(monitor: OpencodeFileWatchMonitor) {
    super()
    this.monitor = monitor
    monitor.on('change', () => this.emit('change'))
  }

  start(): void {
    this.monitor.start()
  }

  dispose(): void {
    this.monitor.dispose()
    this.removeAllListeners()
  }

  snapshot(): AdapterSnapshot {
    const projects = this.monitor.getSnapshot()
    return {
      projects,
      status: 'disabled',
      perInstance: []
    }
  }

  getMonitor(): OpencodeFileWatchMonitor {
    return this.monitor
  }
}
