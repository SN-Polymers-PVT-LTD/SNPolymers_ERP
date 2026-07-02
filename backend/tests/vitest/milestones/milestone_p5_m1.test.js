import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');

describe('Milestone P5-M1 — Daily Progress Reports Database Foundation', () => {
  let suffix;
  let testDate;
  let testDate2;
  let reportId = null;
  let mobile = null;
  let project = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    const randDay = Math.floor(1 + Math.random() * 26);
    const randMonth = Math.floor(1 + Math.random() * 12);
    const pad = (num) => String(num).padStart(2, '0');
    testDate = `2026-${pad(randMonth)}-${pad(randDay)}`;
    testDate2 = `2026-${pad(randMonth)}-${pad(randDay + 1)}`;

    // Find a valid user and project (work order) to test with
    const { data: users, error: userError } = await supabase.from('authorised_users').select('mobile_number').limit(1);
    if (userError || !users || !users.length) {
      throw new Error(`Failed to find a user: ${userError ? userError.message : 'Empty'}`);
    }
    mobile = users[0].mobile_number;

    const { data: projects, error: projectError } = await supabase.from('projects_master').select('work_order_no, state, district, zone, department, site_details').limit(1);
    if (projectError || !projects || !projects.length) {
      throw new Error(`Failed to find a project: ${projectError ? projectError.message : 'Empty'}`);
    }
    project = projects[0];

    // Clean up any old reports for this work order to avoid unique constraint issues initially
    await supabase
      .from('daily_progress_reports')
      .delete()
      .eq('work_order_no', project.work_order_no);
  });

  afterAll(async () => {
    // Hard deletes are blocked, so we leave it as test records
  });

  describe('Daily Progress Report Operations', () => {
    test('Test 1: Inserts a valid report row successfully', async () => {
      const validReport = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        site_visit_date: testDate,
        work_progress_details: 'Test work progress description',
        physical_work_progress: 45.50,
        daily_site_photo_url: 'test-uuid-path.jpg',
        original_photo_filename: 'test.jpg'
      };

      const { data: insData, error: insError } = await supabase
        .from('daily_progress_reports')
        .insert([validReport])
        .select();

      expect(insError).toBeNull();
      expect(insData).toBeDefined();
      expect(insData.length).toBeGreaterThan(0);
      reportId = insData[0].report_id;
    });

    test('Test 1b: Verify audit_log entry for INSERT', async () => {
      expect(reportId).not.toBeNull();

      const { data: auditData, error: auditError } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', reportId)
        .eq('module_name', 'DailyProgress')
        .maybeSingle();

      expect(auditError).toBeNull();
      expect(auditData).not.toBeNull();
      expect(auditData.action).toBe('CREATE');
    });

    test('Test 2: Blocks hard DELETE of daily progress reports via trigger', async () => {
      expect(reportId).not.toBeNull();

      const { error: delErr } = await supabase
        .from('daily_progress_reports')
        .delete()
        .eq('report_id', reportId);

      expect(delErr).not.toBeNull();
      expect(delErr.message).toContain('Hard deletion of daily progress reports is permanently prohibited');
    });

    test('Test 3: Verifying updated_at trigger on UPDATE', async () => {
      expect(reportId).not.toBeNull();

      const { data: initialData } = await supabase
        .from('daily_progress_reports')
        .select('updated_at')
        .eq('report_id', reportId)
        .single();

      // Brief sleep to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 500));

      const { data: updData, error: updError } = await supabase
        .from('daily_progress_reports')
        .update({ remarks_after_site_visit: 'Updated JE remarks' })
        .eq('report_id', reportId)
        .select();

      expect(updError).toBeNull();
      expect(updData).toBeDefined();
      expect(updData.length).toBeGreaterThan(0);
      expect(updData[0].updated_at).not.toBe(initialData.updated_at);
    });

    test('Test 4: Blocks physical progress > 100 via CHECK constraint', async () => {
      const invalidReport = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        site_visit_date: testDate2,
        work_progress_details: 'Test work progress description',
        physical_work_progress: 101.00,
        daily_site_photo_url: 'test-uuid-path.jpg',
        original_photo_filename: 'test.jpg'
      };

      const { error } = await supabase
        .from('daily_progress_reports')
        .insert([invalidReport]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_physical_work_progress');
    });

    test('Test 5: Blocks negative physical progress via CHECK constraint', async () => {
      const invalidReport = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        site_visit_date: testDate2,
        work_progress_details: 'Test work progress description',
        physical_work_progress: -1.00,
        daily_site_photo_url: 'test-uuid-path.jpg',
        original_photo_filename: 'test.jpg'
      };

      const { error } = await supabase
        .from('daily_progress_reports')
        .insert([invalidReport]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_physical_work_progress');
    });

    test('Test 6: Blocks inconsistent authority remarks via CHECK constraint', async () => {
      const invalidReport = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        site_visit_date: testDate2,
        work_progress_details: 'Test work progress description',
        physical_work_progress: 45.50,
        daily_site_photo_url: 'test-uuid-path.jpg',
        original_photo_filename: 'test.jpg',
        remarks_approved_authority: 'Approved remarks'
      };

      const { error } = await supabase
        .from('daily_progress_reports')
        .insert([invalidReport]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_authority_remarks_consistency');
    });

    test('Test 7: Blocks duplicate work_order_no + site_visit_date via unique constraint', async () => {
      const duplicateReport = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        site_visit_date: testDate, // same date
        work_progress_details: 'Test work progress description',
        physical_work_progress: 50.00,
        daily_site_photo_url: 'test-uuid-path.jpg',
        original_photo_filename: 'test.jpg'
      };

      const { error } = await supabase
        .from('daily_progress_reports')
        .insert([duplicateReport]);

      expect(error).not.toBeNull();
      const isUniqueViolated = error.code === '23505' || error.message.includes('uq_daily_progress_work_order_date');
      expect(isUniqueViolated).toBe(true);
    });
  });
});
