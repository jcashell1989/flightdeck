import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentProfile } from '../config/store'

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock child_process before importing launcher
const mockChildProcess = {
  exitCode: null as number | null,
  pid: 1234,
  kill: vi.fn(),
  on: vi.fn(),
  stdout: null,
  stderr: null,
  stdin: null
}

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockChildProcess)
}))

// Mock net to control port-free checks and server startup polling
const mockNetServer = {
  once: vi.fn(),
  listen: vi.fn(),
  close: vi.fn()
}

const mockNetConnection = {
  once: vi.fn(),
  destroy: vi.fn()
}

vi.mock('net', () => ({
  createServer: vi.fn(() => mockNetServer),
  createConnection: vi.fn(() => mockNetConnection)
}))

import { spawn } from 'child_process'
import * as net from 'net'
import { OpencodeLauncher } from './launcher'

const mockSpawn = spawn as ReturnType<typeof vi.fn>
const mockCreateServer = net.createServer as ReturnType<typeof vi.fn>
const mockCreateConnection = net.createConnection as ReturnType<typeof vi.fn>

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-1',
    label: 'test profile',
    agentType: 'opencode',
    isDefault: true,
    ...overrides
  }
}

// Helper: make isPortFree resolve to true (port is free)
function makePortFree(): void {
  mockNetServer.once.mockImplementation((event: string, cb: () => void) => {
    if (event === 'listening') setTimeout(cb, 0)
    return mockNetServer
  })
  mockNetServer.close.mockImplementation((cb: () => void) => cb())
}

// Helper: make server startup poll succeed immediately
function makeServerReady(): void {
  mockNetConnection.once.mockImplementation((event: string, cb: () => void) => {
    if (event === 'connect') setTimeout(cb, 0)
    return mockNetConnection
  })
}

// ── buildEnv (tested indirectly via spawn call) ───────────────────────────

describe('OpencodeLauncher.launch — env construction', () => {
  let launcher: OpencodeLauncher

  beforeEach(() => {
    vi.clearAllMocks()
    launcher = new OpencodeLauncher()
    makePortFree()
    makeServerReady()
    // Reset exitCode so existing-instance check fails
    mockChildProcess.exitCode = null
    mockChildProcess.on.mockImplementation((event: string, cb: (code: number) => void) => {
      // Don't call exit/error callbacks during tests
      return mockChildProcess
    })
  })

  afterEach(() => {
    launcher.stopAll()
  })

  it('sets OPENROUTER_API_KEY for openrouter provider', async () => {
    const profile = makeProfile({ provider: 'openrouter', apiKey: 'sk-or-test' })
    await launcher.launch(profile, '/projects/auth')
    const env = mockSpawn.mock.calls[0][2].env
    expect(env['OPENROUTER_API_KEY']).toBe('sk-or-test')
  })

  it('sets ANTHROPIC_API_KEY for anthropic provider', async () => {
    const profile = makeProfile({ provider: 'anthropic', apiKey: 'sk-ant-test' })
    await launcher.launch(profile, '/projects/auth')
    const env = mockSpawn.mock.calls[0][2].env
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-test')
  })

  it('sets OPENAI_API_KEY for openai provider', async () => {
    const profile = makeProfile({ provider: 'openai', apiKey: 'sk-openai-test' })
    await launcher.launch(profile, '/projects/auth')
    const env = mockSpawn.mock.calls[0][2].env
    expect(env['OPENAI_API_KEY']).toBe('sk-openai-test')
  })

  it('sets GOOGLE_API_KEY for google provider', async () => {
    const profile = makeProfile({ provider: 'google', apiKey: 'goog-test' })
    await launcher.launch(profile, '/projects/auth')
    const env = mockSpawn.mock.calls[0][2].env
    expect(env['GOOGLE_API_KEY']).toBe('goog-test')
  })

  it('does not set any key for unknown provider (logs warning instead)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Temporarily clear provider keys from process.env so we can assert they
    // were not injected by buildEnv (inherited env values would confuse the check)
    const savedOR = process.env['OPENROUTER_API_KEY']
    const savedAnt = process.env['ANTHROPIC_API_KEY']
    delete process.env['OPENROUTER_API_KEY']
    delete process.env['ANTHROPIC_API_KEY']
    try {
      const profile = makeProfile({ provider: 'unknown-provider', apiKey: 'sk-test' })
      await launcher.launch(profile, '/projects/auth')
      const env = mockSpawn.mock.calls[0][2].env
      expect(env['OPENROUTER_API_KEY']).toBeUndefined()
      expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown provider'))
    } finally {
      if (savedOR !== undefined) process.env['OPENROUTER_API_KEY'] = savedOR
      if (savedAnt !== undefined) process.env['ANTHROPIC_API_KEY'] = savedAnt
      warnSpy.mockRestore()
    }
  })

  it('sets OPENCODE_MODEL when model is provided', async () => {
    const profile = makeProfile({ model: 'openrouter/kimi-k2.5' })
    await launcher.launch(profile, '/projects/auth')
    const env = mockSpawn.mock.calls[0][2].env
    expect(env['OPENCODE_MODEL']).toBe('openrouter/kimi-k2.5')
  })

  it('sets OPENCODE_PROVIDER when provider is provided', async () => {
    const profile = makeProfile({ provider: 'openrouter' })
    await launcher.launch(profile, '/projects/auth')
    const env = mockSpawn.mock.calls[0][2].env
    expect(env['OPENCODE_PROVIDER']).toBe('openrouter')
  })
})

// ── launch — instance reuse ───────────────────────────────────────────────

describe('OpencodeLauncher.launch — instance reuse', () => {
  let launcher: OpencodeLauncher

  beforeEach(() => {
    vi.clearAllMocks()
    launcher = new OpencodeLauncher()
    makePortFree()
    makeServerReady()
    mockChildProcess.exitCode = null
    mockChildProcess.on.mockImplementation(() => mockChildProcess)
  })

  afterEach(() => {
    launcher.stopAll()
  })

  it('returns existing port without spawning again for same profile+directory', async () => {
    const profile = makeProfile()
    const port1 = await launcher.launch(profile, '/projects/auth')
    const port2 = await launcher.launch(profile, '/projects/auth')
    expect(port1).toBe(port2)
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })

  it('spawns a new process for a different directory', async () => {
    const profile = makeProfile()
    await launcher.launch(profile, '/projects/auth')
    await launcher.launch(profile, '/projects/api')
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })
})

// ── stopAll ───────────────────────────────────────────────────────────────

describe('OpencodeLauncher.stopAll', () => {
  it('sends SIGTERM to all running processes', async () => {
    vi.clearAllMocks()
    const launcher = new OpencodeLauncher()
    makePortFree()
    makeServerReady()
    mockChildProcess.exitCode = null
    mockChildProcess.on.mockImplementation(() => mockChildProcess)

    await launcher.launch(makeProfile({ id: 'p1' }), '/projects/auth')
    launcher.stopAll()

    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('throws when launch is called after stopAll', async () => {
    const launcher = new OpencodeLauncher()
    launcher.stopAll()
    await expect(launcher.launch(makeProfile(), '/projects/auth')).rejects.toThrow('disposed')
  })
})

// ── stopAllAsync (td-d699f0) ──────────────────────────────────────────────

describe('OpencodeLauncher.stopAllAsync', () => {
  it('waits for children to exit before resolving', async () => {
    vi.clearAllMocks()
    const launcher = new OpencodeLauncher()
    makePortFree()
    makeServerReady()
    mockChildProcess.exitCode = null

    // Capture the exit handler so we can invoke it manually to simulate
    // the child actually dying after SIGTERM.
    let exitHandler: ((code: number) => void) | undefined
    mockChildProcess.on.mockImplementation((event: string, cb: (code: number) => void) => {
      if (event === 'exit') exitHandler = cb
      return mockChildProcess
    })
    // killChild uses child.once('exit', …), so also capture via once.
    const onceHandler = vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'exit') {
        // Resolve the kill promise by invoking the captured handler async.
        setTimeout(() => cb(0), 0)
      }
      return mockChildProcess
    })
    ;(mockChildProcess as unknown as { once: typeof onceHandler }).once = onceHandler

    await launcher.launch(makeProfile({ id: 'p1' }), '/projects/auth')

    await launcher.stopAllAsync(100)

    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')
    // Trigger the exit handler to flush the 'stopped' event path.
    exitHandler?.(0)
  })

  it('escalates to SIGKILL after grace period if child does not exit', async () => {
    vi.clearAllMocks()
    const launcher = new OpencodeLauncher()
    makePortFree()
    makeServerReady()
    mockChildProcess.exitCode = null
    ;(mockChildProcess as unknown as { killed: boolean }).killed = false
    mockChildProcess.on.mockImplementation(() => mockChildProcess)

    await launcher.launch(makeProfile({ id: 'p1' }), '/projects/auth')

    // After launch, swap to fake timers and a no-op once() so killChild
    // hangs waiting for 'exit'. This simulates a stuck child.
    vi.useFakeTimers()
    ;(mockChildProcess as unknown as { once: (e: string, cb: unknown) => unknown }).once = vi.fn(
      () => mockChildProcess
    )

    const stopPromise = launcher.stopAllAsync(50)
    // SIGTERM fires immediately (synchronous in killChild).
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')

    // Advance past the grace period — SIGKILL should fire.
    await vi.advanceTimersByTimeAsync(60)
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL')

    vi.useRealTimers()
    // stopPromise will hang forever in this synthetic scenario; don't await it.
    void stopPromise
  })
})
