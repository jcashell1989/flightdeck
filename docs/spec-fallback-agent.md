# agentctl — Agent Profiles & Managed Instance Design

> Status: Implemented.
> Ticket: td-be1f9c
> Last updated: 2026-04-07

---

## Overview

agentctl can launch and manage `opencode serve` processes on behalf of
configured **Agent Profiles**. A profile is a reusable env template
(agent type, provider, model, API key). When the user dispatches a task
via `⌘K`, agentctl starts the appropriate `opencode serve` process if it
isn't already running, connects a client to it, and sends the prompt.

This enables running multiple opencode instances with different models
(e.g. Claude Sonnet 4.6 as primary, kimi-k2.5 as fallback) without
manually managing server processes.

---

## Concepts

### AgentProfile

A reusable configuration template stored in `userData/config.json`:

```ts
interface AgentProfile {
  id: string              // stable UUID, never changes after creation
  label: string           // display name, e.g. "kimi fallback"
  agentType: 'opencode' | 'claude-code'
  provider?: string       // e.g. 'openrouter', 'anthropic', 'openai', 'google'
  model?: string          // e.g. 'openrouter/kimi-k2.5', 'openrouter/minimax-m2.7'
  apiKey?: string         // stored plaintext — keychain migration is a follow-up
  isDefault: boolean      // pre-selected in the ⌘K dispatch overlay
}
```

Only `agentType: 'opencode'` profiles are dispatchable. Claude Code profiles
are informational only (Claude Code is passive-monitor-only due to auth constraints).

### ManagedInstance (runtime state, not persisted)

A running `opencode serve` process spawned by agentctl:

```
profileId + directory → { process: ChildProcess, port: number }
```

Instances are keyed by `${profileId}:${directory}`. They stay alive until
the app quits or the user explicitly stops them. On `before-quit`, all
managed instances receive `SIGTERM`.

---

## Architecture

### `src/main/opencode/launcher.ts` — OpencodeLauncher

Responsibilities:
1. **Port assignment** — probe ports 4100–4200 via TCP bind test; pick the first free one.
2. **Process spawn** — `spawn('opencode', ['serve', '--port', port], { cwd: directory, env })`.
3. **Env construction** — map `profile.provider` to the correct API key env var:
   - `openrouter` → `OPENROUTER_API_KEY`
   - `anthropic` → `ANTHROPIC_API_KEY`
   - `openai` → `OPENAI_API_KEY`
   - `google` → `GOOGLE_API_KEY`
   - *(unknown)* → `OPENROUTER_API_KEY` (generic fallback)
4. **Startup poll** — TCP connect probe every 500ms, 10s timeout.
5. **Lifecycle** — `stop(profileId, directory)`, `stopAll()` (called on `before-quit`).

### `OpencodeRegistry.ensureManagedClient(instance, managedKey)`

Creates and connects an `OpencodeInstanceClient` for a managed instance if one
doesn't already exist. Key format: `managed:${profileId}:${directory}`. This
avoids colliding with manually-configured `host:port` keys.

### IPC surface

| Channel | Direction | Description |
|---|---|---|
| `profile:list` | renderer → main | Returns `AgentProfile[]` from config |
| `profile:add` | renderer → main | Adds a profile, returns it with generated id |
| `profile:update` | renderer → main | Replaces a profile by id |
| `profile:delete` | renderer → main | Removes a profile by id |
| `instance:dispatch` | renderer → main | Launch + connect + createSession + sendPrompt |

`instance:dispatch` args: `{ profileId: string, directory: string, prompt: string }`
Returns: `{ sessionId: string }`

---

## Dispatch Flow

```
User presses ⌘K
  → selects project + profile
  → presses ⌘↵

CmdKDispatch calls window.electronAPI.instance.dispatch(...)
  → main: look up profile from config
  → main: OpencodeLauncher.launch(profile, directory)
      → if already running: return existing port
      → else: findFreePort → spawn → poll until connectable
  → main: OpencodeRegistry.ensureManagedClient(instance, key)
      → if client exists: return it
      → else: new OpencodeInstanceClient → connect()
  → main: wait for client.status === 'connected' (8s timeout)
  → main: client.createSession(directory) → sessionId
  → main: client.sendPrompt(sessionId, prompt)
  → return { sessionId }

CmdKDispatch receives sessionId → onDispatched(sessionId) → overlay closes
Dashboard receives snapshot push → new session card appears
```

---

## UI

### Settings — Agent Profiles section

A table below "opencode instances" with columns:
**Label | Agent | Provider | Model | API Key | Default | (delete)**

- All fields inline-editable (blur/Enter to commit, Escape to revert).
- API key masked by default; revealed on focus.
- Default column: radio group — only one profile can be default.
- Add-row at the bottom.

### ⌘K Dispatch overlay

When profiles exist, a profile `<select>` appears next to the project selector:
```
Target: [project ▾]  ·  [profile ▾]  ·  New session
```
The default profile is pre-selected. While the launcher is starting a new
server, the submit button shows "starting agent…".

When no profiles are configured, the overlay falls back to the legacy
`opencode:session:create` path (manually-configured instances).

---

## Port Range

Default: **4100–4200**. Probed via TCP bind test. Not currently configurable
in the UI — change `PORT_RANGE_START` / `PORT_RANGE_END` in `launcher.ts` if needed.

Manually-configured instances (Settings → opencode instances) use whatever
port the user specifies (default 4096). Managed instances never conflict with
manual ones as long as manual ports are outside 4100–4200.

---

## API Key Storage

API keys are stored **plaintext** in `userData/config.json`. This is acceptable
for a local desktop app where the config file is user-owned, but a keychain
migration is the right long-term approach.

Future: use Electron's `safeStorage` API to encrypt keys at rest, with the
OS keychain as the backing store.

---

## Launch Template

agentctl runs these commands internally. Shown here for transparency and
for users who want to run instances manually:

```sh
# Primary — Claude Sonnet 4.6 via OpenRouter
OPENROUTER_API_KEY=sk-or-... \
OPENCODE_MODEL=openrouter/anthropic/claude-sonnet-4-5 \
  opencode serve --port 4096

# Fallback — kimi-k2.5 via OpenRouter
OPENROUTER_API_KEY=sk-or-... \
OPENCODE_MODEL=openrouter/kimi-k2.5 \
  opencode serve --port 4100   # agentctl auto-assigns from 4100–4200

# Alternative fallback — minimax m2.7 via OpenRouter
OPENROUTER_API_KEY=sk-or-... \
OPENCODE_MODEL=openrouter/minimax/minimax-m2.7 \
  opencode serve --port 4101
```

---

## Scope Boundaries

**In scope (Phase 5 / td-be1f9c):**
- `AgentProfile` config schema
- `OpencodeLauncher` process manager
- Profile CRUD IPC
- `instance:dispatch` IPC
- Settings profiles UI
- `⌘K` profile selector

**Out of scope:**
- Keychain / `safeStorage` for API keys
- Automatic failover (routing to fallback when primary is down) — manual profile selection is the current model
- Claude Code dispatch (auth constraint: Max subscription ≠ API key)
- Multi-machine / remote instances
- Profile-level port override in UI

---

## Validation

1. Add a profile in Settings (label: "kimi fallback", agentType: opencode, provider: openrouter, model: openrouter/kimi-k2.5, apiKey: your key)
2. Open `⌘K` — profile dropdown appears, "kimi fallback" is selectable
3. Select a project + the kimi profile, enter a prompt, press `⌘↵`
4. Overlay shows "starting agent…" briefly
5. `opencode serve` process appears in Activity Monitor on port 4100–4200
6. Session card appears on dashboard with the correct project
7. Quit the app — `opencode serve` process is gone
8. `npm run typecheck` clean
