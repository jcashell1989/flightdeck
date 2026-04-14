import { safeHandle } from './_helpers'
import { tdReader } from '../td/reader'

export function register(): void {
  safeHandle('td:list', async (_e, cwd?: string) => tdReader.list(cwd))
  safeHandle('td:show', async (_e, id: string, cwd?: string) => tdReader.show(id, cwd))
  safeHandle('td:start', async (_e, id: string, cwd?: string) => { await tdReader.start(id, cwd) })
  safeHandle('td:log', async (_e, id: string, message: string, cwd?: string) => { await tdReader.log(id, message, cwd) })
  safeHandle('td:handoff', async (_e, id: string, cwd?: string) => { await tdReader.handoff(id, cwd) })
  safeHandle('td:usage', async (_e, cwd?: string) => tdReader.usage(cwd))
}
