import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');

describe('Milestone P6-M1 — RA/Final Bill Database Foundation', () => {
  let suffix;
  let testBillNo;
  let createdBillId = null;
  let mobile = null;
  let project = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testBillNo = `BILL_M1_TEST_${suffix}`;

    // Find a valid user and project (work order) to test with
    const { data: users, error: userError } = await supabase.from('authorised_users').select('mobile_number').limit(1);
    if (userError || !users || !users.length) {
      throw new Error(`Failed to find a user: ${userError ? userError.message : 'Empty'}`);
    }
    mobile = users[0].mobile_number;

    // Find a valid project that has no entries in ra_final_bills to avoid unique constraint issues
    const { data: bills } = await supabase.from('ra_final_bills').select('work_order_no');
    const existingWOs = new Set((bills || []).map(b => b.work_order_no));

    const { data: projects, error: projectError } = await supabase.from('projects_master').select('work_order_no, state, district, zone, department, site_details');
    if (projectError || !projects || !projects.length) {
      throw new Error(`Failed to find a project: ${projectError ? projectError.message : 'Empty'}`);
    }
    
    project = projects.find(p => !existingWOs.has(p.work_order_no)) || projects[0];

    // Clean up any old test bills for this work order to avoid unique constraint issues
    await supabase
      .from('ra_final_bills')
      .delete()
      .eq('work_order_no', project.work_order_no);
  });

  afterAll(async () => {
    // Clean up created bill record (since hard delete trigger blocks delete, it remains, but we try a soft cancel/remarks update if needed)
    // Actually, hard delete is blocked, so we just log a note or let it remain.
  });

  describe('RA/Final Bill Core Operations', () => {
    test('Test 1: Inserting valid RA bill row successfully', async () => {
      const validBill = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        payment_type: 'RA Bill 1',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: testBillNo,
        bill_amount_with_gst: 150000.00,
        earnest_money_deposit: 1000.00,
        security_deposit_amount: 2000.00,
        bill_copy_url: 'test-uuid-path.pdf',
        original_bill_filename: 'invoice.pdf',
        remarks: 'Test remarks'
      };

      const { data: insData, error: insError } = await supabase
        .from('ra_final_bills')
        .insert([validBill])
        .select();

      expect(insError).toBeNull();
      expect(insData).toBeDefined();
      expect(insData.length).toBeGreaterThan(0);
      createdBillId = insData[0].bill_id;
    });

    test('Test 1b: Verify audit_log entry for INSERT', async () => {
      expect(createdBillId).not.toBeNull();

      const { data: auditData, error: auditError } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', createdBillId)
        .eq('module_name', 'RAFinalBill')
        .maybeSingle();

      expect(auditError).toBeNull();
      expect(auditData).not.toBeNull();
      expect(auditData.action).toBe('CREATE');
    });

    test('Test 2: Attempting hard delete (expecting restriction)', async () => {
      expect(createdBillId).not.toBeNull();

      const { error: delErr } = await supabase
        .from('ra_final_bills')
        .delete()
        .eq('bill_id', createdBillId);

      expect(delErr).not.toBeNull();
      expect(delErr.message).toContain('Hard deletion of RA/Final bill records is permanently prohibited');
    });

    test('Test 3: Verifying updated_at trigger on UPDATE', async () => {
      expect(createdBillId).not.toBeNull();

      // Retrieve first to get initial updated_at
      const { data: initialData } = await supabase
        .from('ra_final_bills')
        .select('updated_at')
        .eq('bill_id', createdBillId)
        .single();

      // Brief sleep to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 500));

      const { data: updData, error: updError } = await supabase
        .from('ra_final_bills')
        .update({ remarks: 'Updated remarks for Test 3' })
        .eq('bill_id', createdBillId)
        .select();

      expect(updError).toBeNull();
      expect(updData).toBeDefined();
      expect(updData.length).toBeGreaterThan(0);
      expect(updData[0].updated_at).not.toBe(initialData.updated_at);
    });

    test('Test 4: Inserting with bill_amount_with_gst = 0 (expecting check constraint failure)', async () => {
      const invalidBill = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        payment_type: 'RA Bill 2',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `${testBillNo}_4`,
        bill_amount_with_gst: 0,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([invalidBill]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_bill_amount_positive');
    });

    test('Test 5: Inserting with bill_amount_with_gst = -500 (expecting check constraint failure)', async () => {
      const invalidBill = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        payment_type: 'RA Bill 2',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `${testBillNo}_5`,
        bill_amount_with_gst: -500,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([invalidBill]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_bill_amount_positive');
    });

    test('Test 6: Inserting with earnest_money_deposit = -1 (expecting check constraint failure)', async () => {
      const invalidBill = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        payment_type: 'RA Bill 2',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `${testBillNo}_6`,
        bill_amount_with_gst: 100.00,
        earnest_money_deposit: -1,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([invalidBill]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_emd_non_negative');
    });

    test('Test 7: Inserting with payment_type = "RA Bill 0" (expecting check constraint failure)', async () => {
      const invalidBill = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        payment_type: 'RA Bill 0',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `${testBillNo}_7`,
        bill_amount_with_gst: 100.00,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([invalidBill]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_payment_type_format');
    });

    test('Test 8: Inserting with payment_type = "ra bill 1" (lowercase) (expecting check constraint failure)', async () => {
      const invalidBill = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        payment_type: 'ra bill 1',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `${testBillNo}_8`,
        bill_amount_with_gst: 100.00,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([invalidBill]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_payment_type_format');
    });

    test('Test 9: Inserting with payment_type = "Random String" (expecting check constraint failure)', async () => {
      const invalidBill = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        payment_type: 'Random String',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `${testBillNo}_9`,
        bill_amount_with_gst: 100.00,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([invalidBill]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_payment_type_format');
    });

    test('Test 10: Inserting duplicate payment type for same work order (expecting unique constraint failure)', async () => {
      const duplicateBill = {
        created_by: mobile,
        work_order_no: project.work_order_no,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        payment_type: 'RA Bill 1', // Duplicate of Test 1
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `${testBillNo}_dup`,
        bill_amount_with_gst: 200000.00,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([duplicateBill]);

      expect(error).not.toBeNull();
      expect(error.code).toBe('23505'); // unique_violation
    });
  });
});
