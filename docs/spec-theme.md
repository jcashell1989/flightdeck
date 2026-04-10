# flight deck — Theme Specification: cleo-parchment

> The dashboard uses the cleo-parchment theme in both dark and light variants.
> Dark/light follows macOS appearance automatically via `prefers-color-scheme`
> (or `AppleInterfaceStyle` defaults read if native app).
> Source of truth: `~/.config/opencode/themes/cleo-parchment.json`

---

## Base Palette

### Dark variant (`bg = #1D1912`)

Warm near-black with brown undertones.

```
--bg-base:        #1D1912   /* Normal bg */
--bg-panel:       #2A2420   /* Cards, context panel, drawers */
--bg-element:     #3A342A   /* Hover states, dropdowns, selections */
--fg-primary:     #F5F0E8   /* Main text */
--fg-muted:       #D6D3CE   /* Labels, metadata */
--fg-subtle:      #6B6256   /* Timestamps, paths, faint text */
--border:         #3A342A   /* Default card borders */
--border-active:  #5A5347   /* Focused/active borders */
```

### Light variant (`bg = #F5F0E8`)

Warm parchment.

```
--bg-base:        #F5F0E8
--bg-panel:       #EDE8E0
--bg-element:     #C8C0AE
--fg-primary:     #2B241B
--fg-muted:       #5A5347
--fg-subtle:      #8A7B6E
--border:         #C8C0AE
--border-active:  #5A5347
```

---

## Accent / Primary

Matches `primary` role in `cleo-parchment.json` and active states in tmux/sketchybar.

```
dark:   #C9A54E   /* gold — active nav, focus rings, primary buttons */
light:  #5B8A5C   /* green — same role */
```

---

## Status Colors

Each status color is drawn from the cleo-parchment palette's existing semantic role.

| State | Dark | Light | Palette source |
|---|---|---|---|
| Running | `#5B8A5C` | `#5B8A5C` | `dark-green` / `light-green` |
| Idle | `#4F473B` | `#8A7B6E` | `dark-fg-subtle` / `light-fg-subtle` |
| Tool/permission approval | `#D4AF5A` | `#8A7028` | `dark-yellow` / `light-yellow` |
| Clarifying question | `#556F7C` | `#3A5563` | `dark-blue` / `light-blue` |
| Done — review changes | `#910766` | `#7A0558` | `dark-magenta` / `light-magenta` |
| Error | `#B05050` | `#8B3232` | `dark-red` / `light-red` |

**Note on review/done color:** The designer spec used indigo/violet. cleo-parchment
has no indigo; magenta is the closest distinct color not already used for another
state. It reads as "notable but not urgent" — appropriate for a completed session
awaiting review.

---

## Background Tints (Attention Card States)

4–6% opacity overlays on `--bg-panel`. Slightly higher than a neutral dark theme
because cleo-parchment's warm backgrounds absorb color more.

```css
/* Dark */
--tint-approval:  rgba(212, 175, 90,  0.05);
--tint-question:  rgba(85,  111, 124, 0.06);
--tint-review:    rgba(145, 7,   102, 0.05);
--tint-error:     rgba(176, 80,  80,  0.06);

/* Light */
--tint-approval:  rgba(138, 112, 40,  0.06);
--tint-question:  rgba(58,  85,  99,  0.06);
--tint-review:    rgba(122, 5,   88,  0.05);
--tint-error:     rgba(139, 50,  50,  0.06);
```

---

## Left Border (Attention Cards)

3px solid, full card height, status color at full opacity.

```css
/* Dark */
--border-approval: #D4AF5A;
--border-question: #556F7C;
--border-review:   #910766;
--border-error:    #B05050;

/* Light */
--border-approval: #8A7028;
--border-question: #3A5563;
--border-review:   #7A0558;
--border-error:    #8B3232;
```

---

## Diff Viewer Colors

Taken directly from `cleo-parchment.json` `diffAdded*` / `diffRemoved*` keys.

```css
/* Dark */
--diff-added-bg:      #233023;
--diff-removed-bg:    #3A1E1E;
--diff-added-text:    #5B8A5C;   /* dark-green */
--diff-removed-text:  #B05050;   /* dark-red */
--diff-hunk-header:   #78AEBB;   /* dark-cyan */
--diff-added-ln-bg:   #2A3A2A;
--diff-removed-ln-bg: #3A2A2A;
--diff-line-number:   #4F473B;   /* dark-fg-subtle */

/* Light */
--diff-added-bg:      #D8EDD8;
--diff-removed-bg:    #F0D8D8;
--diff-added-text:    #3D6B3E;   /* light-green */
--diff-removed-text:  #8B3232;   /* light-red */
--diff-hunk-header:   #4A7A86;   /* light-cyan */
--diff-added-ln-bg:   #C8E0C8;
--diff-removed-ln-bg: #E8C8C8;
--diff-line-number:   #8A7B6E;   /* light-fg-muted */
```

---

## Typography

| Role | Font | Size | Weight | Color |
|---|---|---|---|---|
| Project name | System UI | 13px | 500 | `--fg-primary` |
| Agent type label | System UI | 12px | 400 | `--fg-muted` |
| Session ID / hash | Berkeley Mono | 11px | 400 | `--fg-subtle` |
| Current action | Berkeley Mono | 12px | 400 | `--fg-primary` |
| Status label | System UI | 11px | 500 | status color |
| Timestamps | System UI | 11px | 400 | `--fg-subtle` |
| Path text | Berkeley Mono | 11px | 400 | `--fg-subtle` |
| Tool output | Berkeley Mono | 12px | 400 | `--fg-muted` |
| Dispatch input | Berkeley Mono | 14px | 400 | `--fg-primary` |

System UI = `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

Berkeley Mono is already present in the environment. No additional font loading needed.

---

## Pulse Animation

```css
@keyframes status-pulse {
  0%, 100% { transform: scale(1.0); opacity: 1.0; }
  50%       { transform: scale(1.3); opacity: 0.8; }
}

.status-dot--pulsing {
  animation: status-pulse 2s ease-in-out infinite;
}
```

Applied to: approval (amber) and question (blue) dots only.
Review (magenta) and error (red) dots are static.

---

## Dark/Light Switching

Listen to `prefers-color-scheme` media query. If native app (Tauri/Electron),
additionally watch `AppleInterfaceStyle` via the same mechanism as
`~/.config/cleo-parchment/appearance-watcher.sh`.

No manual toggle in the app UI — follows system appearance automatically.

---

## CSS Custom Properties — Full Reference

```css
:root[data-theme="dark"] {
  /* Base */
  --bg-base:        #1D1912;
  --bg-panel:       #2A2420;
  --bg-element:     #3A342A;
  --fg-primary:     #F5F0E8;
  --fg-muted:       #D6D3CE;
  --fg-subtle:      #6B6256;
  --border:         #3A342A;
  --border-active:  #5A5347;

  /* Accent */
  --accent:         #C9A54E;
  --accent-hover:   #D4AF5A;

  /* Status */
  --status-running:  #5B8A5C;
  --status-idle:     #4F473B;
  --status-approval: #D4AF5A;
  --status-question: #556F7C;
  --status-review:   #910766;
  --status-error:    #B05050;

  /* Tints */
  --tint-approval:  rgba(212, 175, 90,  0.05);
  --tint-question:  rgba(85,  111, 124, 0.06);
  --tint-review:    rgba(145, 7,   102, 0.05);
  --tint-error:     rgba(176, 80,  80,  0.06);

  /* Borders */
  --border-approval: #D4AF5A;
  --border-question: #556F7C;
  --border-review:   #910766;
  --border-error:    #B05050;

  /* Diff */
  --diff-added-bg:      #233023;
  --diff-removed-bg:    #3A1E1E;
  --diff-added-text:    #5B8A5C;
  --diff-removed-text:  #B05050;
  --diff-hunk-header:   #78AEBB;
  --diff-added-ln-bg:   #2A3A2A;
  --diff-removed-ln-bg: #3A2A2A;
  --diff-line-number:   #4F473B;
}

:root[data-theme="light"] {
  /* Base */
  --bg-base:        #F5F0E8;
  --bg-panel:       #EDE8E0;
  --bg-element:     #C8C0AE;
  --fg-primary:     #2B241B;
  --fg-muted:       #5A5347;
  --fg-subtle:      #8A7B6E;
  --border:         #C8C0AE;
  --border-active:  #5A5347;

  /* Accent */
  --accent:         #5B8A5C;
  --accent-hover:   #7EAC7C;

  /* Status */
  --status-running:  #5B8A5C;
  --status-idle:     #8A7B6E;
  --status-approval: #8A7028;
  --status-question: #3A5563;
  --status-review:   #7A0558;
  --status-error:    #8B3232;

  /* Tints */
  --tint-approval:  rgba(138, 112, 40,  0.06);
  --tint-question:  rgba(58,  85,  99,  0.06);
  --tint-review:    rgba(122, 5,   88,  0.05);
  --tint-error:     rgba(139, 50,  50,  0.06);

  /* Borders */
  --border-approval: #8A7028;
  --border-question: #3A5563;
  --border-review:   #7A0558;
  --border-error:    #8B3232;

  /* Diff */
  --diff-added-bg:      #D8EDD8;
  --diff-removed-bg:    #F0D8D8;
  --diff-added-text:    #3D6B3E;
  --diff-removed-text:  #8B3232;
  --diff-hunk-header:   #4A7A86;
  --diff-added-ln-bg:   #C8E0C8;
  --diff-removed-ln-bg: #E8C8C8;
  --diff-line-number:   #8A7B6E;
}
```
