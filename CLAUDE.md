# CLAUDE.md — project-specific instructions for Claude Code

This file is project-local and supplements `~/.claude/CLAUDE.md`. For the full
working protocol (td, QRSPI, delegation, verification, conventions) see
[`AGENTS.md`](./AGENTS.md) — it is authoritative and the two files must not
disagree.

## Quick reference

- **Task tracking:** `td` — see `AGENTS.md §1`. One log per decision, one log
  per slice, `td handoff` at slice boundaries, `td review` requires a
  different session to approve.
- **Workflow:** QRSPI — stop for approval at Design and Structure. Do not
  skip ahead to Implement on non-trivial work.
- **Architecture:** Electron + React + TypeScript. `src/main/` owns network
  I/O; `src/renderer/` receives via IPC through `src/preload/`. No direct
  network calls from the renderer.
- **Specs:** `docs/spec-ux.md`, `docs/spec-theme.md`, `docs/research.md`,
  `docs/structure.md`. Code and spec ship in the same commit.
- **Deps:** No new npm package lands without a `td log` entry on the active
  ticket explaining why.
- **Typecheck:** `npm run typecheck` must be green before `td review`.
- **Commits:** per slice, with `Refs: td-<id>` trailer.

## Project-specific rules

1. **Mock data is a first-class fallback**, not a placeholder. It must remain
   toggle-able via `config.mock.enabled` so UI work can proceed without a
   running opencode server.
2. **Attention state set** (Phase 2): `{approval, question, error, idle}`.
   `idle` is attention — an agent with no reason to be idle is a problem.
   `review` is reserved for Phase 3. See `docs/spec-ux.md §2` card matrix.
3. **Configuration lives in one place:** the main-process `ConfigStore`
   (`src/main/config/store.ts`) is the single source of truth. Renderer reads
   via `useConfig()`; never hard-code values that should be config.
4. **Never self-approve td reviews.** Even if the work is obviously correct,
   the approval gate is in a different session.

## When in doubt

Read `AGENTS.md`. If `AGENTS.md` and this file conflict, `AGENTS.md` wins —
open a PR to reconcile.
