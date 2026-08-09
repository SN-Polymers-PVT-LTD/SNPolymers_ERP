import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const { notifyZoFundRequestApproved } = require('../../../src/services/telegram.service');

describe('Milestone P3-M4 — Fund Request Telegram Notification', () => {
  const testMobile = '+918276071523';
  const testChatId = '5078059280';
  let originalEnvNodeEnv;
  let originalTelegramChatId = null;

  beforeAll(async () => {
    originalEnvNodeEnv = process.env.NODE_ENV;

    // Ensure the test user exists and has a linked Telegram chat ID
    const { data: user } = await supabase
      .from('authorised_users')
      .select('telegram_chat_id')
      .eq('mobile_number', testMobile)
      .maybeSingle();

    originalTelegramChatId = user?.telegram_chat_id ?? null;

    await supabase.from('authorised_users').upsert(
      {
        mobile_number: testMobile,
        role: 'zo',
        is_active: true,
        display_name: 'Test ZO User M4',
        telegram_chat_id: testChatId
      },
      { onConflict: 'mobile_number' }
    );

    await supabase.from('authorised_users').upsert(
      {
        mobile_number: '+918000000002',
        role: 'zo',
        is_active: true,
        display_name: 'Test ZO User No Chat M4',
        telegram_chat_id: null
      },
      { onConflict: 'mobile_number' }
    );
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalEnvNodeEnv;

    // Restore original chat ID
    await supabase
      .from('authorised_users')
      .update({ telegram_chat_id: originalTelegramChatId })
      .eq('mobile_number', testMobile);
  });

  const testFrId = 'test-fr-uuid-m4-12345';
  const mockOriginalRequest = {
    fund_request_id: testFrId,
    zo_user_id: testMobile,
    zo_fr_no: `TEST_M4_FR_${Math.floor(100000 + Math.random() * 900000)}`,
    zo_fr_amount: 85000.50
  };

  const mockUpdatedRequest = {
    approve_ho_amount: 80000.00,
    transfer_from_account: 'CC',
    ho_remarks: 'Approved for test execution'
  };

  test('Test 1: Dispatches Telegram notification and logs status in dev/prod modes', async () => {
    process.env.NODE_ENV = 'development';

    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = '123456:mock_token';

    const originalFetch = global.fetch;
    let telegramFetchCount = 0;
    global.fetch = async (url, options) => {
      if (String(url).includes('api.telegram.org')) {
        telegramFetchCount += 1;
        return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
      }
      return originalFetch(url, options);
    };

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logOutput = '';
    console.log = (...args) => {
      logOutput += args.join(' ') + '\n';
      originalLog(...args);
    };
    console.warn = (...args) => {
      logOutput += args.join(' ') + '\n';
      originalWarn(...args);
    };
    console.error = (...args) => {
      logOutput += args.join(' ') + '\n';
      originalError(...args);
    };

    try {
      await notifyZoFundRequestApproved(mockOriginalRequest, mockUpdatedRequest);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      global.fetch = originalFetch;
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    expect(telegramFetchCount).toBeGreaterThan(0);
    expect(logOutput.toLowerCase()).toContain('sent');
  });

  test('Test 2: Gracefully logs warning for users without telegram_chat_id configured', async () => {
    process.env.NODE_ENV = 'development';

    const originalWarn = console.warn;
    let warnOutput = '';
    console.warn = (...args) => {
      warnOutput += args.join(' ') + '\n';
      originalWarn(...args);
    };

    const mockRequestNoChat = {
      ...mockOriginalRequest,
      zo_user_id: '+918000000002' // Dummy user with no telegram link
    };

    try {
      await supabase.from('authorised_users').update({ telegram_chat_id: null }).eq('mobile_number', '+918000000002');
      await notifyZoFundRequestApproved(mockRequestNoChat, mockUpdatedRequest);
    } finally {
      console.warn = originalWarn;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    expect(warnOutput).toContain('has no Telegram chat ID configured');
  });

  test('Test 3: Gracefully logs warning when TELEGRAM_BOT_TOKEN is not set', async () => {
    process.env.NODE_ENV = 'development';
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    const originalWarn = console.warn;
    let warnOutput = '';
    console.warn = (...args) => {
      warnOutput += args.join(' ') + '\n';
      originalWarn(...args);
    };

    try {
      await notifyZoFundRequestApproved(mockOriginalRequest, mockUpdatedRequest);
    } finally {
      console.warn = originalWarn;
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    expect(warnOutput).toContain('TELEGRAM_BOT_TOKEN not set');
  });

  test('Test 4: Wraps exceptions safely and does not throw to block main transaction', async () => {
    process.env.NODE_ENV = 'development';

    let hasThrown = false;
    try {
      await notifyZoFundRequestApproved(null, null);
    } catch (err) {
      hasThrown = true;
    } finally {
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    expect(hasThrown).toBe(false);
  });
});
