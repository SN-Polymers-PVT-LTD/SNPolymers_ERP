import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const telegramService = require('../../../src/services/telegram.service');
const mockRes = require('../../helpers/mockRes');
const {
  submitEstimate,
  reviewEstimate,
  submitReview
} = require('../../../src/controllers/estimates.controller');

const setupProject = require('../../helpers/setupProject');
const setupUsers = require('../../helpers/setupUsers');

describe('Milestone 8 — Notifications & Audit logs API', () => {
  let suffix;
  let testZoMobile;
  let testJeMobile;
  let testOtherMobile;
  let testHoMobile;
  let testAdminMobile;
  let testWorkOrder;
  let testEstimateId = null;
  let testItemId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testZoMobile = `9501${suffix}`;
    testJeMobile = `9502${suffix}`;
    testOtherMobile = `9503${suffix}`;
    testHoMobile = `9504${suffix}`;
    testAdminMobile = `9505${suffix}`;
    testWorkOrder = `TEST_WO_M8_${suffix}`;

    await setupUsers([
      { mobile_number: testZoMobile, role: 'zo', is_active: true, display_name: `ZO M8 ${suffix}`, telegram_chat_id: null },
      { mobile_number: testJeMobile, role: 'je', is_active: true, display_name: `JE M8 ${suffix}`, telegram_chat_id: null },
      { mobile_number: testOtherMobile, role: 'je', is_active: true, display_name: `Other JE ${suffix}`, telegram_chat_id: null },
      { mobile_number: testHoMobile, role: 'ho', is_active: true, display_name: `HO M8 ${suffix}`, telegram_chat_id: null },
      { mobile_number: testAdminMobile, role: 'admin', is_active: true, display_name: `Admin M8 ${suffix}`, telegram_chat_id: null }
    ]);
    await setupProject(testWorkOrder, `EST_M8_${suffix}`, 500000.00, testJeMobile);

    // Map testJeMobile to testZoMobile so the ZO has access to this cost estimate
    await supabase.from('je_zo_mappings').insert({
      je_user_id: testJeMobile,
      zo_user_id: testZoMobile,
      is_active: true,
      assigned_by: testAdminMobile
    });

    // Clear active estimates for this work order to bypass unique checks
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Rejected by ZO', last_modified_by: testAdminMobile })
      .eq('work_order_no', testWorkOrder);

    // Insert test estimate in Draft
    const { data: estimate, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: testWorkOrder,
        estimate_no: `EST-M8-${suffix}`,
        area_code: 'South Bengal',
        estimate_revision: 0,
        zonal_office_no: 'ZO-01',
        estimate_amount: 50000,
        estimate_status: 'Draft',
        created_by: testJeMobile,
        last_modified_by: testJeMobile
      })
      .select()
      .single();

    if (estErr) throw estErr;
    testEstimateId = estimate.estimate_id;

    // Create line item
    const { data: item, error: itemErr } = await supabase
      .from('project_cost_estimate_items')
      .insert({
        estimate_id: testEstimateId,
        material_main_head: 'Labour',
        material_sub_head: 'Unskilled',
        material_details: 'Unskilled Worker',
        unit: 'Nos',
        qty: 100,
        rate: 500,
        amount: 50000,
        rate_reference: 'M8 Test Reference'
      })
      .select()
      .single();

    if (itemErr) throw itemErr;
    testItemId = item.item_id;
  });

  afterAll(async () => {
    if (testEstimateId) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', testEstimateId);
      await supabase.from('estimate_revision_log').delete().eq('estimate_id', testEstimateId);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', testEstimateId);
    }
    await supabase.from('je_zo_mappings').delete().eq('zo_user_id', testZoMobile);
    if (testWorkOrder) await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile, testAdminMobile]);
  });

  describe('Telegram Notifications & Fallbacks', () => {
    test('Test 1: Verifies all Telegram service functions are exported correctly', () => {
      expect(typeof telegramService.sendOtp).toBe('function');
      expect(typeof telegramService.startPolling).toBe('function');
      expect(typeof telegramService.notifyZoEstimateSubmitted).toBe('function');
      expect(typeof telegramService.notifyHoEstimateApproved).toBe('function');
      expect(typeof telegramService.notifyJeRevisionRequested).toBe('function');
    });

    test('Test 1b: Runs notifyJeRevisionRequested gracefully without throwing in test environment', async () => {
      const mockEstimate = {
        estimate_id: '00000000-0000-0000-0000-000000000000',
        created_by: testJeMobile,
        estimate_no: 'EST-TEST',
        work_order_no: testWorkOrder,
        projects_master: { site_details: 'Test details' }
      };
      const mockRevisionLog = {
        stage: 'ZO',
        revision_cycle: 1,
        requested_by: testZoMobile,
        revision_deadline: new Date().toISOString()
      };
      
      // Should return immediately or complete without error in test environment
      await expect(telegramService.notifyJeRevisionRequested(mockEstimate, mockRevisionLog)).resolves.not.toThrow();
    });

    test('Test 1c: notifyJeRevisionRequested correctly formats message and hits Telegram API when token and chat_id are present', async () => {
      // Temporarily bypass the NODE_ENV === 'test' guard
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Temporarily set a dummy TELEGRAM_BOT_TOKEN
      const originalToken = process.env.TELEGRAM_BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = '123456:mock_token';

      // Mock global fetch only for Telegram requests
      const originalFetch = global.fetch;
      let fetchedUrl = null;
      global.fetch = async (url, options) => {
        if (url.includes('api.telegram.org')) {
          fetchedUrl = url;
          return {
            json: async () => ({ ok: true, result: { message_id: 12345 } })
          };
        }
        return originalFetch(url, options);
      };

      // Set telegram_chat_id in DB for the test JE user
      await supabase
        .from('authorised_users')
        .update({ telegram_chat_id: '987654321' })
        .eq('mobile_number', testJeMobile);

      try {
        const mockEstimate = {
          estimate_id: testEstimateId,
          created_by: testJeMobile,
          estimate_no: 'EST-M8-MOCK',
          work_order_no: testWorkOrder,
          projects_master: { site_details: 'Test details at site' }
        };
        const mockRevisionLog = {
          stage: 'ZO',
          revision_cycle: 1,
          requested_by: testZoMobile,
          revision_deadline: new Date().toISOString()
        };

        await telegramService.notifyJeRevisionRequested(mockEstimate, mockRevisionLog);

        expect(fetchedUrl).not.toBeNull();
        expect(fetchedUrl).toContain('987654321'); // Check chat_id
        expect(fetchedUrl).toContain('EST-M8-MOCK'); // Check estimate no
        expect(fetchedUrl).toContain('Unapproved'); // Check unapproved rows text
      } finally {
        process.env.NODE_ENV = originalEnv;
        process.env.TELEGRAM_BOT_TOKEN = originalToken;
        global.fetch = originalFetch;
        // Revert DB change
        await supabase
          .from('authorised_users')
          .update({ telegram_chat_id: null })
          .eq('mobile_number', testJeMobile);
      }
    });

    test('Test 2a: Gracefully submits estimate when TELEGRAM_BOT_TOKEN is missing', async () => {
      expect(testEstimateId).not.toBeNull();

      const originalToken = process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;

      const reqSubmit = {
        params: { id: testEstimateId },
        user: { role: 'je', mobile_number: testJeMobile }
      };
      const res = mockRes();
      
      try {
        await submitEstimate(reqSubmit, res);
      } finally {
        process.env.TELEGRAM_BOT_TOKEN = originalToken;
      }

      expect(res.statusCode).toBe(200);

      const { data: dbEst } = await supabase
        .from('project_cost_estimates')
        .select('estimate_status')
        .eq('estimate_id', testEstimateId)
        .single();

      expect(dbEst.estimate_status).toBe('Submitted');
    });

    test('Test 2b: Gracefully submits estimate when ZO user has null telegram_chat_id', async () => {
      expect(testEstimateId).not.toBeNull();

      // Revert status back to Draft
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Draft', estimate_revision: 0 })
        .eq('estimate_id', testEstimateId);

      const reqSubmit = {
        params: { id: testEstimateId },
        user: { role: 'je', mobile_number: testJeMobile }
      };
      const res = mockRes();
      await submitEstimate(reqSubmit, res);

      expect(res.statusCode).toBe(200);

      const { data: dbEst } = await supabase
        .from('project_cost_estimates')
        .select('estimate_status')
        .eq('estimate_id', testEstimateId)
        .single();

      expect(dbEst.estimate_status).toBe('Submitted');
    });

    test('Test 2c: Gracefully submits estimate during simulated notifyZoEstimateSubmitted API failure', async () => {
      expect(testEstimateId).not.toBeNull();

      // Reset to Draft
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Draft', estimate_revision: 0 })
        .eq('estimate_id', testEstimateId);

      const originalNotify = telegramService.notifyZoEstimateSubmitted;
      telegramService.notifyZoEstimateSubmitted = async () => {
        throw new Error('Simulated Telegram API crash');
      };

      const reqSubmit = {
        params: { id: testEstimateId },
        user: { role: 'je', mobile_number: testJeMobile }
      };
      const res = mockRes();
      
      try {
        await submitEstimate(reqSubmit, res);
      } finally {
        telegramService.notifyZoEstimateSubmitted = originalNotify;
      }

      expect(res.statusCode).toBe(200);

      const { data: dbEst } = await supabase
        .from('project_cost_estimates')
        .select('estimate_status')
        .eq('estimate_id', testEstimateId)
        .single();

      expect(dbEst.estimate_status).toBe('Submitted');
    });
  });

  describe('Audit Logging Verification', () => {
    test('Test 3: Validates manual STATUS_CHANGE audit records for full workflow lifecycle', async () => {
      expect(testEstimateId).not.toBeNull();

      // 1. Transition A: Draft -> Submitted (by JE)
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Draft', estimate_revision: 0 })
        .eq('estimate_id', testEstimateId);

      // Clean up audit logs AFTER resetting to Draft
      await supabase.from('audit_log').delete().eq('record_identifier', String(testEstimateId));

      const reqSubmit = {
        params: { id: testEstimateId },
        user: { role: 'je', mobile_number: testJeMobile }
      };
      await submitEstimate(reqSubmit, mockRes());

      const { data: auditA } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', String(testEstimateId))
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false });

      expect(auditA[0].user_id).toBe(testJeMobile);
      expect(auditA[0].old_value.estimate_status).toBe('Draft');
      expect(auditA[0].new_value.estimate_status).toBe('Submitted');

      // 2. Transition B: Submitted -> Under ZO Review (by ZO)
      const reqZoReview = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile }
      };
      await reviewEstimate(reqZoReview, mockRes());

      const { data: auditB } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', String(testEstimateId))
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false });

      expect(auditB[0].user_id).toBe(testZoMobile);
      expect(auditB[0].old_value.estimate_status).toBe('Submitted');
      expect(auditB[0].new_value.estimate_status).toBe('Under ZO Review');

      // 3. Transition C: Under ZO Review -> ZO Approved
      await supabase.from('project_cost_estimate_items')
        .update({ zo_office_approve: 'Approve' })
        .eq('estimate_id', testEstimateId);

      const reqZoSubmit = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile },
        body: { remarks: 'ZO approved' }
      };
      await submitReview(reqZoSubmit, mockRes());

      const { data: auditC } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', String(testEstimateId))
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false });

      expect(auditC[0].user_id).toBe(testZoMobile);
      expect(auditC[0].old_value.estimate_status).toBe('Under ZO Review');
      expect(auditC[0].new_value.estimate_status).toBe('ZO Approved');

      // 4. Transition D: ZO Approved -> Under HO Review (by HO)
      const reqHoReview = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile }
      };
      await reviewEstimate(reqHoReview, mockRes());

      const { data: auditD } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', String(testEstimateId))
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false });

      expect(auditD[0].user_id).toBe(testHoMobile);
      expect(auditD[0].old_value.estimate_status).toBe('ZO Approved');
      expect(auditD[0].new_value.estimate_status).toBe('Under HO Review');

      // 5. Transition E: Under HO Review -> Final Approved (by HO)
      await supabase.from('project_cost_estimate_items')
        .update({ ho_office_approve: 'Approve' })
        .eq('estimate_id', testEstimateId);

      const reqHoSubmit = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: { remarks: 'HO approved' }
      };
      await submitReview(reqHoSubmit, mockRes());

      const { data: auditE } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', String(testEstimateId))
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false });

      expect(auditE[0].user_id).toBe(testHoMobile);
      expect(auditE[0].old_value.estimate_status).toBe('Under HO Review');
      expect(auditE[0].new_value.estimate_status).toBe('Final Approved');
    });

    test('Test 4: Validates AUTO_RESUBMIT audit entry structure (null user_id)', async () => {
      expect(testEstimateId).not.toBeNull();

      // Reset to ZO Revision Requested
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'ZO Revision Requested', estimate_revision: 1 })
        .eq('estimate_id', testEstimateId);

      await supabase.from('audit_log').delete().eq('record_identifier', String(testEstimateId)).eq('action', 'AUTO_RESUBMIT');

      const expiredDate = new Date();
      expiredDate.setMinutes(expiredDate.getMinutes() - 10);
      
      await supabase.from('estimate_revision_log').insert({
        estimate_id: testEstimateId,
        revision_cycle: 1,
        stage: 'ZO',
        requested_by: testZoMobile,
        revision_deadline: expiredDate.toISOString(),
        created_at: expiredDate.toISOString()
      });

      const reqReview = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile }
      };
      await reviewEstimate(reqReview, mockRes());

      const { data: resubAudit } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', String(testEstimateId))
        .eq('action', 'AUTO_RESUBMIT');

      expect(resubAudit.length).toBe(1);
      expect(resubAudit[0].user_id).toBeNull();
      expect(resubAudit[0].old_value.estimate_status).toBe('ZO Revision Requested');
      expect(resubAudit[0].new_value.estimate_status).toBe('Submitted');
    });

    test('Test 5: Verifies console OTP delivery fallback successfully returns success when chat_id is missing', async () => {
      const otpResult = await telegramService.sendOtp(null, '123456');
      
      expect(otpResult.success).toBe(true);
      expect(otpResult.mode).toBe('console');
    });
  });
});
