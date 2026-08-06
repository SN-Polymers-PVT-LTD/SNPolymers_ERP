import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { getMe, refreshTokens, logout } = require('../../../src/controllers/auth.controller');
const {
  loginTestUser,
  deleteAuthTestUser,
  runVerifyJwt,
  mockResWithCookies
} = require('../../helpers/authFlow');
const mockRes = require('../../helpers/mockRes');

describe('authSession — OTP → verify → me → refresh → logout', () => {
  let session;

  beforeAll(async () => {
    session = await loginTestUser({
      displayName: 'Session flow JE',
      role: 'je'
    });
  });

  afterAll(async () => {
    if (session?.mobile?.canonical) {
      await deleteAuthTestUser(session.mobile.canonical);
    }
  });

  test('GET /auth/me returns authenticated user after verify-otp', async () => {
    const req = { cookies: session.cookies, headers: {} };
    const res = mockRes();

    await runVerifyJwt(req, res);
    expect(res.statusCode).not.toBe(401);

    await getMe(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.user.mobile_number).toBe(session.mobile.canonical);
    expect(res.jsonData.user.role).toBe('je');
    expect(res.jsonData.user.display_name).toBe('Session flow JE');
  });

  test('POST /auth/refresh rotates tokens and returns user payload', async () => {
    const req = { cookies: session.cookies, headers: {} };
    const res = mockResWithCookies();

    await refreshTokens(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.user.mobile_number).toBe(session.mobile.canonical);
    expect(res.cookies.accessToken).toBeTruthy();
    expect(res.cookies.refreshToken).toBeTruthy();
    expect(res.cookies.refreshToken).not.toBe(session.cookies.refreshToken);

    session.cookies = res.cookies;
  });

  test('GET /auth/me works with refreshed access token', async () => {
    const req = { cookies: session.cookies, headers: {} };
    const res = mockRes();

    await runVerifyJwt(req, res);
    await getMe(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.user.mobile_number).toBe(session.mobile.canonical);
  });

  test('POST /auth/logout clears session and rejects subsequent /me', async () => {
    const meReq = { cookies: session.cookies, headers: {} };
    const meRes = mockRes();
    await runVerifyJwt(meReq, meRes);
    expect(meRes.statusCode).not.toBe(401);

    const logoutReq = {
      cookies: session.cookies,
      headers: {},
      user: meReq.user,
      sessionId: meReq.sessionId
    };
    const logoutRes = mockResWithCookies();
    await logout(logoutReq, logoutRes);

    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.jsonData.success).toBe(true);
    expect(logoutRes.clearedCookies).toContain('accessToken');

    const afterReq = { cookies: session.cookies, headers: {} };
    const afterRes = mockResWithCookies();
    await runVerifyJwt(afterReq, afterRes);

    expect(afterRes.statusCode).toBe(401);
  });
});
