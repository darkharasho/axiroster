import { defineConfig } from 'vitest/config'

// Integration tests hit a real Supabase project (needs SUPABASE_URL / ANON /
// SERVICE_ROLE in the environment). Kept separate from the default unit run so
// `npm test` stays green without network/Docker. Run with `npm run test:integration`.
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node'
  }
})
