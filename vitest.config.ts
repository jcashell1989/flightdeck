import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Run in Node environment — tests cover main-process code only.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'out'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/index.ts', '**/*.test.ts']
    }
  }
})
