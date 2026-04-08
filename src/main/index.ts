import { app, BrowserWindow, nativeTheme, ipcMain, webContents, dialog } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { is } from '@electron-toolkit/utils'
import { configStore, AppConfig, ProjectConfig, AgentProfile } from './config/store'
import { opencodeRegistry } from './opencode/registry'
import { claudeMonitor } from './claude/monitor'
import { opencodeLauncher } from './opencode/launcher'

// Main is bundled as ESM (electron.vite.config.ts: format 'es'), so __dirname
// is not defined. Resolve it from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url))

function broadcast(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

ipcMain.handle('get-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

ipcMain.handle('config:get', () => configStore.get())
ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => configStore.set(patch))

ipcMain.handle('opencode:snapshot', () => opencodeRegistry.snapshot())

ipcMain.handle('opencode:session:messages', async (_e, sessionId: string) => {
  const client = opencodeRegistry.findClientForSession(sessionId)
  if (!client) throw new Error(`no client owns session ${sessionId}`)
  return client.fetchMessages(sessionId)
})

ipcMain.handle(
  'opencode:session:prompt',
  async (_e, sessionId: string, text: string) => {
    const client = opencodeRegistry.findClientForSession(sessionId)
    if (!client) throw new Error(`no client owns session ${sessionId}`)
    await client.sendPrompt(sessionId, text)
    return { ok: true }
  }
)

ipcMain.handle(
  'opencode:session:respond',
  async (
    _e,
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject'
  ) => {
    const client = opencodeRegistry.findClientForSession(sessionId)
    if (!client) throw new Error(`no client owns session ${sessionId}`)
    await client.respondPermission(sessionId, permissionId, response)
    return { ok: true }
  }
)

ipcMain.handle('opencode:session:abort', async (_e, sessionId: string) => {
  const client = opencodeRegistry.findClientForSession(sessionId)
  if (!client) throw new Error(`no client owns session ${sessionId}`)
  await client.abortSession(sessionId)
  return { ok: true }
})

ipcMain.handle(
  'opencode:session:create',
  async (
    _e,
    args: { instanceKey?: string; directory: string; prompt: string; title?: string }
  ) => {
    const client = args.instanceKey
      ? opencodeRegistry.findClientByKey(args.instanceKey)
      : opencodeRegistry.firstClient()
    if (!client) throw new Error('no opencode client available')
    const id = await client.createSession(args.directory, args.title)
    await client.sendPrompt(id, args.prompt)
    return { sessionId: id }
  }
)

function runCmd(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
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
function validPath(p: string): boolean {
  return typeof p === 'string' && p.length > 0 && p.startsWith('/') && !p.includes('\0')
}

ipcMain.handle('opencode:diff', async (_e, path: string) => {
  if (!validPath(path)) return { stdout: '', stderr: 'invalid path', code: 1 }
  return runCmd('git', ['-C', path, 'diff', '--no-color'], path)
})

ipcMain.handle('opencode:todo', async (_e, path: string) => {
  if (!validPath(path)) return { stdout: '', stderr: 'invalid path', code: 1 }
  return runCmd('td', ['usage', '-q', '-w', path], path)
})

// ── Project management IPC ─────────────────────────────────────────────────

/** Validate a project path and return its status. */
ipcMain.handle('project:validate', async (_e, path: string) => {
  if (!validPath(path)) return { valid: false, reason: 'invalid path' }
  try {
    const stat = await fs.stat(path)
    if (!stat.isDirectory()) return { valid: false, reason: 'not a directory' }
  } catch {
    return { valid: false, reason: 'path does not exist' }
  }
  // Check if it's a git repo.
  try {
    await fs.access(join(path, '.git'))
    return { valid: true, isGitRepo: true }
  } catch {
    return { valid: true, isGitRepo: false }
  }
})

/** Open a native folder picker and return the selected path. */
ipcMain.handle('project:browse', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? null : result.filePaths[0] ?? null
})

/** Add a project to the config. Optionally git-init the directory. */
ipcMain.handle(
  'project:add',
  async (_e, args: { path: string; name?: string; gitInit?: boolean }) => {
    if (!validPath(args.path)) throw new Error('invalid path')
    const cfg = configStore.get()
    if (cfg.projects.some((p) => p.path === args.path)) {
      throw new Error('project already exists')
    }
    if (args.gitInit) {
      await runCmd('git', ['init'], args.path)
    }
    const project: ProjectConfig = {
      path: args.path,
      name: args.name,
      archived: false
    }
    await configStore.set({ projects: [...cfg.projects, project] })
    return { ok: true }
  }
)

/** Archive (soft-delete) a project. */
ipcMain.handle('project:archive', async (_e, path: string) => {
  if (!validPath(path)) throw new Error('invalid path')
  const cfg = configStore.get()
  const projects = cfg.projects.map((p) =>
    p.path === path ? { ...p, archived: true } : p
  )
  await configStore.set({ projects })
  return { ok: true }
})

/** Restore an archived project. */
ipcMain.handle('project:restore', async (_e, path: string) => {
  if (!validPath(path)) throw new Error('invalid path')
  const cfg = configStore.get()
  const projects = cfg.projects.map((p) =>
    p.path === path ? { ...p, archived: false } : p
  )
  await configStore.set({ projects })
  return { ok: true }
})

/** Hard-delete a project from the config. */
ipcMain.handle('project:delete', async (_e, path: string) => {
  if (!validPath(path)) throw new Error('invalid path')
  const cfg = configStore.get()
  const projects = cfg.projects.filter((p) => p.path !== path)
  await configStore.set({ projects })
  return { ok: true }
})

// ── Agent profile IPC ──────────────────────────────────────────────────────

ipcMain.handle('profile:list', () => {
  return configStore.get().profiles
})

ipcMain.handle('profile:add', async (_e, p: Omit<AgentProfile, 'id'>) => {
  const id = crypto.randomUUID()
  const profile: AgentProfile = { ...p, id }
  const cfg = configStore.get()
  await configStore.set({ profiles: [...cfg.profiles, profile] })
  return profile
})

ipcMain.handle('profile:update', async (_e, p: AgentProfile) => {
  const cfg = configStore.get()
  const profiles = cfg.profiles.map((existing) => (existing.id === p.id ? p : existing))
  await configStore.set({ profiles })
  return p
})

ipcMain.handle('profile:delete', async (_e, id: string) => {
  const cfg = configStore.get()
  const profiles = cfg.profiles.filter((p) => p.id !== id)
  await configStore.set({ profiles })
  return { ok: true }
})

// ── Managed instance dispatch IPC ─────────────────────────────────────────

ipcMain.handle(
  'instance:dispatch',
  async (_e, args: { profileId: string; directory: string; prompt: string }) => {
    const cfg = configStore.get()
    const profile = cfg.profiles.find((p) => p.id === args.profileId)
    if (!profile) throw new Error(`profile ${args.profileId} not found`)
    if (profile.agentType !== 'opencode') {
      throw new Error(`profile ${args.profileId} is not an opencode profile`)
    }

    // Launch (or reuse) the managed opencode serve instance.
    const port = await opencodeLauncher.launch(profile, args.directory)
    const managedKey = `managed:${args.profileId}:${args.directory}`
    const instance = { host: '127.0.0.1', port, label: profile.label }

    // Ensure the registry has a connected client for this instance.
    const client = opencodeRegistry.ensureManagedClient(instance, managedKey)

    // Wait briefly for the client to connect (it may be mid-handshake).
    await new Promise<void>((resolve, reject) => {
      if (client.snapshot().status === 'connected') return resolve()
      const timeout = setTimeout(() => reject(new Error('client connect timeout')), 8000)
      client.once('status', (ev: { status: string }) => {
        if (ev.status === 'connected') {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    const sessionId = await client.createSession(args.directory)
    await client.sendPrompt(sessionId, args.prompt)
    return { sessionId }
  }
)

configStore.on('change', (cfg: AppConfig) => broadcast('config-changed', cfg))

opencodeRegistry.on('change', () => {
  broadcast('opencode:snapshot', opencodeRegistry.snapshot())
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1D1912' : '#F5F0E8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const themeHandler = (): void => {
    if (win.isDestroyed()) return
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    win.webContents.send('theme-changed', theme)
  }
  nativeTheme.on('updated', themeHandler)
  win.on('closed', () => {
    nativeTheme.removeListener('updated', themeHandler)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await configStore.init()
  // Wire Claude Code monitor into the registry before starting either.
  opencodeRegistry.setClaudeMonitor(claudeMonitor)
  opencodeRegistry.start()
  claudeMonitor.start()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  opencodeRegistry.dispose()
  claudeMonitor.dispose()
  opencodeLauncher.stopAll()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
