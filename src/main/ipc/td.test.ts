import { describe, it, expect, vi } from 'vitest'
import { createTdWatchManager } from './td'

describe('createTdWatchManager', () => {
  it('increments refCount for duplicate watch calls and disposes on final unwatch', () => {
    const disposeA = vi.fn()
    const watchStateDir = vi.fn(() => disposeA)
    const manager = createTdWatchManager(watchStateDir, vi.fn())

    manager.watch('/repo')
    manager.watch('/repo')
    expect(watchStateDir).toHaveBeenCalledTimes(1)

    manager.unwatch('/repo')
    expect(disposeA).not.toHaveBeenCalled()

    manager.unwatch('/repo')
    expect(disposeA).toHaveBeenCalledTimes(1)
  })

  it('tracks watchers independently per cwd', () => {
    const disposeDefault = vi.fn()
    const disposeRepo = vi.fn()
    const watchStateDir = vi.fn()
      .mockReturnValueOnce(disposeDefault)
      .mockReturnValueOnce(disposeRepo)

    const manager = createTdWatchManager(watchStateDir, vi.fn())
    manager.watch()
    manager.watch('/repo')
    manager.unwatch('/repo')

    expect(disposeRepo).toHaveBeenCalledTimes(1)
    expect(disposeDefault).not.toHaveBeenCalled()

    manager.disposeAll()
    expect(disposeDefault).toHaveBeenCalledTimes(1)
  })
})
