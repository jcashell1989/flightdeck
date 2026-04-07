import { useEffect, useRef } from 'react'
import { View } from '../types'

interface UseKeyboardNavOptions {
  onViewChange: (view: View) => void
  onFocusNext: () => void
  onFocusPrev: () => void
  onEscape: () => void
  onEnter: () => void
}

const VIEW_KEYS: Record<string, View> = {
  '1': 'dashboard',
  '2': 'sessions',
  '3': 'projects',
  '4': 'settings'
}

export function useKeyboardNav(opts: UseKeyboardNavOptions): void {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      // Don't capture when typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const o = optsRef.current

      const view = VIEW_KEYS[e.key]
      if (view) {
        e.preventDefault()
        o.onViewChange(view)
        return
      }

      switch (e.key) {
        case 'j':
        case 'J':
          e.preventDefault()
          o.onFocusNext()
          break
        case 'k':
        case 'K':
          e.preventDefault()
          o.onFocusPrev()
          break
        case 'Escape':
          e.preventDefault()
          o.onEscape()
          break
        case 'Enter':
          o.onEnter()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
