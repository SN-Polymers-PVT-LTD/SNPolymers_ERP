import { describe, test, expect, vi, beforeEach } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const { requestOtp, verifyOtpCode } = require('../../../src/controllers/auth.controller');
const { getProjectsHealth } = require('../../../src/controllers/analytics.controller');
const {
  loginTestUser,
  deleteAuthTestUser,
  runVerifyJwt,
  uniqueTestMobile
} = require('../../helpers/authFlow');
const mockRes = require('../../helpers/mockRes');
const mockResWithCookies = require('../../helpers/mockResWithCookies');
const { requestApp } = require('../../helpers/httpRequest');
const app = require('../../../src/app');
const {
  errorResponseSchema,
  healthResponseSchema,
  requestOtpSuccessSchema,
  verifyOtpSuccessSchema,
  authMeResponseSchema,
  projectsHealthResponseSchema
} = require('../../helpers/responseSchemas');

function mockHealthyDb() {
  const limitMock = vi.fn().mockResolvedValue({ error: null });
  const selectMock = vi.fn().mockReturnValue({ limit: limitMock });
  vi.spyOn(supabase, 'from').mockReturnValue({ select: selectMock });
}

describe('apiResponseShape — Zod validity contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GIT_SHA = 'abc1234567890';
    process.env.GIT_BRANCH = 'main';
    process.env.BUILD_TIMESTAMP = '2026-08-05T08:00:00.000Z';
  });

  test('GET /health matches healthResponseSchema', async () => {
    mockHealthyDb();
    const { statusCode, body } = await requestApp(app, 'GET', '/health');
    expect(statusCode).toBe(200);
    expect(() => healthResponseSchema.parse(body)).not.toThrow();
  });

  test('rejects invalid health payload ({ ok: true })', () => {
    expect(() => healthResponseSchema.parse({ ok: true })).toThrow();
  });

  test('POST /auth/request-otp success matches requestOtpSuccessSchema', async () => {
    const mobile = uniqueTestMobile();
    await deleteAuthTestUser(mobile.canonical);

    await supabase.from('authorised_users').insert([{
      mobile_number: mobile.canonical,
      display_name: 'Shape test user',
      role: 'je',
      is_active: true,
      telegram_chat_id: '5555555555'
    }]);

    const res = mockRes();
    await requestOtp({ body: { mobileNumber: mobile.frontend } }, res);
    expect(res.statusCode).toBe(200);
    expect(() => requestOtpSuccessSchema.parse(res.jsonData)).not.toThrow();

    await deleteAuthTestUser(mobile.canonical);
  });

  test('POST /auth/verify-otp success matches verifyOtpSuccessSchema', async () => {
    const session = await loginTestUser({ displayName: 'Verify shape user', role: 'je' });
    expect(() => verifyOtpSuccessSchema.parse(session.verifyResponse)).not.toThrow();
    await deleteAuthTestUser(session.mobile.canonical);
  });

  test('GET /auth/me matches authMeResponseSchema', async () => {
    const session = await loginTestUser({ displayName: 'Me shape user', role: 'je' });
    const req = { cookies: session.cookies, headers: {} };
    const res = mockRes();

    await runVerifyJwt(req, res);
    const { getMe } = require('../../../src/controllers/auth.controller');
    await getMe(req, res);

    expect(() => authMeResponseSchema.parse(res.jsonData)).not.toThrow();
    await deleteAuthTestUser(session.mobile.canonical);
  });

  test('GET /analytics/projects (projects-health) matches projectsHealthResponseSchema', async () => {
    const session = await loginTestUser({ displayName: 'Projects health shape', role: 'je' });
    const req = { user: { role: 'je', mobile_number: session.mobile.canonical } };
    const res = mockRes();

    await getProjectsHealth(req, res);
    expect(res.statusCode).toBe(200);
    expect(() => projectsHealthResponseSchema.parse(res.jsonData)).not.toThrow();

    await deleteAuthTestUser(session.mobile.canonical);
  });

  test('error responses match errorResponseSchema', async () => {
    const res = mockRes();
    await requestOtp({ body: { mobileNumber: '+910000000000' } }, res);
    expect(res.statusCode).toBe(403);
    expect(() => errorResponseSchema.parse(res.jsonData)).not.toThrow();
  });

  test('rejects invalid API success shape ({ ok: true })', () => {
    expect(() => requestOtpSuccessSchema.parse({ ok: true })).toThrow();
    expect(() => verifyOtpSuccessSchema.parse({ ok: true })).toThrow();
    expect(() => authMeResponseSchema.parse({ ok: true })).toThrow();
  });
});
