# flight deck — Structure & Build Phases

> Status: Approved.
> Last updated: 2026-04-11

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

**Shipped:**
- `OpencodeInstanceClient` extended with action methods: `fetchMessages`, `sendPrompt`, `respondPermission`, `abortSession`, `createSession`. Permission tracking upgraded from a `Set<string>` of IDs to a `Map<string, SdkPermission>` so the renderer can render the actual title/pattern/command for approval banners.
- `OpencodeRegistry` gains lookup helpers (`findClientForSession`, `findClientByKey`, `firstClient`, `listClients`) used by the new IPC handlers.
- IPC bridge adds: `opencode:session:messages`, `opencode:session:prompt`, `opencode:session:respond`, `opencode:session:abort`, `opencode:session:create`, `opencode:diff` (spawns `git -C <path> diff --no-color`), `opencode:todo` (spawns `td usage -q -w <path>`). All exposed via `window.electronAPI.opencode`.
- Renderer: centralized `electronAPI.d.ts` ambient types (previously scattered local `declare global` blocks).
- `useSessionDetail(session, config)` hook fetches messages on session change and refetches when `lastActivity` advances (live snapshot push → refetch). Mock mode returns a static fixture.
- `ContextPanel` rewritten: clickable tab bar (Conversation / Diff / Todo). Conversation renders user/agent/tool parts with collapsible tool output and auto-scroll-to-bottom. Diff tab runs `git diff` in main and colorizes +/−/@@ lines. Todo tab runs `td usage -q` with a Refresh button. Reply textarea sends prompts via `session.prompt` (disabled in mock mode, disabled while session state disallows reply).
- `AttentionBanner` wired to real actions: Allow → `respondPermission('once')`, Deny → `respondPermission('reject')`. Question state points the user at the reply box. Review button is a no-op placeholder (state never assigned in Phase 3).
- `CmdKDispatch` overlay: prompt textarea + project selector + recent dispatches (localStorage, bounded to 20 entries). Cmd/Ctrl+Enter submits via `createSession` + `sendPrompt`. Esc closes. Mock mode skips the dispatch with a console warning.
- Full-screen mode: `F` toggles (NavRail + main-content hidden, ContextPanel fills body). Escape cascades: CmdK → full-screen → panel.
- Keyboard nav: Cmd/Ctrl+K + Escape are global (work inside text inputs). J/K/F/1-4/Enter still ignore inputs.
- TopBar `⌘K Dispatch` button is now a real button wired to the same handler.

**Scope changes from the original plan:**
- Diff tab renders a single unified text block rather than a file tree + diff split. File tree revisit in Phase 4 if it becomes ergonomic pain.
- Dispatch overlay target selector is project-only. Agent defaults to opencode (claude-code is still Phase 4 monitor-only) and session mode is always "New session". Append-to-existing is a follow-up — reply to running sessions already works from the context panel.
- `review` state remains reserved and unassigned in Phase 3. The `Mark Reviewed` button is a visual placeholder until the watermark signal lands.

**Validation status:**
- ✅ `npm run typecheck` clean.
- ✅ `npm run build` green (main 91.76 kB, renderer 632.03 kB).
- ⏳ Reviewer must manually smoke: (1) click a session card → context panel opens; (2) switch tabs (Conversation/Diff/Todo) with a real opencode project and confirm live data renders; (3) press `F` → full-screen, `Esc` → back; (4) press `⌘K` → dispatch overlay, fire a prompt at a real directory, confirm session appears on dashboard; (5) trigger a permission request in opencode, click Allow/Deny, confirm the server receives it.

---

## Phase 4 — Claude Code Monitor + Project Management

**Ticket:** `td-a84ca8`
**Depends on:** `td-4a41eb` (Claude Code monitor design — complete, see `docs/spec-claude-monitor.md`)

**Goal:** Claude Code sessions appear alongside opencode sessions. Projects are manageable from the UI.

**Design:** See `docs/spec-claude-monitor.md` for full design. Summary:

- **Data sources:** `~/.claude/sessions/<pid>.json` (live process registry) + `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl` (conversation log)
- **State inference:** Tail-read last 4KB of JSONL; `assistant.stop_reason=tool_use` → running, `system.stop_hook_summary` → idle, dead process mid-turn → error
- **Architecture:** `src/main/claude/` module (monitor.ts, parser.ts, types.ts). `ClaudeMonitor` watches files + polls process liveness. Merges into `OpencodeRegistry.getSnapshot()`.
- **No new IPC:** Reuses `opencode:snapshot` push. Renderer already handles `agentType: 'claude-code'`.
- **New dep:** `chokidar ^4.0.0` for file watching.
- **States assigned:** `running`, `idle`, `error` only. `approval`/`question`/`review` not assigned (no structured signal in JSONL).

**Scope:**
- `ClaudeMonitor` + `ClaudeParser` in `src/main/claude/`
- `OpencodeRegistry` integration (merge Claude Code sessions into snapshot)
- Monitor-only guard in dispatch UI (can't send to Claude Code)
- Projects view: add / archive / restore / hard delete
- Add Project drawer with real-time path validation + git init
- Undo toast for archive actions

**Validation:**
- Run `claude` in a terminal, see it appear on dashboard with correct state
- Claude Code session transitions through states as work progresses
- Kill `claude` mid-turn → session shows `error` state
- Dispatch overlay shows Claude Code as disabled with "monitor only" tooltip
- Add a new project directory, see it appear on dashboard
- Archive and restore a project
- `npm run typecheck` clean

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

## Phase 5 — Agent Profiles & Managed Instances

**Ticket:** `td-be1f9c`

**Goal:** flight deck launches and manages `opencode serve` processes on behalf of
configured Agent Profiles. Users can run multiple opencode instances with
different models (e.g. Claude Sonnet as primary, kimi-k2.5 as fallback) and
select between them in the `⌘K` dispatch overlay.

**Design:** See `docs/spec-fallback-agent.md` for full design. Summary:

- **AgentProfile** — reusable env template (label, agentType, provider, model, apiKey, isDefault) stored in config.
- **OpencodeLauncher** — spawns `opencode serve` with profile env vars, auto-assigns ports 4100–4200, polls until connectable, kills all on app quit.
- **IPC:** `profile:list/add/update/delete`, `instance:dispatch` (launch + connect + createSession + sendPrompt).
- **Settings UI:** Agent Profiles table (inline-edit, masked API key, default radio).
- **⌘K overlay:** Profile dropdown; shows "starting agent…" while launcher works. Falls back to legacy path when no profiles configured.

**Validation:**
- Add a profile in Settings, dispatch via `⌘K` with that profile selected
- `opencode serve` process appears on the correct port
- Session card appears on dashboard
- App quit kills all managed processes
- `npm run typecheck` clean

---

## Phase 3 (new roadmap) — HTTP Server + Mobile Client

**Ticket:** `td-f3881d`
**Depends on:** Phase 1 Claude Code dispatch complete (`td-8b02fa`)

**Goal:** Access and control sessions from a mobile device over Tailscale.

**Shipped:**
- `AppConfig.http` — `{ enabled, bindAddress, port, token }`. Token auto-generated (UUID) at first run, stored plaintext in config.json (local-network secret, file perms 0600). Validated in `validatePatch`.
- `src/main/http/server.ts` — Hono app factory. Auth middleware: `Authorization: Bearer <token>` header (mutations) or `fd_token` cookie (SSE + reads). Rate limiter: 10 failures → 60s block per IP. `timingSafeEqual` via sha256 hash. `GET /pair?token=t` sets HttpOnly cookie, 302 to `/`. `GET /api/snapshot`, `GET /api/events` (SSE, cleans up listener on disconnect), `POST /api/dispatch`, `POST /api/session/:id/respond`, `POST /api/session/:id/abort`. `GET /*` serves mobile SPA with SPA fallback.
- `src/main/http/index.ts` — `HttpServer` class (start/stop/restart, emits listening/error/stopped).
- `src/main/http/static.ts` — `getMobileRoot()`: dev uses `out/mobile/`, packaged uses `resources/app.asar.unpacked/out/mobile/`.
- `src/main/index.ts` wired: start if enabled, restart on config change, stop in before-quit. Status events broadcast via `http:status` IPC.
- `mobile/` — standalone Vite+React+TypeScript SPA (35 modules, ~204 kB gzip 64 kB). Views: Dashboard (attention-first session list), SessionDetail (approve/reject/abort), Dispatch (stub — no `/api/profiles` yet). SSE subscription via `EventSource`. Bearer token in `sessionStorage`. Dark theme.
- `electron-builder.yml` — `asarUnpack: ["out/mobile/**"]` so Hono can `fs.readFile` static assets in packaged builds.
- Settings: "Remote Access" section — enable toggle, bind address, port, QR code canvas (`qrcode.toCanvas`), copy URL button, regenerate token, live `http:status` indicator.

**Deps added:** `hono`, `@hono/node-server`, `qrcode`, `@types/qrcode`.

**CSRF / security:** Mutating HTTP routes require Bearer header, not cookie. SSE uses cookie (EventSource cannot set headers). CORS explicitly absent (same-origin). No `apiKey` exposed over HTTP — dispatch accepts `profileId` only.

**Scope boundaries:**
- `/api/profiles` endpoint deferred to Phase 4 (needed for full dispatch from mobile)
- No HTTPS / self-signed cert — Tailscale handles transport security
- No service worker / PWA manifest — service workers require HTTPS on LAN

**Validation:**
- `npm run build` + `npm run build:mobile` clean
- `npm run typecheck` clean
- Enable in Settings → QR appears, http:status shows "Listening"
- Open pairing URL on mobile → cookie set, dashboard loads, sessions update via SSE
- Approve/abort a session from mobile → main process receives the request

---

## Out of Scope (for now)

- Enodios integration (deferred per research.md)
- OS-level notifications (spec says in-app only)
- Multi-machine / remote daemon mode
- Auto-update / code signing / distribution
