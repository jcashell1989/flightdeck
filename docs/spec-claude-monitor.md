# flightdeck — Claude Code Monitor Design

> Status: Implemented and UAT-verified.
> Ticket: td-4a41eb (monitor) · td-8b02fa (dispatch)
> Last updated: 2026-04-11

---

## Overview

Claude Code sessions cannot be controlled programmatically (Max subscription ≠ API key).
The monitor is **read-only**: it watches files and polls the process list to infer session
state, then surfaces Claude Code sessions alongside opencode sessions on the dashboard.

---

## Data Sources

### 1. `~/.claude/sessions/<pid>.json` — Live process registry

Claude Code writes one JSON file per running process:

```json
{
  "pid": 65453,
  "sessionId": "fe1e140e-2557-49de-bece-b833eacdd385",
  "cwd": "/Users/julian/projects/auth-service",
  "startedAt": 1775071672872,
  "kind": "interactive",
  "entrypoint": "cli"
}
```

- **Presence** = process was started. **Liveness** = `kill -0 <pid>` returns 0.
- `cwd` maps to a project directory (and thus a project in our config).
- `sessionId` is the UUID used to find the matching JSONL file.
- Files are **not cleaned up** when the process exits — must check liveness.

### 2. `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl` — Conversation log

One JSONL file per session. Path encoding: `/` → `-`, leading `/` dropped.
Example: `/Users/julian/projects/auth-service` → `-Users-julian-projects-auth-service`.

Each line is a JSON object. Relevant message types:

| Type | Subtype | Meaning |
|---|---|---|
| `assistant` | — | Agent turn. `message.stop_reason` = `tool_use` (still running) or `end_turn` (turn complete) |
| `system` | `stop_hook_summary` | Turn ended (hooks ran). Agent is now idle. |
| `system` | `turn_duration` | Turn ended with timing. Agent is now idle. |
| `user` | — | User sent a message. Agent is about to start a turn. |
| `queue-operation` | `enqueue` | Background task queued (agent is busy). |
| `queue-operation` | `dequeue` | Background task dequeued. |
| `permission-mode` | — | Permission mode changed (not a state signal). |
| `last-prompt` | — | Last prompt text (written at session end). |

**State inference from JSONL tail:**

The last few lines of the JSONL determine current state. Read the last N lines
(tail-read, not full parse) and walk backwards:

1. If the last `assistant` message has `stop_reason: "tool_use"` → **running**
2. If the last `system` message has `subtype: "stop_hook_summary"` or `"turn_duration"` → **idle**
3. If the last `user` message is more recent than the last `assistant` message → **running** (agent hasn't responded yet)
4. If no messages at all → **idle** (session just started, no turns yet)

**Current action inference:**

Walk backwards from the tail to find the most recent `assistant` message with
`stop_reason: "tool_use"`. Extract the tool name from `message.content[].type === "tool_use"`.
Map tool names to human-readable actions:

| Tool name | Display |
|---|---|
| `Bash` | `⚙ running shell command` |
| `Read` | `✎ reading file` |
| `Edit` / `Write` | `✎ editing file` |
| `Glob` / `Grep` | `⚙ searching codebase` |
| `Agent` | `⚙ spawning subagent` |
| `WebFetch` / `WebSearch` | `⚙ fetching web` |
| `mcp__*` | `⚙ using MCP tool` |
| *(any other)* | `⚙ working…` |

If idle, use the last completed action text (last `assistant` text content, truncated to 60 chars).

---

## Architecture

### Main-process module: `src/main/claude/`

```
src/main/claude/
  monitor.ts      — ClaudeMonitor class (file watcher + process poller)
  parser.ts       — JSONL tail reader + state inference
  types.ts        — ClaudeSession, ClaudeProject internal types
```

### `ClaudeMonitor` class

Responsibilities:
1. **Watch** `~/.claude/sessions/` for new/removed `.json` files (chokidar)
2. **Poll** process liveness every 5s (`kill -0 <pid>`)
3. **Watch** `~/.claude/projects/` for JSONL file changes (chokidar, depth 1)
4. **Emit** a `snapshot` event whenever state changes
5. **Integrate** with `OpencodeRegistry` — the registry calls `monitor.getSnapshot()` and merges Claude Code sessions into the aggregate payload

**Polling vs watching tradeoff:**
- JSONL files are appended to frequently while running → chokidar `change` events are reliable
- Process liveness cannot be watched — must poll. 5s interval is acceptable latency.
- Sessions dir is small (one file per running process) → watch is cheap.

### `ClaudeParser` — JSONL tail reader

```typescript
interface ParsedSessionState {
  state: 'running' | 'idle'
  currentAction: string
  lastActivity: number   // timestamp of last JSONL entry
  startedAt: number      // from sessions/<pid>.json
}
```

**Tail read strategy:** Read last 4KB of the JSONL file (Node.js `fs.read` with offset).
Parse complete lines from the tail. Walk backwards to find state signals.
This avoids loading multi-MB conversation files into memory.

### Integration with `OpencodeRegistry`

`OpencodeRegistry` already owns the aggregate snapshot. Phase 4 adds:

```typescript
// registry.ts
private claudeMonitor: ClaudeMonitor | null = null

// Called from index.ts after registry init
setClaudeMonitor(monitor: ClaudeMonitor): void

// Merged in getSnapshot()
getSnapshot(): AggregateSnapshot {
  const opencodeProjects = this.buildOpencodeProjects()
  const claudeProjects = this.claudeMonitor?.getSnapshot() ?? []
  return mergeProjects(opencodeProjects, claudeProjects)
}
```

**Merge logic:** Projects are keyed by `path`. If a project exists in both opencode
and Claude Code, their sessions are merged under the same `ProjectGroup`. If a
Claude Code session's `cwd` doesn't match any configured project, it is surfaced
as an **unconfigured project** (shown with a `?` badge, path as name).

### IPC

No new IPC channels needed. Claude Code sessions flow through the existing
`opencode:snapshot` push mechanism. The renderer already handles `agentType: 'claude-code'`.

---

## State Mapping

| JSONL signal | Mapped state | Notes |
|---|---|---|
| Last assistant `stop_reason: "tool_use"` | `running` | Agent is mid-turn |
| Last system `stop_hook_summary` / `turn_duration` | `idle` | Turn ended |
| Last user message newer than last assistant | `running` | Agent hasn't responded yet |
| Process dead (`kill -0` fails) + last state was running | `error` | Crashed mid-turn |
| Process dead + last state was idle | `idle` | Session ended normally |
| No JSONL file found for sessionId | `running` | Session just started, file not yet written |

**`question` state:** Claude Code has no structured question protocol visible in
the JSONL. The `queue-operation: enqueue` event indicates a background task is
waiting, but this is not a user-facing question. `question` state is **never
assigned** by the Claude Code monitor (same as Phase 2 opencode constraint).

**`approval` state:** Claude Code's permission system writes `permission-mode`
entries but does not expose pending permission details in the JSONL in a
structured way. `approval` state is **not assigned** in Phase 4. Future: watch
for `permissionMode: "acceptEdits"` transitions as a weak signal.

**`review` state:** Not assigned (same as opencode — reserved for Phase 5).

---

## File Watching Strategy

```
Watch targets:
  ~/.claude/sessions/          depth=0, events: add, unlink
  ~/.claude/projects/          depth=1, events: add, change
    └─ <encoded-path>/
         └─ <session-uuid>.jsonl   ← change events trigger re-parse
```

**chokidar config:**
```typescript
{
  depth: 1,
  ignoreInitial: false,   // hydrate on startup
  awaitWriteFinish: {
    stabilityThreshold: 200,  // wait 200ms after last write before emitting
    pollInterval: 50
  }
}
```

`awaitWriteFinish` prevents partial-line reads when Claude Code is actively
appending to the JSONL.

---

## Project Path Encoding

Claude Code encodes project paths as directory names by replacing `/` with `-`
and dropping the leading `/`. Reverse mapping:

```typescript
function decodeProjectPath(encoded: string): string {
  // '-Users-julian-projects-auth-service' → '/Users/julian/projects/auth-service'
  return '/' + encoded.replace(/-/g, '/')
}
```

**Ambiguity:** A directory name containing `-` is indistinguishable from a path
separator. In practice this is rare (project paths rarely contain hyphens in
every segment). Accept the ambiguity — worst case is a false project match.
A future improvement could cross-reference against `cwd` from the sessions JSON.

---

## Dependencies

- **chokidar** — file watching. Already a transitive dep of electron-vite; add
  as explicit dep. Version: `^5.0.0` (ESM-native, no fsevents issues on macOS).
- No other new dependencies.

---

## Scope Boundaries

**In scope (Phase 4):**
- Session detection via `~/.claude/sessions/` + process liveness
- State inference (`running` / `idle` / `error`) from JSONL tail
- Current action text from last tool use
- Merge into existing snapshot + dashboard display
- Monitor-only guard in dispatch UI (already partially implemented — `agentType: 'claude-code'` check)

**Out of scope (Phase 4):**
- `approval` state (no structured signal in JSONL)
- `question` state (no structured signal)
- `review` state (reserved)
- Conversation tab for Claude Code sessions (JSONL is readable but renderer
  message format differs from opencode SDK — defer to Phase 5)
- Diff tab for Claude Code sessions (can use same `git diff` IPC — include if trivial)

---

## Validation

1. Start `claude` in a terminal in a known project directory
2. Session card appears on dashboard with `agentType: 'claude-code'`, state `running`
3. While claude is actively using tools, `currentAction` updates within ~5s
4. When claude finishes a turn, state transitions to `idle`
5. Kill the `claude` process mid-turn → state transitions to `error`
6. Dispatch overlay shows Claude Code as disabled with "monitor only" tooltip
7. `npm run typecheck` clean

---

## Open Questions (resolved)

| Question | Decision |
|---|---|
| Use chokidar or native `fs.watch`? | chokidar — handles macOS FSEvents reliably, already in dep tree |
| Full JSONL parse or tail read? | Tail read (last 4KB) — avoids loading multi-MB files |
| Where does merge happen? | In `OpencodeRegistry.getSnapshot()` — single aggregate point |
| New IPC channel? | No — reuse `opencode:snapshot` push |
| What if cwd doesn't match a configured project? | Surface as unconfigured project with `?` badge |
