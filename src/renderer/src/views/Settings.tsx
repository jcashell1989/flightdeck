import { useState } from 'react'
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
        <Hint>One row per running <code>opencode serve</code>. Default port 4096.</Hint>
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

  const update = (idx: number, patch: Partial<OpencodeInstance>): void => {
    onChange(instances.map((i, k) => (k === idx ? { ...i, ...patch } : i)))
  }
  const remove = (idx: number): void => {
    onChange(instances.filter((_, k) => k !== idx))
  }
  const add = (): void => {
    const port = parseInt(draftPort, 10)
    if (!draftHost || !Number.isFinite(port)) return
    onChange([...instances, { host: draftHost, port, label: draftLabel || undefined }])
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
            <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '4px 8px' }}>
                <Input value={inst.host} onChange={(v) => update(idx, { host: v })} />
              </td>
              <td style={{ padding: '4px 8px', width: 80 }}>
                <Input
                  value={String(inst.port)}
                  onChange={(v) => {
                    const n = parseInt(v, 10)
                    if (Number.isFinite(n)) update(idx, { port: n })
                  }}
                />
              </td>
              <td style={{ padding: '4px 8px' }}>
                <Input value={inst.label ?? ''} onChange={(v) => update(idx, { label: v || undefined })} />
              </td>
              <td style={{ padding: '4px 8px', width: 24 }}>
                <button
                  onClick={() => remove(idx)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--fg-subtle)', cursor: 'pointer' }}
                  aria-label="Remove instance"
                >
                  ✕
                </button>
              </td>
            </tr>
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
    </div>
  )
}

function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
