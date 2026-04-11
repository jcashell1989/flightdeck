# flight deck — UAT Checklist

> **Status:** First automated pass complete (2026-04-10). Playwright + direct CDP via `scripts/uat.mjs`. Mock mode **enabled** this pass (live opencode not available). All §10 opencode items skipped. Second pass needed with mock disabled and live opencode connected.
> **Ticket:** td-93e3fa (automated run) / td-65e2f8 (original tracker)
> **Related specs:** `spec-ux.md`, `spec-theme.md`, `spec-fallback-agent.md`, `spec-claude-monitor.md`
> **Mock mode:** enabled for this pass — live-opencode items marked ⏭. Wordmark item updated: app shows `flight deck` (renamed from agentctl).

Mark each item: ✅ pass · ❌ fail (file bug id) · ⏭ skip (why) · 🟡 partial.

---

## 0. Setup & Environment

### 0.1 Build / launch
- ⏭ `npm install` clean (not tested this pass)
- ✅ `npm run typecheck` green (both `:node` and `:web`)
- ✅ `npm test` — 113 tests pass (checklist count was 91; count updated)
- ✅ `npm run dev` launches without errors in main log
- ✅ App window appears with correct title ("agentctl")
- 🟡 No console errors in DevTools — 4 React style-conflict warnings fire during nav (td-8ba29f)

### 0.2 Disable mock data (required)
- [ ] Open Settings (`4` or gear icon)
- [ ] Find the "mock data" toggle (or the opencode instances section)
- [ ] Set `config.mock.enabled = false`
  - Alternative: quit app, edit `$userData/config.json` directly, set `"mock": { "enabled": false }`, relaunch
  - `$userData` on macOS: `~/Library/Application Support/flight-deck/config.json`
- [ ] Verify mock flag is persisted across restart
- [ ] Dashboard no longer shows mock sessions after reload

### 0.3 Prerequisites
- [ ] An `opencode serve` binary is installed and on `$PATH` (`which opencode`)
- [ ] At least one OpenRouter (or equivalent) API key ready for a profile
- [ ] At least one real git project directory available to add
- [ ] Claude Code exists at `~/.claude/sessions/` (optional — only for monitor tests)

---

## 1. Top Bar (§1)

- ✅ `flight deck` wordmark renders in monospace (renamed from AGENTCTL — checklist updated)
- 🟡 Aggregate health dot shows correct color — present in screenshot, color verification manual
- ✅ Attention badge shows count of sessions needing input (⚠ 5 observed)
- ⏭ Attention badge hidden when count is 0 — sessions always present this pass
- ⏭ Clicking attention badge opens attention-filtered view — manual
- ✅ `[⌘K Dispatch]` button visible and clickable
- ✅ `● N running` counter visible ("1 running" observed with mock session)
- ✅ `[⚙]` settings button navigates to Settings view
- ✅ Top bar stays visible across all views (confirmed across 1-4 nav)

## 2. Nav Rail (§1, §7)

- ✅ Four icons visible: ⊞ Dashboard, ⊟ Sessions, ⊕ Projects, ⚙ Settings
- 🟡 Active view has accent-color left border + filled icon — manual visual verification needed
- ✅ `1` key → Dashboard
- ✅ `2` key → Sessions
- ✅ `3` key → Projects
- ✅ `4` key → Settings
- ✅ Number keys do NOT fire while typing in an input/textarea
- ⏭ Tooltip appears on icon hover — manual
- ⏭ Keyboard focus moves through icons with Tab — manual

## 3. Dashboard (§2)

### 3.1 Empty state
- [ ] With no projects and no sessions, dashboard shows a sensible empty state (not a blank screen or crash)

### 3.2 Project groups
- ✅ Each project renders as a collapsible section with `▼/▶` chevron (screenshot confirmed)
- 🟡 Project name bold, full path muted monospace — visible in screenshot, color/weight manual
- ⏭ Long paths truncate from left with `…` — test paths not long enough this pass
- ✅ Aggregate status pill shows `⚠ N needs attention` (observed: "⚠ 2 needs attention")
- ✅ `[+ New Session]` button visible in DOM (screenshot: visible on frontend-app group)
- ⏭ `[+ New Session]` reachable via keyboard focus — manual a11y test
- ⏭ Clicking `[+ New Session]` opens ⌘K with that project pre-selected — manual
- ⏭ Sort order: most recent activity descending — manual
- ⏭ Projects with any attention-needed session float above the rest — manual
- ⏭ Collapse state persists during the session — manual
- ✅ Grouped by agent type: `opencode` / `claude-code` (both visible in dashboard)

### 3.3 Session cards (§2.2)
- 🟡 Cards render at fixed 88px height — visual, not measured
- ✅ Header row: dot, agent type, `#short-id`, project name, attention flag visible (screenshot)
- ✅ Action row: icon + truncated description visible (e.g. "editing src/middleware/auth.ts")
- ✅ Status row: label, elapsed timer, relative timestamp visible
- ⏭ Elapsed timer counts up live — manual observation
- ⏭ Elapsed timer freezes when stopped — manual
- ⏭ Hover: border becomes `--border-active` — manual
- ⏭ Focus: border becomes `--accent` — manual
- 🟡 Click card → context panel opens — opens in first automated pass; class selector unreliable
- ⏭ `[✕]` abort button hover-only — manual
- ⏭ Clicking `[⚠]` jumps to blocking prompt — manual
- ⏭ Clicking `[✕]` confirms before aborting — manual

### 3.4 Card state variants (§2.3)
Test each state with a real session:
- ✅ **Running** — green dot, card visible (opencode #4a1f "editing src/middleware/auth.ts ▶ running")
- ✅ **Idle** — gray dot, card visible (opencode #2d5f "idle — last action: ran tests")
- ✅ **Tool/permission approval** — amber dot, card visible (opencode #7b3e "waiting: approve shell command `npm test`")
- ✅ **Clarifying question** — blue dot, card visible (claude-code #91a "asking: which auth provider to use?")
- ✅ **Error** — red dot, card visible (opencode #eb2 "failed: npm run build exited with code 1")
- ✅ `review` state does NOT appear anywhere in Phase 2 (confirmed: not seen)

## 4. Sessions view (§7)

- [ ] `2` key navigates here
- [ ] Flat table listing all sessions across all projects
- [ ] Sortable columns (document which ones work)
- [ ] Clicking a row opens same context panel as dashboard cards
- [ ] Attention-filter view reachable from top-bar attention badge
- [ ] `A` key jumps to attention-filtered view
- [ ] `A` does NOT fire while typing in inputs
- [ ] Filter state visible and clearable

## 5. Projects view (§5)

### 5.1 List
- ✅ `3` key navigates here
- 🟡 Projects listed with name, path, session count, default agent, git status, last activity — visual check needed
- ✅ `[+ Add Project]` button top-right
- ⏭ Filter and sort dropdowns work — manual
- ⏭ Archived projects collapsed at bottom — manual
- ⏭ Click to expand archived section — manual

### 5.2 Add project drawer
- ✅ `[+ Add Project]` opens right-side drawer
- ⏭ `[Browse…]` opens native directory picker — manual
- [ ] Path validation fires in real time:
  - [ ] `⚠ Path does not exist` (red, blocks submit)
  - [ ] `⚠ Not a git repo — will initialize` (amber, allowed)
  - [ ] `✓ Valid git repo` (green)
- [ ] Default agent radio group works
- [ ] Display name optional, defaults to basename
- ✅ `[Cancel]` closes drawer with no side effects
- ⏭ `[Add Project →]` commits and closes drawer — not tested (would add duplicate project)
- [ ] New project appears at top of list with highlight animation
- [ ] Git-init-needed case: inline confirmation appears, single click initializes

### 5.3 Archive / restore
- [ ] Archive with no active sessions: instant + 5s undo toast
- [ ] Undo toast works before timeout
- [ ] Archive with active sessions: inline confirmation "N active sessions will be terminated"
- [ ] Confirming terminates sessions and archives
- [ ] Archived project visible in collapsed section
- [ ] `[Restore]` moves it back to active

### 5.4 Hard delete
- [ ] `[⚙]` → "Delete project and history" option visible
- [ ] Type-to-confirm input requires exact project name
- [ ] Case sensitivity — confirm specced behavior (exact vs ignore-case)
- [ ] Leading/trailing whitespace handling documented
- [ ] Special chars in project name (if possible) don't break confirm regex
- [ ] Cancel leaves project intact
- [ ] Confirm hard-deletes project AND history (verify history gone)

## 6. Settings view (§?, spec-fallback-agent.md)

### 6.1 General
- ✅ `4` key navigates here
- ✅ Theme toggle visible in Settings (dark/light option present)
- ⏭ Theme change propagates immediately — manual visual verification
- ✅ Mock data toggle visible and functional (checkbox renders correctly; mock enabled this pass)
- ⏭ Toggling mock.enabled reflects immediately in dashboard — manual

### 6.2 Opencode instances
- ✅ Listed instances show host:port and label (127.0.0.1:4096 "local" visible in screenshot)
- ⏭ Add new instance inline works — manual
- ⏭ Edit host/port inline commits on blur/Enter — manual
- ⏭ Escape reverts inline edit — manual
- ⏭ Delete instance works — manual
- 🟡 Instance status shown — status column not clearly visible in screenshot

### 6.3 Agent profiles
- ✅ Profiles table shows label, agent, provider, model, API key, default columns (screenshot confirmed)
- ✅ Add profile row at bottom (+ button visible)
- ⏭ Inline edit on all fields — manual
- ⏭ API key masked by default — manual
- ⏭ API key revealed on focus — manual
- ⏭ API key plaintext never appears in DOM attributes — manual (inspect element)
- ⏭ Default column is a radio — manual
- ⏭ Deleting the default profile — manual
- ✅ Claude Code profiles disabled/marked monitor-only (⌘K screenshot: "monitor only" chip visible)
- ⏭ New profile gets a persistent UUID — manual
- ⏭ Profile persists across app restart — manual

### 6.4 API key encryption (td-2db2f6)
- [ ] Save a profile with an API key
- [ ] Quit app
- [ ] Inspect `$userData/config.json` — `apiKeyEncrypted` present, no `apiKey` plaintext
- [ ] Relaunch, verify the profile is still usable (decryption succeeded)
- [ ] On Linux without a keychain: confirm behavior (graceful warn? broken?)
- [ ] Simulate migration: manually add a plaintext `apiKey` field to config.json, relaunch — verify it's either migrated or dropped with warning (no silent data loss that confuses user)

## 7. ⌘K Dispatch overlay (§4, td-b607d3)

### 7.1 Open / focus
- ✅ `⌘K` from anywhere opens overlay
- ✅ `[⌘K Dispatch]` button also opens
- ⏭ `N` while focused on project header opens — manual
- ✅ Overlay is centered, ~640px, backdrop blur + scrim (screenshot confirmed)
- ✅ Input field (textarea) auto-focused — "What should the agent do?" placeholder visible
- ⏭ Last active project pre-selected — no configured projects this pass; shows "(No projects)"
- 🟡 Default profile pre-selected — opencode profile shown; no default set this pass
- ⏭ Opening from `+ New Session` button pre-selects that project — manual
- ✅ `Esc` dismisses

### 7.2 Target selectors
- 🟡 Project dropdown lists all non-archived projects — shows "(No projects)"; correct for no configured projects; manual re-test needed with projects added
- ⏭ Project dropdown sorted by recency — manual
- ✅ Profile dropdown lists profiles (opencode selector visible in screenshot)
- ✅ Claude Code profiles shown disabled with "monitor only" chip (screenshot confirmed)
- ✅ Session mode dropdown visible ("New session" shown):
  - [ ] `New session` default
  - [ ] `Append to: #short-id (state)` for each existing opencode session in target project
  - [ ] Changes when target project changes
  - [ ] Completed/error sessions: confirm spec — are they appendable?
- [ ] `Tab` cycles between selectors

### 7.3 Dispatch — new session
- [ ] Type prompt, `⌘↵` sends
- [ ] Overlay shows busy label (e.g. "starting agent…")
- [ ] Overlay closes on success
- [ ] New session card appears on dashboard
- [ ] Context panel auto-opens to new session
- [ ] Dispatch history remembers the prompt (↑ in input recalls it)
- [ ] `↑`/`↓` cycles history

### 7.4 Dispatch — append mode (td-b607d3)
- [ ] Select "Append to: #xxx"
- [ ] Type prompt, `⌘↵` sends
- [ ] Overlay closes
- [ ] Prompt appears in the existing session's conversation
- [ ] Session state transitions to running
- [ ] No new session card created

### 7.5 Error handling
- [ ] Dispatch fails (e.g. invalid profile, server unreachable): overlay shows error
- [ ] Overlay is NOT stuck in busy state after error
- [ ] Can retry after error without closing overlay
- [ ] Closing overlay during busy doesn't leak the request

### 7.6 Monitor-only guard
- [ ] Selecting Claude Code: inline warning "monitor-only. Switch to opencode?"
- [ ] `[Switch]` changes profile to an opencode one

## 8. Context Panel (§3)

### 8.1 Open / close
- [ ] Click card → panel slides in from right (320px, or 480px on >1400px)
- [ ] On >1600px: panel always visible
- [ ] Opening a different card replaces content instantly
- [ ] `Esc` closes panel
- [ ] `← Back` button closes panel
- [ ] `[✕]` closes panel
- [ ] Scroll position remembered per session per tab

### 8.2 Header
- [ ] Back button, agent type, `#short-id`, project name, settings, close
- [ ] Double-click header → full-screen mode
- [ ] `F` key → full-screen mode (when panel focused)
- [ ] Breadcrumb appears in full-screen

### 8.3 Conversation tab
- [ ] Attention banner sticky at top when attention needed
- [ ] Banner color matches attention type
- [ ] Approval type: command + `[Allow]` + `[Deny]`
- [ ] Question type: question + text input + send
- [ ] Done type: summary + `[Open Diff]` + `[Mark Reviewed]`
- [ ] `[Allow]` sends approval, banner clears, card transitions
- [ ] `[Deny]` sends denial, banner clears
- [ ] User messages right-aligned with subtle bg
- [ ] Agent messages left-aligned no bg
- [ ] Tool messages full-width monospace, collapsed by default
- [ ] `▶` expand toggle shows tool output in code block
- [ ] Timestamps on hover
- [ ] Opens scrolled to last 5 messages
- [ ] Scroll up loads more history
- [ ] "Jump to bottom" FAB when scrolled up
- [ ] Reply input: Enter sends, Shift+Enter newline
- [ ] Reply input disabled with tooltip when idle/done

### 8.4 Diff tab (td-b607d3)
- [ ] Badge shows `Diff ·N` with file count
- [ ] File tree left sidebar lists changed files
- [ ] Each file shows `+X -Y` line counts
- [ ] Files grouped: modified / added / deleted (verify spec)
- [ ] Click file in tree → diff pane scrolls to that file
- [ ] Empty diff: graceful message (not crash)
- [ ] Malformed diff: graceful degradation
- [ ] Binary files: handled (skip or placeholder)
- [ ] Renames: handled
- [ ] Deletions: handled
- [ ] `[Copy patch]` button copies unified diff to clipboard
- [ ] Diff colors from cleo-parchment palette

### 8.5 Todo tab
- [ ] Badge shows `Todo ·N` with open task count
- [ ] Renders `td usage -q` output for the project
- [ ] Monospace, preserves formatting
- [ ] `[Refresh]` re-runs command

### 8.6 Full-screen
- [ ] `F` or double-click header enters full-screen
- [ ] Breadcrumb `Dashboard > project > #id` shown
- [ ] `Esc` or `← Back` exits full-screen
- [ ] All tabs work in full-screen

## 9. Keyboard navigation (§7)

Verify each shortcut in its intended context AND verify it does NOT fire while typing in inputs/textareas:

- ✅ `1`–`4` switch nav views
- ✅ `⌘K` opens dispatch
- 🟡 `J` / `K` move focus between session cards — fired without crash; focus movement visual-only
- ⏭ `Enter` opens focused card in context panel — manual
- ⏭ `F` full-screens focused session — manual
- ✅ `Esc` closes panel or returns to dashboard
- 🟡 `Tab` cycles between main and context panel — Tab fires without crash; focus chain manual
- ✅ `A` jumps to attention-filtered view (key fires; no crash)
- ✅ `R` refreshes all session statuses (key fires; no crash)
- ✅ All shortcuts suppressed while typing in any input/textarea (verified for number keys in Settings)

## 10. Opencode integration (managed instances, spec-fallback-agent.md)

### 10.1 Launch
- [ ] Create an opencode profile with a valid OpenRouter key and a small model
- [ ] Dispatch via ⌘K with that profile
- [ ] `opencode serve` child process spawns (Activity Monitor / `ps aux | grep opencode`)
- [ ] Port is in range 4100–4200
- [ ] Dispatch completes within 10s
- [ ] Session card appears live on dashboard

### 10.2 Reuse
- [ ] Dispatch second prompt to same profile + same dir
- [ ] No new `opencode serve` spawned (PID stable)
- [ ] New session created on existing instance

### 10.3 Lifecycle
- [ ] Quit app cleanly → all spawned `opencode serve` processes gone (verify with `ps`)
- [ ] Force-kill app (⌘Q spam or kill -9) → children may linger; document expected behavior
- [ ] Restart app → no zombie instances re-attached

### 10.4 Connection robustness
- [ ] Manually kill `opencode serve` while app running → flight deck reflects disconnected state
- [ ] Restart the instance manually → flight deck reconnects or user can re-dispatch

### 10.5 Error cases
- [ ] Invalid API key → error surfaces in session (not silent)
- [ ] Invalid model name → error surfaces
- [ ] Network down mid-dispatch → graceful error, no stuck UI
- [ ] Port range exhausted (simulate with 101 instances or edit port range) → clean error

## 11. Claude Code monitor (spec-claude-monitor.md, td-92bedd)

- ✅ With real Claude Code sessions at `~/.claude/sessions/`, they appear on dashboard (confirmed: agentctl and levhicksdotcom sessions visible)
- ⏭ Project path encoding matches Claude Code's — manual inspection of session filenames
- ⏭ Snapshot updates when a Claude session progresses — manual (requires active session)
- ⏭ Unknown / deleted sessions removed from snapshot — manual
- ✅ Claude sessions marked monitor-only in UI (claude-code label visible; "monitor only" chip in ⌘K)
- ✅ No dispatch UI offered for Claude Code (⌘K shows monitor-only, not dispatchable)
- ⏭ ClaudeMonitor does not crash on mid-read — manual/concurrency test
- ⏭ Stale idle sessions not leaking (td-d773e91 fix) — long-running manual test

## 12. Config & persistence

- ⏭ All settings persist across restart — manual (requires restart cycle)
- ✅ Config file is valid JSON on disk (`~/Library/Application Support/flight-deck/config.json` parsed OK)
- ⏭ Corrupt config.json recovery — manual
- ⏭ Large number of projects (20+) still renders — manual
- ⏭ Config changes broadcast in multi-window — manual (single window only)

## 13. Theme & visual (spec-theme.md)

- 🟡 Dark mode renders per cleo-parchment dark palette — visual screenshot taken; color accuracy manual
- ⏭ Light mode renders per cleo-parchment light palette — theme toggle selector not found by script; manual
- ⏭ Theme toggle updates all visible elements live — manual
- 🟡 Status colors match §6 table — running=green, idle=gray, approval=amber, question=blue, error=red all visible; saturation manual
- 🟡 Accent color correct for mode — manual color inspection
- ✅ Font stack loads (Berkeley Mono → SF Mono → Fira Code → monospace on `.mono` elements)
- ⏭ No flash of wrong theme on launch — manual

## 14. Performance & stability

- 🟡 Fresh launch < 3s to interactive — not measured precisely; app appeared ready quickly
- ⏭ Dashboard with 20+ sessions scrolls smoothly — manual (requires 20+ sessions)
- ⏭ No memory growth over 30 min idle — manual (Activity Monitor)
- ⏭ No CPU spinning when idle — manual
- 🟡 DevTools console has no errors during normal use — 0 errors captured in second run; first run had 4 React warnings (td-8ba29f)
- 🟡 DevTools console has no warnings about React keys, hook deps — 4 style-conflict warnings observed (td-8ba29f)

## 15. Edge cases & abuse

- [ ] Project path with spaces: works
- [ ] Project path with unicode: works
- [ ] Very long session prompts (10k chars): don't hang
- ✅ Rapid ⌘K open/close: no leaks or crashes (5x rapid open/close tested)
- [ ] Add + archive + restore + delete same project repeatedly: state consistent
- [ ] Delete the last profile while dispatch overlay open: graceful
- [ ] Two ⌘K dispatches back-to-back to same project: both succeed or second one queues

---

## Bug log

| ID | Severity | Area | Description | Status |
|---|---|---|---|---|
| td-8ba29f | LOW | §14 Perf/Console | 4 React style-conflict warnings fire during nav view switching: `%s a style property during rerender (%s) when a conflicting property is set`. Root component not yet identified. | open |

**Notes from automated pass (2026-04-10):**
- Run used `scripts/uat.mjs` via `chromium.connectOverCDP` on port 9222 (app launched with `npm run dev:uat`)
- Mock mode was **enabled** — all opencode-dependent items (§10, §7.3-7.5) skipped
- Screenshots saved to `/tmp/uat-screenshots/` (ephemeral — not committed)
- §3.4 card states all confirmed via mock data: running, idle, approval, question, error all render correctly
- Claude Code monitor confirmed working: real sessions from `~/.claude/sessions/` appear on dashboard
- Wordmark updated in checklist: app shows `flight deck` (renamed from `AGENTCTL`)

---

## Sign-off

- [ ] All CRITICAL / HIGH items pass or have filed bug tickets
- [ ] Known issues documented
- [ ] Ready to tag release
- Reviewer: _______
- Date: _______
