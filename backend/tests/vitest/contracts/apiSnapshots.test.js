import { describe, test, expect, vi, beforeEach } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const { getMe } = require('../../../src/controllers/auth.controller');
const { getProjectsHealth } = require('../../../src/controllers/analytics.controller');
const {
  loginTestUser,
  deleteAuthTestUser,
  runVerifyJwt
} = require('../../helpers/authFlow');
const { sanitizeForSnapshot } = require('../../helpers/snapshotSanitizer');
const mockRes = require('../../helpers/mockRes');
const { requestApp } = require('../../helpers/httpRequest');
const app = require('../../../src/app');

function mockHealthyDb() {
  const limitMock = vi.fn().mockResolvedValue({ error: null });
  const selectMock = vi.fn().mockReturnValue({ limit: limitMock });
  vi.spyOn(supabase, 'from').mockReturnValue({ select: selectMock });
}

describe('apiSnapshots — golden response structure', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GIT_SHA = 'abc1234567890';
    process.env.GIT_BRANCH = 'main';
    process.env.BUILD_TIMESTAMP = '2026-08-05T08:00:00.000Z';
  });

  test('GET /health response shape snapshot', async () => {
    mockHealthyDb();
    const { body } = await requestApp(app, 'GET', '/health');
    expect(sanitizeForSnapshot(body)).toMatchSnapshot();
  });

  test('GET /auth/me response shape snapshot (JE session)', async () => {
    const session = await loginTestUser({
      displayName: 'Snapshot JE user',
      role: 'je'
    });

    const req = { cookies: session.cookies, headers: {} };
    const res = mockRes();
    await runVerifyJwt(req, res);
    await getMe(req, res);

    expect(sanitizeForSnapshot(res.jsonData)).toMatchSnapshot();

    await deleteAuthTestUser(session.mobile.canonical);
  });

  test('GET /analytics/projects response shape snapshot (JE, empty scope)', async () => {
    const session = await loginTestUser({
      displayName: 'Snapshot projects JE',
      role: 'je'
    });

    const req = { user: { role: 'je', mobile_number: session.mobile.canonical } };
    const res = mockRes();
    await getProjectsHealth(req, res);

    expect(sanitizeForSnapshot(res.jsonData)).toMatchSnapshot();

    await deleteAuthTestUser(session.mobile.canonical);
  });
});
