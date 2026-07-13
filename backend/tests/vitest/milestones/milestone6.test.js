import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  requestRevision,
  getRevisionLog
} = require('../../../src/controllers/estimates.controller');

describe('Milestone 6 — Cost Estimates Revision Gating & Logs API', () => {
  let suffix;
  let testZoMobile;
  let testJeMobile;
  let testOtherMobile;
  let testHoMobile;
  let testAdminMobile;
  let testWorkOrder;
  let testEstimateId = null;
  let testItemId = null;
  let jeZoMappingId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testZoMobile = `+91800000_${suffix.substring(0, 4)}`;
    testJeMobile = `+91800001_${suffix.substring(0, 4)}`;
    testOtherMobile = `+91800002_${suffix.substring(0, 4)}`;
    testHoMobile = `+91800003_${suffix.substring(0, 4)}`;
    testAdminMobile = '+918276071523';
    testWorkOrder = 'WB_BAN_102'; // Running work order

    // Setup test users and estimate
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);

    // Insert ZO
    await supabase.from('authorised_users').insert({
      mobile_number: testZoMobile,
      display_name: 'Test ZO User',
      role: 'zo',
      is_active: true
    });

    // Insert JE
    await supabase.from('authorised_users').insert({
      mobile_number: testJeMobile,
      display_name: 'Test JE User',
      role: 'je',
      is_active: true
    });

    // Insert Other JE
    await supabase.from('authorised_users').insert({
      mobile_number: testOtherMobile,
      display_name: 'Other JE User',
      role: 'je',
      is_active: true
    });

    // Insert HO
    await supabase.from('authorised_users').insert({
      mobile_number: testHoMobile,
      display_name: 'Test HO User',
      role: 'ho',
      is_active: true
    });

    // Clear active estimates for this work order to bypass unique checks
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Rejected by ZO', last_modified_by: testAdminMobile })
      .eq('work_order_no', testWorkOrder);

    // Insert test estimate in 'Draft' status
    const { data: estimate, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: testWorkOrder,
        estimate_no: `EST-M6-${suffix}`,
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

    // Create a line item for it
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
        amount: 50000
      })
      .select()
      .single();

    if (itemErr) throw itemErr;
    testItemId = item.item_id;

    // Add JE-ZO mapping so canViewEstimate passes for testZoMobile viewing testJeMobile's estimate
    const { data: jeZoData } = await supabase.from('je_zo_mappings').insert({
      je_user_id: testJeMobile,
      zo_user_id: testZoMobile,
      is_active: true,
      assigned_by: testZoMobile
    }).select('id').single();
    jeZoMappingId = jeZoData?.id || null;
  });

  afterAll(async () => {
    if (jeZoMappingId) await supabase.from('je_zo_mappings').delete().eq('id', jeZoMappingId);
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

  describe('Gating and Validation Checks', () => {
    test('Test 1: Blocks revision request for Draft status with 403', async () => {
      const req = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile },
        body: {}
      };
      const res = mockRes();
      await requestRevision(req, res);

      expect(res.statusCode).toBe(403);
    });

    test('Test 2: Blocks revision request with 422 when there are no unapproved rows', async () => {
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      const req = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile },
        body: {}
      };
      const res = mockRes();
      await requestRevision(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('Not Approve');
    });

    test('Test 3: Blocks invalid values for deadline_hours with 400', async () => {
      // Mark item as 'Not Approve' for ZO Review
      await supabase.from('project_cost_estimate_items')
        .update({ zo_office_approve: 'Not Approve', zo_remarks: 'Disapproved by ZO' })
        .eq('item_id', testItemId);

      const checkInvalidHours = async (hours) => {
        const req = {
          params: { id: testEstimateId },
          user: { role: 'zo', mobile_number: testZoMobile },
          body: { deadline_hours: hours }
        };
        const res = mockRes();
        await requestRevision(req, res);
        return res.statusCode === 400;
      };

      expect(await checkInvalidHours(12.5)).toBe(true);
      expect(await checkInvalidHours(0)).toBe(true);
      expect(await checkInvalidHours(-10)).toBe(true);
      expect(await checkInvalidHours(169)).toBe(true);
    });

    test('Test 3b: Defaults deadline_hours to 24h and modified_item_ids to empty array', async () => {
      const reqDefault = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile },
        body: {}
      };
      const resDefault = mockRes();
      
      const timeBeforeCall = Date.now();
      await requestRevision(reqDefault, resDefault);

      expect(resDefault.statusCode).toBe(200);
      const log = resDefault.jsonData.revisionLog;
      const expectedDeadline = timeBeforeCall + 24 * 60 * 60 * 1000;
      const actualDeadline = new Date(log.revision_deadline).getTime();
      const diffSeconds = Math.abs(expectedDeadline - actualDeadline) / 1000;

      expect(diffSeconds).toBeLessThan(15);
      expect(log.modified_item_ids).toBeDefined();
      expect(log.modified_item_ids.length).toBe(0);
    });
  });

  describe('Revision Stages & Numbering Sequence', () => {
    test('Test 4.1: Admin successfully requests ZO revision (revision_cycle incremented)', async () => {
      // Close previous log
      await supabase.from('estimate_revision_log')
        .update({ resubmitted_at: new Date().toISOString() })
        .eq('estimate_id', testEstimateId);

      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      const reqAdminZo = {
        params: { id: testEstimateId },
        user: { role: 'admin', mobile_number: testAdminMobile },
        body: { deadline_hours: 48 }
      };
      const resAdminZo = mockRes();
      await requestRevision(reqAdminZo, resAdminZo);

      expect(resAdminZo.statusCode).toBe(200);
      expect(resAdminZo.jsonData.revisionLog.revision_cycle).toBe(2);
      expect(resAdminZo.jsonData.revisionLog.stage).toBe('ZO');
      expect(resAdminZo.jsonData.estimate.estimate_status).toBe('ZO Revision Requested');
    });

    test('Test 4.2: HO revision request starts cycle at 1 (resets cycle sequence per stage)', async () => {
      // Close log
      await supabase.from('estimate_revision_log')
        .update({ resubmitted_at: new Date().toISOString() })
        .eq('estimate_id', testEstimateId);

      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      // Mark item as 'Not Approve' for HO Review
      await supabase.from('project_cost_estimate_items')
        .update({ ho_office_approve: 'Not Approve', ho_remarks: 'Disapproved by HO' })
        .eq('item_id', testItemId);

      const reqHo = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: { deadline_hours: 12 }
      };
      const resHo = mockRes();
      await requestRevision(reqHo, resHo);

      expect(resHo.statusCode).toBe(200);
      expect(resHo.jsonData.revisionLog.revision_cycle).toBe(1);
      expect(resHo.jsonData.revisionLog.stage).toBe('HO');
      expect(resHo.jsonData.estimate.estimate_status).toBe('HO Revision Requested');
    });

    test('Test 4.3: Admin successfully requests HO revision (cycle increments to 2)', async () => {
      // Close log
      await supabase.from('estimate_revision_log')
        .update({ resubmitted_at: new Date().toISOString() })
        .eq('estimate_id', testEstimateId);

      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      const reqAdminHo = {
        params: { id: testEstimateId },
        user: { role: 'admin', mobile_number: testAdminMobile },
        body: { deadline_hours: 24 }
      };
      const resAdminHo = mockRes();
      await requestRevision(reqAdminHo, resAdminHo);

      expect(resAdminHo.statusCode).toBe(200);
      expect(resAdminHo.jsonData.revisionLog.revision_cycle).toBe(2);
      expect(resAdminHo.jsonData.revisionLog.stage).toBe('HO');
      expect(resAdminHo.jsonData.estimate.estimate_status).toBe('HO Revision Requested');

      // Close log
      await supabase.from('estimate_revision_log')
        .update({ resubmitted_at: new Date().toISOString() })
        .eq('estimate_id', testEstimateId);
    });
  });

  describe('Active Logs and Concurrency Checks', () => {
    test('Test 5: Blocks request revision when one is already active with 409 Conflict', async () => {
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      // Create an active log
      const reqActive = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile },
        body: {}
      };
      await requestRevision(reqActive, mockRes());

      // Attempt second request revision
      const resDup = mockRes();
      await requestRevision(reqActive, resDup);

      expect(resDup.statusCode).toBe(409);
      expect(resDup.jsonData.message).toContain('already active');
    });

    test('Test 5b: DB constraint uniq_active_revision blocks direct insert of duplicate active logs', async () => {
      const { error } = await supabase
        .from('estimate_revision_log')
        .insert({
          estimate_id: testEstimateId,
          revision_cycle: 99,
          stage: 'ZO',
          requested_by: testZoMobile,
          revision_deadline: new Date().toISOString(),
          resubmitted_at: null
        });

      expect(error).not.toBeNull();
      expect(error.code).toBe('23505');
    });

    test('Test 6: Handles concurrent requests safely (one succeeds, other returns 409)', async () => {
      // Close active logs
      await supabase.from('estimate_revision_log')
        .update({ resubmitted_at: new Date().toISOString() })
        .eq('estimate_id', testEstimateId);

      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      const reqC1 = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile },
        body: { deadline_hours: 24 }
      };
      const resC1 = mockRes();
      const resC2 = mockRes();

      await Promise.all([
        requestRevision(reqC1, resC1),
        requestRevision(reqC1, resC2)
      ]);

      const codes = [resC1.statusCode, resC2.statusCode];
      expect(codes.includes(200)).toBe(true);
      expect(codes.includes(409)).toBe(true);

      const { data: activeLogs } = await supabase
        .from('estimate_revision_log')
        .select('*')
        .eq('estimate_id', testEstimateId)
        .is('resubmitted_at', null);

      expect(activeLogs.length).toBe(1);

      // Close logs
      await supabase.from('estimate_revision_log')
        .update({ resubmitted_at: new Date().toISOString() })
        .eq('estimate_id', testEstimateId);
    });
  });

  describe('Authorization matrix for getRevisionLog', () => {
    test('Test 7: Verification of Admin/Owner/Stage-Specific ZO/HO access gating', async () => {
      const checkLogAccess = async (role, mobile, expectedCode) => {
        const req = {
          params: { id: testEstimateId },
          user: { role, mobile_number: mobile }
        };
        const res = mockRes();
        await getRevisionLog(req, res);
        return res.statusCode === expectedCode;
      };

      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      expect(await checkLogAccess('admin', testAdminMobile, 200)).toBe(true);
      expect(await checkLogAccess('je', testJeMobile, 200)).toBe(true);
      expect(await checkLogAccess('je', testOtherMobile, 404)).toBe(true);
      expect(await checkLogAccess('zo', testZoMobile, 200)).toBe(true);
      expect(await checkLogAccess('ho', testHoMobile, 200)).toBe(true); // HO has intentional view access

      // Move to HO Review
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      expect(await checkLogAccess('zo', testZoMobile, 200)).toBe(true); // ZO has intentional view access
      expect(await checkLogAccess('ho', testHoMobile, 200)).toBe(true);
      expect(await checkLogAccess('staff', '+918000000099', 404)).toBe(true);
    });
  });
});
