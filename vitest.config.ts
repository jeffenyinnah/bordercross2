import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Agent app tests (tests/agent-app). The workspace packages run their own vitest.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
