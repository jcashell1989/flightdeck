import { app, BrowserWindow, nativeTheme, webContents } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { is } from '@electron-toolkit/utils'
import { configStore } from './config/store'
import { opencodeRegistry } from './opencode/registry'
import { claudeMonitor } from './claude/monitor'
import { opencodeFileWatchMonitor } from './adapters/file-watch'
import { opencodeLauncher } from './opencode/launcher'
import { ClaudeLauncher } from './claude/launcher'
import * as ipcConfig from './ipc/config'
import * as ipcOpencode from './ipc/opencode'
import * as ipcProject from './ipc/project'
import * as ipcProfile from './ipc/profile'
import * as ipcInstance from './ipc/instance'

// Main is bundled as ESM (electron.vite.config.ts: format 'es'), so __dirname
// is not defined. Resolve it from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url))

function broadcast(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

/**
 * Register all IPC handlers. Called from inside app.whenReady() — after
 * configStore.init() — so that handlers never fire against an un-initialised
 * store, and so Electron Vite HMR can safely re-evaluate this module without
 * tripping "Attempted to register a second handler for 'X'". Each register()
 * internally uses safeHandle() which calls removeHandler first.
 */
function registerIpc(claudeLauncher: ClaudeLauncher): void {
  ipcConfig.register(broadcast)
  ipcOpencode.register(broadcast)
  ipcProject.register()
  ipcProfile.register()
  ipcInstance.register(claudeLauncher)
}

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
    // Use the central broadcast helper so every webContents receives the
    // update — win.webContents.send only targets the closed-over window.
    broadcast('theme-changed', theme)
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

/**
 * One-time migration: copy userData from the old "agentctl" app name to the
 * new "flight-deck" app name. Runs before any code reads app.getPath('userData')
 * so the rest of the app never sees the old path.
 * Migration failure must not crash the app — wrapped in try/catch.
 */
function migrateUserData(): void {
  try {
    const platform = process.platform
    const home = app.getPath('home')
    let oldPath: string
    if (platform === 'darwin') {
      oldPath = path.join(home, 'Library', 'Application Support', 'agentctl')
    } else if (platform === 'linux') {
      oldPath = path.join(home, '.config', 'agentctl')
    } else {
      // win32
      const appData = process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming')
      oldPath = path.join(appData, 'agentctl')
    }
    const newPath = app.getPath('userData')
    const oldExists = fs.existsSync(oldPath)
    const newExists = fs.existsSync(newPath)
    if (oldExists && !newExists) {
      fs.cpSync(oldPath, newPath, { recursive: true })
      fs.rmSync(oldPath, { recursive: true, force: true })
      console.log(`[main] migrated userData: ${oldPath} → ${newPath}`)
    } else if (oldExists && newExists) {
      console.warn(`[main] userData migration skipped: both old (${oldPath}) and new (${newPath}) paths exist. Remove the old path manually if desired.`)
    }
  } catch (e) {
    console.error('[main] userData migration failed (non-fatal):', e)
  }
}

migrateUserData()

app.whenReady().then(async () => {
  // Config must be loaded before any IPC handler can read it.
  await configStore.init()
  claudeLauncher = await ClaudeLauncher.create()
  const launcher = claudeLauncher
  // Register IPC AFTER init so handlers never hit an un-initialised store,
  // and so the renderer's config:get cannot race the load.
  registerIpc(launcher)
  // Wire dispatched sessions into the monitor for immediate JSONL watch.
  launcher.on('started', ({ pid, sessionId, directory }: { pid: number; sessionId: string; directory: string }) => {
    claudeMonitor.trackLaunchedSession({ pid, sessionId, cwd: directory, startedAt: Date.now() })
  })
  // Wire monitors into the registry before starting any of them.
  opencodeRegistry.setClaudeMonitor(claudeMonitor)
  opencodeRegistry.setOpencodeFileWatch(opencodeFileWatchMonitor)
  opencodeRegistry.start()
  claudeMonitor.start()
  opencodeFileWatchMonitor.start()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Shutdown protocol: before-quit fires once, we preventDefault to hold the
 * quit, run async disposal (crucially including stopAllAsync which waits for
 * child opencode serve processes to actually exit), then call app.quit()
 * again which fires before-quit a second time — the `shuttingDown` flag lets
 * that pass through. Without this, Electron tears down the process before
 * SIGTERM'd children have a chance to exit, leaving them as zombies owned
 * by init.
 */
let claudeLauncher: import('./claude/launcher').ClaudeLauncher | null = null
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  shuttingDown = true
  void (async () => {
    try {
      opencodeRegistry.dispose()
      claudeMonitor.dispose()
      opencodeFileWatchMonitor.dispose()
      await Promise.all([opencodeLauncher.stopAllAsync(), claudeLauncher?.stopAllAsync() ?? Promise.resolve()])
    } catch (e) {
      console.error('[main] error during shutdown:', e)
    } finally {
      app.quit()
    }
  })()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
