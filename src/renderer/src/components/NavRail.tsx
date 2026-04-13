import { View } from '../types'

interface NavRailProps {
  activeView: View
  onViewChange: (view: View) => void
}

const NAV_ITEMS: { view: View; icon: string; label: string; key: string }[] = [
  { view: 'dashboard', icon: '⊞', label: 'Dashboard', key: '1' },
  { view: 'sessions', icon: '⊟', label: 'Sessions', key: '2' },
  { view: 'projects', icon: '⊕', label: 'Projects', key: '3' },
  { view: 'analytics', icon: '◈', label: 'Analytics', key: '4' },
  { view: 'settings', icon: '⚙', label: 'Settings', key: '5' }
]

export function NavRail({ activeView, onViewChange }: NavRailProps) {
  return (
    <nav
      style={{
        width: 56,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12,
        gap: 4,
        borderRight: '1px solid var(--border)',
        backgroundColor: 'var(--bg-panel)',
        flexShrink: 0
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = activeView === item.view
        return (
          <button
            key={item.view}
            onClick={() => onViewChange(item.view)}
            title={`${item.label} (${item.key})`}
            style={{
              position: 'relative',
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              background: active ? 'var(--bg-element)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--fg-muted)',
              transition: 'background 0.15s, color 0.15s'
            }}
          >
            {active && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: -6,
                  top: 8,
                  bottom: 8,
                  width: 3,
                  borderRadius: 2,
                  background: 'var(--accent)'
                }}
              />
            )}
            {item.icon}
          </button>
        )
      })}
    </nav>
  )
}
