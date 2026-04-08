import { ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { configStore, ProjectConfig } from '../config/store'

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

function validPath(p: string): boolean {
  return typeof p === 'string' && p.length > 0 && p.startsWith('/') && !p.includes('\0')
}

export function register(): void {
  /** Validate a project path and return its status. */
  ipcMain.handle('project:validate', async (_e, path: string) => {
    if (!validPath(path)) return { valid: false, reason: 'invalid path' }
    try {
      const stat = await fs.stat(path)
      if (!stat.isDirectory()) return { valid: false, reason: 'not a directory' }
    } catch {
      return { valid: false, reason: 'path does not exist' }
    }
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
}
