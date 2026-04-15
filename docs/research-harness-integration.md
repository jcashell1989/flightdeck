# Research — Harness integration transports for flightdeck

> **Context:** UAT td-93e3fa surfaced that flightdeck (née agentctl) doesn't see externally-started `opencode tui` sessions. The immediate gap was filed as **td-838cbc** (OpencodeMonitor). The broader question became: *can flightdeck become a universal "Telegram-style" thin client that drives any AI coding harness, or is each harness its own integration project?* This document captures the research that answered that question.
>
> **Status:** Research pass, 2026-04-09. Decisions seeded; implementation work tracked under the linked tickets.
>
> **Author's note:** Two earlier wrong-turns are preserved below for posterity — (a) "agentctl should expand slash commands itself" and (b) "build a bespoke Claude Code channel plugin." Both were superseded by better evidence.

## Goal

Answer three questions, in order of importance:

1. Can flightdeck act as a Telegram-like dumb pipe that forwards user text — including slash commands — to a running AI coding session without per-harness expansion logic?
2. What does the integration path look like for each target harness (opencode, Claude Code, Codex CLI, Aider, Hermes, Letta, OpenClaw)?
3. Is there a single "right" data model for the dispatch layer, or does flightdeck need per-harness adapters?

## Key finding

**The Telegram-client pattern works for opencode as-is. For every other harness it reduces to one of three paths:** (a) native HTTP/REST adapter, (b) SDK-based programmatic driver, (c) file-watch monitor only. There is no universal protocol.

## Per-harness transport matrix

| Harness | Transport | Slash command handling | Flight deck integration path | Status |
|---|---|---|---|---|
| **opencode** | Native HTTP: `POST /session/:id/message`, `POST /session/:id/command`, `GET /command`, `POST /session/:id/prompt_async` | Server-side expansion of `$ARGUMENTS`, `@file`, `!shell` from markdown files in `~/.config/opencode/commands/` and `.opencode/commands/` | **Direct HTTP adapter** (current architecture, expanded with `/command` wiring) | Phase 1 — in progress |
| **Claude Code** | Claude Agent SDK (Python + TypeScript) with `query()` / `ClaudeSDKClient` / V2 `createSession` | Slash commands loaded via `settingSources: ['project']` from `.claude/commands/*.md` — expanded inside the SDK, not the transport | **Claude Agent SDK adapter** — host spawns + drives the agent session | Phase 2 — spec first, blocked on auth licensing (see below) |
| **Claude Code (alt)** | Channel plugin pattern (Anthropic official Telegram plugin precedent) | Plugin receives inbound text, injects as user message into active `claude --channels plugin:...` session | **Build a `flightdeck` channel plugin** — contained but duplicates SDK capability | Phase 2 alternative — considered, deprioritized |
| **Claude Code (degraded)** | File watch of `~/.claude/projects/<encoded-cwd>/*.jsonl` | Read-only | **ClaudeMonitor** (already shipped) | Shipped |
| **Hermes Agent** (NousResearch) | OpenAI-compatible HTTP at `localhost:8642/v1/chat/completions` with `X-Hermes-Session-Id` for persistent sessions | Unclear — OpenAI API has no slash command concept; message text is the only path. Whether Hermes's server expands slash commands embedded in user text is unverified. | **OpenAI-compat adapter** — cheap once Phase 1 shipped, slash command support likely degraded | Phase 3 — opportunistic |
| **Letta** (lettabot) | REST: `POST /v1/agents/<id>/messages` with streaming (SSE), client-side tools support | Unclear from docs — lettabot UI supports slash commands across channels (`/start`, `/help`, `/agent <id>`, etc.) but these are handled at the bot layer, not the core Letta API. Flight deck would need to reimplement or forward through a Letta bot instance. | **REST adapter** — cheap; slash commands need second research pass | Phase 3 — opportunistic |
| **Codex CLI** (OpenAI) | None documented publicly. A "Codex SDK" is referenced in docs but not investigated here. | Client-side in CLI composer; `/review`, `/fork`, etc. are native to the CLI interface. Custom commands supported. | **Unknown — parked** pending Codex SDK research | Phase 3+ |
| **Aider** | None. [Feature request for HTTP server mode is open since 2024](https://github.com/Aider-AI/aider/issues/2081). | Client-side in CLI | **pty-only or upstream contribution** | Phase 4+ |
| **OpenClaw** | Gateway daemon with no documented third-party HTTP API. Commands handled programmatically via `commands-registry.shared.ts` / plugin `registerCommand()`. All external access is via chat platforms (Discord, Slack, Telegram, WhatsApp). | Gateway parses `/foo` text from inbound platform messages; plugins register commands programmatically. | **Contribute a gateway channel adapter upstream** — ugly, not worth it unless a specific user needs OpenClaw | Parked |

## opencode — deep dive

opencode is the gold-case harness for flightdeck. The server architecture aligns perfectly with the "thin client" model.

### Endpoints confirmed

- `POST /session/:id/message` — regular user prompt. Body: `{ messageID?, model?, agent?, noReply?, system?, tools?, parts }`.
- `POST /session/:id/prompt_async` — async variant, returns `204 No Content`.
- `POST /session/:id/command` — **dedicated slash command endpoint**. Body: `{ messageID?, agent?, model?, command, arguments }`.
- `GET /command` — list all loaded commands. Returns `Command[]` (schema in opencode SDK's `types.gen.ts`).

### Command expansion semantics

Commands are loaded from:

- `~/.config/opencode/commands/*.md` — global
- `<project>/.opencode/commands/*.md` — per-project

Markdown files support:

- YAML frontmatter with `description`, `agent`, `model`
- Placeholders: `$ARGUMENTS`, `$NAME` (named args), `@filename` (file refs), `!command` (shell execution)
- File name (without extension) becomes the command name

Expansion happens **server-side** inside `opencode serve`. Flightdeck never parses the markdown, never substitutes placeholders — it just POSTs `{ command: "foo", arguments: "bar baz" }` and lets the server handle everything. **Plugins that register commands server-side work automatically** because flightdeck doesn't care how commands are stored.

### Flightdeck wiring work for opencode slash commands

Minimal. Parse `/token` from the reply input / ⌘K input; if present, route to `POST /session/:id/command` instead of `POST /session/:id/message`. Optionally pre-fetch `GET /command` once per session for a typeahead UI. Escape hatch: `\/foo` sends literal `/foo`. See the NEW ticket for Phase 1.

## Claude Code — deep dive

### The Claude Agent SDK is the primary path — with a licensing caveat

The Claude Agent SDK (formerly the Claude Code SDK) is Anthropic's official programmatic interface to Claude Code's agent loop. Both Python (`claude-agent-sdk`) and TypeScript (`@anthropic-ai/claude-agent-sdk`) packages ship stable releases; a V2 preview exists in TypeScript with a cleaner `createSession` / `send` / `stream` shape closer to Python's `ClaudeSDKClient`.

**What the SDK provides that flightdeck needs:**

- **Streaming agent loop** — `query()` / `ClaudeSDKClient.receive_response()` yields messages in real time (assistant text, tool uses, tool results, system events).
- **Session management** — sessions persist to `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. This is **the exact path ClaudeMonitor already watches.** That means flightdeck's existing session visibility layer and the SDK-driven dispatch path share the same on-disk artifacts — no duplicate tracking.
- **`continue`**, **`resume`**, and **`fork`** for picking up prior sessions. `continue` finds the most recent session in `cwd`; `resume` takes a specific session ID; `fork` branches without mutating the original.
- **`canUseTool` callback** — fires when Claude wants to use a tool not on the pre-approved list. Flightdeck can surface this as an attention banner with Allow / Deny buttons, then return the decision to the SDK. **This is a direct match for the existing attention-state card model.**
- **`AskUserQuestion` tool** — first-class clarifying-question support. Same UI surface as approval banners.
- **Hooks:** `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, and more. Hooks can inject `systemMessage` into the conversation or block tool calls.
- **Slash commands via `settingSources: ['project']`** — loads `.claude/commands/*.md` natively. Flight deck doesn't parse them. Same "thin pipe" story as opencode but with the SDK as the transport instead of HTTP.
- **Subagents, MCP servers, skills, plugins, memory** — all available.

**Architecture:** flightdeck main process imports the TypeScript SDK directly, wraps `query()` / `ClaudeSDKClient` in an adapter, and exposes the same IPC shape the renderer already expects. The SDK doesn't run a separate server — it's a library that drives the agent loop in-process.

### The licensing caveat

From the [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview):

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Please use the API key authentication methods described in this document instead.

Supported auth: `ANTHROPIC_API_KEY` (direct API), Amazon Bedrock, Google Vertex AI, Microsoft Azure. **NOT** the user's claude.ai Pro / Max / Team subscription.

**This is a real problem for dogfooding:**

- A user with a Claude Max subscription cannot use flightdeck's SDK adapter without double-paying (Max for the CLI + API credits for the SDK path).
- Token costs on the API path scale with usage; an all-day-dogfood workflow becomes a meaningful monthly spend.
- The alternative — spawning `claude` as a subprocess and driving it via stdin / session files — uses the user's authenticated session but sacrifices the SDK's structured API (`canUseTool`, hooks, streaming typed messages).

**Three ways out, all with tradeoffs:**

1. **Accept API auth for flightdeck users.** Document it. Users who want SDK-driven Claude in flightdeck pay per token. Users who prefer their subscription stay on ClaudeMonitor (file watch, read-only).
2. **Subprocess path.** Flightdeck spawns `claude` directly and parses the JSONL session files as they're written. This is essentially an extended ClaudeMonitor with write-side capability — inject prompts by writing to the session file before the process picks them up, or by piping to stdin. No clean approval flow (no `canUseTool`). Fragile.
3. **Request approval from Anthropic.** The licensing note says "unless previously approved." Flightdeck could apply for an exception. Outcome unknown; likely available only to larger integrations.

The SDK adapter is still the right primary Phase 2 path, but option 1 means **the Phase 2 user is a different user than the Phase 1 user**. Someone who dogfoods opencode via flightdeck does not automatically dogfood Claude Code via flightdeck. That's a meaningful product segmentation question.

### The channel plugin alternative

The [Anthropic official Telegram plugin](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/telegram/README.md) is an MCP server that runs *inside* Claude Code via `claude --channels plugin:telegram@...`. It owns an external connection (the Telegram bot), receives inbound messages, injects them as user messages into the active session, and exposes `reply` / `react` / `edit_message` tools to the assistant.

A `flightdeck` channel plugin would:

- Open a local Unix socket instead of a Telegram bot connection
- Expose the same tool surface (`reply`, maybe `set_attention_state`)
- Be paired to flightdeck via a one-time code
- Run under the user's authenticated Claude session — **no API-key licensing problem**

**Why it was deprioritized:**

- Duplicates capabilities the Agent SDK already provides natively (message injection, tool approval via `canUseTool`, streaming).
- Requires maintaining a separate TypeScript/Bun codebase.
- Forces the user to launch Claude Code with `--channels plugin:flightdeck@...` — workflow friction, unless flightdeck manages the launch itself.
- Plugin can only be active when Claude Code is running with the channel flag; externally-launched sessions still fall through to ClaudeMonitor.

**Why it might come back:**

- If the SDK licensing restriction is a hard blocker for dogfooding on a Max subscription, the channel plugin is the only path that reuses the subscription auth.
- It's the pattern Anthropic is officially supporting for messaging integrations, so future upgrades (access control, voice, attachments) will land there first.

**Decision parked.** Research revisit once Phase 1 ships and we know whether the SDK auth model is actually a blocker for the intended user.

## Architecture implications

### Adapter layer, not a single transport

Flightdeck's dispatch code needs to become adapter-based. Proposed `Session` type extension:

```ts
interface Session {
  // ...existing fields...
  controlMode: 'managed' | 'watched'
  // NOTE: `transport` was superseded by `adapterId: string` (opaque) in
  // docs/spec-adapters.md. The union type below is retained for research
  // context only — implementation uses adapterId, not a transport enum.
  transport:
    | 'opencode-http'
    | 'claude-agent-sdk'
    | 'claude-channel-plugin'
    | 'openai-compat-http'
    | 'letta-rest'
    | 'file-watch'
    | 'pty'
  adapterId: string
}
```

Each adapter registers at app start and handles its own `send(sessionId, userMessage)` / `sendCommand(sessionId, command, args)` / `abort(sessionId)` surface. The renderer is adapter-agnostic. Adding a new harness = new adapter file + union update, zero UI touches.

### What this changes in existing code

- `src/main/opencode/*` → move under `src/main/adapters/opencode-http/`
- `src/main/claude/ClaudeMonitor` → `src/main/adapters/file-watch/`
- New: `src/main/adapters/claude-agent-sdk/` (Phase 2)
- IPC dispatch API gains a `transport` discriminant and routes to the correct adapter
- `useSessionService` merges sessions from all adapters into one flat list
- The `Session` type in `src/shared/types.ts` adds `transport` and `adapterId`

### Spec documents to update / create

- **New:** `docs/spec-adapters.md` — canonical adapter contract, `transport` enum, registration model
- **Update:** `spec-fallback-agent.md` — the "opencode instances" architecture is now one adapter among many
- **Update:** `spec-claude-monitor.md` — recast as the `file-watch` adapter, with language about how it coexists with future write-capable Claude adapters
- **New (deferred):** `spec-claude-sdk-adapter.md` — only when Phase 2 starts
- **New (deferred):** `spec-claude-channel-plugin.md` — only if Phase 2 pivots to the plugin path

## Abandoned approaches (for posterity)

Both were seriously considered earlier in this research and rejected with reasoning:

1. **"Agentctl expands slash commands itself."** Early proposal: flightdeck reads `.claude/commands/`, `.opencode/commands/`, and native `.agentctl/commands/` dirs, parses frontmatter, substitutes `$ARGUMENTS`, and sends expanded text to the harness. **Rejected because:** per-harness format drift (each harness's substitution syntax differs), plugin blindness (plugin-registered commands can't be imported), and it reinvents server-side capability. The right layer is the harness itself.

2. **"Build a bespoke channel plugin as Phase 2 primary."** See Claude Code deep dive. Superseded by the Claude Agent SDK finding — the SDK already provides everything the plugin would, cleaner, in-process, without requiring the user to launch with a flag. The plugin is preserved as a fallback if SDK auth licensing turns out to be a blocker.

## Open questions for future research

1. **Does `opencode serve` happily coexist with an already-running `opencode tui` sharing the same `~/.local/share/opencode/` database?** If not, flightdeck-managed dispatch could corrupt TUI sessions. Needs a controlled test before shipping `/command` wiring.
2. **What does `Command[]` from `GET /command` actually contain?** Need to inspect `opencode` SDK's `types.gen.ts` to design the typeahead UI.
3. **Does Letta's REST API accept slash commands as message text and expand them, or are lettabot commands purely a bot-layer concept?** Affects the cheapness of the Letta adapter.
4. **Does Hermes's OpenAI-compatible endpoint expand slash commands found in user text?** Same question shape as Letta.
5. **Codex SDK** — what does it look like, can it drive sessions programmatically?
6. **Claude Agent SDK authentication exception policy** — worth applying for, or is the API-key-only path the honest answer?
7. **Can flightdeck intercept `cwd` safely across SDK session resume?** The SDK's tip on `encoded-cwd` matching is a correctness constraint the adapter must preserve.

## Related tickets

- **td-93e3fa** — UAT first full pass (parent)
- **td-838cbc** — feature: OpencodeMonitor for externally-started TUI sessions (P1)
- **NEW (to file):** feature: opencode slash command wiring via `/session/:id/command` + `GET /command` (Phase 1)
- **NEW (to file):** spec: adapter architecture (`spec-adapters.md`) — prerequisite for both Phase 1 wiring and Phase 2
- **NEW (to file):** epic: Phase 2 Claude Code integration via Claude Agent SDK (blocked on licensing clarification)

## Sources

- [opencode Commands docs](https://opencode.ai/docs/commands/)
- [opencode Server docs](https://opencode.ai/docs/server/)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Agent SDK hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Claude Agent SDK permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Claude Agent SDK user input / approvals](https://platform.claude.com/docs/en/agent-sdk/user-input)
- [Claude Agent SDK plugins](https://platform.claude.com/docs/en/agent-sdk/plugins)
- [Anthropic official Claude Code Telegram plugin README](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/telegram/README.md)
- [Hermes Agent API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/)
- [Hermes Agent gateway architecture](https://deepwiki.com/NousResearch/hermes-agent/7.1-gateway-architecture)
- [Letta API — send message](https://docs.letta.com/api-reference/agents/messages/create)
- [lettabot commands](https://github.com/letta-ai/lettabot/blob/main/docs/commands.md)
- [Codex CLI slash commands](https://developers.openai.com/codex/cli/slash-commands)
- [Aider HTTP server feature request](https://github.com/Aider-AI/aider/issues/2081)
- [OpenClaw slash commands docs](https://docs.openclaw.ai/tools/slash-commands)
- [Telegram Bot API — Commands](https://core.telegram.org/api/bots/commands)
