import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
const {
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
} = require('../../../scripts/smoke/smokeChecks');

function mockHeaders(map = {}) {
  return {
    get: (key) => map[key.toLowerCase()] ?? null
  };
}

function healthyBody(overrides = {}) {
  return {
    status: 'OK',
    database: 'CONNECTED',
    version: '1.0.0',
    git: 'abc1234',
    branch: 'main',
    built: '2026-01-01T00:00:00.000Z',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('productionSmoke — check helpers', () => {
  test('parseHealthPayload accepts valid health JSON', () => {
    const parsed = parseHealthPayload(healthyBody());
    expect(parsed.database).toBe('CONNECTED');
  });

  test('parseHealthPayload rejects missing fingerprint fields', () => {
    expect(() => parseHealthPayload({ status: 'OK' })).toThrow();
  });

  test('assertDatabaseConnected fails when disconnected', () => {
    expect(() => assertDatabaseConnected({ database: 'DISCONNECTED' })).toThrow(/not connected/i);
  });

  test('assertLatency enforces response budget', () => {
    expect(() => assertLatency(4000, 3000)).toThrow(/latency/i);
    expect(() => assertLatency(1200, 3000)).not.toThrow();
  });

  test('assertAuthRouting requires 401 and rejects 404/502', () => {
    expect(() => assertAuthRouting({ status: 401 })).not.toThrow();
    expect(() => assertAuthRouting({ status: 404 })).toThrow(/404/i);
    expect(() => assertAuthRouting({ status: 502 })).toThrow(/gateway/i);
    expect(() => assertAuthRouting({ status: 200 })).toThrow(/401/i);
  });

  test('assertCorsPreflight requires Access-Control-Allow-Origin', () => {
    expect(() => assertCorsPreflight(
      { status: 204, headers: mockHeaders({ 'access-control-allow-origin': 'https://sn-polymers.vercel.app' }) },
      'https://sn-polymers.vercel.app'
    )).not.toThrow();

    expect(() => assertCorsPreflight(
      { status: 204, headers: mockHeaders({}) },
      'https://sn-polymers.vercel.app'
    )).toThrow(/Access-Control-Allow-Origin/i);
  });

  test('assertSecurityHeaders requires helmet headers', () => {
    expect(() => assertSecurityHeaders(mockHeaders({
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'"
    }))).not.toThrow();

    expect(() => assertSecurityHeaders(mockHeaders({
      'x-content-type-options': 'nosniff'
    }))).toThrow(/content-security-policy/i);
  });
});

describe('productionSmoke — runProductionSmoke', () => {
  const previousShaFlag = process.env.SMOKE_VERIFY_GITHUB_SHA;
  const previousRepo = process.env.GITHUB_REPOSITORY;

  beforeEach(() => {
    delete process.env.SMOKE_VERIFY_GITHUB_SHA;
    delete process.env.GITHUB_REPOSITORY;
  });

  afterEach(() => {
    if (previousShaFlag === undefined) delete process.env.SMOKE_VERIFY_GITHUB_SHA;
    else process.env.SMOKE_VERIFY_GITHUB_SHA = previousShaFlag;
    if (previousRepo === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previousRepo;
  });

  test('runs full suite against mocked fetch responses', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/health')) {
        return {
          ok: true,
          status: 200,
          headers: mockHeaders({
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'self'"
          }),
          text: async () => JSON.stringify(healthyBody())
        };
      }

      if (String(url).includes('/api/v1/auth/me') && options.method === 'OPTIONS') {
        return {
          ok: true,
          status: 204,
          headers: mockHeaders({ 'access-control-allow-origin': 'https://sn-polymers.vercel.app' }),
          text: async () => ''
        };
      }

      if (String(url).includes('/api/v1/auth/me')) {
        return {
          ok: false,
          status: 401,
          headers: mockHeaders({}),
          text: async () => JSON.stringify({ success: false, message: 'Authentication required.' })
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const summary = await runProductionSmoke({
      base: 'https://example.onrender.com',
      fetchImpl,
      maxLatencyMs: 5000
    });

    expect(summary.database).toBe('CONNECTED');
    expect(summary.authMeStatus).toBe(401);
    expect(summary.shaVerified).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('verifyGithubSha compares backend tree hashes between main and deployed commit', async () => {
    process.env.SMOKE_VERIFY_GITHUB_SHA = 'true';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const sharedBackendTreeSha = 'tree-backend-abc1234567890abcdef1234567890abcd';

    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/commits/main')) {
        return {
          ok: true,
          status: 200,
          headers: mockHeaders({}),
          text: async () => JSON.stringify({ commit: { tree: { sha: 'root-main' } } })
        };
      }
      if (urlStr.endsWith('/commits/abc1234')) {
        return {
          ok: true,
          status: 200,
          headers: mockHeaders({}),
          text: async () => JSON.stringify({ commit: { tree: { sha: 'root-deployed' } } })
        };
      }
      if (urlStr.endsWith('/git/trees/root-main') || urlStr.endsWith('/git/trees/root-deployed')) {
        return {
          ok: true,
          status: 200,
          headers: mockHeaders({}),
          text: async () => JSON.stringify({
            tree: [{ path: 'backend', type: 'tree', sha: sharedBackendTreeSha }]
          })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await verifyGithubSha(healthyBody(), fetchImpl);
    expect(result).toEqual({
      deployedPrefix: 'abc1234',
      githubPrefix: 'tree-ba',
      branch: 'main',
      backendTreeSha: sharedBackendTreeSha,
      deployedBackendTreeSha: sharedBackendTreeSha,
      backendTreeMatch: true
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test('verifyGithubSha fails when backend tree hashes differ', async () => {
    process.env.SMOKE_VERIFY_GITHUB_SHA = 'true';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/commits/main')) {
        return {
          ok: true,
          status: 200,
          headers: mockHeaders({}),
          text: async () => JSON.stringify({ commit: { tree: { sha: 'root-main' } } })
        };
      }
      if (urlStr.endsWith('/commits/abc1234')) {
        return {
          ok: true,
          status: 200,
          headers: mockHeaders({}),
          text: async () => JSON.stringify({ commit: { tree: { sha: 'root-deployed' } } })
        };
      }
      if (urlStr.endsWith('/git/trees/root-main')) {
        return {
          ok: true,
          status: 200,
          headers: mockHeaders({}),
          text: async () => JSON.stringify({
            tree: [{ path: 'backend', type: 'tree', sha: 'tree-backend-main-version' }]
          })
        };
      }
      if (urlStr.endsWith('/git/trees/root-deployed')) {
        return {
          ok: true,
          status: 200,
          headers: mockHeaders({}),
          text: async () => JSON.stringify({
            tree: [{ path: 'backend', type: 'tree', sha: 'tree-backend-deployed-version' }]
          })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(verifyGithubSha(healthyBody(), fetchImpl)).rejects.toThrow(/Backend tree mismatch/i);
  });

  test('fetchHealthCheck retries once after cold-start latency breach', async () => {
    const times = [0, 4000, 5000, 5100];
    let index = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => times[Math.min(index++, times.length - 1)]);

    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        headers: mockHeaders({
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'"
        }),
        text: async () => JSON.stringify(healthyBody())
      };
    });

    const result = await fetchHealthCheck('https://example.onrender.com/health', fetchImpl, 3000);
    expect(result.health.database).toBe('CONNECTED');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });
});
