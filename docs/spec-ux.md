# agentctl — UX/UI Specification

> Status: Approved. Ready for Structure phase.
> Last updated: 2026-04-06

---

## 1. Layout

### Overall Structure

Three-column layout: persistent left nav rail, scrollable main content area,
collapsible right context panel.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● AGENTCTL                    [⚠ 3]  [⌘K Dispatch]  [● 2 running]  [⚙]     │  ← Top bar (40px)
├────────┬─────────────────────────────────────────────┬────────────────────────┤
│        │                                             │                        │
│  NAV   │           MAIN CONTENT AREA                │   CONTEXT PANEL        │
│  RAIL  │           (scrollable)                     │   (collapsible, 320px) │
│ (56px) │                                             │                        │
│   ⊞    │                                             │                        │
│   ⊟    │                                             │                        │
│   ⊕    │                                             │                        │
│   ⚙    │                                             │                        │
└────────┴─────────────────────────────────────────────┴────────────────────────┘
```

### Top Bar (40px, always visible)

- **Left:** App wordmark `AGENTCTL` in monospace. Single status dot (aggregate health).
- **Center:** Attention badge `⚠ 3` — count of sessions needing human input. Clicking opens attention-filtered view.
- **Right cluster:** `[⌘K Dispatch]` button · `● 2 running` live counter · `[⚙]` settings.

### Left Nav Rail (56px, icon-only)

Four icons, vertically stacked. Active state: accent-color left border + filled icon.
Keyboard: `1`–`4` jumps to each view globally. Tooltip on hover.

```
  ⊞  Dashboard   (1)
  ⊟  Sessions    (2)
  ⊕  Projects    (3)
  ⚙  Settings    (4)
```

### Main Content Area

Scrollable, 24px padding. Content varies by view:
- **Dashboard:** Grouped project cards
- **Sessions:** Flat filterable table
- **Projects:** Project management UI

### Context Panel (320px, slides in from right)

Triggered by clicking a session card. Overlaps main content (does not push it).
On screens >1600px: always visible, shows last-focused session.
On screens >1400px: widens to 480px when open.

Close: `Esc` or `×` button. Opening a second card replaces panel content instantly.

---

## 2. Dashboard Cards

### Project Group

Top-level grouping. Collapsible section header per project.

```
▼  auth-service          /Users/julian/projects/auth-service     ● 2 active  [+ New Session]
   └─ opencode ──────────────────────────────────────────────────────────────────────────────
      [session card]  [session card]
   └─ claude-code ──────────────────────────────────────────────────────────────────────────
      [session card]
```

**Project header:**
- `▼/▶` collapse chevron
- Project name (medium weight)
- Full path (monospace, muted, truncated from left with `…` if long)
- Aggregate status pill: `● 2 active` or `⚠ 1 needs attention`
- `[+ New Session]` — hover-only text button

**Sort order:** Most recent session activity, descending. Projects with any
attention-needed session float above all others regardless of recency.

---

### Session Card

Fixed height: **88px**. Width: fills column (min 280px). Cards wrap horizontally
within each agent group; stack vertically on narrow viewports.

```
┌─────────────────────────────────────────────────────────┐
│ ◉  opencode  #4a2f   ·  auth-service          [⚠]  [✕] │  ← Header row
│                                                         │
│ ✎ editing src/middleware/auth.ts                        │  ← Current action
│                                                         │
│ ▶ running        12:34                   2 min ago      │  ← Status row
└─────────────────────────────────────────────────────────┘
```

**Header row (top 24px):**
- Status dot `◉` — color-coded (see §6)
- Agent type: `opencode` / `claude-code` / `unknown`
- Session ID: short hash `#4a2f`, monospace, muted
- Project name (muted, truncated) — shown in flat Sessions list view
- `[⚠]` attention flag — visible only when attention needed, right-aligned, pulsing
- `[✕]` abort button — hover-only, running sessions only

**Current action row (middle 20px):**
- Icon prefix: `✎` editing · `⚙` running tool · `⏸` waiting · `✓` done · `✗` error
- Short description of current action, monospace, truncated with `…`
- If idle: last completed action in muted color

**Status row (bottom 24px):**
- Status label: `▶ running` / `◌ idle` / `⏸ waiting` / `✓ done` / `✗ error`
- Elapsed time for current run (counting up if running, static when done)
- Relative timestamp: `2 min ago`

**Card borders:**
- Default: 1px solid `--border`
- Hover: 1px solid `--border-active`, slight background lift
- Focused: 1px solid `--accent`
- Attention states: 3px left border (color by attention type — see §6)

**Click targets:**
- Entire card → opens session in context panel
- `[⚠]` flag → opens panel, jumps directly to blocking prompt

---

### Card State Variations

| State | Dot | Left border | Background | Pulse | Attention |
|---|---|---|---|---|---|
| Running | green ● | none | default | no | no |
| Idle | gray ○ | **2px neutral** | default | no | **yes** |
| Tool/permission approval | amber ● | 3px amber | amber tint | yes | yes |
| Clarifying question | blue ● | 3px blue | blue tint | yes | yes |
| Done — review changes | magenta ● | 3px magenta | magenta tint | no | (reserved) |
| Error | red ● | 3px red | red tint | no | yes |

**Attention semantics (Phase 2):** An agent that is **not actively working** is
something the user generally wants to look at. Therefore the attention set is
`{approval, question, error, idle}` — only `running` is "leave it alone."
`review` is reserved for a Phase 3 signal (idle + uncommitted-diff + unseen
watermark) and is never assigned in Phase 2. `idle` gets a thinner 2px neutral
left border — visible enough to float to the top of sorts and show the ⚠ flag,
quiet enough not to read as loudly as the 3px colored states.

Pulse: status dot scales 1.0 → 1.3 → 1.0 on 2s ease-in-out loop.
Only on approval and question states (actively blocking). Idle, error, and
review are static.

---

## 3. Session Drill-Down (Context Panel)

### Panel Layout

```
┌──────────────────────────────────────────────────────┐
│ ← Back   opencode #4a2f · auth-service        [⚙][✕]│  ← Panel header
├──────────────────────────────────────────────────────┤
│  [Conversation]  [Diff ·14]  [Todo ·3]               │  ← Tab bar
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ ⚠ WAITING FOR INPUT                          │    │  ← Attention banner (sticky)
│  │ Approve: run `npm test` in auth-service?     │    │
│  │                         [Allow]  [Deny]      │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ── Recent (last 5 messages) ──────────────────      │
│                                                      │
│  [user] Refactor the auth middleware to use…         │
│  [agent] I'll start by reading the current…          │
│  [tool:read] src/middleware/auth.ts → 142 lines      │
│  [agent] The current implementation uses…            │
│  [tool:edit] Modifying src/middleware/auth.ts        │
│                                                      │
│  ── ↑ Full history ─────────────────────────────     │
│  (scroll up to load more)                            │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ Reply to agent…                    [Send ↵]  │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### Conversation Tab

**Attention Banner** (sticky at top, only when attention needed):
- Color matches attention type (amber / blue / magenta)
- Type 1 — approval: shows command, `[Allow]` and `[Deny]` buttons
- Type 2 — question: shows agent's question, text input to reply
- Type 3 — done: shows summary ("14 files changed"), `[Open Diff]` shortcut + `[Mark Reviewed]` button

**Message rendering:**
- `[user]` — right-aligned, subtle background
- `[agent]` — left-aligned, no background
- `[tool:*]` — full-width, monospace, collapsed by default (`▶ tool:read auth.ts` expand toggle)
- Tool output: code block when expanded
- Timestamps: hover-only

**Scroll behavior:**
- Opens showing bottom of recent messages (last 5)
- Scroll up loads full history
- "Jump to bottom" FAB when scrolled up

**Reply input:**
- Single-line, expands to multiline on shift+enter
- `Enter` to send
- Enabled when agent is waiting (Type 2) or session is running (append instructions)
- Disabled with tooltip when idle/done

### Diff Tab

- Badge: file count `Diff ·14`
- File tree left (collapsible), unified diff right
- Files grouped: modified / added / deleted
- Each file header: filename + `+12 -4` line counts
- `[Copy patch]` button in tab bar right
- Colors from cleo-parchment diff palette (see spec-theme.md)

### Todo Tab

- Badge: open task count `Todo ·3`
- Renders `td usage -q` output for the project directory
- Monospace, preserves `td` CLI output formatting
- `[Refresh]` button re-runs `td` command

### Full-Screen Mode

Double-click panel header or press `F` → session fills main content area.
Breadcrumb: `Dashboard > auth-service > opencode #4a2f`.
`Esc` or `← Back` returns to dashboard.

---

## 4. Quick-Dispatch Overlay (⌘K)

### Trigger

- Global: `⌘K` from anywhere
- `[⌘K Dispatch]` button in top bar
- `N` when focused on a project header

### Layout

Centered modal, ~640px wide, backdrop blur + dark scrim.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ⌘  Dispatch                                          [Esc]  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ▶  What should the agent do?                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Target:  [auth-service ▾]  ·  [opencode ▾]  ·  [New ▾]    │
│                                                              │
│  ──────────────────────────────────────────────────────────  │
│                                                              │
│  Recent dispatches                                           │
│  ↑  "Add rate limiting to the auth endpoints"  auth-service  │
│  ↑  "Write tests for the JWT refresh flow"     auth-service  │
│  ↑  "Refactor the middleware to use…"          api-gateway   │
│                                                              │
│  ──────────────────────────────────────────────────────────  │
│                                                              │
│  ⌘↵ Send  ·  Tab to cycle target  ·  ↑↓ history             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Behavior

**Input field:** Large, auto-focused. Monospace. `↑`/`↓` cycles dispatch history
(terminal-style). Shift+enter for multiline.

**Target selectors (three inline dropdowns):**
1. **Project** — defaults to most recently active. Dropdown sorted by recency.
2. **Agent** — defaults to project's default agent. Claude Code shown disabled
   with lock icon + "monitor only" tooltip.
3. **Session mode** — `New session` / `Append to: #4a2f (running)` / `Append to: #3b1e (idle)`

**Smart defaults:** If a session card was focused/hovered before opening,
pre-populate all three from that card.

**Keyboard:** `Tab` cycles dropdowns · `⌘↵` sends · `Esc` dismisses ·
arrow keys in dropdowns · `Enter` to select.

**On send:** Overlay closes. Targeted session card animates to `running`.
Context panel auto-opens to that session.

**Monitor-only guard:** If Claude Code is selected, show inline warning:
"Claude Code is monitor-only. Switch to opencode?" with `[Switch]` option.

---

## 5. Project Management

### Projects View

```
┌──────────────────────────────────────────────────────────────────────┐
│ Projects                                              [+ Add Project] │
├──────────────────────────────────────────────────────────────────────┤
│  Filter: [all ▾]  Sort: [recent activity ▾]                          │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ auth-service          /Users/julian/projects/auth-service    │    │
│  │ ● 2 active sessions   opencode (default)   git: main ·clean  │    │
│  │ Last activity: 2 min ago                      [⚙] [Archive]  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ── Archived (2) ─────────────────────────────────────────────────   │
│  (collapsed, click to expand)                                        │
└──────────────────────────────────────────────────────────────────────┘
```

Each project row: name · full path · active session count · default agent ·
git status (branch · clean/dirty/ahead) · last activity · `[⚙]` · `[Archive]`

### Add Project (right-side drawer)

```
┌─────────────────────────────────────────────┐
│ Add Project                            [✕]  │
├─────────────────────────────────────────────┤
│  Directory                                  │
│  ┌─────────────────────────────────────┐    │
│  │ /Users/julian/projects/new-service  │    │
│  └─────────────────────────────────────┘    │
│  [Browse…]                                  │
│                                             │
│  ✓ Valid directory                          │
│  ⚠ Not a git repo — will initialize         │
│                                             │
│  Default Agent                              │
│  ○ opencode   ● claude-code   ○ auto        │
│                                             │
│  Display Name (optional)                    │
│  ┌─────────────────────────────────────┐    │
│  │ new-service                         │    │
│  └─────────────────────────────────────┘    │
│                                             │
│            [Cancel]  [Add Project →]        │
└─────────────────────────────────────────────┘
```

**Real-time path validation:**
- `⚠ Path does not exist` — red, blocks submit
- `⚠ Not a git repo — will initialize` — amber, allowed
- `✓ Valid git repo` — green

**On submit with git init needed:** Single inline confirmation step within the
drawer ("Initialize git repo in /path/to/dir?") — one click, no separate modal.

**On success:** Project appears at top of dashboard with brief highlight animation.

### Remove / Archive

**Archive** (soft remove):
- No active sessions: immediate, 5-second undo toast at bottom of screen
- Active sessions: inline confirmation within the row ("2 active sessions will
  be terminated. Archive anyway? [Confirm] [Cancel]")
- Archived projects: collapsed section at bottom of Projects view, history preserved

**Restore:** Expand archived section → `[Restore]` moves back to active list.

**Hard delete:** Only via `[⚙]` → "Delete project and history" — requires typing
project name to confirm.

---

## 6. Color / State System

See [`spec-theme.md`](spec-theme.md) for the full cleo-parchment color specification.

### Status color summary

| State | Dark hex | Light hex |
|---|---|---|
| Running | `#5B8A5C` green | `#5B8A5C` green |
| Idle | `#4F473B` gray | `#8A7B6E` gray |
| Tool/permission approval | `#D4AF5A` amber | `#8A7028` yellow |
| Clarifying question | `#556F7C` blue | `#3A5563` blue |
| Done — review changes | `#910766` magenta | `#7A0558` magenta |
| Error | `#B05050` red | `#8B3232` red |

### Attention type visual matrix

| State | Dot | Left border | Background | Pulse | Attention |
|---|---|---|---|---|---|
| Running | green ● | none | default | no | no |
| Idle | gray ○ | 2px neutral | default | no | yes |
| Tool approval | amber ● | 3px amber | amber/5% | yes | yes |
| Question | blue ● | 3px blue | blue/6% | yes | yes |
| Review changes | magenta ● | 3px magenta | magenta/5% | no | (reserved) |
| Error | red ● | 3px red | red/6% | no | yes |

### Accent

```
dark:   #C9A54E  (gold)
light:  #5B8A5C  (green)
```

Used for: focus rings, active nav item, primary buttons, selected card border.

---

## 7. Navigation Model

### Primary navigation

Left rail, `1`–`4` keyboard shortcuts. Four views: Dashboard · Sessions · Projects · Settings.

### Dashboard → Session drill-down

- **Click card** → context panel slides in from right. Dashboard stays interactive.
- **Click `[⚠]` flag** → panel opens directly to blocking prompt.
- **Double-click card header or `F`** → full-screen session view. Breadcrumb shown.
- **`Esc`** → closes panel (if open) or returns to dashboard (if full-screen).
- **`← Back`** → same as `Esc`.

### Context panel behavior

- Opening a second card while panel is open: content replaces instantly (no animation).
- Panel remembers scroll position per session per tab.
- Not a separate route — hash fragment `#session-4a2f` if browser-based.

### Sessions view (flat list)

Alternative to dashboard. All sessions across all projects, sortable table.
Clicking a row opens the same context panel.
Pre-filtered "needs attention" view accessible from top bar attention badge.

### Keyboard navigation

| Key | Action |
|---|---|
| `1`–`4` | Switch nav views |
| `⌘K` | Open quick-dispatch |
| `J` / `K` | Move focus between session cards |
| `Enter` | Open focused card in context panel |
| `F` | Full-screen focused session |
| `Esc` | Close panel / return to dashboard |
| `Tab` | Cycle between main and context panel |
| `A` | Jump to attention-filtered view |
| `R` | Refresh all session statuses |

---

## 8. Key Interaction Flows

### Flow 1: Agent needs approval — user responds

1. Session card left border turns amber. Dot pulses amber. Action: `⏸ Waiting: approve shell command`. Global badge increments.
2. User focuses card (`J`/`K`) or clicks it.
3. Context panel opens. Attention banner at top: command shown, `[Allow]` and `[Deny]`.
4. User scrolls down to see last 5 messages for context.
5. User clicks `[Allow]`. Banner disappears. Card transitions: border gone, dot green, action updates.
6. Attention badge decrements.

### Flow 2: Dispatching a new task

1. User presses `⌘K`. Overlay appears, last active project pre-selected.
2. User changes project via dropdown (type to filter).
3. Agent and session mode already defaulted correctly.
4. User types prompt. `⌘↵` sends.
5. Overlay closes. Project card animates. New session card appears: `▶ running`.
6. Context panel auto-opens to new session.

### Flow 3: Reviewing completed work

1. Session card: violet/magenta border, static dot, action `✓ Done — 8 files changed`. Badge shows `⚠ 1`.
2. User clicks `[⚠]` flag. Panel opens to attention banner: "Session complete. 8 files changed." with `[Open Diff]`.
3. User clicks `[Open Diff]`. Panel switches to Diff tab.
4. User presses `F` for full-screen. Diff widens.
5. User checks Todo tab — sees `td` output.
6. User clicks `[Mark Reviewed]` in attention banner. Card transitions to `◌ idle`. Badge clears.

---

## Component Inventory

| Component | Location | Notes |
|---|---|---|
| `TopBar` | Always visible | Health dot, attention badge, dispatch button, settings |
| `NavRail` | Always visible | 4 icons, keyboard shortcuts 1–4 |
| `ProjectGroup` | Dashboard | Collapsible, sortable |
| `SessionCard` | Dashboard, Sessions list | 88px fixed height, 6 state variants |
| `AttentionFlag` | SessionCard | 3 type variants, pulsing/static |
| `ContextPanel` | Right side | Slides in, 3 tabs |
| `AttentionBanner` | ContextPanel top | Sticky, 3 variants with action buttons |
| `MessageList` | ContextPanel/Conversation | User/agent/tool message types |
| `DiffViewer` | ContextPanel/Diff | File tree + unified diff |
| `TodoPanel` | ContextPanel/Todo | `td usage -q` output renderer |
| `QuickDispatch` | Global overlay | Command palette style |
| `ProjectList` | Projects view | Sortable, filterable rows |
| `AddProjectDrawer` | Projects view | Right-side drawer |
| `StatusDot` | SessionCard | 6 color variants, optional pulse |
| `ElapsedTimer` | SessionCard | Live counting, static when done |
| `AgentBadge` | SessionCard | opencode / claude-code / unknown |
| `AttentionBadge` | TopBar | Count badge, click to filter |
| `UndoToast` | Bottom of screen | 5s timeout, archive undo |
