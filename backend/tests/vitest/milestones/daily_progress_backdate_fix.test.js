import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const {
  createProgressReport,
  addAuthorityRemarks
} = require('../../../src/controllers/dailyProgress.controller');

describe('Daily Progress Backdate Constraint & Approval Suite', () => {
  let suffix;
  let testWorkOrder;
  let testEstimateNo;
  let estimateId = null;
  const testMobile = '+918000000002'; // Actual JE in DB
  const testZoMobile = '+918000000001'; // ZO that testMobile JE is mapped to
  let createdReportId = null;
  let jeZoMappingId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testWorkOrder = `TEST_WO_DP_${suffix}`;
    testEstimateNo = `EST_DP_${suffix}`;

    // Setup active project
    await setupProject(testWorkOrder, testEstimateNo, 500000.00, testMobile);

    // Setup JE-ZO mapping so createProgressReport can resolve zo_user_id
    const { data: mappingData } = await supabase.from('je_zo_mappings').insert({
      je_user_id: testMobile,
      zo_user_id: testZoMobile,
      is_active: true,
      assigned_by: testZoMobile
    }).select('id').single();
    jeZoMappingId = mappingData?.id || null;
  });

  afterAll(async () => {
    if (jeZoMappingId) {
      await supabase.from('je_zo_mappings').delete().eq('id', jeZoMappingId);
    }
    // Cleanup
    if (createdReportId) {
      await supabase.from('daily_progress_reports').delete().eq('report_id', createdReportId);
    }
  });

  test('Test 1: Fails to submit back-dated report without remarks', async () => {
    const req = {
      body: {
        work_order_no: testWorkOrder,
        site_visit_date: '2026-07-01', // strictly a back-date
        work_progress_details: 'Tested progress detail',
        physical_work_progress: 10,
        daily_site_photo_url: 'daily-progress-photos/test.jpg',
        original_photo_filename: 'test.jpg',
        remarks_after_site_visit: '' // blank remarks
      },
      user: { mobile_number: testMobile }
    };
    const res = mockRes();

    await createProgressReport(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('Remarks are required for back-dated daily progress');
  });

  test('Test 2: Succeeds to submit back-dated report with remarks, marked as Pending', async () => {
    const req = {
      body: {
        work_order_no: testWorkOrder,
        site_visit_date: '2026-07-01',
        work_progress_details: 'Tested progress detail with remarks',
        physical_work_progress: 12,
        daily_site_photo_url: 'daily-progress-photos/test2.jpg',
        original_photo_filename: 'test2.jpg',
        remarks_after_site_visit: 'Because I forgot to submit it on time.' // explain reason
      },
      user: { mobile_number: testMobile }
    };
    const res = mockRes();

    await createProgressReport(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.report.approval_status).toBe('Pending');
    createdReportId = res.jsonData.report.report_id;
  });

  test('Test 3: Authority can Approve the pending back-dated report', async () => {
    const req = {
      params: { id: createdReportId },
      body: {
        remarks_approved_authority: 'Approved because JE explained properly.',
        action: 'Approve'
      },
      // Test 3 needs a valid admin user for the authority action
    user: { role: 'admin', mobile_number: testZoMobile }
    };
    const res = mockRes();

    await addAuthorityRemarks(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.report.approval_status).toBe('Approved');
    expect(res.jsonData.report.remarks_approved_authority).toBe('Approved because JE explained properly.');
  });
});
