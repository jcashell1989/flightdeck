# flightdeck

A desktop dashboard for running multiple AI coding agents across multiple
projects — without losing track of any of them.

![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![Status](https://img.shields.io/badge/status-paused-grey)

## Status

Paused pending genuine gaps found on existing tooling.

## What it does

When you have several AI agents running in parallel — different projects,
different tools — it's easy to miss the one that's been waiting on your
approval for ten minutes. flightdeck gives you a single glanceable window
where every agent session surfaces its state in real time, flags anything
that needs your attention, and lets you dispatch work without leaving the
dashboard.

## Features

- **Live session dashboard** — sessions grouped by project, each showing
  current action, status, elapsed time, and attention state at a glance
- **Attention tracking** — sessions needing approval, answers, or error
  resolution surface immediately; badge in the top bar shows the count
- **⌘K dispatch** — command-palette overlay to send prompts or slash commands
  to any running opencode session
- **Projects view** — add, manage, and archive project directories; git
  initialization handled automatically
- **Analytics** — session activity over time
- **Dark / light theme** — follows macOS system appearance automatically
  (cleo-parchment theme)

## Agent support

| Agent | Integration level | Notes |
|---|---|---|
| **opencode** | Full control | HTTP REST + SSE via `@opencode-ai/sdk`; start, stop, dispatch, live state |
| **Claude Code** | Monitor only | File-watch on `~/.claude/projects/`; no API key required |

## Getting started

**Prerequisites:** Node 20+, macOS (Linux/Windows untested but structurally
supported).

```bash
# Install dependencies
npm install

# Run in development mode (mock data on by default)
npm run dev

# Turn off mock data to connect to a real opencode server:
# Settings → uncheck "Use mock data"
```

To connect to a live opencode instance, start `opencode serve` in a terminal
and add the host/port in **Settings → Opencode instances**.

## Build

```bash
# Type-check
npm run typecheck

# Production build
npm run build

# Package as a macOS .app
npm run package
# Output: dist/mac-arm64/flightdeck.app
```

## Run tests

```bash
# Unit tests
npm test

# Playwright UAT suite (requires a production build first)
npm run build && npm run test:uat
```

## Tech stack

- **Electron 41 + React 19 + TypeScript**
- **electron-vite** for fast dev builds
- **Vite** for the renderer and mobile companion
- **Vitest** for unit tests, **Playwright** for E2E UAT

## Project structure

```
src/main/        — Electron main process (IPC, adapters, config store)
src/preload/     — Context bridge
src/renderer/    — React UI
src/main/adapters/  — Per-agent adapters (opencode-http, claude-file-watch)
docs/            — Specs and research
```

## Status

Early development. Core dashboard, projects, settings, and Claude Code
monitoring are working. opencode dispatch and advanced session controls are
in progress.

## License

MIT
