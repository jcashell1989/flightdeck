# agentctl

A multi-agent coding dashboard for monitoring and dispatching work across
multiple AI coding agents and project directories.

## Status

**Structure phase complete.** Ready for Phase 1 implementation.

## Agents in scope

| Agent | Provider | Auth | Integration |
|---|---|---|---|
| opencode | OpenRouter → AWS Bedrock (Sonnet 4.6) | OpenRouter API key | Full — HTTP REST + SSE via `@opencode-ai/sdk` |
| Claude Code | Anthropic direct (claude.ai Max) | Max subscription (CLI only) | Passive monitor — file watch + process list |
| Fallback agent | OpenRouter → kimi-k2.5 / minimax m2.7 | TBD | TBD — plug-in slot reserved |
| Enodios (letta + hermes ×3) | — | — | Nice-to-have, read-only, deferred |

## Docs

- [`docs/spec-ux.md`](docs/spec-ux.md) — Full UX/UI specification
- [`docs/spec-theme.md`](docs/spec-theme.md) — cleo-parchment theme specification
- [`docs/research.md`](docs/research.md) — Tool evaluation and integration surface research
- [`docs/structure.md`](docs/structure.md) — Build phases, decisions, and validation approach

## Key decisions

- **Primary screen:** Dashboard overview (always visible, glanceable)
- **Unit of display:** Hierarchical — project (directory) → agent type → session instance
- **Project = directory**, must be git-tracked (auto-init if not)
- **Dispatch:** ⌘K command-palette overlay, opencode only (Claude Code is monitor-only)
- **Notifications:** In-app only, no OS interruptions
- **Theme:** cleo-parchment, dark/light follows macOS appearance automatically
- **Architecture:** Option C — standalone Electron + React app (see `docs/structure.md`)
