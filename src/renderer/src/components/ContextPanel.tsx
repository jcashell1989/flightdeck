import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppConfig, Project, Session } from '../types'
import { StatusDot } from './StatusDot'
import type { MessageRecord, ProcessResult } from '../electronAPI'
import { useSessionDetail } from '../hooks/useSessionDetail'
import { parseSlashCommand } from '../../../shared/commandParser'
import { CommandPalette, type CommandPaletteHandle } from './CommandPalette'

interface ContextPanelProps {
  session: Session | null
  project: Project | null
  config: AppConfig | null
  fullScreen: boolean
  onClose: () => void
  onToggleFullScreen: () => void
}

type Tab = 'conversation' | 'diff' | 'todo'

export function ContextPanel({
  session,
  project,
  config,
  fullScreen,
  onClose,
  onToggleFullScreen
}: ContextPanelProps) {
  const [tab, setTab] = useState<Tab>('conversation')
  const detail = useSessionDetail(session, config)
  const useMock = config?.mock.enabled ?? true

  // Reset tab when session changes so we don't land on Diff with stale data.
  useEffect(() => {
    setTab('conversation')
  }, [session?.id])

  if (!session) return null

  return (
    <div
      style={{
        flex: fullScreen ? '1 1 100%' : 2,
        minWidth: 0,
        borderLeft: '1px solid var(--border)',
        backgroundColor: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0
        }}
      >
        <button onClick={onClose} style={headerBtn}>
          ← Back
        </button>
        <StatusDot state={session.state} />
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{session.agentType}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)' }} title={session.id}>
          #{session.id.slice(-4)}
        </span>
        {project && (
          <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>· {project.name}</span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onToggleFullScreen}
          title={fullScreen ? 'Exit full screen (Esc)' : 'Full screen (F)'}
          style={headerBtn}
        >
          {fullScreen ? '⇱' : '⇲'}
        </button>
        <button onClick={onClose} style={headerBtn} title="Close (Esc)">
          ✕
        </button>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0
        }}
      >
        <TabButton active={tab === 'conversation'} onClick={() => setTab('conversation')}>
          Conversation
        </TabButton>
        <TabButton active={tab === 'diff'} onClick={() => setTab('diff')}>
          Diff
        </TabButton>
        <TabButton active={tab === 'todo'} onClick={() => setTab('todo')}>
          Todo
        </TabButton>
      </div>

      {/* Tab body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {tab === 'conversation' && (
          <ConversationTab
            session={session}
            detail={detail}
            useMock={useMock}
          />
        )}
        {tab === 'diff' && <DiffTab project={project} useMock={useMock} />}
        {tab === 'todo' && <TodoTab project={project} useMock={useMock} />}
      </div>
    </div>
  )
}

const headerBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 13,
  padding: '2px 6px'
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 12px',
        fontSize: 12,
        background: active ? 'var(--bg-element)' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--fg-primary)' : 'var(--fg-subtle)',
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  )
}

// ─── Conversation ─────────────────────────────────────────────────────────

function ConversationTab({
  session,
  detail,
  useMock
}: {
  session: Session
  detail: ReturnType<typeof useSessionDetail>
  useMock: boolean
}) {
  const [replyDraft, setReplyDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const paletteRef = useRef<CommandPaletteHandle | null>(null)

  // Auto-scroll to bottom when new messages land OR when streaming tokens
  // extend the last message. Depending only on messages.length misses
  // incremental growth of the last message's content.
  const lastMessageFingerprint = useMemo(() => {
    const last = detail.messages[detail.messages.length - 1]
    if (!last) return ''
    const textLen = last.parts.reduce((n, p) => {
      const t = (p as { text?: string }).text
      return n + (typeof t === 'string' ? t.length : 0)
    }, 0)
    return `${detail.messages.length}:${last.parts.length}:${textLen}`
  }, [detail.messages])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lastMessageFingerprint])

  const canReply =
    !useMock &&
    (session.state === 'running' ||
      session.state === 'idle' ||
      session.state === 'question')

  const handleSend = useCallback(async () => {
    const text = replyDraft.trim()
    if (!text || sending) return
    const api = window.electronAPI?.opencode
    if (!api) {
      setSendError('bridge unavailable')
      return
    }
    setSending(true)
    setSendError(null)
    try {
      // Slash command routing: /cmd args → sendCommand; plain text → sendPrompt.
      // Only for managed opencode sessions (claude-code and file-watch are read-only).
      const canDispatchCommands =
        session.agentType === 'opencode' &&
        !session.instanceKey?.startsWith('opencode-file-watch:')
      const parsed = canDispatchCommands ? parseSlashCommand(text) : null
      if (parsed) {
        await api.sendCommand(session.id, parsed.command, parsed.args)
      } else {
        // Strip the \/ escape before sending (user typed \/foo to mean literal /foo).
        await api.sendPrompt(session.id, text.startsWith('\\/') ? text.slice(1) : text)
      }
      setReplyDraft('')
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }, [replyDraft, sending, session.id, session.agentType, session.instanceKey])

  const showBanner =
    session.state === 'approval' ||
    session.state === 'question' ||
    session.state === 'review' ||
    session.state === 'error'

  return (
    <>
      <div ref={scrollRef} style={{ flex: 1, padding: 16, overflow: 'auto', minHeight: 0 }}>
        {showBanner && (
          <AttentionBanner session={session} useMock={useMock} onReply={handleSend} />
        )}
        {detail.loading && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 11, marginTop: 8 }}>
            loading messages…
          </div>
        )}
        {detail.error && !detail.unavailable && (
          <div style={{ color: 'var(--status-error)', fontSize: 11, marginTop: 8 }}>
            {detail.error}
          </div>
        )}
        {detail.unavailable && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 11, marginTop: 16, textAlign: 'center' }}>
            {detail.unavailable}
          </div>
        )}
        {detail.messages.length === 0 && !detail.loading && !detail.error && !detail.unavailable && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 11, marginTop: 16, textAlign: 'center' }}>
            no messages yet
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {detail.messages.map((m, i) => (
            <MessageRow key={messageKey(m, i)} message={m} />
          ))}
        </div>
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        {sendError && (
          <div style={{ color: 'var(--status-error)', fontSize: 10, marginBottom: 4 }}>
            {sendError}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <CommandPalette
            ref={paletteRef}
            sessionId={session.id}
            inputValue={replyDraft}
            onComplete={(completed) => {
              setReplyDraft(completed)
              textareaRef.current?.focus()
            }}
            onDismiss={() => {
              setReplyDraft('')
              textareaRef.current?.focus()
            }}
          />
          <textarea
            ref={textareaRef}
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={(e) => {
              // Forward navigation/completion/dismiss keys to the palette first
              if (paletteRef.current?.handleKey(e)) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder={
              useMock
                ? 'Reply disabled in mock mode'
                : canReply
                  ? 'Reply to agent… (Enter to send, Shift+Enter for newline)'
                  : `Reply disabled while ${session.state}`
            }
            disabled={!canReply || sending}
            rows={2}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 12,
              fontFamily: '"Berkeley Mono", "SF Mono", monospace',
              border: '1px solid var(--border)',
              borderRadius: 4,
              backgroundColor: 'var(--bg-base)',
              color: 'var(--fg-primary)',
              outline: 'none',
              resize: 'vertical'
            }}
          />
        </div>
      </div>
    </>
  )
}

function messageKey(m: MessageRecord, fallback: number): string {
  const id = (m.info as { id?: string } | undefined)?.id
  return id ?? `m-${fallback}`
}

function MessageRow({ message }: { message: MessageRecord }) {
  const role = (message.info as { role?: string } | undefined)?.role ?? 'agent'
  const isUser = role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'stretch',
        gap: 4
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>
        [{isUser ? 'user' : role === 'assistant' ? 'agent' : role}]
      </div>
      {message.parts.map((p, i) => (
        <PartRow key={(p as { id?: string }).id ?? `p-${i}`} part={p} isUser={isUser} />
      ))}
    </div>
  )
}

function PartRow({ part, isUser }: { part: MessageRecord['parts'][number]; isUser: boolean }) {
  const type = part.type
  if (type === 'text') {
    return (
      <div
        style={{
          fontSize: 12,
          color: 'var(--fg-primary)',
          backgroundColor: isUser ? 'var(--bg-element)' : 'transparent',
          padding: isUser ? '6px 10px' : '0',
          borderRadius: isUser ? 6 : 0,
          maxWidth: '85%',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {(part.text as string) ?? ''}
      </div>
    )
  }
  if (type === 'tool') {
    return <ToolPart part={part} />
  }
  if (type === 'file') {
    return (
      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
        📄 {(part as { filename?: string }).filename ?? 'file'}
      </div>
    )
  }
  if (type === 'reasoning') {
    return (
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>
        thinking…
      </div>
    )
  }
  return (
    <div className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
      [{type}]
    </div>
  )
}

function ToolPart({ part }: { part: MessageRecord['parts'][number] }) {
  const [expanded, setExpanded] = useState(false)
  const name = (part.tool as string | undefined) ?? 'tool'
  const status = (part.state as { status?: string } | undefined)?.status
  const output = (part.state as { output?: string } | undefined)?.output
  return (
    <div className="mono" style={{ fontSize: 11 }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 'inherit'
        }}
      >
        {expanded ? '▾' : '▸'} tool:{name}
        {status && ` (${status})`}
      </button>
      {expanded && output && (
        <pre
          style={{
            marginTop: 4,
            padding: 8,
            backgroundColor: 'var(--bg-base)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--fg-primary)',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap'
          }}
        >
          {output}
        </pre>
      )}
    </div>
  )
}

// ─── Attention Banner ─────────────────────────────────────────────────────

function AttentionBanner({
  session,
  useMock,
  onReply
}: {
  session: Session
  useMock: boolean
  onReply: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const color =
    session.state === 'approval'
      ? 'var(--border-approval)'
      : session.state === 'question'
        ? 'var(--border-question)'
        : session.state === 'error'
          ? 'var(--border-error)'
          : 'var(--border-review)'

  const tint =
    session.state === 'approval'
      ? 'var(--tint-approval)'
      : session.state === 'question'
        ? 'var(--tint-question)'
        : session.state === 'error'
          ? 'var(--tint-error)'
          : 'var(--tint-review)'

  const label =
    session.state === 'approval'
      ? 'WAITING FOR APPROVAL'
      : session.state === 'question'
        ? 'WAITING FOR INPUT'
        : session.state === 'error'
          ? 'AGENT ERROR'
          : 'REVIEW CHANGES'

  const respond = async (response: 'once' | 'reject') => {
    if (useMock) {
      setErr('mock mode — action skipped')
      return
    }
    const pid = session.pendingPermission?.id
    if (!pid) {
      setErr('no pending permission id')
      return
    }
    const api = window.electronAPI?.opencode
    if (!api) {
      setErr('bridge unavailable')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await api.respondPermission(session.id, pid, response)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pp = session.pendingPermission
  const describe =
    pp?.command ?? pp?.pattern ?? pp?.title ?? session.currentAction

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 6,
        border: `1px solid ${color}`,
        backgroundColor: tint,
        fontSize: 12,
        marginBottom: 12
      }}
    >
      <div
        style={{
          fontWeight: 600,
          color,
          marginBottom: 6,
          fontSize: 11,
          letterSpacing: '0.04em'
        }}
      >
        ⚠ {label}
        {pp?.type && ` · ${pp.type}`}
      </div>
      <div
        className="mono"
        style={{
          color: 'var(--fg-primary)',
          marginBottom: 8,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {describe}
      </div>
      {session.state === 'approval' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            disabled={busy}
            onClick={() => void respond('once')}
            style={bannerBtn(color)}
          >
            Allow
          </button>
          <button
            disabled={busy}
            onClick={() => void respond('reject')}
            style={bannerBtn('var(--fg-subtle)')}
          >
            Deny
          </button>
        </div>
      )}
      {session.state === 'question' && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          Type your answer in the reply box below, then press Enter.
          <button
            onClick={onReply}
            style={{ ...bannerBtn(color), marginLeft: 8 }}
            disabled={busy}
          >
            Send reply
          </button>
        </div>
      )}
      {session.state === 'review' && (
        <button disabled={busy} style={bannerBtn(color)}>
          Mark Reviewed
        </button>
      )}
      {err && (
        <div style={{ fontSize: 10, color: 'var(--status-error)', marginTop: 6 }}>{err}</div>
      )}
    </div>
  )
}

function bannerBtn(color: string): CSSProperties {
  return {
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 500,
    border: `1px solid ${color}`,
    borderRadius: 4,
    background: 'transparent',
    color,
    cursor: 'pointer'
  }
}

// ─── Diff Tab ─────────────────────────────────────────────────────────────

interface DiffFile {
  filename: string
  added: number
  removed: number
  startLine: number // index into `lines` where this file's diff begins
}

function parseDiffFiles(lines: string[]): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      // Extract filename from "diff --git a/foo b/foo" → "foo"
      const match = line.match(/diff --git a\/.+ b\/(.+)/)
      current = { filename: match?.[1] ?? line, added: 0, removed: 0, startLine: i }
    } else if (current) {
      if (line.startsWith('+') && !line.startsWith('+++')) current.added++
      if (line.startsWith('-') && !line.startsWith('---')) current.removed++
    }
  }
  if (current) files.push(current)
  return files
}

function DiffTab({ project, useMock }: { project: Project | null; useMock: boolean }) {
  const result = useShellResult(project?.path ?? null, useMock, 'getDiff')
  const content = result.data?.stdout
  const lines = useMemo(() => (content ? content.split('\n') : []), [content])
  const files = useMemo(() => parseDiffFiles(lines), [lines])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const diffRef = useRef<HTMLDivElement | null>(null)

  // Scroll to selected file's diff block
  useEffect(() => {
    if (!selectedFile || !diffRef.current) return
    const el = diffRef.current.querySelector(`[data-file="${CSS.escape(selectedFile)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedFile])

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* File tree */}
      {files.length > 0 && (
        <div
          style={{
            width: 200,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            overflow: 'auto',
            padding: '8px 0',
            fontSize: 11
          }}
        >
          {files.map((f) => (
            <button
              key={`${f.startLine}:${f.filename}`}
              onClick={() => setSelectedFile(f.filename)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '4px 10px',
                background: selectedFile === f.filename ? 'var(--bg-element)' : 'none',
                border: 'none',
                color: 'var(--fg-primary)',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: '"Berkeley Mono", "SF Mono", monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={f.filename}
            >
              <span style={{ color: 'var(--status-running)', marginRight: 4 }}>+{f.added}</span>
              <span style={{ color: 'var(--status-error)', marginRight: 6 }}>-{f.removed}</span>
              {f.filename.split('/').pop()}
            </button>
          ))}
        </div>
      )}

      {/* Diff content */}
      <div ref={diffRef} style={{ flex: 1, overflow: 'auto', padding: 12, minHeight: 0 }}>
        {result.loading && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>loading diff…</div>
        )}
        {result.error && (
          <div style={{ color: 'var(--status-error)', fontSize: 11 }}>{result.error}</div>
        )}
        {useMock && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 11, marginBottom: 8 }}>
            mock mode — no live diff
          </div>
        )}
        {!result.loading && !content && !result.error && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>no changes</div>
        )}
        {lines.length > 0 && (
          <pre
            className="mono"
            style={{ fontSize: 11, lineHeight: 1.4, margin: 0, whiteSpace: 'pre' }}
          >
            {lines.map((line, i) => {
              // Attach data-file anchor at each "diff --git" line
              const fileAtLine = files.find((f) => f.startLine === i)
              return (
                <div
                  key={i}
                  data-file={fileAtLine?.filename}
                  style={{ color: diffLineColor(line) }}
                >
                  {line || ' '}
                </div>
              )
            })}
          </pre>
        )}
      </div>
    </div>
  )
}

function diffLineColor(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'var(--status-running)'
  if (line.startsWith('-') && !line.startsWith('---')) return 'var(--status-error)'
  if (line.startsWith('@@')) return 'var(--accent)'
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'var(--fg-muted)'
  return 'var(--fg-primary)'
}

// ─── Todo Tab ─────────────────────────────────────────────────────────────

function TodoTab({ project, useMock }: { project: Project | null; useMock: boolean }) {
  const result = useShellResult(project?.path ?? null, useMock, 'getTodo')
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'flex-end',
          flexShrink: 0
        }}
      >
        <button onClick={result.refresh} style={headerBtn}>
          Refresh
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, minHeight: 0 }}>
        {result.loading && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>running td…</div>
        )}
        {result.error && (
          <div style={{ color: 'var(--status-error)', fontSize: 11 }}>{result.error}</div>
        )}
        {useMock && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 11, marginBottom: 8 }}>
            mock mode — no live td output
          </div>
        )}
        {result.data && (
          <pre
            className="mono"
            style={{
              fontSize: 11,
              lineHeight: 1.4,
              margin: 0,
              color: 'var(--fg-primary)',
              whiteSpace: 'pre-wrap'
            }}
          >
            {result.data.stdout || result.data.stderr || '(no output)'}
          </pre>
        )}
      </div>
    </div>
  )
}

function useShellResult(
  path: string | null,
  useMock: boolean,
  method: 'getDiff' | 'getTodo'
): {
  data: ProcessResult | null
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const [data, setData] = useState<ProcessResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!path || useMock) {
      setData(null)
      setError(null)
      return
    }
    const api = window.electronAPI?.opencode
    if (!api) {
      setError('bridge unavailable')
      return
    }
    let disposed = false
    setLoading(true)
    setError(null)
    api[method](path)
      .then((r) => {
        if (disposed) return
        setData(r)
      })
      .catch((e: unknown) => {
        if (disposed) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [path, useMock, method, nonce])

  return { data, loading, error, refresh }
}
