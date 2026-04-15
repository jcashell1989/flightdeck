import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/uat',
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    screenshot: 'only-on-failure',
    video: 'off'
  }
})
