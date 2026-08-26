import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const app = require('../../../src/app');
const { requestApp } = require('../../helpers/httpRequest');
const {
  loginTestUser,
  deleteAuthTestUser,
  DEV_OTP
} = require('../../helpers/authFlow');
const {
  enrollOtpSuccessSchema,
  enrollFaceSuccessSchema,
  errorResponseSchema
} = require('../../helpers/responseSchemas');

describe('faceVerification.contract — Phase 2 OTP-Gated Enrollment', () => {
  let accountsSession;
  let adminSession;
  let jeSession;
  let noTelegramSession;

  function generateVector(val = 0.5, len = 128) {
    return Array.from({ length: len }, (_, i) => Number((Math.sin(i + 1) * val).toFixed(6)));
  }

  function cookieHeader(session) {
    return {
      Cookie: `accessToken=${session.cookies.accessToken}; refreshToken=${session.cookies.refreshToken}`
    };
  }

  beforeAll(async () => {
    // 1. Seed accounts user with linked Telegram
    accountsSession = await loginTestUser({
      role: 'accounts',
      displayName: 'Accounts Enroll User',
      telegramChatId: '1111111111'
    });

    // 2. Seed admin user with linked Telegram
    adminSession = await loginTestUser({
      role: 'admin',
      displayName: 'Admin Enroll User',
      telegramChatId: '2222222222'
    });

    // 3. Seed JE user (unauthorized role)
    jeSession = await loginTestUser({
      role: 'je',
      displayName: 'JE Unauthorized User',
      telegramChatId: '3333333333'
    });

    // 4. Seed accounts user without telegram_chat_id
    noTelegramSession = await loginTestUser({
      role: 'accounts',
      displayName: 'No Telegram Accounts User',
      telegramChatId: '9999999999' // temporary to complete initial login
    });
    // Explicitly nullify telegram_chat_id to test unlinked Telegram guard
    await supabase
      .from('authorised_users')
      .update({ telegram_chat_id: null })
      .eq('id', noTelegramSession.user.id);
  });

  afterAll(async () => {
    const sessions = [accountsSession, adminSession, jeSession, noTelegramSession];
    for (const s of sessions) {
      if (s?.mobile?.canonical) {
        await deleteAuthTestUser(s.mobile.canonical);
      }
    }
  });

  // ── Authentication & RBAC Enforcement ─────────────────────────────────────

  describe('Authentication & Role-Based Access Control', () => {
    test('POST /enroll/request-otp without authentication returns 401', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll/request-otp'
      );
      expect(statusCode).toBe(401);
      expect(() => errorResponseSchema.parse(body)).not.toThrow();
    });

    test('POST /enroll without authentication returns 401', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        {},
        { descriptor: generateVector(0.5), otp: DEV_OTP }
      );
      expect(statusCode).toBe(401);
      expect(() => errorResponseSchema.parse(body)).not.toThrow();
    });

    test('POST /enroll/request-otp with unauthorized role (je) returns 403', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll/request-otp',
        cookieHeader(jeSession)
      );
      expect(statusCode).toBe(403);
      expect(body.message).toMatch(/Access denied/i);
    });

    test('POST /enroll with unauthorized role (je) returns 403', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        cookieHeader(jeSession),
        { descriptor: generateVector(0.5), otp: DEV_OTP }
      );
      expect(statusCode).toBe(403);
      expect(body.message).toMatch(/Access denied/i);
    });
  });

  // ── Request Enrollment OTP ────────────────────────────────────────────────

  describe('POST /api/v1/auth/face-verification/enroll/request-otp', () => {
    test('returns 400 TELEGRAM_NOT_LINKED if user has no telegram_chat_id', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll/request-otp',
        cookieHeader(noTelegramSession)
      );
      expect(statusCode).toBe(400);
      expect(body.success).toBe(false);
      expect(body.code).toBe('TELEGRAM_NOT_LINKED');
      expect(body.message).toMatch(/Telegram setup required/i);
    });

    test('returns 200 and dispatches OTP for accounts user with linked Telegram', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll/request-otp',
        cookieHeader(accountsSession)
      );
      expect(statusCode).toBe(200);
      expect(() => enrollOtpSuccessSchema.parse(body)).not.toThrow();
      expect(body.success).toBe(true);

      // Verify OTP request was recorded in database
      const { data: otps } = await supabase
        .from('otp_requests')
        .select('*')
        .eq('mobile_number', accountsSession.mobile.canonical)
        .order('created_at', { ascending: false })
        .limit(1);

      expect(otps).toBeDefined();
      expect(otps.length).toBe(1);
      expect(otps[0].is_used).toBe(false);
    });

    test('returns 200 for admin user with linked Telegram', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll/request-otp',
        cookieHeader(adminSession)
      );
      expect(statusCode).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── Enrollment Schema Validation ──────────────────────────────────────────

  describe('POST /api/v1/auth/face-verification/enroll — Validation', () => {
    test('rejects missing descriptor field with 400', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        cookieHeader(accountsSession),
        { otp: DEV_OTP }
      );
      expect(statusCode).toBe(400);
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/Descriptor must be an array of numbers/i);
    });

    test('rejects 127-element descriptor with 400', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        cookieHeader(accountsSession),
        { descriptor: generateVector(0.5, 127), otp: DEV_OTP }
      );
      expect(statusCode).toBe(400);
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/exactly 128 numbers/i);
    });

    test('rejects 129-element descriptor with 400', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        cookieHeader(accountsSession),
        { descriptor: generateVector(0.5, 129), otp: DEV_OTP }
      );
      expect(statusCode).toBe(400);
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/exactly 128 numbers/i);
    });

    test('rejects missing OTP with 400', async () => {
      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        cookieHeader(accountsSession),
        { descriptor: generateVector(0.5, 128) }
      );
      expect(statusCode).toBe(400);
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/OTP is required/i);
    });
  });

  // ── OTP Verification & Descriptor Persistence ─────────────────────────────

  describe('POST /api/v1/auth/face-verification/enroll — Execution & Upsert', () => {
    test('rejects invalid OTP with 400 INVALID_OTP', async () => {
      // First request an OTP to create a DB entry
      await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll/request-otp',
        cookieHeader(accountsSession)
      );

      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        cookieHeader(accountsSession),
        { descriptor: generateVector(0.5, 128), otp: '000000' }
      );
      expect(statusCode).toBe(400);
      expect(body.success).toBe(false);
      expect(body.code).toBe('INVALID_OTP');
      expect(body.attemptsLeft).toBeDefined();
    });

    test('succeeds with valid OTP and persists 128-d descriptor into database', async () => {
      const descriptor = generateVector(0.42, 128);

      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        cookieHeader(accountsSession),
        { descriptor, otp: DEV_OTP }
      );

      expect(statusCode).toBe(200);
      expect(() => enrollFaceSuccessSchema.parse(body)).not.toThrow();
      expect(body.success).toBe(true);
      expect(body.message).toMatch(/enrolled successfully/i);
      expect(body.enrolled_at).toBeDefined();

      // Verify row exists in public.face_descriptors
      const { data: rows, error } = await supabase
        .from('face_descriptors')
        .select('*')
        .eq('user_id', accountsSession.user.id);

      expect(error).toBeNull();
      expect(rows).toBeDefined();
      expect(rows.length).toBe(1);
      expect(rows[0].descriptor.length).toBe(128);
      expect(rows[0].descriptor[0]).toBeCloseTo(descriptor[0], 4);
    });

    test('re-enrollment with new descriptor overwrites previous record (row count stays 1)', async () => {
      const updatedDescriptor = generateVector(0.88, 128);

      const { statusCode, body } = await requestApp(
        app,
        'POST',
        '/api/v1/auth/face-verification/enroll',
        cookieHeader(accountsSession),
        { descriptor: updatedDescriptor, otp: DEV_OTP }
      );

      expect(statusCode).toBe(200);
      expect(body.success).toBe(true);

      // Verify row count is still exactly 1 for this user
      const { data: rows, error } = await supabase
        .from('face_descriptors')
        .select('*')
        .eq('user_id', accountsSession.user.id);

      expect(error).toBeNull();
      expect(rows.length).toBe(1);
      expect(rows[0].descriptor[0]).toBeCloseTo(updatedDescriptor[0], 4);
    });
  });
});
