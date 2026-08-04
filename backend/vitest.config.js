const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    
    // Strict sequential execution to prevent DB collisions
    fileParallelism: false,
    maxWorkers: 1,
    sequence: {
      sequential: true
    },

    // 30s per individual test (DB calls can be slow)
    testTimeout: 30000,

    // 60s for hooks (seeding takes time)
    hookTimeout: 60000,

    include: ['tests/vitest/**/*.test.js'],

    // Never accidentally pick up legacy files
    exclude: [
      'tests/milestones/**',
      'tests/hardening/**',
      'tests/phase2/**',
      'node_modules/**'
    ],

    // Default terminal output plus HTML reporting
    reporters: ['default', 'html'],

    // Silence Telegram notifications and enforce local Supabase Docker target for all Vitest runs
    env: {
      NODE_ENV: 'test',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
      SUPABASE_TEST_DB_URI: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      TELEGRAM_MODE: 'disabled'
    }
  }
});
