require('dotenv').config();
const { defineConfig } = require('vitest/config');

const isDevDb = process.env.USE_DEV_DB === 'true';

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

    // @frozen — milestones/ is legacy; do not add new files. New coverage → unit/, contracts/, regression/.
    include: [
      'tests/vitest/unit/**/*.test.js',
      'tests/vitest/contracts/**/*.test.js',
      'tests/vitest/regression/**/*.test.js',
      'tests/vitest/milestones/**/*.test.js',
      'tests/vitest/*.test.js'
    ],

    // Never accidentally pick up legacy files outside vitest/
    exclude: [
      'tests/milestones/**',
      'tests/hardening/**',
      'tests/phase2/**',
      'node_modules/**'
    ],

    passWithNoTests: true,

    // Default terminal output plus HTML reporting
    reporters: ['default', 'html'],

    // Silence Telegram notifications and enforce local Supabase Docker target (or dev-db override)
    env: {
      NODE_ENV: 'test',
      USE_DEV_DB: isDevDb ? 'true' : 'false',
      SUPABASE_URL: isDevDb ? process.env.SUPABASE_URL : 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: isDevDb
        ? process.env.SUPABASE_SERVICE_ROLE_KEY
        : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
      SUPABASE_TEST_DB_URI: isDevDb
        ? (process.env.SUPABASE_TEST_DB_URI || process.env.DATABASE_URL)
        : 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      TELEGRAM_MODE: 'disabled'
    }
  }
});
