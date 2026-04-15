import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as QRCode from 'qrcode'
import { AgentProfile, AppConfig, OpencodeInstance } from '../types'
import type { ThemeId } from '../../../shared/types'

interface SettingsProps {
  config: AppConfig | null
  setConfig: (patch: Partial<AppConfig>) => Promise<boolean>
}

const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'os', label: 'OS default' },
  { id: 'dark', label: 'Dark (cleo)' },
  { id: 'light', label: 'Light (cleo)' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { id: 'nord', label: 'Nord' },
]

export function Settings({ config, setConfig }: SettingsProps) {
  if (!config) {
    return (
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Settings</h2>
        <div style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>Loading…</div>
      </div>
    )
  }

  const toggleMock = (): void => {
    setConfig({ mock: { enabled: !config.mock.enabled } })
  }

  const updateInstances = (instances: OpencodeInstance[]): void => {
    setConfig({ opencode: { instances } })
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 24 }}>Settings</h2>

      <Section title="Appearance">
        <Row>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Theme
            <select
              value={config.theme}
              onChange={(e) => {
                const opt = THEME_OPTIONS.find((o) => o.id === e.target.value)
                if (opt) setConfig({ theme: opt.id })
              }}
              style={{
                background: 'var(--bg-element)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--fg-primary)',
                fontSize: 13,
                padding: '3px 6px',
              }}
            >
              {THEME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </label>
        </Row>
      </Section>

      <Section title="Mock data">
        <Row>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config.mock.enabled}
              onChange={toggleMock}
            />
            <span style={{ fontSize: 13 }}>Use mock data instead of live opencode</span>
          </label>
        </Row>
        <Hint>When enabled, the dashboard renders fixture sessions and ignores configured opencode instances.</Hint>
      </Section>

      <Section title="opencode instances">
        <InstanceList
          instances={config.opencode.instances}
          onChange={updateInstances}
        />
        <Hint>One row per running <code>opencode serve</code>. Default port 4096. Edits commit on blur or Enter.</Hint>
      </Section>

      <Section title="Agent Profiles">
        <ProfileList />
        <Hint>One row per agent configuration. opencode profiles are dispatchable from ⌘K. API keys are encrypted at rest via OS keychain (Electron safeStorage). Click the dot next to the key field to reveal.</Hint>
      </Section>

      <Section title="Remote Access">
        <RemoteAccess config={config} setConfig={setConfig} />
        <Hint>Expose the flight deck over HTTP so a mobile client can connect. Bind to 0.0.0.0 (or a Tailscale address) and share the pairing URL with your phone.</Hint>
      </Section>
    </div>
  )
}

// ── Remote Access ─────────────────────────────────────────────────────────────

interface HttpStatus {
  status: string
  host?: string
  port?: number
  message?: string
}

function RemoteAccess({
  config,
  setConfig
}: {
  config: AppConfig
  setConfig: (patch: Partial<AppConfig>) => Promise<boolean>
}) {
  const [httpStatus, setHttpStatus] = useState<HttpStatus | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const api = window.electronAPI?.http
    if (!api) return
    return api.onStatus(setHttpStatus)
  }, [])

  const cfg = config.http

  const pairingUrl =
    cfg.enabled && cfg.bindAddress && cfg.port && cfg.token
      ? `http://${cfg.bindAddress}:${cfg.port}/pair?token=${cfg.token}`
      : ''

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pairingUrl) return
    QRCode.toCanvas(canvas, pairingUrl).catch(console.error)
  }, [pairingUrl])

  const handleEnabledChange = (): void => {
    setConfig({ http: { ...cfg, enabled: !cfg.enabled } })
  }

  const handleBindAddressBlur = (value: string): void => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== cfg.bindAddress) {
      setConfig({ http: { ...cfg, bindAddress: trimmed } })
    }
  }

  const handlePortBlur = (value: string): void => {
    const parsed = parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 1024 && parsed <= 65535 && parsed !== cfg.port) {
      setConfig({ http: { ...cfg, port: parsed } })
    }
  }

  const handleCopy = (): void => {
    if (pairingUrl) navigator.clipboard.writeText(pairingUrl).catch(console.error)
  }

  const handleRegenerateToken = (): void => {
    setConfig({ http: { ...cfg, token: crypto.randomUUID() } })
  }

  // Derive status label + color
  let statusText = 'Stopped'
  let statusColor = 'var(--fg-subtle)'
  if (httpStatus) {
    if (httpStatus.status === 'listening' && httpStatus.host && httpStatus.port) {
      statusText = `Listening on ${httpStatus.host}:${httpStatus.port}`
      statusColor = 'var(--status-ok, #4caf50)'
    } else if (httpStatus.status === 'error') {
      statusText = `Error: ${httpStatus.message ?? 'unknown'}`
      statusColor = 'var(--status-error)'
    } else {
      statusText = 'Stopped'
    }
  }

  return (
    <div>
      {/* Enable toggle + status */}
      <Row>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={handleEnabledChange}
          />
          <span style={{ fontSize: 13 }}>Enable remote access</span>
        </label>
        <span style={{ fontSize: 11, color: statusColor, marginLeft: 28, display: 'block', marginTop: 4 }}>
          {statusText}
        </span>
      </Row>

      {/* Bind address */}
      <Row>
        <FieldRow label="Bind address">
          <SettingsInput
            defaultValue={cfg.bindAddress}
            placeholder="0.0.0.0"
            onCommit={handleBindAddressBlur}
          />
        </FieldRow>
      </Row>

      {/* Port */}
      <Row>
        <FieldRow label="Port">
          <SettingsInput
            defaultValue={String(cfg.port)}
            placeholder="7080"
            inputMode="numeric"
            onCommit={handlePortBlur}
          />
        </FieldRow>
      </Row>

      {/* Pairing URL */}
      <Row>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 4 }}>Pairing URL</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 11,
              color: 'var(--fg-muted)',
              background: 'var(--bg-elevated, #1b1b1b)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 6px',
              overflowX: 'auto',
              whiteSpace: 'nowrap'
            }}
          >
            {pairingUrl || <span style={{ color: 'var(--fg-subtle)' }}>—</span>}
          </div>
          <button
            onClick={handleCopy}
            disabled={!pairingUrl}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--fg-muted)',
              cursor: pairingUrl ? 'pointer' : 'not-allowed',
              padding: '4px 8px',
              fontSize: 12,
              opacity: pairingUrl ? 1 : 0.4
            }}
          >
            Copy
          </button>
        </div>
      </Row>

      {/* QR code */}
      <Row>
        <div style={{ marginTop: 8 }}>
          {pairingUrl ? (
            <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 4 }} />
          ) : (
            <div
              style={{
                width: 160,
                height: 160,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px dashed var(--border)',
                borderRadius: 4,
                fontSize: 11,
                color: 'var(--fg-subtle)',
                textAlign: 'center',
                padding: 12
              }}
            >
              Build mobile client first
            </div>
          )}
        </div>
      </Row>

      {/* Regenerate token */}
      <Row>
        <button
          onClick={handleRegenerateToken}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            padding: '4px 10px',
            fontSize: 12
          }}
        >
          Regenerate token
        </button>
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 6 }}>
          Regenerating the token will disconnect any active mobile sessions.
        </div>
      </Row>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--fg-subtle)', width: 96, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, maxWidth: 240 }}>{children}</div>
    </div>
  )
}

function SettingsInput({
  defaultValue,
  placeholder,
  inputMode,
  onCommit
}: {
  defaultValue: string
  placeholder?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  onCommit: (value: string) => void
}) {
  const [value, setValue] = useState(defaultValue)

  // Resync when prop changes (e.g. config reloaded from main)
  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  return (
    <input
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') {
          setValue(defaultValue)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      style={{
        width: '100%',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 4,
        color: 'var(--fg-primary)',
        fontSize: 12,
        padding: '4px 6px',
        fontFamily: 'inherit'
      }}
    />
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 8 }}>{children}</div>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 6 }}>{children}</div>
}

const keyOf = (i: { host: string; port: number }): string => `${i.host}:${i.port}`

function InstanceList({
  instances,
  onChange
}: {
  instances: OpencodeInstance[]
  onChange: (next: OpencodeInstance[]) => void
}) {
  const [draftHost, setDraftHost] = useState('127.0.0.1')
  const [draftPort, setDraftPort] = useState('4096')
  const [draftLabel, setDraftLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const commitRow = (idx: number, next: OpencodeInstance): void => {
    // Reject duplicates against other rows. The registry keys clients by
    // host:port so a duplicate would silently dedupe and confuse the UI.
    const dupe = instances.some((i, k) => k !== idx && keyOf(i) === keyOf(next))
    if (dupe) {
      setError(`duplicate instance ${keyOf(next)} — edit ignored`)
      return
    }
    setError(null)
    onChange(instances.map((i, k) => (k === idx ? next : i)))
  }

  const remove = (idx: number): void => {
    setError(null)
    onChange(instances.filter((_, k) => k !== idx))
  }

  const add = (): void => {
    const port = parseInt(draftPort, 10)
    if (!draftHost.trim()) {
      setError('host is required')
      return
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setError('port must be an integer in 1–65535')
      return
    }
    const candidate: OpencodeInstance = {
      host: draftHost.trim(),
      port,
      label: draftLabel.trim() || undefined
    }
    if (instances.some((i) => keyOf(i) === keyOf(candidate))) {
      setError(`instance ${keyOf(candidate)} already exists`)
      return
    }
    setError(null)
    onChange([...instances, candidate])
    setDraftLabel('')
  }

  return (
    <div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--fg-subtle)', textAlign: 'left' }}>
            <th style={{ padding: '4px 8px', fontWeight: 500 }}>Host</th>
            <th style={{ padding: '4px 8px', fontWeight: 500 }}>Port</th>
            <th style={{ padding: '4px 8px', fontWeight: 500 }}>Label</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {instances.map((inst, idx) => (
            <InstanceRow
              key={`${idx}-${keyOf(inst)}`}
              instance={inst}
              onCommit={(next) => commitRow(idx, next)}
              onRemove={() => remove(idx)}
            />
          ))}
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: '4px 8px' }}>
              <Input value={draftHost} onChange={setDraftHost} />
            </td>
            <td style={{ padding: '4px 8px', width: 80 }}>
              <Input value={draftPort} onChange={setDraftPort} />
            </td>
            <td style={{ padding: '4px 8px' }}>
              <Input value={draftLabel} onChange={setDraftLabel} />
            </td>
            <td style={{ padding: '4px 8px', width: 24 }}>
              <button
                onClick={add}
                style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--fg-muted)', cursor: 'pointer', padding: '2px 6px' }}
              >
                +
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--status-error)' }}>{error}</div>
      )}
    </div>
  )
}

/**
 * One editable row. Holds local draft state for host/port/label and only
 * commits to parent (which writes to ConfigStore + tears down/rebuilds the
 * live client) on blur or Enter — never on every keystroke (B1 in code
 * review). Reverts to canonical value on Escape.
 */
function InstanceRow({
  instance,
  onCommit,
  onRemove
}: {
  instance: OpencodeInstance
  onCommit: (next: OpencodeInstance) => void
  onRemove: () => void
}) {
  const [host, setHost] = useState(instance.host)
  const [port, setPort] = useState(String(instance.port))
  const [label, setLabel] = useState(instance.label ?? '')

  // Resync local draft if parent value changes (e.g. another commit happened
  // elsewhere) and we don't currently have a divergent draft.
  useEffect(() => {
    setHost(instance.host)
    setPort(String(instance.port))
    setLabel(instance.label ?? '')
  }, [instance.host, instance.port, instance.label])

  const commit = (): void => {
    const trimmedHost = host.trim()
    const parsedPort = parseInt(port, 10)
    if (!trimmedHost) {
      setHost(instance.host)
      return
    }
    if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setPort(String(instance.port))
      return
    }
    const nextLabel = label.trim() || undefined
    if (
      trimmedHost === instance.host &&
      parsedPort === instance.port &&
      nextLabel === instance.label
    ) {
      return
    }
    onCommit({ host: trimmedHost, port: parsedPort, label: nextLabel })
  }

  const revert = (): void => {
    setHost(instance.host)
    setPort(String(instance.port))
    setLabel(instance.label ?? '')
  }

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '4px 8px' }}>
        <Input value={host} onChange={setHost} onCommit={commit} onRevert={revert} />
      </td>
      <td style={{ padding: '4px 8px', width: 80 }}>
        <Input value={port} onChange={setPort} onCommit={commit} onRevert={revert} />
      </td>
      <td style={{ padding: '4px 8px' }}>
        <Input value={label} onChange={setLabel} onCommit={commit} onRevert={revert} />
      </td>
      <td style={{ padding: '4px 8px', width: 24 }}>
        <button
          onClick={onRemove}
          style={{ background: 'transparent', border: 'none', color: 'var(--fg-subtle)', cursor: 'pointer' }}
          aria-label="Remove instance"
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

function Input({
  value,
  onChange,
  onCommit,
  onRevert
}: {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  onRevert?: () => void
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          onRevert?.()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      style={{
        width: '100%',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 4,
        color: 'var(--fg-primary)',
        fontSize: 12,
        padding: '4px 6px',
        fontFamily: 'inherit'
      }}
    />
  )
}

// ── Agent Profiles ────────────────────────────────────────────────────────────

const AGENT_TYPES: AgentProfile['agentType'][] = ['opencode', 'claude-code']

/** Shared inline-input style for the profiles table. */
const profileInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--fg-primary)',
  fontSize: 12,
  padding: '4px 6px',
  fontFamily: 'inherit'
}

function ProfileList() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])

  useEffect(() => {
    window.electronAPI?.profile?.list().then(setProfiles)
  }, [])

  const handleUpdate = useCallback(async (updated: AgentProfile) => {
    const saved = await window.electronAPI?.profile?.update(updated)
    if (saved) {
      setProfiles((prev) => prev.map((p) => (p.id === saved.id ? saved : p)))
    }
  }, [])

  const handleSetDefault = useCallback(
    async (id: string) => {
      // Optimistic update so the UI reflects the new default immediately and
      // a failed IPC can never leave profiles undefined (prior code
      // filtered undefined results, which would make rows disappear).
      const next = profiles.map((p) => ({ ...p, isDefault: p.id === id }))
      setProfiles(next)
      const api = window.electronAPI?.profile
      if (!api) return
      // Persist sequentially to avoid clobbering each other on the main side
      // (every update round-trips the full profiles array through configStore).
      for (const p of next) {
        await api.update(p)
      }
    },
    [profiles]
  )

  const [pendingDelete, setPendingDelete] = useState<AgentProfile | null>(null)

  const requestDelete = useCallback((id: string) => {
    const target = profiles.find((p) => p.id === id) ?? null
    setPendingDelete(target)
  }, [profiles])

  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  const handleDelete = useCallback(async (id: string) => {
    const api = window.electronAPI?.profile
    if (!api) return
    const removed = profiles.find((p) => p.id === id)
    const remaining = profiles.filter((p) => p.id !== id)
    await api.delete(id)
    // If the deleted profile was the default, promote the first remaining
    // profile to default so the UI isn't left with no radio checked.
    if (removed?.isDefault && remaining.length > 0 && !remaining.some((p) => p.isDefault)) {
      const promoted = { ...remaining[0], isDefault: true }
      const next = [promoted, ...remaining.slice(1)]
      setProfiles(next)
      await api.update(promoted)
    } else {
      setProfiles(remaining)
    }
  }, [profiles])

  const handleAdd = useCallback(
    async (draft: Omit<AgentProfile, 'id'>) => {
      const isFirst = profiles.length === 0
      const payload: Omit<AgentProfile, 'id'> = { ...draft, isDefault: isFirst || draft.isDefault }
      const saved = await window.electronAPI?.profile?.add(payload)
      if (saved) {
        // If the new profile is default, clear default on others and persist.
        if (saved.isDefault && profiles.length > 0) {
          const cleared = await Promise.all(
            profiles.map((p) => window.electronAPI?.profile?.update({ ...p, isDefault: false }))
          )
          setProfiles([
            ...cleared.filter((r): r is AgentProfile => r !== undefined),
            saved
          ])
        } else {
          setProfiles((prev) => [...prev, saved])
        }
      }
    },
    [profiles]
  )

  return (
    <div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--fg-subtle)', textAlign: 'left' }}>
            <th style={{ padding: '4px 8px', fontWeight: 500 }}>Label</th>
            <th style={{ padding: '4px 8px', fontWeight: 500 }}>Agent</th>
            <th style={{ padding: '4px 8px', fontWeight: 500 }}>Provider</th>
            <th style={{ padding: '4px 8px', fontWeight: 500 }}>Model</th>
            <th style={{ padding: '4px 8px', fontWeight: 500, width: 120 }}>API Key</th>
            <th style={{ padding: '4px 8px', fontWeight: 500, width: 50, textAlign: 'center' }}>Default</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              onCommit={handleUpdate}
              onSetDefault={() => handleSetDefault(profile.id)}
              onRemove={() => requestDelete(profile.id)}
            />
          ))}
          <ProfileAddRow onAdd={handleAdd} />
        </tbody>
      </table>
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete profile "${pendingDelete.label}"?`}
          body="This will permanently remove the stored API key. This cannot be undone."
          confirmLabel="Delete"
          onCancel={cancelDelete}
          onConfirm={async () => {
            const id = pendingDelete.id
            setPendingDelete(null)
            await handleDelete(id)
          }}
        />
      )}
    </div>
  )
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  body: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  // Esc handler in capture phase + stopPropagation so the app-wide Esc
  // shortcut (useKeyboardNav → App.onEscape) does not also fire and close
  // unrelated panel state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // stopImmediatePropagation: useKeyboardNav registers its own
        // window-level bubble listener for Escape. Since both listeners
        // attach to window, stopPropagation is insufficient — we need
        // stopImmediate to prevent the App.onEscape cascade from firing.
        e.stopImmediatePropagation()
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  // Focus Cancel on mount — safer default for a destructive confirmation
  // than autoFocusing Delete, which turns habitual Enter-to-dismiss into
  // an unrecoverable destroy.
  useEffect(() => {
    cancelBtnRef.current?.focus()
  }, [])

  // Minimal focus trap: Tab / Shift+Tab cycles between Cancel and Confirm.
  // Two buttons is the entire focusable surface of this dialog, so a full
  // querySelectorAll trap would be overkill.
  const handleTrapKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const cancel = cancelBtnRef.current
    const confirm = confirmBtnRef.current
    if (!cancel || !confirm) return
    if (e.shiftKey) {
      if (document.activeElement === cancel) {
        e.preventDefault()
        confirm.focus()
      }
    } else {
      if (document.activeElement === confirm) {
        e.preventDefault()
        cancel.focus()
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
      onKeyDown={handleTrapKey}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated, #1b1b1b)',
          border: '1px solid var(--border, #333)',
          borderRadius: 6,
          padding: 20,
          minWidth: 320,
          maxWidth: 480,
          color: 'var(--fg, #eee)',
          fontSize: 13
        }}
      >
        <div id="confirm-dialog-title" style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ color: 'var(--fg-subtle)', marginBottom: 16 }}>{body}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            ref={cancelBtnRef}
            onClick={onCancel}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: 'var(--fg)',
              border: '1px solid var(--border, #444)',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            style={{
              padding: '6px 12px',
              background: 'var(--status-error, #c33)',
              color: '#fff',
              border: '1px solid var(--status-error, #c33)',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfileRow({
  profile,
  onCommit,
  onSetDefault,
  onRemove
}: {
  profile: AgentProfile
  onCommit: (next: AgentProfile) => void
  onSetDefault: () => void
  onRemove: () => void
}) {
  const [label, setLabel] = useState(profile.label)
  const [agentType, setAgentType] = useState<AgentProfile['agentType']>(profile.agentType)
  const [provider, setProvider] = useState(profile.provider ?? '')
  const [model, setModel] = useState(profile.model ?? '')
  const [apiKey, setApiKey] = useState(profile.apiKey ?? '')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)

  // Resync local draft when parent value changes.
  useEffect(() => {
    setLabel(profile.label)
    setAgentType(profile.agentType)
    setProvider(profile.provider ?? '')
    setModel(profile.model ?? '')
    setApiKey(profile.apiKey ?? '')
  }, [profile.label, profile.agentType, profile.provider, profile.model, profile.apiKey])

  const buildNext = (): AgentProfile => ({
    ...profile,
    label: label.trim() || profile.label,
    agentType,
    provider: provider.trim() || undefined,
    model: model.trim() || undefined,
    apiKey: apiKey || undefined
  })

  const commit = (): void => {
    const next = buildNext()
    const unchanged =
      next.label === profile.label &&
      next.agentType === profile.agentType &&
      (next.provider ?? '') === (profile.provider ?? '') &&
      (next.model ?? '') === (profile.model ?? '') &&
      (next.apiKey ?? '') === (profile.apiKey ?? '')
    if (!unchanged) onCommit(next)
  }

  const revert = (): void => {
    setLabel(profile.label)
    setAgentType(profile.agentType)
    setProvider(profile.provider ?? '')
    setModel(profile.model ?? '')
    setApiKey(profile.apiKey ?? '')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Escape') {
      revert()
      ;(e.target as HTMLInputElement).blur()
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      {/* Label */}
      <td style={{ padding: '4px 8px' }}>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          style={profileInputStyle}
        />
      </td>
      {/* Agent type */}
      <td style={{ padding: '4px 8px' }}>
        <select
          value={agentType}
          onChange={(e) => {
            setAgentType(e.target.value as AgentProfile['agentType'])
            // Commit immediately on select change — no blur needed.
            onCommit({ ...buildNext(), agentType: e.target.value as AgentProfile['agentType'] })
          }}
          style={{
            ...profileInputStyle,
            cursor: 'pointer'
          }}
        >
          {AGENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      {/* Provider — hidden for claude-code (uses keychain auth) */}
      <td style={{ padding: '4px 8px' }}>
        {agentType !== 'claude-code' ? (
          <input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            style={profileInputStyle}
          />
        ) : (
          <span style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>—</span>
        )}
      </td>
      {/* Model */}
      <td style={{ padding: '4px 8px' }}>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          style={profileInputStyle}
        />
      </td>
      {/* API Key — hidden for claude-code; password field otherwise */}
      <td style={{ padding: '4px 8px', width: 120 }}>
        {agentType !== 'claude-code' ? (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type={apiKeyVisible ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => {
                // Re-mask on blur so the key never stays visible unattended.
                setApiKeyVisible(false)
                commit()
              }}
              onKeyDown={handleKeyDown}
              // autoComplete=off + data-1p-ignore to discourage password managers
              // from treating this as a login field.
              autoComplete="off"
              data-1p-ignore="true"
              style={{ ...profileInputStyle, paddingRight: 24 }}
            />
            <button
              type="button"
              onClick={() => setApiKeyVisible((v) => !v)}
              aria-label={apiKeyVisible ? 'Hide API key' : 'Show API key'}
              title={apiKeyVisible ? 'Hide' : 'Show'}
              style={{
                position: 'absolute',
                right: 4,
                background: 'transparent',
                border: 'none',
                color: 'var(--fg-subtle)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11,
                lineHeight: 1
              }}
            >
              {apiKeyVisible ? '○' : '●'}
            </button>
          </div>
        ) : (
          <span style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>—</span>
        )}
      </td>
      {/* Default radio */}
      <td style={{ padding: '4px 8px', width: 50, textAlign: 'center' }}>
        <input
          type="radio"
          name="profile-default"
          checked={profile.isDefault}
          onChange={onSetDefault}
          style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
        />
      </td>
      {/* Delete */}
      <td style={{ padding: '4px 8px', width: 24 }}>
        <button
          onClick={onRemove}
          style={{ background: 'transparent', border: 'none', color: 'var(--fg-subtle)', cursor: 'pointer' }}
          aria-label="Remove profile"
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

function ProfileAddRow({ onAdd }: { onAdd: (draft: Omit<AgentProfile, 'id'>) => void }) {
  const [label, setLabel] = useState('')
  const [agentType, setAgentType] = useState<AgentProfile['agentType']>('opencode')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')

  const add = (): void => {
    if (!label.trim()) return
    onAdd({
      label: label.trim(),
      agentType,
      provider: provider.trim() || undefined,
      model: model.trim() || undefined,
      apiKey: apiKey || undefined,
      isDefault: false
    })
    setLabel('')
    setProvider('')
    setModel('')
    setApiKey('')
    setAgentType('opencode')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') add()
  }

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '4px 8px' }}>
        <input
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={handleKeyDown}
          style={profileInputStyle}
        />
      </td>
      <td style={{ padding: '4px 8px' }}>
        <select
          value={agentType}
          onChange={(e) => setAgentType(e.target.value as AgentProfile['agentType'])}
          style={{ ...profileInputStyle, cursor: 'pointer' }}
        >
          {AGENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: '4px 8px' }}>
        {agentType !== 'claude-code' ? (
          <input
            placeholder="Provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            onKeyDown={handleKeyDown}
            style={profileInputStyle}
          />
        ) : (
          <span style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>—</span>
        )}
      </td>
      <td style={{ padding: '4px 8px' }}>
        <input
          placeholder="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onKeyDown={handleKeyDown}
          style={profileInputStyle}
        />
      </td>
      <td style={{ padding: '4px 8px', width: 120 }}>
        {agentType !== 'claude-code' ? (
          <input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            data-1p-ignore="true"
            style={profileInputStyle}
          />
        ) : (
          <span style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>—</span>
        )}
      </td>
      <td style={{ padding: '4px 8px', width: 50 }} />
      <td style={{ padding: '4px 8px', width: 24 }}>
        <button
          onClick={add}
          style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--fg-muted)', cursor: 'pointer', padding: '2px 6px' }}
        >
          +
        </button>
      </td>
    </tr>
  )
}
