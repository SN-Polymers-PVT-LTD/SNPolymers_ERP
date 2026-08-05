#!/usr/bin/env node
/**
 * Stateless production smoke probes (Phase 1: health + optional GitHub SHA verification).
 *
 * Usage:
 *   SMOKE_API_BASE=https://snpolymers.onrender.com npm run smoke:prod
 *   SMOKE_VERIFY_GITHUB_SHA=true GITHUB_REPOSITORY=owner/repo npm run smoke:prod
 */

const BASE = (process.env.SMOKE_API_BASE || 'https://snpolymers.onrender.com').replace(/\/$/, '');

const REQUIRED_HEALTH_KEYS = ['status', 'database', 'version', 'git', 'branch', 'timestamp'];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

function assertHealthShape(health) {
  for (const key of REQUIRED_HEALTH_KEYS) {
    if (health[key] === undefined || health[key] === null || health[key] === '') {
      throw new Error(`Health response missing required field: ${key}`);
    }
  }

  if (!/^[0-9a-f]{7,40}$/i.test(health.git) && health.git !== 'dev') {
    throw new Error(`Invalid git fingerprint: ${health.git}`);
  }
}

async function verifyGithubSha(health) {
  if (process.env.SMOKE_VERIFY_GITHUB_SHA !== 'true') {
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.SMOKE_GITHUB_BRANCH || 'main';

  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is required when SMOKE_VERIFY_GITHUB_SHA=true');
  }

  const { response, body } = await fetchJson(
    `https://api.github.com/repos/${repo}/commits/${branch}`,
    { headers: { 'User-Agent': 'snpolymers-smoke' } }
  );

  if (!response.ok) {
    throw new Error(`GitHub API failed (${response.status}): ${JSON.stringify(body)}`);
  }

  const deployedPrefix = String(health.git).slice(0, 7);
  const githubPrefix = String(body.sha).slice(0, 7);

  if (deployedPrefix !== githubPrefix) {
    throw new Error(
      `Deploy SHA mismatch: production=${deployedPrefix} github/${branch}=${githubPrefix}`
    );
  }
}

async function main() {
  const { response, body } = await fetchJson(`${BASE}/health`);

  if (!response.ok) {
    throw new Error(`Health check failed: HTTP ${response.status} — ${JSON.stringify(body)}`);
  }

  assertHealthShape(body);
  await verifyGithubSha(body);

  console.log('smoke:prod passed', {
    base: BASE,
    status: body.status,
    database: body.database,
    version: body.version,
    git: body.git,
    branch: body.branch
  });
}

main().catch((error) => {
  console.error('smoke:prod failed:', error.message);
  process.exit(1);
});
