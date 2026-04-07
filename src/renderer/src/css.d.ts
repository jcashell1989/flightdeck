// Extend React's CSSProperties to know about Electron-specific properties so
// we don't need @ts-expect-error every time we set WebkitAppRegion.
import 'react'

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
