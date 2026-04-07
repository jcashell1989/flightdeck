# agentctl — Structure & Build Phases

> Status: Approved.
> Last updated: 2026-04-06

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Option C — standalone app | UX spec too opinionated for a fork; multi-agent monitoring doesn't fit opencode's single-instance console |
| Tech stack | Electron + React + Vite | Mature ecosystem, Node.js for file watching / process mgmt, dev velocity over bundle size |
| Theme | cleo-parchment CSS custom properties | Spec-complete, dark/light via `nativeTheme` + `prefers-color-scheme` |
| Primary agent | opencode via `@opencode-ai/sdk` | HTTP REST + SSE, one server per project directory |
| Claude Code | Passive monitor only | Max subscription != API key; file watch + process list |

---

## Phase 1 — Skeleton

**Ticket:** `td-633fbb`

**Goal:** Electron app opens, shows three-column layout with cleo-parchment theme, populated with mock data. No backend connections.

**Scope:**
- Electron + React + Vite scaffold (electron-vite)
- CSS custom properties from spec-theme.md
- Dark/light switching via `nativeTheme` + `prefers-color-scheme`
- TopBar, NavRail, main content area, context panel shell
- SessionCard component with all 6 state variants — hardcoded mock data
- ProjectGroup component with collapsible sections
- Navigation between Dashboard / Sessions / Projects / Settings views
- Keyboard nav (`1`-`4`, `J`/`K`, `Esc`)

**Validation:**
- `npm run build` succeeds, app launches
- Layout matches spec wireframes
- All 6 card state variants render correctly
- Dark/light toggle follows system appearance
- Keyboard shortcuts `1`-`4`, `J`/`K`, `Esc` work

---

## Phase 2 — Live Data

**Ticket:** `td-92ae8c`

**Goal:** Dashboard shows real session state from running opencode instances. Cards update in real time.

**Shipped:**
- `ConfigStore` at `userData/config.json` with main-process IPC + renderer `useConfig()`. Single source of truth for opencode instances + mock toggle.
- `OpencodeInstanceClient` wrapping `@opencode-ai/sdk@1.3.17`: hydrates via `session.list()` + `session.status()`, subscribes to `${baseUrl}/event` via the `eventsource` package, applies events through a pure mapper. Exponential backoff reconnect (1/2/4/8/16/30s cap).
- `OpencodeRegistry` (N clients keyed by host:port). Syncs with config — add/remove/rebuild on change. Aggregates per-instance snapshots into a single `{ projects, aggregateStatus }` payload. Mock-mode toggles tear down live connections.
- IPC bridge: `opencode:snapshot` (request + push) via `window.electronAPI.opencode.{getSnapshot, onSnapshot}`.
- `useSessionService()`: mock branch (config.mock.enabled) vs live IPC branch, single hook.
- Dashboard / Sessions / ProjectGroup render from the hook. Sort memoized (a0a588 HIGH-2/3), `elapsedMs` derived via `useElapsedTick` (a0a588 LOW-5 + MEDIUM-4), `allSessions` deps fixed (MEDIUM-5).
- **Attention semantics change:** `idle` is now an attention state — an agent with no reason to be idle is a problem. Attention set is `{approval, question, error, idle}`. See `spec-ux.md §2`.
- Connection banner in TopBar renders `connecting` / `reconnecting` / `error`.
- Settings UI: mock toggle + opencode instances CRUD (host/port/label).

**Scope changes from the original plan:**
- `question` state is **never assigned from opencode events** — SDK 1.3.17 exposes no `question.*` events, only `permission.updated` / `permission.replied` and `session.status/idle/error`. The `question` state slot stays in the type enum for the Claude Code monitor (`td-4a41eb`) and a possible future SDK version.
- `review` state is **reserved for Phase 3** — requires an idle + uncommitted-diff + unseen-watermark signal that needs the diff view to exist. Phase 2 never assigns `review`.
- mDNS discovery, HTTP basic auth (`OPENCODE_SERVER_PASSWORD`), and remote daemon mode remain out of scope.
- `td-a0a588` MEDIUM-8 (J/K nav order mismatch) stays on that ticket as a focused follow-up — orthogonal to live data.

**Validation status:**
- ✅ `npm run typecheck` clean.
- ⏳ End-to-end smoke test against a real `opencode serve` instance is a manual step that must run in a different session (per the td protocol — no self-review). The reviewer should: (1) start `opencode serve`, (2) flip `config.mock.enabled` off via Settings, (3) dispatch a task via `opencode` CLI, (4) confirm state transitions render live, (5) kill the server and confirm the reconnect banner appears, (6) restart and confirm hydration.

---

## Phase 3 — Interaction

**Ticket:** `td-9200a9`

**Goal:** Inspect sessions and dispatch new tasks without leaving the dashboard.

**Scope:**
- Context panel: Conversation tab (message rendering, user/agent/tool types, scroll, reply input)
- Context panel: Diff tab (file tree + unified diff, cleo-parchment diff colors)
- Context panel: Todo tab (`td` output renderer)
- Attention banners (approval Allow/Deny, question reply, review Mark Reviewed)
- Cmd+K dispatch overlay (prompt input, project/agent/session selectors, dispatch history)
- Full-screen session mode (`F` / double-click)
- Reply-to-agent input (send follow-up instructions to running session)

**Validation:**
- Approve a tool-use request from the attention banner
- Reply to a clarifying question
- Dispatch a new task via Cmd+K, watch it run
- Review a completed session's diff
- Full-screen mode enters and exits cleanly

---

## Phase 4 — Claude Code Monitor + Project Management

**Ticket:** `td-a84ca8`
**Depends on:** `td-4a41eb` (Claude Code monitor design)

**Goal:** Claude Code sessions appear alongside opencode sessions. Projects are manageable from the UI.

**Scope:**
- File watcher on `~/.claude/projects/` for Claude Code session detection
- Process list polling for running `claude` processes
- State parsing: map Claude Code file state -> 6 session card states
- Monitor-only guard in dispatch UI (can't send to Claude Code)
- Projects view: add / archive / restore / hard delete
- Add Project drawer with real-time path validation + git init
- Undo toast for archive actions

**Validation:**
- Run `claude` in a terminal, see it appear on dashboard with correct state
- Claude Code session transitions through states as work progresses
- Dispatch overlay shows Claude Code as disabled with "monitor only" tooltip
- Add a new project directory, see it appear on dashboard
- Archive and restore a project

---

## Validation Strategy

**Per-phase smoke test** (manual, before merge):
1. `npm run build` succeeds, app launches without errors
2. Walk through the phase's validation scenarios above
3. No regressions on previous phases
4. Keyboard nav still works, focus visible

**Automated tests** (lightweight, grow with the codebase):
- Phase 1: Component snapshot tests for SessionCard state variants
- Phase 2: Unit tests for opencode service layer (connection, state mapping, reconnection)
- Phase 3: Unit tests for message parsing, diff rendering logic
- Phase 4: Unit tests for Claude Code state parser

No E2E framework until interaction surface stabilizes.

---

## Out of Scope (for now)

- Fallback agent integration (`td-be1f9c` — deferred, low priority)
- Enodios integration (deferred per research.md)
- OS-level notifications (spec says in-app only)
- Multi-machine / remote daemon mode
- Auto-update / code signing / distribution
