import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');

describe('Milestone P4-M1 — Requisitions Database Foundation', () => {
  let suffix;
  let requisitionNo;
  const testMobile = '+918276071523'; // Admin/Staff user from seed
  const testWorkOrder = 'WB_BAN_102'; // Known valid work order in DB
  let requisitionId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    requisitionNo = `REQ_P4_M1_TEST_${suffix}`;
  });

  afterAll(async () => {
    if (requisitionId) {
      // Soft cancel the test record since hard delete is blocked
      await supabase
        .from('requisitions')
        .update({ 
          requisition_status: 'Cancelled', 
          cancelled_by: testMobile, 
          cancelled_at: new Date().toISOString() 
        })
        .eq('requisition_id', requisitionId);
    }
  });

  describe('Requisition Row Operations', () => {
    test('Test 1: Inserts valid Pending requisition successfully', async () => {
      const { data: req1, error: err1 } = await supabase
        .from('requisitions')
        .insert([{
          requester_user_id: testMobile,
          work_order_no: testWorkOrder,
          estimate_no: 'EST_M1_MOCK',
          estimate_amount: 10000.00,
          state: 'West Bengal',
          district: 'Bankura',
          area_code: 'Bankura Zone',
          department: 'PWD',
          site_details: 'Mock Site Details',
          requisition_no: requisitionNo,
          material_main_head: 'Pipes',
          requisition_pdf_url: 'mock_requisition_path.pdf',
          original_filename: 'mock.pdf',
          requisition_amount: 5000.00,
          gst_bill: 'No',
          bank_details: 'SBI Account 1234567890',
          requisition_status: 'Pending',
          created_by: testMobile
        }])
        .select()
        .single();

      expect(err1).toBeNull();
      expect(req1).toBeDefined();
      requisitionId = req1.requisition_id;
    });

    test('Test 2: Blocks duplicate requisition_no via unique constraint', async () => {
      const { error: err2 } = await supabase
        .from('requisitions')
        .insert([{
          requester_user_id: testMobile,
          work_order_no: testWorkOrder,
          estimate_no: 'EST_M1_MOCK',
          estimate_amount: 10000.00,
          state: 'West Bengal',
          district: 'Bankura',
          area_code: 'Bankura Zone',
          department: 'PWD',
          site_details: 'Mock Site Details',
          requisition_no: requisitionNo, // Duplicate
          material_main_head: 'Pipes',
          requisition_pdf_url: 'mock_requisition_path_2.pdf',
          original_filename: 'mock2.pdf',
          requisition_amount: 2000.00,
          gst_bill: 'No',
          bank_details: 'SBI Account 1234567890',
          requisition_status: 'Pending',
          created_by: testMobile
        }]);

      expect(err2).not.toBeNull();
      expect(err2.code).toBe('23505'); // unique_violation
    });

    test('Test 3: Blocks hard DELETE of requisitions via trigger', async () => {
      expect(requisitionId).not.toBeNull();

      const { error: err3 } = await supabase
        .from('requisitions')
        .delete()
        .eq('requisition_id', requisitionId);

      expect(err3).not.toBeNull();
      expect(err3.message).toContain('prohibited');
    });

    test('Test 4: Verifying status change audit trigger captures status updates', async () => {
      expect(requisitionId).not.toBeNull();

      const { error: err4Update } = await supabase
        .from('requisitions')
        .update({
          requisition_status: 'Hold',
          approve_type: 'Hold',
          approved_user_id: testMobile,
          remarks_approved_authority: 'Needs verification'
        })
        .eq('requisition_id', requisitionId);

      expect(err4Update).toBeNull();

      const { data: audit, error: errAudit } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', requisitionId)
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      expect(errAudit).toBeNull();
      expect(audit).not.toBeNull();
      expect(audit.new_value?.requisition_status).toBe('Hold');
    });

    test('Test 5: Verifying set_requisition_updated_at trigger updates updated_at automatically', async () => {
      expect(requisitionId).not.toBeNull();

      const { data: reqBeforeUpdate } = await supabase
        .from('requisitions')
        .select('updated_at')
        .eq('requisition_id', requisitionId)
        .single();

      // Sleep 1 sec to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { error: err5Update } = await supabase
        .from('requisitions')
        .update({ expen_head_remarks: 'Updated remarks for Test 5' })
        .eq('requisition_id', requisitionId);

      expect(err5Update).toBeNull();

      const { data: reqAfterUpdate } = await supabase
        .from('requisitions')
        .select('updated_at')
        .eq('requisition_id', requisitionId)
        .single();

      expect(reqBeforeUpdate).toBeDefined();
      expect(reqAfterUpdate).toBeDefined();
      expect(reqAfterUpdate.updated_at).not.toBe(reqBeforeUpdate.updated_at);
    });

    test('Test 6: Blocks requisition with gst_bill = Yes but null gst_bill_pdf_url via CHECK constraint', async () => {
      const { error: err6 } = await supabase
        .from('requisitions')
        .insert([{
          requester_user_id: testMobile,
          work_order_no: testWorkOrder,
          estimate_no: 'EST_M1_MOCK',
          estimate_amount: 10000.00,
          state: 'West Bengal',
          district: 'Bankura',
          area_code: 'Bankura Zone',
          department: 'PWD',
          site_details: 'Mock Site Details',
          requisition_no: `REQ_M1_TEST_6_${suffix}`,
          material_main_head: 'Pipes',
          requisition_pdf_url: 'mock_requisition_path.pdf',
          original_filename: 'mock.pdf',
          requisition_amount: 3000.00,
          gst_bill: 'Yes',
          gst_bill_pdf_url: null, // Should violate constraint
          bank_details: 'SBI Account 1234567890',
          requisition_status: 'Pending',
          created_by: testMobile
        }]);

      expect(err6).not.toBeNull();
      expect(err6.code).toBe('23514'); // check_violation
    });

    test('Test 7: Blocks approved status with invalid balance amount via CHECK constraint', async () => {
      const { error: err7 } = await supabase
        .from('requisitions')
        .insert([{
          requester_user_id: testMobile,
          work_order_no: testWorkOrder,
          estimate_no: 'EST_M1_MOCK',
          estimate_amount: 10000.00,
          state: 'West Bengal',
          district: 'Bankura',
          area_code: 'Bankura Zone',
          department: 'PWD',
          site_details: 'Mock Site Details',
          requisition_no: `REQ_M1_TEST_7_${suffix}`,
          material_main_head: 'Pipes',
          requisition_pdf_url: 'mock_requisition_path.pdf',
          original_filename: 'mock.pdf',
          requisition_amount: 5000.00,
          gst_bill: 'No',
          bank_details: 'SBI Account 1234567890',
          requisition_status: 'Approved',
          approved_user_id: testMobile,
          approve_type: 'Approve',
          approved_amount: 4000.00,
          approved_balance_amount: 9999.00, // Invalid (should be 1000)
          remarks_approved_authority: 'Approved some',
          created_by: testMobile
        }]);

      expect(err7).not.toBeNull();
      expect(err7.code).toBe('23514'); // check_violation
    });
  });
});
