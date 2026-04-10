# flight deck Codebase Evaluation

**Date:** 2026-04-08  
**Session:** ses_0ab6d4  
**Ticket:** td-6f1e2a

---

## 1. Structure Map

```
agentctl/
├── src/
│   ├── main/                        # Electron main process
│   │   ├── index.ts                 # App entry, window creation, IPC registration
│   │   ├── config/store.ts          # ConfigStore — JSON persistence, atomic write, safeStorage
│   │   ├── ipc/                     # IPC handlers split by domain (added td-b607d3)
│   │   │   ├── config.ts            # get-theme, config:get/set
│   │   │   ├── opencode.ts          # opencode:* handlers
│   │   │   ├── project.ts           # project:* handlers
│   │   │   ├── profile.ts           # profile:* handlers
│   │   │   └── instance.ts          # instance:dispatch
│   │   ├── opencode/
│   │   │   ├── client.ts            # OpencodeInstanceClient (SSE, hydrate, reconnect)
│   │   │   ├── registry.ts          # OpencodeRegistry (N clients, snapshot aggregation)
│   │   │   ├── launcher.ts          # OpencodeLauncher (spawn opencode serve, port mgmt)
│   │   │   ├── mapper.ts            # Pure event→state mapper
│   │   │   └── types.ts             # InstanceSnapshot, NormalizedProject, etc.
│   │   └── claude/
│   │       ├── monitor.ts           # ClaudeMonitor (chokidar, liveness poll)
│   │       ├── parser.ts            # JSONL tail parser → state inference
│   │       └── types.ts             # ClaudeSession, ClaudeProject, ClaudeSnapshot
│   ├── preload/index.ts             # contextBridge — full typed API surface
│   └── renderer/src/
│       ├── main.tsx                 # React entry
│       ├── App.tsx                  # Root: layout, keyboard nav, state orchestration
│       ├── types.ts                 # Shared renderer types
│       ├── mockData.ts              # Dev fixture (not guarded from prod builds)
│       ├── theme.css                # CSS custom properties (dark + light)
│       ├── global.css               # Layout, component styles
│       ├── electronAPI.d.ts         # Ambient window.electronAPI types
│       ├── hooks/
│       │   ├── useSessionService.ts # IPC subscription + mock branch
│       │   ├── useConfig.ts         # Config IPC + push subscription
│       │   ├── useTheme.ts          # nativeTheme sync
│       │   ├── useKeyboardNav.ts    # Global keyboard handler
│       │   ├── useSessionDetail.ts  # Messages fetch + refetch on activity
│       │   └── useElapsedTick.ts    # 1s ticker for elapsed timers
│       ├── components/
│       │   ├── TopBar.tsx           # Health dot, attention badge, dispatch button
│       │   ├── NavRail.tsx          # 4-icon nav, 1–4 shortcuts
│       │   ├── SessionCard.tsx      # 88px card, 6 state variants
│       │   ├── ProjectGroup.tsx     # Collapsible project section
│       │   ├── StatusDot.tsx        # Color-coded dot, optional pulse
│       │   ├── ContextPanel.tsx     # 3-tab panel (Conversation/Diff/Todo)
│       │   └── CmdKDispatch.tsx     # ⌘K overlay
│       └── views/
│           ├── Dashboard.tsx
│           ├── Sessions.tsx
│           ├── Projects.tsx
│           └── Settings.tsx
├── docs/                            # Specs and design artifacts
│   ├── structure.md                 # Phase plan (Phases 1–5, decisions, validation)
│   ├── spec-ux.md                   # Full UX spec (layout, components, flows)
│   ├── spec-theme.md                # cleo-parchment color system
│   ├── spec-claude-monitor.md       # Claude Code monitor design
│   ├── spec-fallback-agent.md       # Agent profiles / managed instances design
│   └── research.md                  # Prior research notes
├── src/main/**/*.test.ts            # Vitest unit tests (91 tests, added td-c06065)
├── vitest.config.ts
├── electron.vite.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
└── package.json
```

**Build system:** electron-vite (Vite 6 + Electron 35). Main bundled as ESM. Test runner: Vitest 4.

---

## 2. Architecture Assessment

**Strengths:**
- Electron security posture is correct: `contextIsolation: true`, `nodeIntegration: false`, full contextBridge API surface in preload. No renderer has Node access.
- IPC design is clean — all channels namespaced (`opencode:*`, `project:*`, `profile:*`), handlers are thin dispatchers into domain objects.
- `validPath()` guard on all shell-executing IPC handlers prevents path traversal and flag-injection via leading-dash paths.
- Main process owns all I/O; renderer is purely reactive. The separation is well-maintained.
- `ConfigStore` uses atomic write (write to `.tmp`, then `rename`).
- `OpencodeInstanceClient` hydrate-then-drain-buffer pattern handles the race between SSE stream open and initial snapshot fetch correctly.
- `OpencodeRegistry.deriveAggregate()` uses worst-of-N precedence (error > reconnecting > connecting > connected).
- Disposal pattern is consistent across all domain objects — all implement `dispose()` / `stopAll()` and are called in `before-quit`.

---

## 3. Findings by Severity

### HIGH — Addressed in td-2db2f6

| Finding | Resolution |
|---|---|
| API keys stored plaintext in `userData/config.json` | `safeStorage.encryptString` — keys encrypted at rest, decrypted in-memory only |
| `config:set` IPC accepts `Partial<AppConfig>` with no validation | `validatePatch()` added — throws on any shape violation before write |

### MEDIUM — Addressed in td-92bedd

| Finding | Resolution |
|---|---|
| `ClaudeMonitor` path encoding inlined in two places — divergence risk | Both callers now use shared `encodeProjectPath()` from `parser.ts` |
| `instance:dispatch` connect-wait used `.once` — consumed by intermediate `reconnecting` events | Replaced with `.on` + explicit cleanup; resolves only on `connected` |
| Unknown provider in `buildEnv()` silently set `OPENROUTER_API_KEY` | Now logs a warning and sets no key |

### MEDIUM — Addressed in td-c06065

| Finding | Resolution |
|---|---|
| Zero test coverage despite per-phase test goals in `structure.md` | Vitest configured; 91 unit tests across mapper, store, parser, launcher, registry |

### MEDIUM — Addressed in td-b607d3

| Finding | Resolution |
|---|---|
| `main/index.ts` growing monolithic (332 lines, all IPC inline) | Split into `src/main/ipc/{config,opencode,project,profile,instance}.ts` |
| Several spec UX gaps (diff file tree, ⌘K append, New Session btn, A/R shortcuts) | All implemented |

### LOW — Open

| Finding | Status |
|---|---|
| `mockData.ts` not guarded from production builds | Open — low risk, tree-shaken in practice |
| `add.js` scratch file at repo root | Open — should be removed |
| `MessageRecord.info` / `.parts` typed as `unknown` | Accepted — SDK shape uncertainty; renderer has no type safety on message rendering |

---

## 4. UX vs Spec Gap Analysis (at time of evaluation)

| Spec item | Status at evaluation | Status after td-b607d3 |
|---|---|---|
| Three-column layout, cleo-parchment theme | ✅ Implemented | ✅ |
| All 6 session state variants | ✅ Implemented | ✅ |
| Keyboard nav: 1–4, J/K, Esc, Enter, F, ⌘K | ✅ Implemented | ✅ |
| ContextPanel: Conversation / Diff / Todo tabs | ✅ Implemented | ✅ |
| CmdKDispatch with history | ✅ Implemented | ✅ |
| Agent Profiles + managed instance dispatch | ✅ Implemented | ✅ |
| Diff tab: file tree + unified diff split | ❌ Gap | ✅ Implemented |
| ⌘K append-to-session mode | ❌ Gap | ✅ Implemented |
| `[+ New Session]` on project group header | ❌ Gap | ✅ Implemented |
| `A` (attention filter) / `R` (refresh) shortcuts | ❌ Gap | ✅ Implemented |
| Hard-delete: type project name to confirm | ✅ Already implemented | ✅ |
| `[Mark Reviewed]` button wired | ❌ Placeholder only | ❌ Still placeholder |

---

## 5. Implementation Output

All findings were acted on in the same session. Four tickets created and submitted for review:

- **td-2db2f6** — Security fixes (commit `b8732c5`)
- **td-92bedd** — Correctness fixes (commit `d43915d`)
- **td-c06065** — Test infrastructure + 91 unit tests (commit `9f4463a`)
- **td-b607d3** — UX spec gaps + IPC split (commits `84792e9`, `1f4a1da`)

---

# UAT Follow-up Batch Review

**Date:** 2026-04-10
**Session:** ses_a75d62 (reviewer)
**Implementer session:** ses_629813
**Commits reviewed:** `cade0a9..0a76709` (+783/-111, 21 files, 4 commits)

Tickets reviewed and approved:

| Ticket | Title | Verdict |
|---|---|---|
| td-838cbc | OpencodeMonitor — file-watch ~/.local/share/opencode/storage | APPROVED |
| td-3d1f6c | Slash command wiring — POST /session/:id/command + GET /command | APPROVED |
| td-121104 | SessionCard abort [✕] button missing on hover | APPROVED |
| td-68394f | Projects view incomplete vs spec-ux §5 | APPROVED |
| td-0924b7 | Add Project drawer close [x] hit target too small | APPROVED |
| td-c0c93f | LOW/NIT cleanup from UAT bug hunt | APPROVED |
| td-7f5891 | TopBar deviates from spec-ux §1 | APPROVED |
| td-a045b1 | SessionCard hover border not applied | APPROVED |
| td-ce4e56 | Settings default-profile radio not themed | APPROVED |

Typecheck: PASS. No CRITICAL issues. Architectural compliance confirmed (IPC boundary clean, mock toggle preserved, no new packages).

## Review Findings — Open

### HIGH — td-b7c63f

| Finding | File | Status |
|---|---|---|
| Stale closure in `ContextPanel.handleSend` — `useCallback` dep array missing `session.agentType` and `session.instanceKey`. If session object is replaced while the panel is mounted, slash command routing uses stale agent type, potentially dispatching to a read-only file-watch session. | `src/renderer/src/components/ContextPanel.tsx:227` | Open |

**Fix:** add `session.agentType, session.instanceKey` to the `useCallback` dependency array.

### MEDIUM — td-47f570

| Finding | File | Status |
|---|---|---|
| Projects gear (⚙) dropdown has no click-outside or blur dismiss handler. Stays open when user clicks elsewhere on the page. | `src/renderer/src/views/Projects.tsx:617` | Open |

**Fix:** `useEffect` with `mousedown` listener on `document`, or a transparent overlay behind the menu.

### MEDIUM — td-9637e6

| Finding | File | Status |
|---|---|---|
| Git status in Projects view fetched once on path-list change; never refreshed. Branch/dirty/ahead-behind data goes stale after commits, pushes, or branch switches without navigation. | `src/renderer/src/views/Projects.tsx:432-445` | Open |

**Fix:** refresh on interval (≤60s), window focus event, or registry change event. A manual refresh button is a viable fallback.

### MEDIUM — td-f794cb

| Finding | File | Status |
|---|---|---|
| `postCommand` sends the command name to the opencode server without any client-side validation. A malformed name (e.g. containing newlines or control chars) is sent verbatim. | `src/main/opencode/client.ts:185` | Open |

**Fix:** guard in IPC handler: `if (!/^[a-zA-Z0-9_-]+$/.test(command)) throw new Error('invalid command name')`.

### LOW — td-3b1b2c

| Finding | File | Status |
|---|---|---|
| `mockData.ts` `now()` wrapper is called once at module load — provides no freshness benefit over `const now = Date.now()`. Wrapper adds indirection without achieving stated intent of keeping timestamps current over long sessions. | `src/renderer/src/mockData.ts:57` | Open |
| `Projects.tsx` `useEffect` dep uses `configProjects.map(p => p.path).join('|')` — pipe in a path causes false collision. Use `JSON.stringify(...)` or a `useMemo`. | `src/renderer/src/views/Projects.tsx:445` | Open |
