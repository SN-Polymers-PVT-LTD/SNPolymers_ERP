#!/usr/bin/env node
/**
 * Stateless production smoke probes (Phase 7).
 *
 * Usage:
 *   SMOKE_API_BASE=https://snpolymers.onrender.com npm run smoke:prod
 *   SMOKE_VERIFY_GITHUB_SHA=true GITHUB_REPOSITORY=owner/repo npm run smoke:prod
 *
 * Explicitly excluded: POST /request-otp, Telegram delivery, authenticated flows.
 */

const { runProductionSmoke } = require('./smokeChecks');

const BASE = process.env.SMOKE_API_BASE || 'https://snpolymers.onrender.com';

async function main() {
  const summary = await runProductionSmoke({ base: BASE });
  console.log('smoke:prod passed', summary);
}

main().catch((error) => {
  console.error('smoke:prod failed:', error.message);
  process.exit(1);
});
