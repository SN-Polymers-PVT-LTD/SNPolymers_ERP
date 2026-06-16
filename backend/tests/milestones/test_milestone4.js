const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const {
  createEstimate,
  saveDraftItems,
  submitEstimate
} = require('../../src/controllers/estimates.controller');

// Helper to create mock res object
function mockRes() {
  return {
    statusCode: 200,
    jsonData: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.jsonData = data;
      return this;
    }
  };
}

async function testMilestone4() {
  console.log('=== RUNNING MILESTONE 4 BACKEND TESTS ===\n');

  let passes = 0;
  let fails = 0;

  // Generate unique suffix for test isolation
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const activeWorkOrder = `TEST_WO_M4_ACTIVE_${suffix}`;
  let activeWorkOrder2 = null;

  const mobileJE_Owner = `+91900000${suffix}`;
  const mobileJE_Other = `+91911111${suffix}`;
  const mobileZO = `+91922222${suffix}`;
  const mobileAdmin = `+91933333${suffix}`;

  let createdEstimateId = null;
  let createdEstimateId2 = null;
  const insertedMaterialIds = [];

  try {
    // 0. Setup: Clean up and insert test records
    console.log('0. Setting up isolated test records...');

    // Delete existing records to avoid conflict
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_Owner, mobileJE_Other, mobileZO, mobileAdmin]);

    // Insert Users
    const { error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: mobileJE_Owner, display_name: 'JE Owner', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileJE_Other, display_name: 'JE Other', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true, permissions: {} }
    ]);
    if (userError) throw userError;

    // Insert Project
    const { error: projError } = await supabase.from('projects_master').insert([
      {
        work_order_no: activeWorkOrder,
        estimate_no: `EST_M4_${suffix}`,
        work_order_value: 1000000.00,
        site_details: 'Staging Site M4',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);
    if (projError) throw projError;

    // Insert Material
    const { data: testMats, error: matsError } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
    ]).select();

    if (matsError) throw matsError;
    if (testMats) {
      testMats.forEach(m => insertedMaterialIds.push(m.id));
    }

    // Create Estimate
    const resCreate = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: { work_order_no: activeWorkOrder, zonal_office_no: 'ZO-10' }
    }, resCreate);

    if (resCreate.statusCode === 201) {
      createdEstimateId = resCreate.jsonData.estimate.estimate_id;
      console.log(`   Test records set up successfully. Estimate ID: ${createdEstimateId}`);
    } else {
      throw new Error(`Failed to create test estimate: ${resCreate.jsonData.message}`);
    }

    // -------------------------------------------------------------
    // Test 1: Submit non-existent estimate
    // -------------------------------------------------------------
    console.log('\n1. Testing submitEstimate on non-existent estimate ID...');
    const req1 = {
      params: { id: '00000000-0000-0000-0000-000000000000' },
      user: { mobile_number: mobileJE_Owner, role: 'je' }
    };
    const res1 = mockRes();
    await submitEstimate(req1, res1);

    if (res1.statusCode === 404) {
      console.log('   [PASS] submitEstimate rejected non-existent estimate.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 404, got: ${res1.statusCode}`, res1.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Submit estimate with zero line items
    // -------------------------------------------------------------
    console.log('\n2. Testing submitEstimate with zero line items...');
    const req2 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' }
    };
    const res2 = mockRes();
    await submitEstimate(req2, res2);

    if (res2.statusCode === 422 && res2.jsonData.message.includes('at least one line item')) {
      console.log('   [PASS] submitEstimate blocked zero-item submission.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 422, got: ${res2.statusCode}`, res2.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3a: Submit estimate with incomplete items (qty = 0)
    // -------------------------------------------------------------
    console.log('\n3a. Testing submitEstimate with incomplete item (qty = 0)...');
    // Save draft items with qty = 0
    const resSave3 = mockRes();
    await saveDraftItems({
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [{
          material_main_head: 'Raw Materials',
          material_sub_head: 'Cement',
          material_details: `Test Cement ${suffix}`,
          unit: 'Bag',
          qty: 0,
          rate: 450,
          rate_reference: 'Ref'
        }]
      }
    }, resSave3);

    const res3 = mockRes();
    await submitEstimate(req2, res3);

    if (res3.statusCode === 422 && res3.jsonData.message.includes('incomplete')) {
      const isQtyError = res3.jsonData.errors[0]?.missing_fields.includes('qty');
      if (isQtyError) {
        console.log('   [PASS] submitEstimate blocked qty = 0 correctly.');
        passes++;
      } else {
        console.log('   [FAIL] Validation did not list qty as missing:', res3.jsonData);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 422, got: ${res3.statusCode}`, res3.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3b: Submit estimate with incomplete items (rate = 0)
    // -------------------------------------------------------------
    console.log('\n3b. Testing submitEstimate with incomplete item (rate = 0)...');
    // Save draft items with rate = 0
    const resSave3b = mockRes();
    await saveDraftItems({
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [{
          material_main_head: 'Raw Materials',
          material_sub_head: 'Cement',
          material_details: `Test Cement ${suffix}`,
          unit: 'Bag',
          qty: 10,
          rate: 0,
          rate_reference: 'Ref'
        }]
      }
    }, resSave3b);

    const res3b = mockRes();
    await submitEstimate(req2, res3b);

    if (res3b.statusCode === 422 && res3b.jsonData.message.includes('incomplete')) {
      const isRateError = res3b.jsonData.errors[0]?.missing_fields.includes('rate');
      if (isRateError) {
        console.log('   [PASS] submitEstimate blocked rate = 0 correctly.');
        passes++;
      } else {
        console.log('   [FAIL] Validation did not list rate as missing:', res3b.jsonData);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 422, got: ${res3b.statusCode}`, res3b.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4a: Submit estimate with incomplete items (blank rate_ref)
    // -------------------------------------------------------------
    console.log('\n4a. Testing submitEstimate with incomplete item (blank rate_reference)...');
    // Save draft items with blank rate_reference
    const resSave4 = mockRes();
    await saveDraftItems({
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [{
          material_main_head: 'Raw Materials',
          material_sub_head: 'Cement',
          material_details: `Test Cement ${suffix}`,
          unit: 'Bag',
          qty: 10,
          rate: 450,
          rate_reference: '   '
        }]
      }
    }, resSave4);

    const res4 = mockRes();
    await submitEstimate(req2, res4);

    if (res4.statusCode === 422 && res4.jsonData.message.includes('incomplete')) {
      const isRefError = res4.jsonData.errors[0]?.missing_fields.includes('rate_reference');
      if (isRefError) {
        console.log('   [PASS] submitEstimate blocked blank rate_reference correctly.');
        passes++;
      } else {
        console.log('   [FAIL] Validation did not list rate_reference as missing:', res4.jsonData);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 422, got: ${res4.statusCode}`, res4.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4b: Submit estimate with incomplete items (missing/blank unit)
    // -------------------------------------------------------------
    console.log('\n4b. Testing submitEstimate with incomplete item (blank unit)...');
    // Delete existing items first
    await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId);

    // Bypass saveDraftItems (which blocks blank unit with 400) and insert directly into DB to test submission validation
    const customItemId = crypto.randomUUID();
    const { error: directInsertErr } = await supabase.from('project_cost_estimate_items').insert({
      item_id: customItemId,
      estimate_id: createdEstimateId,
      material_main_head: 'Raw Materials',
      material_sub_head: 'Cement',
      material_details: `Test Cement ${suffix}`,
      unit: '', // Empty unit
      qty: 10,
      rate: 450,
      amount: 4500.00,
      rate_reference: 'Ref'
    });

    if (directInsertErr) throw directInsertErr;

    const res4b = mockRes();
    await submitEstimate(req2, res4b);

    if (res4b.statusCode === 422 && res4b.jsonData.message.includes('incomplete')) {
      const isUnitError = res4b.jsonData.errors[0]?.missing_fields.includes('unit');
      if (isUnitError) {
        console.log('   [PASS] submitEstimate blocked blank unit correctly.');
        passes++;
      } else {
        console.log('   [FAIL] Validation did not list unit as missing:', res4b.jsonData);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 422, got: ${res4b.statusCode}`, res4b.jsonData);
      fails++;
    }

    // Restore valid item configuration for subsequent tests
    await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId);
    const resSaveRestore = mockRes();
    await saveDraftItems({
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [{
          material_main_head: 'Raw Materials',
          material_sub_head: 'Cement',
          material_details: `Test Cement ${suffix}`,
          unit: 'Bag',
          qty: 10,
          rate: 450,
          rate_reference: 'Ref'
        }]
      }
    }, resSaveRestore);

    // -------------------------------------------------------------
    // Test 5: Submit estimate as unauthorized user (JE Other)
    // -------------------------------------------------------------
    console.log('\n5. Testing submitEstimate ownership gating...');
    const req5 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Other, role: 'je' }
    };
    const res5 = mockRes();
    await submitEstimate(req5, res5);

    if (res5.statusCode === 403 && res5.jsonData.message.includes('Access denied')) {
      console.log('   [PASS] submitEstimate blocked unauthorized submit correctly.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 403, got: ${res5.statusCode}`, res5.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: First submit as Owner (JE) successfully
    // -------------------------------------------------------------
    console.log('\n6. Testing first submit as Owner JE (Draft -> Submitted)...');
    const res6 = mockRes();
    await submitEstimate(req2, res6);

    if (res6.statusCode === 200 && res6.jsonData.success) {
      const est = res6.jsonData.estimate;
      const isDateValid = est.je_date && new Date(est.je_date).toString() !== 'Invalid Date';
      if (
        est.estimate_status === 'Submitted' &&
        est.estimate_revision === 1 &&
        Number(est.estimate_amount) === 4500.00 &&
        est.je_user_id === mobileJE_Owner &&
        isDateValid
      ) {
        console.log('   [PASS] First submit completed successfully, sets status, revision, je_user_id and je_date.');
        passes++;
      } else {
        console.log('   [FAIL] Incorrect estimate fields after submit:', est);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200, got: ${res6.statusCode}`, res6.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7a: Submit when status is already Submitted (should fail)
    // -------------------------------------------------------------
    console.log('\n7a. Testing submitEstimate when status is already Submitted...');
    const res7 = mockRes();
    await submitEstimate(req2, res7);

    if (res7.statusCode === 403 && res7.jsonData.message.includes('cannot be submitted')) {
      console.log('   [PASS] Blocked submit on already Submitted estimate.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 403, got: ${res7.statusCode}`, res7.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7b: Telegram alert failures are non-blocking
    // -------------------------------------------------------------
    console.log('\n7b. Testing that Telegram notification failure does not block estimate submission...');
    const telegramService = require('../../src/services/telegram.service');
    const originalNotify = telegramService.notifyZoEstimateSubmitted;

    // Stub to throw error
    telegramService.notifyZoEstimateSubmitted = async () => {
      throw new Error('Simulated Telegram Bot failure');
    };

    // Transition back to Draft to re-submit
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Draft', estimate_revision: 0 })
      .eq('estimate_id', createdEstimateId);

    const res7b = mockRes();
    await submitEstimate(req2, res7b);

    // Restore original method
    telegramService.notifyZoEstimateSubmitted = originalNotify;

    if (res7b.statusCode === 200 && res7b.jsonData.success) {
      console.log('   [PASS] Estimate submitted successfully despite Telegram failure.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 200, got: ${res7b.statusCode}`, res7b.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: ZO Resubmission Flow
    // -------------------------------------------------------------
    console.log('\n8. Testing ZO Resubmission Flow...');
    // Get original je_date to verify it is NOT overwritten
    const { data: beforeZoEst } = await supabase
      .from('project_cost_estimates')
      .select('je_date')
      .eq('estimate_id', createdEstimateId)
      .single();

    // 8a. Manually transition to ZO Revision Requested
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'ZO Revision Requested' })
      .eq('estimate_id', createdEstimateId);

    // 8b. Add a revision log entry (with correct columns)
    const logIdZO = crypto.randomUUID();
    const deadlineZO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { error: insertLogError } = await supabase.from('estimate_revision_log').insert({
      id: logIdZO,
      estimate_id: createdEstimateId,
      revision_cycle: 1,
      stage: 'ZO',
      requested_by: mobileZO,
      revision_deadline: deadlineZO
    });
    if (insertLogError) throw insertLogError;

    // 8c. Mark item as 'Not Approve'
    const { data: itemsZo } = await supabase
      .from('project_cost_estimate_items')
      .select('item_id')
      .eq('estimate_id', createdEstimateId);
    
    const itemId = itemsZo[0].item_id;

    await supabase
      .from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Not Approve' })
      .eq('item_id', itemId);

    // 8d. Submit estimate
    const res8 = mockRes();
    await submitEstimate(req2, res8);

    if (res8.statusCode === 200 && res8.jsonData.success) {
      const est = res8.jsonData.estimate;
      const { data: updatedItems } = await supabase
        .from('project_cost_estimate_items')
        .select('*')
        .eq('estimate_id', createdEstimateId);

      const { data: updatedLog } = await supabase
        .from('estimate_revision_log')
        .select('*')
        .eq('id', logIdZO)
        .single();

      const itemReset = updatedItems[0].zo_office_approve === null;
      const logClosed = updatedLog.resubmitted_at !== null && updatedLog.resubmitted_by === mobileJE_Owner;
      const logModifiedRecord =
        updatedLog.modified_item_ids &&
        updatedLog.modified_item_ids.length === 1 &&
        updatedLog.modified_item_ids[0] === itemId;
      const jeDatePreserved = new Date(est.je_date).getTime() === new Date(beforeZoEst.je_date).getTime();

      if (
        est.estimate_status === 'Submitted' &&
        est.estimate_revision === 2 &&
        itemReset &&
        logClosed &&
        logModifiedRecord &&
        jeDatePreserved &&
        est.je_user_id === mobileJE_Owner
      ) {
        console.log('   [PASS] ZO Resubmission successfully reset Not Approved item, closed log, recorded modified_item_ids (only the reset one), and preserved je_date/je_user_id.');
        passes++;
      } else {
        console.log('   [FAIL] ZO Resubmit assertion mismatch:', {
          status: est.estimate_status,
          revision: est.estimate_revision,
          itemReset,
          logClosed,
          logModifiedRecord,
          jeDatePreserved,
          je_user_id: est.je_user_id
        });
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200, got: ${res8.statusCode}`, res8.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 9a: HO Resubmission Flow (Admin submits resubmit)
    // -------------------------------------------------------------
    console.log('\n9a. Testing HO Resubmission Flow (Admin submits)...');
    // 9a.1. Manually transition to HO Revision Requested
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'HO Revision Requested' })
      .eq('estimate_id', createdEstimateId);

    // 9a.2. Add a revision log entry
    const logIdHO = crypto.randomUUID();
    const deadlineHO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertLogErrorHO } = await supabase.from('estimate_revision_log').insert({
      id: logIdHO,
      estimate_id: createdEstimateId,
      revision_cycle: 2,
      stage: 'HO',
      requested_by: mobileAdmin,
      revision_deadline: deadlineHO
    });
    if (insertLogErrorHO) throw insertLogErrorHO;

    // 9a.3. Set zo_office_approve = 'Approve' and ho_office_approve = 'Not Approve'
    await supabase
      .from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Approve', ho_office_approve: 'Not Approve' })
      .eq('item_id', itemId);

    // 9a.4. Submit estimate as Admin
    const req9 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileAdmin, role: 'admin' }
    };
    const res9 = mockRes();
    await submitEstimate(req9, res9);

    if (res9.statusCode === 200 && res9.jsonData.success) {
      const est = res9.jsonData.estimate;
      const { data: updatedItems } = await supabase
        .from('project_cost_estimate_items')
        .select('*')
        .eq('estimate_id', createdEstimateId);

      const { data: updatedLog } = await supabase
        .from('estimate_revision_log')
        .select('*')
        .eq('id', logIdHO)
        .single();

      const hoReset = updatedItems[0].ho_office_approve === null;
      const zoUntouched = updatedItems[0].zo_office_approve === 'Approve';
      const logClosed = updatedLog.resubmitted_at !== null && updatedLog.resubmitted_by === mobileAdmin;
      const jeDatePreserved = new Date(est.je_date).getTime() === new Date(beforeZoEst.je_date).getTime();

      if (
        est.estimate_status === 'Submitted' &&
        est.estimate_revision === 3 &&
        hoReset &&
        zoUntouched &&
        logClosed &&
        jeDatePreserved &&
        est.je_user_id === mobileJE_Owner
      ) {
        console.log('   [PASS] HO Resubmission successfully reset HO unapproved item, left ZO item untouched, closed log, and preserved je_date/je_user_id.');
        passes++;
      } else {
        console.log('   [FAIL] HO Resubmit assertion mismatch:', {
          status: est.estimate_status,
          revision: est.estimate_revision,
          hoReset,
          zoUntouched,
          logClosed,
          jeDatePreserved,
          je_user_id: est.je_user_id
        });
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200, got: ${res9.statusCode}`, res9.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 9b: Admin First Submit Flow
    // -------------------------------------------------------------
    console.log('\n9b. Testing first submit by an Admin user (Draft -> Submitted)...');
    
    activeWorkOrder2 = `TEST_WO_M4_ACTIVE2_${suffix}`;

    // Insert active project 2
    const { error: projError2 } = await supabase.from('projects_master').insert([
      {
        work_order_no: activeWorkOrder2,
        estimate_no: `EST_M4_2_${suffix}`,
        work_order_value: 1200000.00,
        site_details: 'Staging Site M4 2',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);
    if (projError2) throw projError2;

    // Create estimate 2
    const resCreate2 = mockRes();
    await createEstimate({
      user: { mobile_number: mobileAdmin, role: 'admin' },
      body: { work_order_no: activeWorkOrder2, zonal_office_no: 'ZO-10' }
    }, resCreate2);

    if (resCreate2.statusCode === 201) {
      createdEstimateId2 = resCreate2.jsonData.estimate.estimate_id;
      
      // Save valid draft items to estimate 2
      await saveDraftItems({
        params: { id: createdEstimateId2 },
        user: { mobile_number: mobileAdmin, role: 'admin' },
        body: {
          items: [{
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 5,
            rate: 500,
            rate_reference: 'Ref_Admin'
          }]
        }
      }, mockRes());

      // Submit as Admin
      const resAdminSubmit = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId2 },
        user: { mobile_number: mobileAdmin, role: 'admin' }
      }, resAdminSubmit);

      if (resAdminSubmit.statusCode === 200 && resAdminSubmit.jsonData.success) {
        const est2 = resAdminSubmit.jsonData.estimate;
        if (
          est2.estimate_status === 'Submitted' &&
          est2.estimate_revision === 1 &&
          est2.je_user_id === mobileAdmin
        ) {
          console.log('   [PASS] Admin completed first submit successfully.');
          passes++;
        } else {
          console.log('   [FAIL] Admin first submit estimate fields mismatch:', est2);
          fails++;
        }
      } else {
        console.log(`   [FAIL] Expected 200 for Admin first submit, got: ${resAdminSubmit.statusCode}`, resAdminSubmit.jsonData);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Failed to create Admin test estimate. Status: ${resCreate2.statusCode}`);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 10: RPC Defensive Gating - Invalid Workflow State
    // -------------------------------------------------------------
    console.log('\n10. Testing RPC Defensive Gating (Incorrect workflow state)...');
    // Currently, the first estimate is in 'Submitted' status. Calling RPC with stage ZO should fail.
    const { error: rpcErr10 } = await supabase.rpc('submit_estimate', {
      p_estimate_id: createdEstimateId,
      p_stage: 'ZO',
      p_mobile_number: mobileJE_Owner,
      p_new_revision: 4
    });

    if (rpcErr10 && rpcErr10.message.includes('Expected ZO Revision Requested')) {
      console.log('    [PASS] RPC successfully blocked submission from incorrect state (Submitted).');
      passes++;
    } else {
      console.log('    [FAIL] RPC allowed ZO submission from Submitted status or returned wrong error:', rpcErr10);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 11: RPC Defensive Gating - Missing Open Log (v_open_log_count = 0)
    // -------------------------------------------------------------
    console.log('\n11. Testing RPC Defensive Gating (No open revision log)...');
    // Set status to ZO Revision Requested but do not create any logs (all logs are closed)
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'ZO Revision Requested' })
      .eq('estimate_id', createdEstimateId);

    const { error: rpcErr11 } = await supabase.rpc('submit_estimate', {
      p_estimate_id: createdEstimateId,
      p_stage: 'ZO',
      p_mobile_number: mobileJE_Owner,
      p_new_revision: 4
    });

    if (rpcErr11 && rpcErr11.message.includes('Expected exactly one open revision log, found 0')) {
      console.log('    [PASS] RPC successfully blocked submission when no open logs exist.');
      passes++;
    } else {
      console.log('    [FAIL] RPC did not throw correct exception on zero open logs:', rpcErr11);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 12: RPC Defensive Gating - Duplicate Open Logs (v_open_log_count = 2)
    // -------------------------------------------------------------
    console.log('\n12. Testing RPC Defensive Gating (Multiple open revision logs)...');
    // Insert two open logs
    const dupLog1 = crypto.randomUUID();
    const dupLog2 = crypto.randomUUID();
    
    const { error: insertDupErr } = await supabase.from('estimate_revision_log').insert([
      { id: dupLog1, estimate_id: createdEstimateId, revision_cycle: 3, stage: 'ZO', requested_by: mobileZO, revision_deadline: deadlineZO },
      { id: dupLog2, estimate_id: createdEstimateId, revision_cycle: 3, stage: 'ZO', requested_by: mobileZO, revision_deadline: deadlineZO }
    ]);
    if (insertDupErr) throw insertDupErr;

    const { error: rpcErr12 } = await supabase.rpc('submit_estimate', {
      p_estimate_id: createdEstimateId,
      p_stage: 'ZO',
      p_mobile_number: mobileJE_Owner,
      p_new_revision: 4
    });

    if (rpcErr12 && rpcErr12.message.includes('Expected exactly one open revision log, found 2')) {
      console.log('    [PASS] RPC successfully blocked submission when duplicate open logs exist.');
      passes++;
    } else {
      console.log('    [FAIL] RPC did not throw correct exception on multiple open logs:', rpcErr12);
      fails++;
    }

    // Reset database status to Draft for clean deletions
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Draft' })
      .eq('estimate_id', createdEstimateId);

    if (createdEstimateId2) {
      await supabase
        .from('project_cost_estimates')
        .update({ estimate_status: 'Draft' })
        .eq('estimate_id', createdEstimateId2);
    }

  } catch (err) {
    console.error('Unexpected test exception:', err);
    fails++;
  } finally {
    console.log('\nCleaning up verification records...');
    try {
      if (createdEstimateId) {
        // Delete logs first due to FK constraints
        await supabase.from('estimate_revision_log').delete().eq('estimate_id', createdEstimateId);
        await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId);
        // Delete estimate header (allowed since work_order_no LIKE 'TEST_WO_%')
        await supabase.from('project_cost_estimates').delete().eq('estimate_id', createdEstimateId);
      }
      if (createdEstimateId2) {
        await supabase.from('estimate_revision_log').delete().eq('estimate_id', createdEstimateId2);
        await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId2);
        await supabase.from('project_cost_estimates').delete().eq('estimate_id', createdEstimateId2);
      }
      if (insertedMaterialIds.length > 0) {
        await supabase.from('material_master').delete().in('id', insertedMaterialIds);
      }
      // Delete projects master rows
      await supabase.from('projects_master').delete().eq('work_order_no', activeWorkOrder);
      if (activeWorkOrder2) {
        await supabase.from('projects_master').delete().eq('work_order_no', activeWorkOrder2);
      }
      await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_Owner, mobileJE_Other, mobileZO, mobileAdmin]);
      console.log('   Cleanup done.');
    } catch (cleanupErr) {
      console.warn('   Cleanup error:', cleanupErr.message);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE 4 TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME TESTS FAILED. <<<');
    process.exit(1);
  }
}

testMilestone4();
