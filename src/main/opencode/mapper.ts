/**
 * Pure mapping functions that translate opencode SDK types into the
 * normalized session state the renderer consumes.
 *
 * Intentionally stateless — the OpencodeInstanceClient owns the mutable
 * per-session state; this module transforms snapshots.
 */
import type {
  Session as SdkSession,
  SessionStatus as SdkSessionStatus,
  Event as SdkEvent,
  Permission as SdkPermission,
  Part as SdkPart
} from '@opencode-ai/sdk'
import type {
  NormalizedProject,
  NormalizedSession,
  NormalizedSessionState,
  PendingPermission
} from './types'
import type { OpencodeInstance } from '../config/store'

/**
 * Per-session mutable state tracked by the client. The mapper only reads it.
 */
export interface InternalSessionState {
  meta: SdkSession
  sdkStatus: SdkSessionStatus
  pendingPermissions: Map<string, SdkPermission>
  lastError: string | null
  currentAction: string
  lastActivity: number
}

export function initialSessionState(meta: SdkSession): InternalSessionState {
  return {
    meta,
    sdkStatus: { type: 'idle' },
    pendingPermissions: new Map(),
    lastError: null,
    currentAction: meta.title || 'waiting',
    lastActivity: meta.time.updated ?? meta.time.created
  }
}

export function deriveState(s: InternalSessionState): NormalizedSessionState {
  if (s.lastError) return 'error'
  if (s.pendingPermissions.size > 0) return 'approval'
  switch (s.sdkStatus.type) {
    case 'busy':
      return 'running'
    case 'retry':
      return 'running'
    case 'idle':
    default:
      return 'idle'
  }
}

export function toNormalizedSession(
  s: InternalSessionState,
  projectId: string,
  instanceKey: string
): NormalizedSession {
  // Use the full SDK id as the canonical id. Display shortening (last 4 chars)
  // is the renderer's job — see SessionCard / Sessions.tsx — so that the
  // identity used for React keys, focus tracking, and IPC lookups is unique.
  let pendingPermission: PendingPermission | null = null
  const firstPerm = s.pendingPermissions.values().next().value as SdkPermission | undefined
  if (firstPerm) {
    const meta = (firstPerm.metadata ?? {}) as Record<string, unknown>
    const pat = firstPerm.pattern
    pendingPermission = {
      id: firstPerm.id,
      type: firstPerm.type,
      title: firstPerm.title,
      pattern: Array.isArray(pat) ? pat.join(' ') : pat,
      command:
        typeof meta.command === 'string'
          ? meta.command
          : typeof meta.cmd === 'string'
            ? meta.cmd
            : undefined,
      metadata: meta
    }
  }
  return {
    id: s.meta.id,
    agentType: 'opencode',
    state: deriveState(s),
    currentAction: s.currentAction,
    startedAt: s.meta.time.created,
    lastActivity: s.lastActivity,
    projectId,
    instanceKey,
    pendingPermission
  }
}

/**
 * Group per-session states into one or more NormalizedProjects, keyed by
 * the opencode directory (one opencode server = one directory in practice,
 * but group defensively in case the schema ever splits projects).
 */
export function groupIntoProjects(
  states: Iterable<InternalSessionState>,
  instance: OpencodeInstance
): NormalizedProject[] {
  const instanceKey = `${instance.host}:${instance.port}`
  const byDir = new Map<string, InternalSessionState[]>()
  for (const s of states) {
    const dir = s.meta.directory
    let arr = byDir.get(dir)
    if (!arr) {
      arr = []
      byDir.set(dir, arr)
    }
    arr.push(s)
  }

  const projects: NormalizedProject[] = []
  for (const [dir, list] of byDir) {
    const projectId = `${instanceKey}:${dir}`
    projects.push({
      id: projectId,
      name: basenameOf(dir),
      path: dir,
      sessions: list.map((s) => toNormalizedSession(s, projectId, instanceKey))
    })
  }
  return projects
}

function basenameOf(path: string): string {
  // Unix-only — opencode normalizes directories to forward slashes, and the
  // server is not supported on Windows. Revisit if that ever changes.
  const stripped = path.replace(/\/+$/, '')
  const idx = stripped.lastIndexOf('/')
  return idx >= 0 ? stripped.slice(idx + 1) : stripped
}

/**
 * Apply a streamed SSE event to the mutable state map. Returns true if the
 * snapshot was mutated (i.e. the client should emit a change).
 *
 * NOTE on question state: SDK 1.3.17 exposes no question.* events — only
 * permission.updated / permission.replied. We therefore never assign the
 * 'question' state from opencode; the renderer's 'question' state remains
 * a slot for Claude Code monitor (td-4a41eb) and future SDK versions.
 */
export function applyEvent(
  states: Map<string, InternalSessionState>,
  event: SdkEvent
): boolean {
  switch (event.type) {
    case 'session.updated': {
      const info = (event.properties as { info: SdkSession }).info
      const existing = states.get(info.id)
      if (existing) {
        existing.meta = info
        existing.lastActivity = info.time.updated ?? existing.lastActivity
      } else {
        states.set(info.id, initialSessionState(info))
      }
      return true
    }
    case 'session.deleted': {
      const info = (event.properties as { info: SdkSession }).info
      return states.delete(info.id)
    }
    case 'session.status': {
      const { sessionID, status } = event.properties as {
        sessionID: string
        status: SdkSessionStatus
      }
      const s = states.get(sessionID)
      if (!s) return false
      s.sdkStatus = status
      s.lastActivity = Date.now()
      return true
    }
    case 'session.idle': {
      const { sessionID } = event.properties as { sessionID: string }
      const s = states.get(sessionID)
      if (!s) return false
      s.sdkStatus = { type: 'idle' }
      s.lastActivity = Date.now()
      return true
    }
    case 'session.error': {
      const { sessionID, error } = event.properties as {
        sessionID?: string
        error?: { message?: string; name?: string }
      }
      if (!sessionID) return false
      const s = states.get(sessionID)
      if (!s) return false
      s.lastError = error?.message ?? error?.name ?? 'unknown error'
      s.lastActivity = Date.now()
      return true
    }
    case 'permission.updated': {
      // Per SDK types.gen.d.ts:386, EventPermissionUpdated.properties IS the
      // Permission object directly (not wrapped). Verified against
      // @opencode-ai/sdk@1.3.17.
      const perm: SdkPermission = event.properties
      const s = states.get(perm.sessionID)
      if (!s) return false
      s.pendingPermissions.set(perm.id, perm)
      s.lastActivity = Date.now()
      return true
    }
    case 'permission.replied': {
      const { sessionID, permissionID } = event.properties as {
        sessionID: string
        permissionID: string
      }
      const s = states.get(sessionID)
      if (!s) return false
      const changed = s.pendingPermissions.delete(permissionID)
      s.lastActivity = Date.now()
      return changed
    }
    case 'message.part.updated': {
      // Every Part variant carries sessionID per types.gen.d.ts (line 347 and
      // each *Part subtype). No narrowing cast needed.
      const part: SdkPart = event.properties.part
      const s = states.get(part.sessionID)
      if (!s) return false
      s.currentAction = describePart(part)
      s.lastActivity = Date.now()
      return true
    }
    default:
      return false
  }
}

function describePart(part: SdkPart): string {
  switch (part.type) {
    case 'text':
      return truncate((part as { text: string }).text, 80)
    case 'tool': {
      const tool = part as { tool?: string; state?: { status?: string } }
      const name = tool.tool ?? 'tool'
      const st = tool.state?.status
      return st ? `${name} (${st})` : name
    }
    case 'file': {
      const f = part as { filename?: string }
      return f.filename ? `editing ${f.filename}` : 'editing file'
    }
    case 'reasoning':
      return 'thinking…'
    default:
      return part.type
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
