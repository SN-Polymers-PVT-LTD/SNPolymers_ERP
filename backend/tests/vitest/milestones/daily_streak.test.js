import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const { createProgressReport } = require('../../../src/controllers/dailyProgress.controller');
const { checkAndSendStreakReminders } = require('../../../src/services/streakNotification.service');

describe('Daily Progress Upload Streak Suite', () => {
  let suffix;
  let testWorkOrder;
  let testEstimateNo;
  const testMobile = '+918000000002'; // JE mobile
  const testZoMobile = '+918000000001';
  let jeZoMappingId = null;
  let workOrderMappingId = null;
  const reportIds = [];

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testWorkOrder = `TEST_WO_STREAK_${suffix}`;
    testEstimateNo = `EST_STREAK_${suffix}`;

    // Setup active project
    await setupProject(testWorkOrder, testEstimateNo, 500000.00, testMobile);

    // Assign owning Zonal Office to the project
    await supabase.from('projects_master')
      .update({ zo_user_id: testZoMobile })
      .eq('work_order_no', testWorkOrder);

    // Setup JE-ZO mapping
    const { data: mappingData } = await supabase.from('je_zo_mappings').insert({
      je_user_id: testMobile,
      zo_user_id: testZoMobile,
      is_active: true,
      assigned_by: testZoMobile
    }).select('id').single();
    jeZoMappingId = mappingData?.id || null;

    // Setup Work Order mapping
    const { data: woMappingData } = await supabase.from('work_order_mappings').insert({
      work_order_no: testWorkOrder,
      je_user_id: testMobile,
      is_active: true,
      reason: 'Assigned',
      assigned_by: testZoMobile
    }).select('id').single();
    workOrderMappingId = woMappingData?.id || null;
  });

  afterAll(async () => {
    // Clean up created mappings
    if (jeZoMappingId) {
      await supabase.from('je_zo_mappings').delete().eq('id', jeZoMappingId);
    }
    if (workOrderMappingId) {
      await supabase.from('work_order_mappings').delete().eq('id', workOrderMappingId);
    }
    // Clean up reports
    if (reportIds.length > 0) {
      await supabase.from('daily_progress_reports').delete().in('report_id', reportIds);
    }
  });

  test('Test 1: Verify streak increments correctly when previous report was yesterday', async () => {
    const todayISTStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISTStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(yesterday);

    // 1. Force the database state: last_report_date = yesterday, daily_streak = 5
    await supabase.from('authorised_users')
      .update({ daily_streak: 5, last_report_date: yesterdayISTStr, telegram_chat_id: '123456789' })
      .eq('mobile_number', testMobile);

    // 2. Submit a report for today
    const req = {
      body: {
        work_order_no: testWorkOrder,
        site_visit_date: todayISTStr,
        work_progress_details: 'Test streak increment details',
        physical_work_progress: 15,
        daily_site_photo_url: 'daily-progress-photos/test_streak.jpg',
        original_photo_filename: 'test_streak.jpg',
        remarks_after_site_visit: ''
      },
      user: { mobile_number: testMobile }
    };
    const res = mockRes();

    await createProgressReport(req, res);
    expect(res.statusCode).toBe(201);
    reportIds.push(res.jsonData.report.report_id);

    // 3. Verify user daily_streak is updated to 6 in DB
    const { data: userObj } = await supabase
      .from('authorised_users')
      .select('daily_streak, last_report_date')
      .eq('mobile_number', testMobile)
      .single();

    expect(userObj.daily_streak).toBe(6);
    expect(userObj.last_report_date).toBe(todayISTStr);
  });

  test('Test 2: Verify reminder scheduler fetches JEs with missing reports and triggers fetch requests', async () => {
    // Back-date all daily progress reports created by testMobile so they have nothing submitted today
    await supabase.from('daily_progress_reports')
      .update({ site_visit_date: '2000-01-01' })
      .eq('created_by', testMobile);

    // Force set the test JE as having last reported yesterday, so they should be reminded today
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISTStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(yesterday);

    await supabase.from('authorised_users')
      .update({ daily_streak: 2, last_report_date: yesterdayISTStr, telegram_chat_id: '9988776655' })
      .eq('mobile_number', testMobile);

    // Mock global fetch conditionally so that Supabase client keeps working
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockImplementation((url, options) => {
      if (typeof url === 'string' && url.includes('api.telegram.org')) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true })
        });
      }
      return originalFetch(url, options);
    });
    global.fetch = fetchMock;

    try {
      await checkAndSendStreakReminders();

      // Find the telegram message call for our test JE
      const calls = fetchMock.mock.calls.filter(call => call[0].includes('api.telegram.org'));
      const targetCall = calls.find(call => call[0].includes('9988776655'));
      expect(targetCall).toBeDefined();
      expect(targetCall[0]).toContain('Daily%20Streak%20Alert');
    } finally {
      // Restore original fetch
      global.fetch = originalFetch;
    }
  });
});
