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

    // Silence Telegram notifications during tests
    env: {
      NODE_ENV: 'test'
    }
  }
});
