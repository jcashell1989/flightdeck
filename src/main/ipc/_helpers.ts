import { ipcMain } from 'electron'

type IpcListener = Parameters<typeof ipcMain.handle>[1]

/**
 * Register an `ipcMain.handle` after first removing any existing handler
 * for the same channel. This allows the main process to survive Electron
 * Vite HMR reloads, which re-evaluate the main module and otherwise throw
 * "Attempted to register a second handler for 'foo'".
 *
 * Also serves as a defensive guard if `register()` is ever called twice
 * from production code.
 *
 * Errors thrown by the listener are caught, logged with channel context
 * (main-side observability), and rethrown as plain Error objects so Electron
 * can serialise them back to the renderer. The renderer's `formatIpcError`
 * strips the Electron "Error invoking remote method 'X':" wrapper so the
 * underlying message surfaces cleanly in the config banner / onunhandledrejection
 * safety net.
 */
export function safeHandle(channel: string, listener: IpcListener): void {
  ipcMain.removeHandler(channel)
  const wrapped: IpcListener = async (event, ...args) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (listener as any)(event, ...args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ipc:${channel}] handler error:`, msg)
      throw err instanceof Error ? err : new Error(msg)
    }
  }
  ipcMain.handle(channel, wrapped)
}
