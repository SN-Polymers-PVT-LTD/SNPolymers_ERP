import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');

describe('Milestone 1 — Database Foundation', () => {
  let testMobile;
  let testWorkOrder;
  let testEstimateNo;
  let testAdminMobile = '+918276071523'; // Whitelisted admin from seed
  let testInvalidMobile = '+919999999900';
  let createdEstimateId = null;
  let createdPurchaseOptionId = null;

  function rpcThrewUnauthorized(error) {
    return error && (error.message.includes('Unauthorized') || error.message.includes('User does not have'));
  }

  // Use beforeAll for the shared project setup, as it's expensive and shared
  beforeAll(async () => {
    testWorkOrder = `TEST_WO_M1_${crypto.randomUUID().substring(0, 8)}`;
    testEstimateNo = `EST_M1_${crypto.randomUUID().substring(0, 8)}`;

    // Clean up any potential leftovers first
    await supabase.from('project_cost_estimate_items').delete().filter('material_main_head', 'eq', 'TEST_MAIN_1');
    await supabase.from('project_cost_estimates').delete().filter('zonal_office_no', 'eq', 'TEST_ZO_99');
    await supabase.from('projects_master').delete().filter('work_order_no', 'like', 'TEST_WO_M1_%');
    await supabase.from('purchase_data').delete().filter('name', 'eq', 'TEST_PURCHASE_OPTION');

    // Setup temporary project
    const { error } = await supabase.from('projects_master').insert([{
      work_order_no: testWorkOrder,
      estimate_no: testEstimateNo,
      work_order_value: 100000.00,
      site_details: 'Test Site M1',
      state: 'West Bengal',
      district: 'Kolkata',
      zone: 'Kolkata Zone',
      department: 'PWD',
      status: 'Running',
      created_by: testAdminMobile,
      edited_by: testAdminMobile
    }]);
    if (error) throw new Error(`Project setup failed: ${error.message}`);
  });

  afterAll(async () => {
    // Final cleanup of projects_master
    await supabase.from('project_cost_estimate_items').delete().filter('material_main_head', 'eq', 'TEST_MAIN_1');
    await supabase.from('project_cost_estimates').delete().filter('zonal_office_no', 'eq', 'TEST_ZO_99');
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
    if (createdPurchaseOptionId) {
      await supabase.from('purchase_data').delete().eq('id', createdPurchaseOptionId);
    }
  });

  // Unique user per test block for clean isolation
  beforeEach(() => {
    testMobile = `+91${crypto.randomUUID().replace(/[^0-9]/g, '').substring(0, 10)}`;
  });

  afterEach(async () => {
    await supabase.from('authorised_users').delete().eq('mobile_number', testMobile);
  });

  describe('Role Whitelist Constraints', () => {
    test('inserts valid JE role successfully', async () => {
      const { data: userJe, error: errJe } = await supabase
        .from('authorised_users')
        .insert([
          {
            mobile_number: testMobile,
            display_name: 'Test JE User',
            role: 'je',
            permissions: {},
            is_active: true
          }
        ])
        .select()
        .single();

      expect(errJe).toBeNull();
      expect(userJe).toBeDefined();
      expect(userJe.role).toBe('je');
    });

    test('blocks invalid role via CHECK constraint', async () => {
      const { error: errInvalidRole } = await supabase
        .from('authorised_users')
        .insert([
          {
            mobile_number: testInvalidMobile, // This mobile is not cleaned up because it fails insertion
            display_name: 'Test Invalid User',
            role: 'invalid_role',
            permissions: {},
            is_active: true
          }
        ]);

      expect(errInvalidRole).not.toBeNull();
      expect(errInvalidRole.code).toBe('23514'); // check_violation
    });
  });

  describe('Unique Purchase Option & References', () => {
    test('creates unique purchase option and blocks duplicates', async () => {
      const { data: pd1Data, error: errPd1 } = await supabase
        .from('purchase_data')
        .insert([{ name: 'TEST_PURCHASE_OPTION', created_by: testAdminMobile }])
        .select()
        .single();

      expect(errPd1).toBeNull();
      expect(pd1Data).toBeDefined();
      createdPurchaseOptionId = pd1Data.id;

      // Try to insert a duplicate name
      const { error: errPdDup } = await supabase
        .from('purchase_data')
        .insert([{ name: 'TEST_PURCHASE_OPTION', created_by: testAdminMobile }]);

      expect(errPdDup).not.toBeNull();
      expect(errPdDup.code).toBe('23505'); // unique_violation
    });
  });

  describe('Estimate Integrity, Triggers, & RPCs', () => {
    let testEstimate;
    let testItem;
    let localTestMobile;

    beforeAll(async () => {
      localTestMobile = `+91${crypto.randomUUID().replace(/[^0-9]/g, '').substring(0, 10)}`;

      // Create user first
      const { error: errUser } = await supabase.from('authorised_users').insert([{
        mobile_number: localTestMobile,
        display_name: 'Test JE User',
        role: 'je',
        permissions: {},
        is_active: true
      }]);
      if (errUser) throw new Error(`User insertion failed: ${errUser.message}`);

      // Create estimate header
      const { data, error } = await supabase
        .from('project_cost_estimates')
        .insert([
          {
            work_order_no: testWorkOrder,
            estimate_no: 'EST_TEST_M1',
            area_code: 'South Bengal',
            estimate_revision: 0,
            zonal_office_no: 'TEST_ZO_99',
            estimate_amount: 0,
            estimate_status: 'Draft',
            created_by: localTestMobile
          }
        ])
        .select()
        .single();

      if (error) throw new Error(`Estimate creation failed: ${error.message}`);
      testEstimate = data;
      createdEstimateId = data.estimate_id;
    });

    afterAll(async () => {
      // Cleanup local test user
      await supabase.from('authorised_users').delete().eq('mobile_number', localTestMobile);

      if (createdEstimateId) {
        // Restore to original to allow delete
        await supabase.from('project_cost_estimates').update({
          work_order_no: 'WB_BAN_102',
          created_by: testAdminMobile,
          last_modified_by: testAdminMobile,
          je_user_id: testAdminMobile,
          zo_approved_by: null,
          ho_approved_by: null
        }).eq('estimate_id', createdEstimateId);
      }
    });

    test('Test 4: Blocks estimate item with mismatched amount (rate * qty)', async () => {
      const { error } = await supabase
        .from('project_cost_estimate_items')
        .insert([
          {
            estimate_id: testEstimate.estimate_id,
            material_main_head: 'TEST_MAIN_1',
            material_sub_head: 'TEST_SUB_1',
            material_details: 'TEST_DETAILS_1',
            unit: 'Nos',
            qty: 10,
            rate: 150,
            amount: 999.00 // Mismatched (should be 1500)
          }
        ]);

      expect(error).not.toBeNull();
      expect(error.code).toBe('23514'); // check_violation
    });

    test('Test 4b: Inserts estimate item with correct amount', async () => {
      const { data, error } = await supabase
        .from('project_cost_estimate_items')
        .insert([
          {
            estimate_id: testEstimate.estimate_id,
            material_main_head: 'TEST_MAIN_1',
            material_sub_head: 'TEST_SUB_1',
            material_details: 'TEST_DETAILS_1',
            unit: 'Nos',
            qty: 10,
            rate: 150,
            amount: 1500.00
          }
        ])
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      testItem = data;
    });

    test('Test 5: Hard delete prevention trigger blocks deletion of estimate header', async () => {
      const { error } = await supabase
        .from('project_cost_estimates')
        .delete()
        .eq('estimate_id', testEstimate.estimate_id);

      expect(error).not.toBeNull();
      const isBlocked = error.message.includes('permanently prohibited') || 
                        error.message.includes('violates foreign key constraint');
      expect(isBlocked).toBe(true);
    });

    test('Test 6: Audit log trigger captures estimate status change', async () => {
      const { error: errUpdateStatus } = await supabase
        .from('project_cost_estimates')
        .update({ estimate_status: 'Submitted', last_modified_by: localTestMobile })
        .eq('estimate_id', testEstimate.estimate_id);

      expect(errUpdateStatus).toBeNull();

      const { data: auditLog, error: errAudit } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', testEstimate.estimate_id)
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      expect(errAudit).toBeNull();
      expect(auditLog).not.toBeNull();
      expect(auditLog.new_value?.estimate_status).toBe('Submitted');
    });

    test('Test 7: RPC submit_row_approvals blocks unauthorized users (role = je)', async () => {
      const { error } = await supabase.rpc('submit_row_approvals', {
        p_estimate_id: testEstimate.estimate_id,
        p_approvals: [{ item_id: testItem.item_id, approve_status: 'Approve', remarks: 'Good' }],
        p_stage: 'ZO',
        p_modified_by: localTestMobile // JE role mobile
      });

      expect(rpcThrewUnauthorized(error)).toBe(true);
    });

    test('Test 8: RPC transactional rollback works for invalid item ID in mixed batch', async () => {
      const { error } = await supabase.rpc('submit_row_approvals', {
        p_estimate_id: testEstimate.estimate_id,
        p_approvals: [
          { item_id: testItem.item_id, approve_status: 'Approve', remarks: 'First ok' },
          { item_id: '00000000-0000-0000-0000-000000000000', approve_status: 'Approve', remarks: 'Invalid' }
        ],
        p_stage: 'ZO',
        p_modified_by: testAdminMobile // Authorized admin
      });

      expect(error).not.toBeNull();
      expect(error.message).toContain('not found or does not belong');

      // Verify rollback occurred
      const { data: itemVerify } = await supabase
        .from('project_cost_estimate_items')
        .select('zo_office_approve')
        .eq('item_id', testItem.item_id)
        .single();

      expect(itemVerify.zo_office_approve).toBeNull();
    });
  });
});
