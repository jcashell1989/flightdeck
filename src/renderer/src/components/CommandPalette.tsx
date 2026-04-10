import {
  CSSProperties,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import type { CommandDefinition } from '../../../shared/types'

export interface CommandPaletteProps {
  sessionId: string
  inputValue: string
  onComplete: (completed: string) => void
  onDismiss: () => void
}

export interface CommandPaletteHandle {
  /** Returns true if the key was consumed by the palette. */
  handleKey: (e: React.KeyboardEvent) => boolean
  /** Whether the palette is currently visible. */
  isVisible: () => boolean
}

// Module-level cache: sessionId → CommandDefinition[]
const commandCache = new Map<string, CommandDefinition[]>()

function shouldShowPalette(inputValue: string): boolean {
  return (
    inputValue.startsWith('/') &&
    !inputValue.startsWith('\\/') &&
    !inputValue.includes(' ')
  )
}

function getToken(inputValue: string): string {
  return inputValue.slice(1)
}

export const CommandPalette = forwardRef<CommandPaletteHandle, CommandPaletteProps>(
  function CommandPalette({ sessionId, inputValue, onComplete, onDismiss }, ref) {
    const [commands, setCommands] = useState<CommandDefinition[]>(
      () => commandCache.get(sessionId) ?? []
    )
    const [selectedIndex, setSelectedIndex] = useState(0)
    const listRef = useRef<HTMLDivElement | null>(null)

    // Fetch commands once per session
    useEffect(() => {
      if (commandCache.has(sessionId)) {
        setCommands(commandCache.get(sessionId)!)
        return
      }
      const api = window.electronAPI?.opencode
      if (!api) return
      void api
        .listCommands(sessionId)
        .then((cmds) => {
          commandCache.set(sessionId, cmds)
          setCommands(cmds)
        })
        .catch(() => {
          // Hide silently on failure
        })
    }, [sessionId])

    const visible = shouldShowPalette(inputValue)
    const token = visible ? getToken(inputValue) : ''
    const filtered = visible ? commands.filter((c) => c.name.startsWith(token)) : []
    const isCurrentlyVisible = visible && filtered.length > 0

    // Reset selection when filtered set changes
    useEffect(() => {
      setSelectedIndex(0)
    }, [token])

    // Scroll selected item into view
    useEffect(() => {
      if (!listRef.current) return
      const item = listRef.current.querySelector(`[data-idx="${selectedIndex}"]`)
      item?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex])

    const complete = (idx: number) => {
      const cmd = filtered[idx]
      if (cmd) onComplete('/' + cmd.name + ' ')
    }

    // Expose imperative handle so the parent textarea can forward key events
    useImperativeHandle(
      ref,
      () => ({
        isVisible: () => isCurrentlyVisible,
        handleKey: (e: React.KeyboardEvent): boolean => {
          if (!isCurrentlyVisible) return false
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
            return true
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedIndex((i) => Math.max(i - 1, 0))
            return true
          }
          if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault()
            complete(selectedIndex)
            return true
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onDismiss()
            return true
          }
          return false
        }
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [isCurrentlyVisible, filtered, selectedIndex, onComplete, onDismiss]
    )

    if (!isCurrentlyVisible) return null

    return (
      <div style={paletteStyle}>
        <div ref={listRef} style={{ maxHeight: ROW_HEIGHT * 6, overflowY: 'auto' }}>
          {filtered.map((cmd, idx) => (
            <div
              key={cmd.name}
              data-idx={idx}
              onMouseDown={(e) => {
                // preventDefault keeps focus on the textarea
                e.preventDefault()
                complete(idx)
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
              style={rowStyle(idx === selectedIndex)}
            >
              <span className="mono" style={{ flexShrink: 0, color: 'inherit' }}>
                /{cmd.name}
              </span>
              <span style={descStyle}>{cmd.description}</span>
            </div>
          ))}
        </div>
        <div style={hintStyle}>↑↓ navigate · Tab/Enter complete · Esc dismiss</div>
      </div>
    )
  }
)

// ─── Styles ───────────────────────────────────────────────────────────────

const ROW_HEIGHT = 32

const paletteStyle: CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  right: 0,
  marginBottom: 4,
  backgroundColor: 'var(--bg-elevated, var(--bg-panel))',
  border: '1px solid var(--border)',
  borderRadius: 6,
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  fontSize: 12,
  zIndex: 100,
  overflow: 'hidden'
}

function rowStyle(selected: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 10px',
    height: ROW_HEIGHT,
    cursor: 'pointer',
    backgroundColor: selected ? 'var(--accent)' : 'transparent',
    color: selected ? '#fff' : 'var(--fg-primary)'
  }
}

const descStyle: CSSProperties = {
  color: 'var(--fg-subtle)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1
}

const hintStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-subtle)',
  padding: '4px 10px',
  borderTop: '1px solid var(--border)'
}
