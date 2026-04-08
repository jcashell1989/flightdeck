import { app, BrowserWindow, nativeTheme, webContents } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { is } from '@electron-toolkit/utils'
import { configStore } from './config/store'
import { opencodeRegistry } from './opencode/registry'
import { claudeMonitor } from './claude/monitor'
import { opencodeLauncher } from './opencode/launcher'
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
function registerIpc(): void {
  ipcConfig.register(broadcast)
  ipcOpencode.register(broadcast)
  ipcProject.register()
  ipcProfile.register()
  ipcInstance.register()
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

app.whenReady().then(async () => {
  // Config must be loaded before any IPC handler can read it.
  await configStore.init()
  // Register IPC AFTER init so handlers never hit an un-initialised store,
  // and so the renderer's config:get cannot race the load.
  registerIpc()
  // Wire Claude Code monitor into the registry before starting either.
  opencodeRegistry.setClaudeMonitor(claudeMonitor)
  opencodeRegistry.start()
  claudeMonitor.start()
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
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  shuttingDown = true
  void (async () => {
    try {
      opencodeRegistry.dispose()
      claudeMonitor.dispose()
      await opencodeLauncher.stopAllAsync()
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
