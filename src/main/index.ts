import { app, BrowserWindow, nativeTheme, ipcMain, webContents } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { is } from '@electron-toolkit/utils'
import { configStore, AppConfig } from './config/store'
import { opencodeRegistry } from './opencode/registry'

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
  opencodeRegistry.start()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  opencodeRegistry.dispose()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
