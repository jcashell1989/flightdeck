import { useEffect, useRef } from 'react'
import { View } from '../types'

interface UseKeyboardNavOptions {
  onViewChange: (view: View) => void
  onFocusNext: () => void
  onFocusPrev: () => void
  onEscape: () => void
  onEnter: () => void
  onToggleFullScreen: () => void
  onOpenCmdK: () => void
  onAttentionFilter?: () => void
  onRefresh?: () => void
  /** True when a modal overlay (CmdK dispatch) owns focus and should
   *  swallow single-key shortcuts even if the current e.target is <body>. */
  isModalOpen?: boolean
}

const VIEW_KEYS: Record<string, View> = {
  '1': 'dashboard',
  '2': 'sessions',
  '3': 'projects',
  '4': 'kanban',
  '5': 'analytics',
  '6': 'settings'
}

export function useKeyboardNav(opts: UseKeyboardNavOptions): void {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      const o = optsRef.current

      // Cmd+K / Ctrl+K is global — works even while typing.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        o.onOpenCmdK()
        return
      }

      // Escape is global too (close modal/panel).
      if (e.key === 'Escape') {
        e.preventDefault()
        o.onEscape()
        return
      }

      // Everything else: ignore while typing or while a modal overlay owns
      // focus (prevents A/R/J/K/1-4 from firing against the background view
      // when CmdK opened and focus hasn't landed in its textarea yet).
      if (inInput || o.isModalOpen) return

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
        case 'f':
        case 'F':
          e.preventDefault()
          o.onToggleFullScreen()
          break
        case 'Enter':
          // preventDefault so a focused <button> (e.g. NavRail item) doesn't
          // double-fire as both keydown-Enter and a synthetic click.
          e.preventDefault()
          o.onEnter()
          break
        case 'a':
        case 'A':
          e.preventDefault()
          o.onAttentionFilter?.()
          break
        case 'r':
        case 'R':
          e.preventDefault()
          o.onRefresh?.()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
