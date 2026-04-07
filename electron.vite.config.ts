import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @opencode-ai/sdk and eventsource are ESM-only. Electron main is CJS-output
// by default, so we bundle these two inline instead of externalizing them —
// avoids runtime require(ESM) fragility.
const BUNDLED_MAIN_DEPS = ['@opencode-ai/sdk', 'eventsource']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_MAIN_DEPS })],
    build: {
      rollupOptions: {
        output: { format: 'es' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
