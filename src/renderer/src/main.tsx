import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './global.css'

// Safety net: surface any stray unhandled rejections to the console instead of
// letting them silently disappear. Individual IPC call sites should catch their
// own errors; this is the last line of defence.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
