import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const {
  createProgressReport,
  getProgressReports,
  getProgressReportById,
  addAuthorityRemarks
} = require('../../../src/controllers/dailyProgress.controller');

describe('Milestone P5-M2 & M3 — Daily Progress CRUD & Remarks API', () => {
  let suffix;
  let testWorkOrder;
  let testEstimateNo;
  let testDate;
  let testDate2;
  let createdReportId = null;

  const jeUser = { role: 'je', mobile_number: '+918276071523' };
  const jeUser2 = { role: 'je', mobile_number: '+918000000002' };
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testWorkOrder = `TEST_WO_P5_${suffix}`;
    testEstimateNo = `EST_P5_${suffix}`;

    const pad = (num) => String(num).padStart(2, '0');
    const d1 = new Date();
    d1.setDate(d1.getDate() - 5 - Math.floor(Math.random() * 10));
    testDate = `${d1.getFullYear()}-${pad(d1.getMonth() + 1)}-${pad(d1.getDate())}`;
    
    const d2 = new Date();
    d2.setDate(d2.getDate() - 15 - Math.floor(Math.random() * 10));
    testDate2 = `${d2.getFullYear()}-${pad(d2.getMonth() + 1)}-${pad(d2.getDate())}`;

    // Setup isolated project
    await setupProject(testWorkOrder, testEstimateNo, 1000000.00, jeUser.mobile_number);
  });

  afterAll(async () => {
    // Clean up projects_master (DB cascades or soft/hard deletion rules)
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
  });

  describe('Progress Report Creation', () => {
    test('Test 1: Creates daily progress report (rounds physical_work_progress correctly)', async () => {
      const reqCreate = {
        user: jeUser,
        body: {
          work_order_no: testWorkOrder,
          site_visit_date: testDate,
          work_progress_details: 'API Test Progress details',
          physical_work_progress: 55.456,
          daily_site_photo_url: 'api-test-photo.jpg',
          original_photo_filename: 'original-api-test.jpg',
          remarks_after_site_visit: 'JE remarks'
        }
      };
      const resCreate = mockRes();
      await createProgressReport(reqCreate, resCreate);

      expect(resCreate.statusCode).toBe(201);
      expect(resCreate.jsonData.success).toBe(true);

      const report = resCreate.jsonData.report;
      expect(Number(report.physical_work_progress)).toBe(55.46);
      createdReportId = report.report_id;
    });

    test('Test 2: Blocks duplicate progress report creation on same work order + date with 409', async () => {
      const reqDup = {
        user: jeUser,
        body: {
          work_order_no: testWorkOrder,
          site_visit_date: testDate,
          work_progress_details: 'Duplicate details',
          physical_work_progress: 10,
          daily_site_photo_url: 'dup.jpg'
        }
      };
      const resDup = mockRes();
      await createProgressReport(reqDup, resDup);

      expect(resDup.statusCode).toBe(409);
      expect(resDup.jsonData.message).toContain('already been submitted');
    });

    test('Test 3: Blocks absolute photo URL with 400 Bad Request', async () => {
      const reqPhotoUrl = {
        user: jeUser,
        body: {
          work_order_no: testWorkOrder,
          site_visit_date: testDate2,
          work_progress_details: 'Invalid photo url details',
          physical_work_progress: 25.00,
          daily_site_photo_url: 'https://supabase.co/storage/v1/object/public/photos/test.jpg'
        }
      };
      const resPhotoUrl = mockRes();
      await createProgressReport(reqPhotoUrl, resPhotoUrl);

      expect(resPhotoUrl.statusCode).toBe(400);
    });

    test('Test 4: Blocks creation on Closed projects with 409 Conflict', async () => {
      await supabase.from('projects_master').update({ status: 'Closed' }).eq('work_order_no', testWorkOrder);

      const reqClosed = {
        user: jeUser,
        body: {
          work_order_no: testWorkOrder,
          site_visit_date: testDate2,
          work_progress_details: 'Progress on closed project',
          physical_work_progress: 60.00,
          daily_site_photo_url: 'closed-project.jpg'
        }
      };
      const resClosed = mockRes();
      await createProgressReport(reqClosed, resClosed);

      // Revert status
      await supabase.from('projects_master').update({ status: 'Running' }).eq('work_order_no', testWorkOrder);

      expect(resClosed.statusCode).toBe(409);
      expect(resClosed.jsonData.message).toContain('Active projects');
    });
  });

  describe('Retrieve Operations & Gating', () => {
    test('Test 5: Owner JE retrieves only their own progress reports', async () => {
      expect(createdReportId).not.toBeNull();

      const reqGetJe = {
        user: jeUser,
        query: { page: 1, limit: 10, work_order_no: testWorkOrder }
      };
      const resGetJe = mockRes();
      await getProgressReports(reqGetJe, resGetJe);

      expect(resGetJe.statusCode).toBe(200);
      expect(resGetJe.jsonData.success).toBe(true);

      const list = resGetJe.jsonData.reports;
      const allOwn = list.every(r => r.created_by === jeUser.mobile_number);
      const containsCreated = list.some(r => r.report_id === createdReportId);

      expect(allOwn).toBe(true);
      expect(containsCreated).toBe(true);
    });

    test('Test 6: ZO retrieves all progress reports including from other owners JEs', async () => {
      expect(createdReportId).not.toBeNull();

      const reqGetZo = {
        user: zoUser,
        query: { page: 1, limit: 10, work_order_no: testWorkOrder }
      };
      const resGetZo = mockRes();
      await getProgressReports(reqGetZo, resGetZo);

      expect(resGetZo.statusCode).toBe(200);
      expect(resGetZo.jsonData.success).toBe(true);

      const list = resGetZo.jsonData.reports;
      const containsCreated = list.some(r => r.report_id === createdReportId);
      expect(containsCreated).toBe(true);
    });

    test('Test 7: restrics details to owner and generates photo_signed_url', async () => {
      expect(createdReportId).not.toBeNull();

      const reqGetOwner = {
        user: jeUser,
        params: { id: createdReportId }
      };
      const resGetOwner = mockRes();
      await getProgressReportById(reqGetOwner, resGetOwner);

      const reqGetNonOwner = {
        user: jeUser2,
        params: { id: createdReportId }
      };
      const resGetNonOwner = mockRes();
      await getProgressReportById(reqGetNonOwner, resGetNonOwner);

      expect(resGetOwner.statusCode).toBe(200);
      const signedUrl = resGetOwner.jsonData.report.photo_signed_url;
      expect(signedUrl === null || signedUrl.startsWith('https://')).toBe(true);

      expect(resGetNonOwner.statusCode).toBe(404);

      // DB should store relative path
      const { data: dbRecord } = await supabase
        .from('daily_progress_reports')
        .select('daily_site_photo_url')
        .eq('report_id', createdReportId)
        .single();

      expect(dbRecord.daily_site_photo_url.startsWith('https://')).toBe(false);
    });
  });

  describe('Remarks & Workflows', () => {
    test('Test 8: ZO can add and overwrite authority remarks', async () => {
      expect(createdReportId).not.toBeNull();

      const reqRemarks1 = {
        user: zoUser,
        params: { id: createdReportId },
        body: { remarks_approved_authority: 'ZO Approved Remarks 1' }
      };
      const resRemarks1 = mockRes();
      await addAuthorityRemarks(reqRemarks1, resRemarks1);
      expect(resRemarks1.statusCode).toBe(200);

      const reqRemarks2 = {
        user: zoUser,
        params: { id: createdReportId },
        body: { remarks_approved_authority: 'ZO Overwritten Remarks 2' }
      };
      const resRemarks2 = mockRes();
      await addAuthorityRemarks(reqRemarks2, resRemarks2);

      expect(resRemarks2.statusCode).toBe(200);
      const report = resRemarks2.jsonData.report;
      expect(report.remarks_approved_authority).toBe('ZO Overwritten Remarks 2');
      expect(report.approved_user_id).toBe(zoUser.mobile_number);
      expect(report.approval_date).not.toBeNull();
    });

    test('Test 9: Blocks adding authority remarks on Closed projects with 409', async () => {
      expect(createdReportId).not.toBeNull();

      // Close project
      await supabase.from('projects_master').update({ status: 'Closed' }).eq('work_order_no', testWorkOrder);

      const reqRemarksClosed = {
        user: zoUser,
        params: { id: createdReportId },
        body: { remarks_approved_authority: 'Trying to add remarks to closed WO' }
      };
      const resRemarksClosed = mockRes();
      await addAuthorityRemarks(reqRemarksClosed, resRemarksClosed);

      // Revert status
      await supabase.from('projects_master').update({ status: 'Running' }).eq('work_order_no', testWorkOrder);

      expect(resRemarksClosed.statusCode).toBe(409);
      expect(resRemarksClosed.jsonData.message).toContain('remarks cannot be added or modified');
    });
  });
});
