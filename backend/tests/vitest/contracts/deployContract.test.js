import { describe, test, expect } from 'vitest';
const path = require('path');
const { execSync } = require('child_process');
const { isOriginAllowed } = require('../../../src/config/cors');
const { getCookieOptions } = require('../../../src/config/cookies');
const { getBuildInfo } = require('../../../src/utils/buildInfo');

const backendDir = path.join(__dirname, '../../../');

function runNodeInBackend(script, env = {}) {
  return execSync(`node -e "${script}"`, {
    cwd: backendDir,
    env: { ...process.env, ...env },
    stdio: 'pipe'
  }).toString();
}

function expectBootFailure(env) {
  let failed = false;
  let output = '';
  try {
    execSync('node -e "require(\'./src/app.js\')"', {
      cwd: backendDir,
      env: { ...process.env, ...env },
      stdio: 'pipe'
    });
  } catch (error) {
    failed = true;
    output = error.stderr?.toString() || error.stdout?.toString() || '';
  }
  expect(failed).toBe(true);
  return output;
}

describe('deployContract — production boot guards', () => {
  test('rejects missing JWT_SECRET in production', () => {
    const output = expectBootFailure({
      NODE_ENV: 'production',
      JWT_SECRET: '',
      FRONTEND_URL: 'https://sn-polymers.vercel.app'
    });
    expect(output).toMatch(/JWT_SECRET/i);
  });

  test('rejects default development JWT_SECRET in production', () => {
    const output = expectBootFailure({
      NODE_ENV: 'production',
      JWT_SECRET: 'fallback_development_jwt_secret_key_minimum_256_bit',
      FRONTEND_URL: 'https://sn-polymers.vercel.app'
    });
    expect(output).toMatch(/JWT_SECRET/i);
  });

  test('rejects localhost FRONTEND_URL in production', () => {
    const output = expectBootFailure({
      NODE_ENV: 'production',
      JWT_SECRET: 'ci_test_jwt_secret_minimum_256_bits_long_enough',
      FRONTEND_URL: 'http://localhost:5173'
    });
    expect(output).toMatch(/FRONTEND_URL/i);
  });

  test('allows valid production env to boot app module', () => {
    expect(() => {
      runNodeInBackend("require('./src/app.js')", {
        NODE_ENV: 'production',
        JWT_SECRET: 'ci_test_jwt_secret_minimum_256_bits_long_enough',
        FRONTEND_URL: 'https://sn-polymers.vercel.app'
      });
    }).not.toThrow();
  });
});

describe('deployContract — CORS', () => {
  test('allows official Vercel production origins', () => {
    expect(isOriginAllowed('https://sn-polymers.vercel.app', { nodeEnv: 'production' })).toBe(true);
    expect(isOriginAllowed('https://snpolymers.vercel.app', { nodeEnv: 'production' })).toBe(true);
  });

  test('allows any *.vercel.app preview deployment in production', () => {
    expect(isOriginAllowed('https://sn-polymers-git-feature-abc.vercel.app', { nodeEnv: 'production' })).toBe(true);
  });

  test('blocks unknown origins in production', () => {
    expect(isOriginAllowed('https://evil.example.com', { nodeEnv: 'production' })).toBe(false);
  });

  test('allows localhost in non-production', () => {
    expect(isOriginAllowed('http://localhost:5173', { nodeEnv: 'development' })).toBe(true);
  });
});

describe('deployContract — auth cookies', () => {
  test('uses secure + sameSite none in production', () => {
    expect(getCookieOptions('production')).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none'
    });
  });

  test('uses lax cookies in development/test', () => {
    expect(getCookieOptions('test')).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax'
    });
  });
});

describe('deployContract — build fingerprint', () => {
  test('git fingerprint is 7+ hex chars when GIT_SHA is set', () => {
    const previous = process.env.GIT_SHA;
    process.env.GIT_SHA = '4c82de7abcdef';
    try {
      const info = getBuildInfo();
      expect(info.git).toBe('4c82de7');
      expect(info.git).toMatch(/^[0-9a-f]{7}$/i);
    } finally {
      if (previous === undefined) {
        delete process.env.GIT_SHA;
      } else {
        process.env.GIT_SHA = previous;
      }
    }
  });

  test('reads version from package.json', () => {
    const pkg = require('../../../package.json');
    expect(getBuildInfo().version).toBe(pkg.version);
  });

  test('prefers RENDER_GIT_COMMIT when GIT_SHA is unset', () => {
    const prevSha = process.env.GIT_SHA;
    const prevRender = process.env.RENDER_GIT_COMMIT;
    delete process.env.GIT_SHA;
    process.env.RENDER_GIT_COMMIT = 'deadbeef1234567890';
    try {
      expect(getBuildInfo().git).toBe('deadbee');
    } finally {
      if (prevSha === undefined) delete process.env.GIT_SHA;
      else process.env.GIT_SHA = prevSha;
      if (prevRender === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = prevRender;
    }
  });
});
