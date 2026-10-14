import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: [
      'convex/**/*.test.ts',
      'src/lib/ide/simulator-handoff.test.ts',
      'src/lib/ide/build-problems.test.ts',
    ],
  },
})
