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
    testZoMobile = `+91800000_${suffix.substring(0, 4)}`;
    testJeMobile = `+91800001_${suffix.substring(0, 4)}`;
    testOtherMobile = `+91800002_${suffix.substring(0, 4)}`;
    testHoMobile = `+91800003_${suffix.substring(0, 4)}`;
    testAdminMobile = '+918276071523';
    testWorkOrder = 'WB_BAN_102'; // Running work order

    // Setup: Prepare test users and estimate
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);

    // Insert Users (unconfigured telegram_chat_id initially)
    await supabase.from('authorised_users').insert([
      { mobile_number: testZoMobile, display_name: 'Test ZO User', role: 'zo', is_active: true, telegram_chat_id: null },
      { mobile_number: testJeMobile, display_name: 'Test JE User', role: 'je', is_active: true, telegram_chat_id: null },
      { mobile_number: testOtherMobile, display_name: 'Other JE User', role: 'je', is_active: true, telegram_chat_id: null },
      { mobile_number: testHoMobile, display_name: 'Test HO User', role: 'ho', is_active: true, telegram_chat_id: null }
    ]);

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
      await supabase.from('project_cost_estimates')
        .update({
          estimate_status: 'Rejected by ZO',
          created_by: '+918276071523',
          last_modified_by: '+918276071523',
          je_user_id: '+918276071523',
          zo_approved_by: null,
          ho_approved_by: null
        })
        .eq('estimate_id', testEstimateId);
      await supabase.from('estimate_revision_log').delete().eq('estimate_id', testEstimateId);
    }
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);
  });

  describe('Telegram Notifications & Fallbacks', () => {
    test('Test 1: Verifies all Telegram service functions are exported correctly', () => {
      expect(typeof telegramService.sendOtp).toBe('function');
      expect(typeof telegramService.startPolling).toBe('function');
      expect(typeof telegramService.notifyZoEstimateSubmitted).toBe('function');
      expect(typeof telegramService.notifyHoEstimateApproved).toBe('function');
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

      // Clean up audit logs
      await supabase.from('audit_log').delete().eq('record_identifier', String(testEstimateId));

      // 1. Transition A: Draft -> Submitted (by JE)
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Draft', estimate_revision: 0 })
        .eq('estimate_id', testEstimateId);

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
