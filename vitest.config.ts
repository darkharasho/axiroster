import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'supabase/functions/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node'
  }
})
