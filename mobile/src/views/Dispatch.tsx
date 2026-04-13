// TODO(Phase 4): Full dispatch from mobile requires a /api/profiles endpoint
// on the HTTP server, which is not yet implemented. For now, direct users to
// the desktop app.

export function Dispatch() {
  return (
    <div style={{ padding: '1.5rem', color: '#a1a1aa', textAlign: 'center' }}>
      <div style={{ fontSize: 24, marginBottom: '1rem' }}>🖥</div>
      <p style={{ margin: 0, fontSize: 14 }}>
        Open the desktop app to dispatch new sessions.
      </p>
    </div>
  )
}
