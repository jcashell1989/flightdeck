# AGENTS.md — Working protocol for agentctl

This file defines how AI agents (Claude Code, opencode, etc.) must work in
this repository. It is terser than `CLAUDE.md` but carries the same authority.

## 1. Task tracking is mandatory (`td`)

All non-trivial work **must** be tracked in `td`. Tracking is not a courtesy —
it is the primary record future sessions (and humans) use to orient. Thin
tracking = lost context = duplicated or broken work.

### Session start

1. Run `td usage --new-session` at the start of every new conversation (or
   after `/clear`). Use `td usage -q` for subsequent reads in the same session.
2. Before picking up work: `td current`, `td next`, and `td context <id>` on
   any in-progress ticket. Read recent log entries before writing code.

### Protocol for every non-trivial ticket

| When | Command | Required content |
|---|---|---|
| Picking up work | `td start <id>` | — |
| After each **decision** (architecture, scope, spec change) | `td log "<decision + reason>"` | *What* you decided and *why*, in one line. Not a bundled plan dump. |
| After each **slice / logical unit of work** | `td log "<slice> done: <files touched> — <validation>"` + git commit | Files that changed, which validation passed (typecheck, tests, manual smoke). |
| Before stopping, pausing, or running out of context | `td handoff <id>` | Resumable snapshot — always, not just end-of-session. |
| When ready for review | `td review <id>` | Only after validation is green and git history is clean. |
| Review approval | `td approve <id>` | **Must run in a different session than the implementer.** |

### Rules

- **One log entry per decision, one log entry per slice.** Do not bundle five
  decisions into a single log line. Future readers should be able to see *when*
  each call was made.
- **Log before you commit, not after.** The log entry justifies the commit.
- **Never `td close` completed work.** Use `td review` → `td approve`.
  `td close` is for admin closures (duplicate, won't-fix, cleanup).
- **Cross-reference folded work.** If ticket A implements items from ticket B,
  log on *both* tickets and close the folded items on B when the code lands.
- **Commit per slice.** Git history must be bisectable. Do not land slices 1–5
  as one blob — each slice gets its own commit referencing the ticket id in
  the trailer (`Refs: td-<id>`).
- **Spec and code ship together.** If a code change contradicts a doc in
  `docs/`, update the doc in the same commit. Do not defer "docs pass" to
  the end — drift is guaranteed.
- **`td handoff` at slice boundaries**, not just end of session. A checkpoint
  you can resume from is cheap; a lost context you can't resume from is
  expensive.

### Trivial work exception

Single-file typo fixes, lint-only changes, and direct user clarifications may
skip `td start`/`td log`. Everything else — including anything touching more
than one file, introducing a dependency, or changing a spec — requires the
full protocol.

## 2. QRSPI for non-trivial work

Follow Questions → Research → Design → Structure → Plan → Worktree → Implement.
Each step is a distinct approval gate. Do not proceed past **Design** or
**Structure** without explicit user approval. Log the approval moment with
`td log`.

## 3. Delegation

Use oh-my-claudecode subagents when the task matches their description. Prefer
`Explore` for multi-file orientation, `document-specialist` for SDK/API
research, `executor` (opus) for complex multi-file implementation. Do not
delegate understanding — the orchestrator reads results and decides; agents
gather.

## 4. Verification

- `npm run typecheck` must pass before any `td review`.
- Manual smoke test the affected UI surface before marking a slice done.
- Verification must be done by a different context than the one that wrote
  the code (`verifier` agent, or a different session).
- Never self-approve.

## 5. Repo-specific conventions

- Commit trailers: `Refs: td-<id>`.
- Use `docs/` for all specs. `spec-ux.md`, `spec-theme.md`, `structure.md`,
  `research.md` are the canonical design artifacts.
- `src/main/` = Electron main, `src/preload/` = bridge, `src/renderer/` =
  React UI. Main owns network I/O; renderer receives via IPC.
- No new top-level dependencies without logging the decision on the active
  `td` ticket.
