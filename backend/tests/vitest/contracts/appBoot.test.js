import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const app = require('../../../src/app');
const { requestApp } = require('../../helpers/httpRequest');

function mockHealthyDb() {
  const limitMock = vi.fn().mockResolvedValue({ error: null });
  const selectMock = vi.fn().mockReturnValue({ limit: limitMock });
  vi.spyOn(supabase, 'from').mockReturnValue({ select: selectMock });
  return { selectMock, limitMock };
}

function mockUnhealthyDb(message = 'connection refused') {
  const limitMock = vi.fn().mockResolvedValue({ error: { message } });
  const selectMock = vi.fn().mockReturnValue({ limit: limitMock });
  vi.spyOn(supabase, 'from').mockReturnValue({ select: selectMock });
}

describe('appBoot — /health contract', () => {
  const envBackup = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    envBackup.GIT_SHA = process.env.GIT_SHA;
    envBackup.GIT_BRANCH = process.env.GIT_BRANCH;
    envBackup.BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP;
    process.env.GIT_SHA = 'abc1234567890';
    process.env.GIT_BRANCH = 'main';
    process.env.BUILD_TIMESTAMP = '2026-08-05T08:00:00.000Z';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('returns 200 with deployment fingerprint when database is connected', async () => {
    mockHealthyDb();

    const { statusCode, body } = await requestApp(app, 'GET', '/health');

    expect(statusCode).toBe(200);
    expect(body.status).toBe('OK');
    expect(body.database).toBe('CONNECTED');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.git).toBe('abc1234');
    expect(body.git).toMatch(/^[0-9a-f]{7}$/i);
    expect(body.branch).toBe('main');
    expect(body.built).toBe('2026-08-05T08:00:00.000Z');
    expect(body.timestamp).toBeTruthy();
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  test('returns 503 with fingerprint when database ping fails', async () => {
    mockUnhealthyDb('Simulated DB outage');

    const { statusCode, body } = await requestApp(app, 'GET', '/health');

    expect(statusCode).toBe(503);
    expect(body.status).toBe('ERROR');
    expect(body.database).toBe('DISCONNECTED');
    expect(body.error).toMatch(/Simulated DB outage/i);
    expect(body.version).toBeTruthy();
    expect(body.git).toBe('abc1234');
    expect(body.branch).toBe('main');
    expect(body.timestamp).toBeTruthy();
  });

  test('app module exports without calling listen()', () => {
    expect(app).toBeTruthy();
    expect(typeof app.listen).toBe('function');
  });
});
