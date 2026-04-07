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

**Scope:**
- Service layer: connect to N `opencode serve` instances (manual port config initially, mDNS discovery stretch goal)
- SSE event stream subscription per instance
- Session state mapping: opencode status -> 6 card states
- Attention detection (tool approval, clarifying questions, completion)
- Elapsed timers (live counting for running sessions)
- Project grouping from real data, sort by recency, attention-needed float-to-top
- Error handling: instance down, reconnection, stale state cleanup

**Validation:**
- Connect to a running `opencode serve` instance
- Dispatch a task (via opencode CLI), see card go running -> done
- SSE stream reconnects after network interruption
- Multiple instances on different ports aggregate correctly

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
