# flight deck — Adapter Architecture

> Status: Draft. Awaiting approval.
> Ticket: td-604527
> Last updated: 2026-04-10
> Prerequisite for: td-838cbc (OpencodeMonitor), td-3d1f6c (slash commands),
> td-a0b401 (rename), td-787370 (Phase 2 Claude Code)

---

## Overview

flight deck talks to multiple AI coding harnesses (opencode, Claude Code,
future: Hermes, Letta, Codex). Each harness speaks a different protocol.
Rather than hard-wiring each one into the registry, flight deck uses an
**adapter layer**: a small interface that each harness integration implements.

The adapter layer is internal plumbing — it has no user-facing surface. Users
see sessions on the dashboard; they never choose or configure an adapter
directly. The adapter is selected implicitly by the dispatch path (⌘K profile
→ adapter) or the monitor that discovered the session (file watch → adapter).

---

## Design principles

1. **Renderer is adapter-agnostic.** The renderer receives `Session[]` and
   renders cards. It never imports adapter code or switches on transport.
   Capability checks use boolean fields on the Session, not transport identity.
2. **Adapters are owned by main.** Each adapter runs in the main process and
   exposes a uniform interface. IPC handlers route to the correct adapter via
   `sessionId` lookup or `adapterId` on the dispatch request.
3. **Additive, not rewrite.** The existing `OpencodeInstanceClient` and
   `ClaudeMonitor` become the first two adapters. Their internal implementation
   is unchanged; only the integration surface (how the registry consumes them)
   shifts to the adapter interface.
4. **Capability over identity.** Code should check `session.canReply` not
   `session.transport === 'opencode-http'`. This prevents per-adapter
   branching in the renderer and makes future adapters work without UI changes.

---

## Session type extension

Current `Session` in `src/shared/types.ts`:

```ts
interface Session {
  id: string
  agentType: 'opencode' | 'claude-code'
  state: SessionState
  currentAction: string
  startedAt: number
  lastActivity: number
  projectId: string
  instanceKey?: string
  pendingPermission?: PendingPermission | null
}
```

Extended:

```ts
interface Session {
  // ── existing ──
  id: string
  agentType: 'opencode' | 'claude-code'  // keep — still useful for UI labels + icon selection
  state: SessionState
  currentAction: string
  startedAt: number
  lastActivity: number
  projectId: string
  instanceKey?: string
  pendingPermission?: PendingPermission | null

  // ── new ──
  /** How flight deck controls this session. */
  controlMode: 'managed' | 'watched'
  /** Which adapter owns this session's transport. */
  adapterId: string
  // ── capability flags (derived by registry from adapter method presence) ──
  /** Can the user send a message / reply to this session? */
  canReply: boolean
  /** Can the user send slash commands to this session? */
  canCommand: boolean
  /** Can the user abort this session? */
  canAbort: boolean
}
```

### Field semantics

| Field | Values | Set by |
|---|---|---|
| `controlMode` | `'managed'` — flight deck spawned and controls the process. `'watched'` — externally started, flight deck observes only. | Adapter, at session creation or discovery time. A given adapter produces sessions of exactly one controlMode. If a future harness needs both managed and watched paths, model them as two separate adapters (e.g. `opencode-http` for managed, `opencode-file-watch` for watched). |
| `adapterId` | Opaque string matching the adapter's registered id (e.g. `'opencode-http'`, `'claude-file-watch'`, `'opencode-file-watch'`). | Adapter, stamped on every session it produces. |
| `canReply` | `true` if the adapter implements `send()`. | **Derived by AdapterRegistry** — `typeof adapter.send === 'function'`. |
| `canCommand` | `true` if the adapter implements `sendCommand()`. | **Derived by AdapterRegistry** — `typeof adapter.sendCommand === 'function'`. |
| `canAbort` | `true` if the adapter implements `abort()`. | **Derived by AdapterRegistry** — `typeof adapter.abort === 'function'`. |

### Backwards compatibility

`agentType` is retained. It drives UI concerns (icon, label text, "monitor
only" badge). `adapterId` drives routing. They are orthogonal:

| agentType | adapterId | controlMode | Example |
|---|---|---|---|
| `opencode` | `opencode-http` | `managed` | Dispatched via ⌘K |
| `opencode` | `opencode-file-watch` | `watched` | External TUI session (td-838cbc) |
| `claude-code` | `claude-file-watch` | `watched` | External `claude` CLI session |
| `claude-code` | `claude-channel-plugin` | `managed` | Phase 2: channel plugin |

---

## Adapter interface

```ts
/**
 * Minimum contract every harness adapter must implement.
 * Adapters run in the main process only.
 */
interface Adapter {
  /** Unique id. Must be stable across app restarts. */
  readonly id: string

  /** Human-readable label for diagnostics / logging. */
  readonly label: string

  /** Can this adapter create new sessions via dispatch()? This is the one
   *  declared flag — it can't be derived from method presence because
   *  dispatch routing is by profile/agentType, not by sessionId. */
  readonly canDispatch: boolean

  // ── lifecycle ──
  /** Called once at app start, after configStore.init(). */
  start(): void
  /** Called once on app quit. Must be synchronous or return a Promise
   *  that resolves within 5 s (the shutdown budget). */
  dispose(): void | Promise<void>

  // ── read path ──
  /** Return current sessions grouped by project. */
  snapshot(): AdapterSnapshot

  // ── write path (all optional — guarded by capability flags) ──
  /** Send a user message. Throws if canReply is false. */
  send?(sessionId: string, text: string): Promise<void>
  /** Send a slash command. Throws if canCommand is false. */
  sendCommand?(sessionId: string, command: string, args: string): Promise<void>
  /** List available slash commands for a session. */
  listCommands?(sessionId: string): Promise<CommandDefinition[]>
  /** Abort a running session. Throws if canAbort is false. */
  abort?(sessionId: string): Promise<void>
  /** Respond to a pending permission prompt. */
  respondPermission?(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void>
  /** Fetch conversation messages for a session. */
  fetchMessages?(sessionId: string): Promise<MessageRecord[]>
  /** Create a new session and send the initial prompt. Returns session id. */
  dispatch?(request: DispatchRequest): Promise<string>
}

interface AdapterSnapshot {
  projects: NormalizedProject[]
  /** Connection-level status, if applicable. Adapters that don't connect
   *  to a remote server (e.g. file-watch) return 'connected' always. */
  status: InstanceConnectionStatus | 'disabled'
  perInstance: Array<{ key: string; status: InstanceConnectionStatus; lastError: string | null }>
}

interface CommandDefinition {
  name: string
  description: string
  source: string           // 'command' | 'builtin' | 'plugin' — from the harness
  template?: string        // raw markdown template (for preview, not expansion)
}

interface DispatchRequest {
  profileId: string
  directory: string
  prompt: string
  title?: string
  /** For append-mode: existing session to send the prompt to. */
  sessionId?: string
}
```

### Why optional methods + derived capabilities

Capability flags on `Session` (`canReply`, `canCommand`, `canAbort`) are
**not declared by the adapter**. The registry derives them by inspecting
which optional methods the adapter actually implements:

```ts
// In AdapterRegistry, when stamping sessions from an adapter's snapshot:
const canReply   = typeof adapter.send === 'function'
const canCommand = typeof adapter.sendCommand === 'function'
const canAbort   = typeof adapter.abort === 'function'
```

This is duck-typing by design. The adapter author implements the methods
they support; the registry figures out the rest. Benefits:

- **Can't drift.** An adapter that implements `send()` always produces
  sessions with `canReply: true`. No opportunity for a flag/implementation
  mismatch.
- **No redundant declarations.** The adapter interface has one declared flag
  (`canDispatch`) — the only capability that can't be derived from method
  presence because dispatch routing is by profile, not by sessionId.
- **Renderer stays clean.** It checks `session.canReply`, which is a plain
  boolean stamped at snapshot time — no knowledge of adapters or methods.

The alternative (separate `ReadAdapter` / `WriteAdapter` / `CommandAdapter`
interfaces) was rejected — it adds type complexity for no runtime benefit.

---

## Adapter registry

The current `OpencodeRegistry` becomes the **adapter registry**. It owns N
adapters (not N clients), merges their snapshots, and routes write operations.

```
src/main/adapters/
  registry.ts              ← AdapterRegistry (refactored from OpencodeRegistry)
  types.ts                 ← Adapter interface, AdapterSnapshot, CommandDefinition
  opencode-http/
    adapter.ts             ← wraps existing OpencodeInstanceClient(s)
    client.ts              ← existing client.ts, unchanged internally
    mapper.ts              ← existing mapper.ts, unchanged
    launcher.ts            ← existing launcher.ts, unchanged
    types.ts               ← existing types.ts
  claude-file-watch/
    adapter.ts             ← wraps existing ClaudeMonitor
    monitor.ts             ← existing monitor.ts, unchanged internally
    parser.ts              ← existing parser.ts
    types.ts               ← existing types.ts
  opencode-file-watch/     ← td-838cbc, new
    adapter.ts
    monitor.ts
    parser.ts
    types.ts
```

### AdapterRegistry

```ts
class AdapterRegistry extends EventEmitter {
  private adapters = new Map<string, Adapter>()

  register(adapter: Adapter): void {
    this.adapters.set(adapter.id, adapter)
    // Wire change events
  }

  start(): void {
    for (const a of this.adapters.values()) a.start()
  }

  dispose(): Promise<void> {
    return Promise.all(
      [...this.adapters.values()].map(a => a.dispose())
    ).then(() => {})
  }

  /** Merged snapshot across all adapters. Derives capability flags. */
  snapshot(): AggregateSnapshot {
    const projects: NormalizedProject[] = []
    const perInstance: AggregateStatus['perInstance'] = []
    for (const adapter of this.adapters.values()) {
      // Derive capability flags from the adapter's implemented methods.
      const canReply   = typeof adapter.send === 'function'
      const canCommand = typeof adapter.sendCommand === 'function'
      const canAbort   = typeof adapter.abort === 'function'

      const snap = adapter.snapshot()
      // Stamp derived flags onto every session before merging.
      for (const p of snap.projects) {
        for (const s of p.sessions) {
          s.canReply = canReply
          s.canCommand = canCommand
          s.canAbort = canAbort
        }
        this.mergeProject(projects, p)
      }
      perInstance.push(...snap.perInstance)
    }
    return {
      projects,
      aggregateStatus: { status: this.deriveAggregate(perInstance), perInstance }
    }
  }

  /** Route a write operation to the adapter that owns the session. */
  findAdapterForSession(sessionId: string): Adapter | null {
    for (const a of this.adapters.values()) {
      const snap = a.snapshot()
      if (snap.projects.some(p => p.sessions.some(s => s.id === sessionId))) {
        return a
      }
    }
    return null
  }

  /** Route a dispatch to the correct adapter by profile. */
  findAdapterForDispatch(profileId: string): Adapter | null {
    // Phase 1: always opencode-http.
    // Phase 2: look up profile.agentType → adapter mapping.
    // For now, return the first adapter with canDispatch.
    for (const a of this.adapters.values()) {
      if (a.canDispatch) return a
    }
    return null
  }
}
```

### Migration path from current code

The refactor is mechanical:

1. **Move files** under `src/main/adapters/`. No internal changes to
   `client.ts`, `mapper.ts`, `launcher.ts`, `monitor.ts`, `parser.ts`.
2. **Wrap** `OpencodeInstanceClient` in `opencode-http/adapter.ts` that
   implements the `Adapter` interface. The adapter owns N clients (one per
   configured instance + one per managed instance), delegates to them, and
   merges their snapshots.
3. **Wrap** `ClaudeMonitor` in `claude-file-watch/adapter.ts`.
4. **Replace** `OpencodeRegistry` with `AdapterRegistry` in `index.ts`.
   Registration:
   ```ts
   const registry = new AdapterRegistry()
   registry.register(new OpencodeHttpAdapter(configStore, opencodeLauncher))
   registry.register(new ClaudeFileWatchAdapter())
   // Phase 1 addition:
   registry.register(new OpencodeFileWatchAdapter())
   registry.start()
   ```
5. **Update IPC handlers** in `ipc/opencode.ts` (rename to `ipc/session.ts`)
   to route through `registry.findAdapterForSession()` instead of
   `opencodeRegistry.findClientForSession()`.
6. **Stamp** `controlMode`, `adapterId`, `canReply`, `canCommand`, `canAbort`
   on every `Session` object produced by each adapter's snapshot. Capability
   flags (`canReply`, `canCommand`, `canAbort`) are derived by the **registry**
   (see `AdapterRegistry.snapshot()` above); `controlMode` and `adapterId` are
   set by the adapter itself.

### IPC surface changes

Current IPC channels are opencode-specific (`opencode:session:prompt`, etc.).
Rename to adapter-agnostic names:

| Current | New | Notes |
|---|---|---|
| `opencode:snapshot` | `session:snapshot` | Aggregate from all adapters |
| `opencode:session:messages` | `session:messages` | Routed by sessionId |
| `opencode:session:prompt` | `session:send` | Routed by sessionId |
| `opencode:session:respond` | `session:respond-permission` | Routed by sessionId |
| `opencode:session:abort` | `session:abort` | Routed by sessionId |
| `opencode:session:create` | `session:dispatch` | Routed by profileId → adapter |
| *(new)* | `session:command` | Routed by sessionId |
| *(new)* | `session:commands-list` | Routed by sessionId |
| `opencode:diff` | `project:diff` | Unchanged logic |
| `opencode:todo` | `project:todo` | Unchanged logic |

The renderer's `useSessionService` hook and preload bridge update to match.
This is a breaking rename — do it atomically in the adapter refactor commit.

---

## Adapter capability matrix (Phase 1 + Phase 2)

| Adapter | `canReply` | `canCommand` | `canAbort` | `canDispatch` | `fetchMessages` | Transport |
|---|---|---|---|---|---|---|
| `opencode-http` | ✅ | ✅ | ✅ | ✅ | ✅ | HTTP to `opencode serve` |
| `claude-file-watch` | ❌ | ❌ | ❌ | ❌ | ❌ | chokidar on `~/.claude/` |
| `opencode-file-watch` (td-838cbc) | ❌ | ❌ | ❌ | ❌ | ❌* | chokidar on `~/.local/share/opencode/storage/` |
| `claude-channel-plugin` (Phase 2) | ✅ | ✅** | ✅ | ✅ | ✅ | Unix socket to MCP plugin |

\* Messages exist as JSON files in `storage/message/ses_xxx/msg_*.json` and
could be parsed into `MessageRecord` shape. Start with ❌, upgrade later —
the JSON message files are populated (unlike session metadata).

\** Slash commands via the channel plugin require investigation — the plugin
injects raw text, and Claude Code may or may not expand `/foo` from injected
user messages. Research needed in Phase 2.

---

## Renderer capability gating

The renderer uses the capability flags to show/hide affordances:

```tsx
// Reply input
{session.canReply && <ReplyInput onSend={...} />}

// Abort button on card hover
{session.canAbort && <AbortButton onClick={...} />}

// Slash command typeahead (only when canCommand)
{session.canCommand && <CommandPalette sessionId={session.id} />}

// "Monitor only" chip (when nothing is writable)
{!session.canReply && <Chip label="watched" />}

// "+ New Session here" quick-action on watched cards
{!session.canReply && <NewSessionButton projectPath={project.path} />}
```

This replaces the current pattern of checking `agentType === 'claude-code'`
in multiple places.

---

## opencode-file-watch adapter (td-838cbc)

Architectural precedent: `claude-file-watch`. New adapter watches
`~/.local/share/opencode/storage/` for sessions started outside flight deck.

### Data sources

The `storage/session/*.json` directory is nearly empty (2 files vs 245 in
the database — confirmed 2026-04-10). **`opencode.db` (SQLite) is the
source of truth** for session metadata.

```
~/.local/share/opencode/opencode.db   ← SQLite, WAL mode
  session table:  id, project_id, directory, title, time_created, time_updated, ...
  project table:  id, worktree, name, time_created, time_updated, ...
```

Dependency: `better-sqlite3` opened with `{ readonly: true }`. Read-only
flag means flight deck physically cannot write to the database. WAL mode
allows concurrent readers alongside the TUI's writer (confirmed by probe:
3 TUI sidecars + 1 serve + 1 reader all coexisted cleanly).

### Session discovery

Poll every 5s (same cadence as ClaudeMonitor):

1. `SELECT s.id, s.directory, s.title, s.time_created, s.time_updated, p.name
   FROM session s JOIN project p ON s.project_id = p.id
   ORDER BY s.time_updated DESC`
2. Filter to sessions updated within a recency window (e.g. last 30 minutes)
   to avoid loading 245+ historical sessions into memory.
3. Cross-reference against running opencode processes (`pgrep -f opencode` or
   `lsof` on the DB file) to determine running vs idle state.

### State inference

Unlike Claude Code's JSONL tail-read, opencode stores structured data in
SQLite. State inference strategy:

1. Query `session` table for metadata (directory, title, timestamps).
2. A session with `time_updated` within the last few seconds + a running
   opencode process in its `directory` → `running`.
3. A session with a recent `time_updated` but no running process → `idle`.
4. For richer state (tool calls, pending permissions): read from the
   `message/ses_xxx/msg_*.json` files on disk as a secondary source, only
   for sessions identified as active by the DB query.

### Ownership detection

A session file in `storage/session/` could belong to a managed (flight-deck-
spawned) `opencode serve` instance or an external TUI. To avoid double-
counting:

- The `opencode-http` adapter already tracks session IDs it discovers via SSE.
- The `opencode-file-watch` adapter **excludes** any session ID that the
  `opencode-http` adapter already owns. The registry provides a
  `isSessionOwned(id): boolean` helper for this.

### Watch targets

```
~/.local/share/opencode/storage/session/   depth=0, events: add, change, unlink
~/.local/share/opencode/storage/message/   depth=1, events: add, change
```

chokidar config matches `claude-file-watch`: `awaitWriteFinish` with 200ms
stability threshold to avoid partial reads.

---

## Dispatch routing

How ⌘K determines which adapter handles a dispatch:

```
User selects profile → profile.agentType
  'opencode' → opencode-http adapter (always — managed mode)
  'claude-code' → Phase 2: claude-channel-plugin adapter
                  Phase 1: disabled with "monitor only" tooltip
```

The `findAdapterForDispatch()` method on the registry implements this lookup.
Phase 1 is trivial (only one dispatchable adapter exists). Phase 2 adds a
second case.

---

## Scope boundaries

### In scope (td-604527 — this spec)

- `Adapter` interface definition
- `AdapterRegistry` design
- `Session` type extension
- IPC rename plan
- File layout
- Migration path description
- Capability gating pattern for renderer
- `opencode-file-watch` adapter design sketch (td-838cbc)

### Out of scope

- Implementation (separate tickets per adapter)
- `claude-channel-plugin` adapter design (Phase 2 spec)
- `openai-compat` / `letta-rest` adapters (Phase 3)
- Command palette UI design (td-739f2a)
- Rename execution (td-a0b401)

---

## Open questions

| Question | Status |
|---|---|
| Should `findAdapterForSession` be O(1) via a global `sessionId → adapterId` index, or O(N) scan? | **O(N) scan.** The scan is over *active* sessions in the snapshot, not historical ones. Historical count is ~1,590 (1,345 Claude + 245 opencode) but snapshot at any moment has ~10–20 active sessions. O(N) over 20 is microseconds. No index needed. |
| Should the IPC rename happen in the adapter refactor commit or a separate commit? | **Same commit.** The rename is mechanical and doing it separately means two breaking changes instead of one. |
| Should `adapterId` be visible in the UI (e.g. in a debug/diagnostics panel)? | **No.** Internal only. If needed for debugging, log it to the main console. |
| Does `opencode-file-watch` need to read SQLite (`opencode.db`) or can it work from JSON files alone? | **SQLite required.** `storage/session/*.json` only has 2 files vs 245 rows in the DB (confirmed 2026-04-10). JSON is vestigial. Use `better-sqlite3` with `{ readonly: true }`, poll every 5s. WAL mode handles concurrent access (probe-verified). |

---

## Validation

The spec is validated when:

1. The `Adapter` interface can express the capabilities of all three Phase 1
   adapters (`opencode-http`, `claude-file-watch`, `opencode-file-watch`)
   without any adapter needing to work around the interface.
2. The `Session` type extension is backwards-compatible — existing renderer
   code that doesn't use the new fields continues to work unchanged.
3. The IPC rename plan covers every current channel with a clear migration.
4. The file layout is consistent and discoverable.

---

## References

- `docs/research-harness-integration.md` — research that motivated this spec
- `docs/spec-fallback-agent.md` — current opencode architecture (to be
  updated with adapter framing after this spec is approved)
- `docs/spec-claude-monitor.md` — current Claude Code monitor (to be recast
  as `claude-file-watch` adapter)
- `src/main/opencode/registry.ts` — current registry (becomes AdapterRegistry)
- `src/main/opencode/client.ts` — current client (wrapped by opencode-http adapter)
- `src/main/claude/monitor.ts` — current monitor (wrapped by claude-file-watch adapter)
