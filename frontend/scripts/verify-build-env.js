#!/usr/bin/env node
/**
 * Fail CI/production builds when VITE_API_URL is missing or points at localhost.
 * Local `npm run dev` does not run this script.
 */

const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

if (!isCi) {
  process.exit(0);
}

const apiUrl = (process.env.VITE_API_URL || '').trim();

if (!apiUrl) {
  console.error('FATAL: VITE_API_URL must be set in CI builds.');
  console.error('Example: https://snpolymers.onrender.com/api/v1/auth');
  process.exit(1);
}

if (/localhost|127\.0\.0\.1/i.test(apiUrl)) {
  console.error(`FATAL: VITE_API_URL must not point to localhost in CI (got: ${apiUrl})`);
  process.exit(1);
}

if (!/^https:\/\//i.test(apiUrl)) {
  console.error(`FATAL: VITE_API_URL must use HTTPS in CI (got: ${apiUrl})`);
  process.exit(1);
}

console.log(`verify-build-env: VITE_API_URL OK (${apiUrl})`);
