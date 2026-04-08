import { ipcMain } from 'electron'

/**
 * Register an `ipcMain.handle` after first removing any existing handler
 * for the same channel. This allows the main process to survive Electron
 * Vite HMR reloads, which re-evaluate the main module and otherwise throw
 * "Attempted to register a second handler for 'foo'".
 *
 * Also serves as a defensive guard if `register()` is ever called twice
 * from production code.
 *
 * `listener` is typed as Parameters<typeof ipcMain.handle>[1] so call sites
 * can pass any handler shape Electron accepts without TypeScript complaining
 * about narrower parameter types.
 */
export function safeHandle(
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1]
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, listener)
}
