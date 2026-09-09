import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupProject = require('../../helpers/setupProject');

describe('Milestone P6-M1 — RA/Final Bill Database Foundation', () => {
  let suffix;
  let testBillNo;
  let testWorkOrder;
  let createdBillId = null;
  let mobile = null;
  let project = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testBillNo = `BILL_M1_TEST_${suffix}`;
    testWorkOrder = `TEST_WO_P6_M1_${suffix}`;

    // Find a valid user to test with
    const { data: users, error: userError } = await supabase.from('authorised_users').select('mobile_number').limit(1);
    if (userError || !users || !users.length) {
      throw new Error(`Failed to find a user: ${userError ? userError.message : 'Empty'}`);
    }
    mobile = users[0].mobile_number;

    // Create an isolated project for this suite (ra_final_bills rows are permanent
    // audit records — an RESTRICT FK to projects_master — so this test cannot rely
    // on borrowing/cleaning up another test file's project row).
    await setupProject(testWorkOrder, `EST_P6_M1_${suffix}`, 1000000.00, mobile);
    const { data: projectData, error: projectError } = await supabase
      .from('projects_master')
      .select('work_order_no, state, district, zone, department, site_details')
      .eq('work_order_no', testWorkOrder)
      .single();
    if (projectError || !projectData) {
      throw new Error(`Failed to find a project: ${projectError ? projectError.message : 'Empty'}`);
    }
    project = projectData;
  });

  afterAll(async () => {
    // ra_final_bills rows created in this suite are permanent (hard delete is
    // trigger-blocked, see Test 2) and hold a RESTRICT FK to projects_master, so
    // neither the bill rows nor the project row created above can be cleaned up.
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
        gross_bill: 150000.00,
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

    test('Test 4: Inserting with gross_bill = -1 (expecting check constraint failure)', async () => {
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
        gross_bill: -1,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([invalidBill]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_gross_bill_non_negative');
    });

    test('Test 5: Inserting with gross_bill = -500 (expecting check constraint failure)', async () => {
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
        gross_bill: -500,
        bill_copy_url: 'test.pdf'
      };

      const { error } = await supabase
        .from('ra_final_bills')
        .insert([invalidBill]);

      expect(error).not.toBeNull();
      expect(error.message).toContain('chk_gross_bill_non_negative');
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
        gross_bill: 100.00,
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
        gross_bill: 100.00,
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
        gross_bill: 100.00,
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
        gross_bill: 100.00,
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
        gross_bill: 200000.00,
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
