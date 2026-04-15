import { useEffect, useState } from 'react'
import { useConfig } from '../hooks/useConfig'
import type { AnalyticsSummary, ProjectAnalytics } from '../types'

// ── Mock data ─────────────────────────────────────────────────────────────

const MOCK_SUMMARY: AnalyticsSummary = {
  generatedAt: Date.now(),
  projects: [
    {
      projectPath: '/Users/dev/my-app',
      projectName: 'my-app',
      claudeCodeUsage: [
        {
          sessionId: 'cc-session-1',
          projectPath: '/Users/dev/my-app',
          inputTokens: 48200,
          outputTokens: 12400,
          cacheWriteTokens: 95000,
          cacheReadTokens: 320000,
          model: 'claude-opus-4-5',
          messageCount: 34
        },
        {
          sessionId: 'cc-session-2',
          projectPath: '/Users/dev/my-app',
          inputTokens: 21000,
          outputTokens: 5800,
          cacheWriteTokens: 40000,
          cacheReadTokens: 110000,
          model: 'claude-sonnet-4-5',
          messageCount: 18
        }
      ],
      opencodeSessions: [
        {
          sessionId: 'oc-session-1',
          projectPath: '/Users/dev/my-app',
          realCostUsd: 1.47,
          messageCount: 22,
          totalInputTokens: 35000,
          totalOutputTokens: 9800
        }
      ],
      totalOpencodeCostUsd: 1.47
    },
    {
      projectPath: '/Users/dev/flightdeck',
      projectName: 'flightdeck',
      claudeCodeUsage: [
        {
          sessionId: 'cc-session-3',
          projectPath: '/Users/dev/flightdeck',
          inputTokens: 130000,
          outputTokens: 42000,
          cacheWriteTokens: 210000,
          cacheReadTokens: 870000,
          model: 'claude-opus-4-5',
          messageCount: 87
        }
      ],
      opencodeSessions: [
        {
          sessionId: 'oc-session-2',
          projectPath: '/Users/dev/flightdeck',
          realCostUsd: 3.82,
          messageCount: 51,
          totalInputTokens: 88000,
          totalOutputTokens: 24000
        },
        {
          sessionId: 'oc-session-3',
          projectPath: '/Users/dev/flightdeck',
          realCostUsd: 0.93,
          messageCount: 14,
          totalInputTokens: 18000,
          totalOutputTokens: 5200
        }
      ],
      totalOpencodeCostUsd: 4.75
    }
  ]
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function sumTokens(project: ProjectAnalytics): { input: number; output: number; cache: number } {
  let input = 0, output = 0, cache = 0
  for (const s of project.claudeCodeUsage) {
    input += s.inputTokens
    output += s.outputTokens
    cache += s.cacheWriteTokens + s.cacheReadTokens
  }
  return { input, output, cache }
}

// ── Component ─────────────────────────────────────────────────────────────

export function Analytics() {
  const { config } = useConfig()
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)

  const isMock = config?.mock.enabled ?? false

  useEffect(() => {
    if (isMock) {
      setSummary(MOCK_SUMMARY)
      return
    }
    const api = window.electronAPI?.analytics
    if (!api) return

    let cancelled = false
    api.getSummary()
      .then((s) => { if (!cancelled) setSummary(s) })
      .catch(console.error)

    const unsub = api.onSummary((s) => { if (!cancelled) setSummary(s) })
    return () => {
      cancelled = true
      unsub()
    }
  }, [isMock])

  const projects = summary?.projects ?? []
  const maxCost = Math.max(...projects.map((p) => p.totalOpencodeCostUsd), 0.01)

  return (
    <div style={{ padding: '0 0 24px' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--fg)' }}>
        Analytics
      </h2>

      {projects.length === 0 && (
        <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          No data yet. Sessions will appear as they run.
        </div>
      )}

      {projects.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--fg-muted)', textAlign: 'left' }}>
              <th style={{ padding: '4px 12px 8px 0', fontWeight: 500, width: '22%' }}>Project</th>
              <th style={{ padding: '4px 12px 8px 0', fontWeight: 500, width: '18%' }}>opencode Cost</th>
              <th style={{ padding: '4px 0 8px 0', fontWeight: 500 }}>Claude Code Tokens</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const hasOc = project.opencodeSessions.length > 0
              const hasCc = project.claudeCodeUsage.length > 0
              const tokens = hasCc ? sumTokens(project) : null
              const barPct = hasOc ? (project.totalOpencodeCostUsd / maxCost) * 100 : 0

              return (
                <tr
                  key={project.projectPath}
                  style={{
                    borderTop: '1px solid var(--border)',
                    verticalAlign: 'top'
                  }}
                >
                  {/* Project name */}
                  <td style={{ padding: '10px 12px 10px 0', color: 'var(--fg)' }}>
                    <div style={{ fontWeight: 500 }}>{project.projectName}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--fg-muted)',
                        marginTop: 2,
                        wordBreak: 'break-all'
                      }}
                    >
                      {project.projectPath}
                    </div>
                  </td>

                  {/* opencode cost + bar */}
                  <td style={{ padding: '10px 12px 10px 0' }}>
                    {hasOc ? (
                      <>
                        <div style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                          ${project.totalOpencodeCostUsd.toFixed(2)}
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            height: 4,
                            borderRadius: 2,
                            background: 'var(--border)',
                            width: '100%',
                            maxWidth: 120
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              borderRadius: 2,
                              background: 'var(--accent)',
                              width: `${barPct}%`
                            }}
                          />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                          {project.opencodeSessions.length} session{project.opencodeSessions.length !== 1 ? 's' : ''}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: 'var(--fg-muted)' }}>&mdash;</span>
                    )}
                  </td>

                  {/* Claude Code tokens */}
                  <td style={{ padding: '10px 0' }}>
                    {hasCc && tokens ? (
                      <>
                        <div style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(tokens.input)} input / {fmt(tokens.output)} output / {fmt(tokens.cache)} cache
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                          {project.claudeCodeUsage.reduce((a, s) => a + s.messageCount, 0)} messages
                          &nbsp;&middot;&nbsp;
                          {project.claudeCodeUsage.length} session{project.claudeCodeUsage.length !== 1 ? 's' : ''}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: 'var(--fg-muted)' }}>&mdash;</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {summary && (
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--fg-muted)' }}>
          Generated {new Date(summary.generatedAt).toLocaleTimeString()}
          {isMock && ' (mock data)'}
        </div>
      )}
    </div>
  )
}
