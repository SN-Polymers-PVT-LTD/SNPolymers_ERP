/**
 * Ensures milestone/integration tests run against a reachable local Supabase stack.
 * Vitest config points at http://127.0.0.1:54321 — start it via npm run test:local.
 */
async function requireLocalSupabase() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const isLocal = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/.test(url);
  if (!isLocal) {
    throw new Error(
      'Integration tests expect local Supabase (127.0.0.1:54321).\n' +
        'Run: npm run test:local -- tests/vitest/milestones/<file>.test.js\n' +
        'Do not rely on remote SUPABASE_URL from .env for milestone tests.'
    );
  }

  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Run tests via npm run test:local.');
  }

  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    throw new Error(
      `Local Supabase is not reachable at ${url} (${err.message}).\n` +
        'Start it with: npm run test:local -- tests/vitest/milestones/estimate_summary.test.js'
    );
  }
}

module.exports = { requireLocalSupabase };
