# agentctl — Research & Evaluation

> Captured: 2026-04-06
> Context: Evaluating existing tools and integration surfaces before designing agentctl.

---

## Tools Evaluated

### t3code (pingdotgg/t3code)

**Verdict: Not suitable as a base.**

- v0.0.15, 371 open issues, 294 open PRs — pre-production
- A monitor/launcher, not an orchestrator
- No cross-project task routing — projects are siloed
- No agent-to-agent coordination
- No task queue across projects (single-thread queuing listed as future feature)
- Multi-repo question (issue #1453) open with no resolution
- Active diff-leaking-between-threads bug (#1743) unresolved
- Codex-first architecture; Claude support is secondary
- Does support both Claude + Codex, which is its main advantage over CodexMonitor

### CodexMonitor (Dimillian/CodexMonitor)

**Verdict: Best-in-class UI, wrong agent.**

- v0.7.67, 87 releases, 3.5k stars — meaningfully more mature than t3code
- Tauri desktop app (Rust + React)
- Multi-workspace sidebar with dashboard home screen ✓
- Concurrent sessions per workspace, unread/running state indicators ✓
- Per-thread task queuing (Queue vs Steer follow-up modes) ✓
- Git/GitHub integration, diff viewer, branch management ✓
- Worktree support ✓
- Remote daemon mode (run Codex on another machine, monitor from iOS) ✓
- **Hard constraint: Codex-only.** Built entirely around `codex app-server`
  (JSON-RPC over stdio). Claude support issue #86 was closed without implementation.
- Adding Claude support would require replacing the entire backend adapter layer
  in Rust — substantial work.

### opencode (anomalyco/opencode)

**Verdict: Best integration surface. Primary work agent.**

- v1.3.17, 755 releases, 138k stars — production-grade
- `opencode serve` → HTTP REST + SSE at configurable port
- Official `@opencode-ai/sdk` npm package, typed, generated from OpenAPI spec
- Key endpoints:
  - `GET /session/status` — all session statuses in one call
  - `GET /event` — SSE stream for real-time updates
  - `POST /session/:id/prompt_async` — fire-and-forget dispatch
  - `GET /session/:id/diff` — file diffs per session
  - `GET /project/list` — list all projects
  - `POST /session/:id/abort` — interrupt a running session
- One server instance = one project directory
- Multiple instances on different ports = multi-project monitoring
- mDNS discovery available (`--mdns` flag) for local instance discovery
- Provider-agnostic: Claude, OpenAI, Gemini, local models, OpenRouter
- Used for: work tasks via OpenRouter → AWS Bedrock (Sonnet 4.6)

### Claude Code (Anthropic)

**Verdict: Passive monitor only. Auth constraint is hard.**

- No server mode — each `claude` invocation is independent
- Has `@anthropic-ai/claude-agent-sdk` (renamed from Claude Code SDK) for
  programmatic control via `query()` iterator
- **Critical constraint:** Personal use connects via claude.ai Max subscription,
  not an API key. The Agent SDK requires `ANTHROPIC_API_KEY`. These are
  incompatible — the SDK cannot use the Max subscription.
- Therefore: Claude Code personal sessions can only be monitored externally
  (file watching `~/.claude/projects/`, process list inspection)
- No programmatic dispatch from the dashboard
- Used for: personal tasks via claude.ai Max subscription

### Amp (ampcode.com)

**Verdict: Not relevant.**

- Terminal-only CLI
- No multi-session dashboard
- No server mode

### Enodios (letta + hermes ×3)

**Verdict: Deferred. Nice-to-have read-only integration.**

- Letta has a REST API (`letta serve`)
- Hermes instances would need their own polling/status mechanism
- Read-only (status + conversation history) is the target integration
- Not in scope for initial build

---

## Integration Surface Summary

| Agent | Protocol | Multi-project | Dispatch | Monitor | Maturity |
|---|---|---|---|---|---|
| opencode | HTTP REST + SSE + SDK | Multiple servers, one per dir | ✓ Full | ✓ | v1.3.17 |
| Claude Code | File watch + process list | One process per dir | ✗ (auth constraint) | ✓ Passive | Stable |
| Fallback agent | TBD | TBD | TBD | TBD | Not built |
| Enodios | Letta REST API | N/A | ✗ | ✓ Read-only | Deferred |

---

## Architecture Options Considered

### Option A — Fork CodexMonitor, add Claude provider
- Keep mature Tauri/Rust/React infrastructure
- Replace `src-tauri/src/codex/` with a `claude/` adapter
- Add provider selection per workspace
- **Rejected:** Rust work to map Claude's protocol onto CodexMonitor's internal
  event model is substantial and fragile. Wrong starting point for a Claude-primary workflow.

### Option B — Fork t3code, replace single-provider model with multi-adapter architecture
- t3code already has Claude integration as primary
- Add opencode HTTP adapter, Claude Code passive monitor, dashboard home screen
- **Rejected:** v0.0.15 instability risk. Building on unstable ground.

### Option C — Build new lightweight dashboard against opencode's SDK
- opencode is the primary work agent and has the best integration surface
- Small Electron or Tauri app (or local Next.js) that:
  - Connects to N opencode servers (one per active project)
  - Passively monitors Claude Code via file watching
  - Has a plug-in slot for future agents
- **Preferred:** opencode SDK does the heavy lifting. Scope is well-bounded.
  Claude Code passive monitor is a known-bounded problem.

### Option D — Fork/extend opencode's own web UI (`opencode web`)
- `packages/console` is the web UI, open source
- Already has session list, conversation view, diff viewer
- Missing: multi-project aggregation (each instance is one project)
- Would need a meta-dashboard layer aggregating across multiple opencode instances
- **Viable alternative to C** — builds on 138k-star maintained project

---

## Key Constraints Discovered

1. **Claude Max subscription ≠ API key.** The Claude Agent SDK requires
   `ANTHROPIC_API_KEY`. The claude.ai Max subscription is only accessible
   interactively via the CLI. This makes Claude Code dispatch impossible without
   a separate paid API key.

2. **opencode server is per-directory.** One `opencode serve` instance = one
   project. Multi-project monitoring requires running multiple server instances
   on different ports and aggregating them in the dashboard.

3. **opencode mDNS discovery** (`--mdns` flag) could be used to auto-discover
   running opencode instances on the local network without manual port configuration.

4. **Fallback agent (#3) is TBD.** If it ends up being opencode with a different
   model config (openrouter/kimi or openrouter/minimax), it gets the same HTTP
   integration for free. If it's a separate tool, a new adapter is needed.

---

## User Requirements (from design sessions)

- **Primary job:** Dashboard overview — all agents at a glance
- **Secondary:** Review what agents did (diff + conversation)
- **Tertiary:** Dispatch new tasks
- **Unit of display:** Hierarchical — project → agent type → session instance
- **Project = directory**, must be git-tracked (auto-init if not)
- **Projects:** Frequently changing, not a fixed set
- **Attention types:** Tool/permission approval · clarifying question · done/review
- **Dispatch:** ⌘K command-palette, opencode only
- **Notifications:** In-app only, no OS interruptions
- **Theme:** cleo-parchment, follows macOS appearance
- **Delivery:** No strong preference (desktop app or browser tab)
- **Concurrent sessions:** 4–8 typical
