/**
 * Stateless production smoke checks (Phase 7).
 * No OTP, no authenticated session flows.
 */

const { healthResponseSchema } = require('../../tests/helpers/responseSchemas');

const DEFAULT_MAX_LATENCY_MS = 3000;
const DEFAULT_CORS_ORIGIN = 'https://sn-polymers.vercel.app';
const HEALTH_RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}, fetchImpl = global.fetch) {
  const started = Date.now();
  const response = await fetchImpl(url, options);
  const durationMs = Date.now() - started;
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, durationMs };
}

function parseHealthPayload(body) {
  return healthResponseSchema.parse(body);
}

function assertDatabaseConnected(health) {
  if (health.database !== 'CONNECTED') {
    throw new Error(`Database not connected: ${health.database}`);
  }
}

function assertHealthStatusOk(health) {
  if (health.status !== 'OK') {
    throw new Error(`Health status is not OK: ${health.status}`);
  }
}

function assertLatency(durationMs, maxLatencyMs) {
  if (durationMs > maxLatencyMs) {
    throw new Error(`Health latency ${durationMs}ms exceeds ${maxLatencyMs}ms budget`);
  }
}

function assertAuthRouting(response) {
  if (response.status === 404) {
    throw new Error('Auth route /api/v1/auth/me returned 404 — routing misconfigured');
  }
  if (response.status >= 502 && response.status <= 504) {
    throw new Error(`Auth route returned gateway error: HTTP ${response.status}`);
  }
  if (response.status !== 401) {
    throw new Error(`Expected HTTP 401 from unauthenticated /me, got ${response.status}`);
  }
}

function assertCorsPreflight(response, origin) {
  if (response.status !== 204 && response.status !== 200) {
    throw new Error(`CORS preflight failed: HTTP ${response.status}`);
  }

  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (!allowOrigin) {
    throw new Error('CORS preflight missing Access-Control-Allow-Origin header');
  }

  if (allowOrigin !== origin && allowOrigin !== '*') {
    throw new Error(`CORS origin mismatch: expected ${origin}, got ${allowOrigin}`);
  }
}

function assertSecurityHeaders(headers) {
  const xContentTypeOptions = headers.get('x-content-type-options');
  if (!xContentTypeOptions) {
    throw new Error('Missing x-content-type-options security header');
  }

  const csp = headers.get('content-security-policy');
  if (!csp) {
    throw new Error('Missing content-security-policy header (helmet)');
  }
}

async function verifyGithubSha(health, fetchImpl = global.fetch) {
  if (process.env.SMOKE_VERIFY_GITHUB_SHA !== 'true') {
    return null;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.SMOKE_GITHUB_BRANCH || 'main';

  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is required when SMOKE_VERIFY_GITHUB_SHA=true');
  }

  const deployedSha = String(health.git).trim();
  if (!deployedSha) {
    throw new Error('Health check response is missing a valid git SHA');
  }

  // 1. Fetch the latest commit on the branch that touched backend/
  const branchRes = await fetchJson(
    `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=backend&per_page=1`,
    { headers: { 'User-Agent': 'snpolymers-smoke' } },
    fetchImpl
  );

  if (!branchRes.response.ok) {
    throw new Error(`GitHub API failed to get branch commits (${branchRes.response.status}): ${JSON.stringify(branchRes.body)}`);
  }

  if (!Array.isArray(branchRes.body) || branchRes.body.length === 0) {
    throw new Error(`GitHub API returned no commits for path 'backend' on branch '${branch}'`);
  }

  const branchLatestBackendSha = branchRes.body[0].sha;

  // 2. Fetch the latest commit in the deployed SHA's history that touched backend/
  const deployedRes = await fetchJson(
    `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(deployedSha)}&path=backend&per_page=1`,
    { headers: { 'User-Agent': 'snpolymers-smoke' } },
    fetchImpl
  ).catch(err => {
    // If the commit is not found (e.g. force pushed / not on remote), return a mock error response
    return { response: { ok: false, status: 404 }, body: err.message };
  });

  if (!deployedRes.response.ok) {
    // If the deployed commit isn't on GitHub, we can't verify history. Fallback to basic SHA match.
    const deployedPrefix = deployedSha.slice(0, 7);
    const branchBackendPrefix = branchLatestBackendSha.slice(0, 7);
    if (deployedPrefix !== branchBackendPrefix) {
      throw new Error(
        `Deploy SHA mismatch (fallback): production=${deployedPrefix} is not latest backend commit ${branchBackendPrefix} on ${branch}`
      );
    }
    return { deployedPrefix, githubPrefix: branchBackendPrefix, branch };
  }

  const deployedLatestBackendSha = deployedRes.body[0].sha;

  const deployedPrefix = deployedSha.slice(0, 7);
  const branchBackendPrefix = branchLatestBackendSha.slice(0, 7);

  if (branchLatestBackendSha !== deployedLatestBackendSha) {
    throw new Error(
      `Deploy is missing backend changes: production is at ${deployedPrefix} (latest backend change in history: ${deployedLatestBackendSha.slice(0, 7)}), but branch ${branch} has newer backend change ${branchBackendPrefix}`
    );
  }

  return { deployedPrefix, githubPrefix: branchBackendPrefix, branch };
}

async function fetchHealthCheck(healthUrl, fetchImpl, maxLatencyMs) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await fetchJson(healthUrl, {}, fetchImpl);

    if (!result.response.ok) {
      lastError = new Error(
        `Health check failed: HTTP ${result.response.status} — ${JSON.stringify(result.body)}`
      );
      if (attempt === 1 && result.response.status >= 503) {
        await sleep(HEALTH_RETRY_DELAY_MS);
        continue;
      }
      throw lastError;
    }

    try {
      const health = parseHealthPayload(result.body);
      assertHealthStatusOk(health);
      assertDatabaseConnected(health);
      assertLatency(result.durationMs, maxLatencyMs);
      assertSecurityHeaders(result.response.headers);
      return { ...result, health };
    } catch (error) {
      lastError = error;
      const isColdStartLatency = /latency/i.test(error.message);
      if (attempt === 1 && isColdStartLatency) {
        await sleep(HEALTH_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

/**
 * Run all stateless production smoke checks.
 * @returns {Promise<object>} summary payload for logging
 */
async function runProductionSmoke({
  base,
  fetchImpl = global.fetch,
  maxLatencyMs = Number(process.env.SMOKE_MAX_LATENCY_MS) || DEFAULT_MAX_LATENCY_MS,
  corsOrigin = process.env.SMOKE_CORS_ORIGIN || DEFAULT_CORS_ORIGIN
} = {}) {
  if (!base) {
    throw new Error('SMOKE_API_BASE is required');
  }

  const apiBase = base.replace(/\/$/, '');
  const authMeUrl = `${apiBase}/api/v1/auth/me`;
  const healthUrl = `${apiBase}/health`;

  const healthResult = await fetchHealthCheck(healthUrl, fetchImpl, maxLatencyMs);
  const health = healthResult.health;

  const meResult = await fetchJson(authMeUrl, {}, fetchImpl);
  assertAuthRouting(meResult.response);

  const corsResult = await fetchJson(authMeUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: corsOrigin,
      'Access-Control-Request-Method': 'GET'
    }
  }, fetchImpl);
  assertCorsPreflight(corsResult.response, corsOrigin);

  const shaMatch = await verifyGithubSha(health, fetchImpl);

  return {
    base: apiBase,
    status: health.status,
    database: health.database,
    version: health.version,
    git: health.git,
    branch: health.branch,
    built: health.built,
    healthLatencyMs: healthResult.durationMs,
    authMeStatus: meResult.response.status,
    corsOrigin,
    shaVerified: Boolean(shaMatch),
    shaMatch
  };
}

module.exports = {
  DEFAULT_MAX_LATENCY_MS,
  DEFAULT_CORS_ORIGIN,
  fetchJson,
  parseHealthPayload,
  assertDatabaseConnected,
  assertHealthStatusOk,
  assertLatency,
  assertAuthRouting,
  assertCorsPreflight,
  assertSecurityHeaders,
  verifyGithubSha,
  fetchHealthCheck,
  runProductionSmoke
};
