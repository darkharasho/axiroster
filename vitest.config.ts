import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node'
  }
})
