import { useEffect, useState } from 'react'
import { AppConfig, OpencodeInstance } from '../types'

interface SettingsProps {
  config: AppConfig | null
  setConfig: (patch: Partial<AppConfig>) => Promise<void>
}

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
    </div>
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
