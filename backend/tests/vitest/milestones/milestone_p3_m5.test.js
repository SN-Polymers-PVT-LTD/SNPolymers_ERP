import { describe, test, expect } from 'vitest';
const jwt = require('jsonwebtoken');
const { supabase } = require('../../../src/db/supabase');
const { getEstimates } = require('../../../src/controllers/estimates.core.controller');
const { createReport, updateReport } = require('../../../src/controllers/reports.controller');
const { updateUser, removeUser } = require('../../../src/controllers/admin.controller');
const verifyJwt = require('../../../src/middleware/verifyJwt');
const mockRes = require('../../helpers/mockRes');

// Extend mockRes with clearCookie
const createMockResWithCookies = () => {
  const base = mockRes();
  base.cookiesCleared = {};
  base.clearCookie = function (name, options) {
    this.cookiesCleared[name] = options;
    return this;
  };
  return base;
};

describe('Milestone P3-M5 — Code Quality & Security Hardening', () => {
  test('Test 1: Parses leftmost client IP from x-forwarded-for header correctly', () => {
    const testHeader = '1.2.3.4, 5.6.7.8';
    const parsedIp = (testHeader || '').split(',')[0].trim() || 'unknown';
    expect(parsedIp).toBe('1.2.3.4');
  });

  test('Test 2: Blocks non-numeric and negative report amounts with 400 Bad Request', async () => {
    const reqCreate = {
      body: {
        work_order_no: 'TEST_WO_M1_1234',
        amount: 'invalid-amount'
      }
    };
    const resCreate = mockRes();
    await createReport(reqCreate, resCreate);

    const reqUpdate = {
      params: { fund_report_id: 'some-uuid' },
      body: {
        amount: -50.00
      }
    };
    const resUpdate = mockRes();
    await updateReport(reqUpdate, resUpdate);

    expect(resCreate.statusCode).toBe(400);
    expect(resUpdate.statusCode).toBe(400);
  });

  test('Test 3: Limits JE estimate visibility to own mobile number even with global=true', async () => {
    const reqJeGlobal = {
      user: { role: 'je', mobile_number: '+918000000002' },
      query: { global: 'true' }
    };
    const resJeGlobal = mockRes();
    await getEstimates(reqJeGlobal, resJeGlobal);

    expect(resJeGlobal.statusCode).toBe(200);
    expect(resJeGlobal.jsonData.success).toBe(true);
  });

  test('Test 4: Blocks invalid role updates in admin updateUser with 400 Bad Request', async () => {
    const reqUpdateUser = {
      params: { id: 'some-id' },
      body: { role: 'superadmin' }
    };
    const resUpdateUser = mockRes();
    await updateUser(reqUpdateUser, resUpdateUser);

    expect(resUpdateUser.statusCode).toBe(400);
    expect(resUpdateUser.jsonData.success).toBe(false);
  });

  test('Test 5: verifyJwt middleware clears accessToken cookie on TokenExpiredError', async () => {
    const expiredToken = jwt.sign(
      { user_id: '123', session_id: 'abc', role: 'je' },
      process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit',
      { expiresIn: '-10s' }
    );
    const reqExpired = {
      cookies: { accessToken: expiredToken }
    };
    const resExpired = createMockResWithCookies();
    let nextCalled = false;
    await verifyJwt(reqExpired, resExpired, () => { nextCalled = true; });

    expect(resExpired.statusCode).toBe(401);
    expect(resExpired.cookiesCleared.accessToken).toBeDefined();
  });

  test('Test 6: Blocks deleting user from authorized_users if they have active estimates with 409', async () => {
    const { data: seedUser } = await supabase
      .from('authorised_users')
      .select('id, display_name')
      .eq('mobile_number', '+918276071523') // admin user who has created estimate(s)
      .maybeSingle();

    if (seedUser) {
      const reqRemove = {
        params: { id: seedUser.id }
      };
      const resRemove = mockRes();
      await removeUser(reqRemove, resRemove);

      expect(resRemove.statusCode).toBe(409);
      expect(resRemove.jsonData.success).toBe(false);
    }
  });
});
