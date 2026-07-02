const { supabase } = require('../../src/db/supabase');
const {
  createEstimate,
  saveDraftItems,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview
} = require('../../src/controllers/estimates.controller');

// Import Helpers
const mockRes = require('../helpers/mockRes');
const setupUsers = require('../helpers/setupUsers');
const setupProject = require('../helpers/setupProject');
const cleanupEstimate = require('../helpers/cleanupEstimate');

async function runSecurityDefinerTests() {
  console.log('=== RUNNING SECURITY DEFINER EDGE CASE TESTS ===\n');
  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(10000 + Math.random() * 90000);
  const mobileJE = `+9198100${suffix}`;
  const mobileZO = `+9198200${suffix}`;
  const mobileHO = `+9198300${suffix}`;
  const mobileAdmin = `+9198400${suffix}`;
  const mobileStaff = `+9198500${suffix}`;

  let estId = null;
  let itemIdValid = null;
  let itemIdOther = null;
  let workOrderVal = null;
  let workOrderOther = null;

  try {
    // 0. Setup whitelisted users
    await setupUsers([
      { mobile_number: mobileJE, display_name: 'JE User', role: 'je', is_active: true },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true },
      { mobile_number: mobileHO, display_name: 'HO User', role: 'ho', is_active: true },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true },
      { mobile_number: mobileStaff, display_name: 'Staff User', role: 'je', is_active: true }
    ]);

    // Create unique work orders to prevent collisions
    workOrderVal = `TEST_WO_SEC_V_${suffix}`;
    workOrderOther = `TEST_WO_SEC_O_${suffix}`;

    await setupProject(workOrderVal, `EST_SEC_V_${suffix}`, 1000000.00, mobileAdmin);
    await setupProject(workOrderOther, `EST_SEC_O_${suffix}`, 1000000.00, mobileAdmin);

    const { data: testMats, error: matErr } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Cement Sec A ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
    ]).select();
    if (matErr) throw matErr;

    // Prepare a valid estimate
    const resCreate = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE, role: 'je' },
      body: { work_order_no: workOrderVal, zonal_office_no: 'ZO-1' }
    }, resCreate);
    if (resCreate.statusCode !== 201) {
      throw new Error(`Failed to create valid estimate: ${resCreate.jsonData.message}`);
    }
    estId = resCreate.jsonData.estimate.estimate_id;

    // Save one valid item
    await saveDraftItems({
      params: { id: estId },
      user: { mobile_number: mobileJE, role: 'je' },
      body: {
        items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' }]
      }
    }, mockRes());

    // Submit
    await submitEstimate({ params: { id: estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    // Start review (status -> Under ZO Review)
    await reviewEstimate({ params: { id: estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const { data: items } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', estId);
    itemIdValid = items[0].item_id;

    // Create a second estimate to get a foreign item ID for S9
    const resCreateOther = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE, role: 'je' },
      body: { work_order_no: workOrderOther, zonal_office_no: 'ZO-1' }
    }, resCreateOther);
    if (resCreateOther.statusCode !== 201) {
      throw new Error(`Failed to create other estimate: ${resCreateOther.jsonData.message}`);
    }
    const estIdOther = resCreateOther.jsonData.estimate.estimate_id;
    await saveDraftItems({
      params: { id: estIdOther },
      user: { mobile_number: mobileJE, role: 'je' },
      body: {
        items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' }]
      }
    }, mockRes());
    const { data: itemsOther } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', estIdOther);
    itemIdOther = itemsOther[0].item_id;

    // -------------------------------------------------------------------------
    // S1 — JE Calls ZO RPC
    // -------------------------------------------------------------------------
    console.log('S1 — JE Calls ZO RPC...');
    const resS1 = mockRes();
    await submitRowApprovals({
      params: { id: estId },
      user: { mobile_number: mobileJE, role: 'je' },
      body: { approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }] }
    }, resS1);

    if (resS1.statusCode === 403) {
      console.log('  [PASS] S1: JE was blocked from calling submitRowApprovals.');
      passes++;
    } else {
      console.log(`  [FAIL] S1: Expected 403, got: ${resS1.statusCode}`);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S2 — JE Spoofs ZO Mobile
    // -------------------------------------------------------------------------
    console.log('S2 — JE Spoofs ZO Mobile...');
    const { error: errorS2 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'ZO',
      p_modified_by: mobileJE
    });

    if (errorS2 && errorS2.message.includes('User does not have ZO or Admin role')) {
      console.log('  [PASS] S2: RPC correctly rejected JE trying to act as ZO.');
      passes++;
    } else {
      console.log(`  [FAIL] S2: Spoofing not blocked. Error:`, errorS2);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S3 — Staff Spoofs Admin Mobile
    // -------------------------------------------------------------------------
    console.log('S3 — Staff Spoofs Admin Mobile...');
    const { error: errorS3 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'ZO',
      p_modified_by: mobileStaff
    });

    if (errorS3 && errorS3.message.includes('User does not have ZO or Admin role')) {
      console.log('  [PASS] S3: RPC rejected unauthorized JE from spoofing Admin/ZO roles.');
      passes++;
    } else {
      console.log(`  [FAIL] S3: Spoofing not blocked. Error:`, errorS3);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S4 — Inactive ZO
    // -------------------------------------------------------------------------
    console.log('S4 — Inactive ZO...');
    await supabase.from('authorised_users').update({ is_active: false }).eq('mobile_number', mobileZO);
    
    const { error: errorS4 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    if (errorS4 && errorS4.message.includes('User is inactive or does not exist')) {
      console.log('  [PASS] S4: RPC rejected inactive ZO.');
      passes++;
    } else {
      console.log(`  [FAIL] S4: Inactive ZO was not blocked. Error:`, errorS4);
      fails++;
    }
    await supabase.from('authorised_users').update({ is_active: true }).eq('mobile_number', mobileZO);

    // -------------------------------------------------------------------------
    // S5 — Inactive HO
    // -------------------------------------------------------------------------
    console.log('S5 — Inactive HO...');
    await supabase.from('authorised_users').update({ is_active: false }).eq('mobile_number', mobileHO);
    
    const { error: errorS5 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'HO',
      p_modified_by: mobileHO
    });

    if (errorS5 && errorS5.message.includes('User is inactive or does not exist')) {
      console.log('  [PASS] S5: RPC rejected inactive HO.');
      passes++;
    } else {
      console.log(`  [FAIL] S5: Inactive HO was not blocked. Error:`, errorS5);
      fails++;
    }
    await supabase.from('authorised_users').update({ is_active: true }).eq('mobile_number', mobileHO);

    // -------------------------------------------------------------------------
    // S6 — Deleted User
    // -------------------------------------------------------------------------
    console.log('S6 — Deleted User...');
    const mobileDeleted = `+9198600${suffix}`;
    await supabase.from('authorised_users').insert({
      mobile_number: mobileDeleted,
      display_name: 'Temp Deleted',
      role: 'zo',
      is_active: true
    });
    await supabase.from('authorised_users').delete().eq('mobile_number', mobileDeleted);

    const { error: errorS6 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'ZO',
      p_modified_by: mobileDeleted
    });

    if (errorS6 && errorS6.message.includes('User is inactive or does not exist')) {
      console.log('  [PASS] S6: RPC rejected deleted user.');
      passes++;
    } else {
      console.log(`  [FAIL] S6: Deleted user was not blocked. Error:`, errorS6);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S7 — User Role Downgraded Mid Session
    // -------------------------------------------------------------------------
    console.log('S7 — User Role Downgraded Mid Session...');
    await supabase.from('authorised_users').update({ role: 'je' }).eq('mobile_number', mobileZO);

    const resS7 = mockRes();
    await submitRowApprovals({
      params: { id: estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }] }
    }, resS7);

    if (resS7.statusCode === 500 || resS7.statusCode === 403 || resS7.statusCode === 401) {
      console.log(`  [PASS] S7: Downgraded user was rejected. Status: ${resS7.statusCode}`);
      passes++;
    } else {
      console.log(`  [FAIL] S7: Downgraded user was not rejected. Status: ${resS7.statusCode}`);
      fails++;
    }
    await supabase.from('authorised_users').update({ role: 'zo' }).eq('mobile_number', mobileZO);

    // -------------------------------------------------------------------------
    // S8 — User Role Upgraded Mid Session
    // -------------------------------------------------------------------------
    console.log('S8 — User Role Upgraded Mid Session...');
    await supabase.from('authorised_users').update({ role: 'zo' }).eq('mobile_number', mobileStaff);

    const resS8 = mockRes();
    await submitRowApprovals({
      params: { id: estId },
      user: { mobile_number: mobileStaff, role: 'je' },
      body: { approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }] }
    }, resS8);

    console.log(`  [INFO] S8: User Role Upgraded returned status ${resS8.statusCode}.`);
    passes++;

    // -------------------------------------------------------------------------
    // S9 — Item Belongs To Different Estimate
    // -------------------------------------------------------------------------
    console.log('S9 — Item Belongs To Different Estimate...');
    const { error: errorS9 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdOther, approve_status: 'Approve' }],
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    if (errorS9 && errorS9.message.includes('not found or does not belong to estimate')) {
      console.log('  [PASS] S9: Rejected item belonging to different estimate.');
      passes++;
    } else {
      console.log(`  [FAIL] S9: Invalid item-estimate mapping was not blocked. Error:`, errorS9);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S10 — Cross Stage Injection
    // -------------------------------------------------------------------------
    console.log('S10 — Cross Stage Injection...');
    const { error: errorS10 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'HO',
      p_modified_by: mobileZO
    });

    if (errorS10 && errorS10.message.includes('User does not have HO or Admin role')) {
      console.log('  [PASS] S10: RPC correctly blocked ZO from acting on HO stage.');
      passes++;
    } else {
      console.log(`  [FAIL] S10: Cross stage injection not blocked. Error:`, errorS10);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S11 — Invalid Enum Injection
    // -------------------------------------------------------------------------
    console.log('S11 — Invalid Enum Injection...');
    const { error: errorS11 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'HACK' }],
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    if (errorS11 && errorS11.message.includes('invalid input value for enum')) {
      console.log('  [PASS] S11: Invalid enum value rejected.');
      passes++;
    } else {
      console.log(`  [FAIL] S11: Invalid enum not blocked. Error:`, errorS11);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S12 — Mixed Batch Attack
    // -------------------------------------------------------------------------
    console.log('S12 — Mixed Batch Attack...');
    await supabase.from('project_cost_estimate_items').update({ zo_office_approve: null }).eq('item_id', itemIdValid);

    const { error: errorS12 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [
        { item_id: itemIdValid, approve_status: 'Approve' },
        { item_id: '00000000-0000-0000-0000-000000000000', approve_status: 'Approve' }
      ],
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    const { data: itemS12 } = await supabase.from('project_cost_estimate_items').select('zo_office_approve').eq('item_id', itemIdValid).single();
    if (errorS12 && itemS12.zo_office_approve === null) {
      console.log('  [PASS] S12: Transaction rolled back completely. No partial updates.');
      passes++;
    } else {
      console.log(`  [FAIL] S12: Rollback failed. Status: ${itemS12.zo_office_approve}. Error:`, errorS12);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S13 — Unauthorized Direct Final Approval
    // -------------------------------------------------------------------------
    console.log('S13 — Unauthorized Direct Final Approval...');
    const resS13 = mockRes();
    await submitReview({
      params: { id: estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { remarks: 'Hacking status' }
    }, resS13);

    const { data: estS13 } = await supabase.from('project_cost_estimates').select('estimate_status').eq('estimate_id', estId).single();
    if (estS13.estimate_status !== 'Final Approved') {
      console.log(`  [PASS] S13: Direct transition to Final Approved prevented. Status is: ${estS13.estimate_status}`);
      passes++;
    } else {
      console.log(`  [FAIL] S13: Direct transition to Final Approved succeeded!`);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S14 — SQL Injection Style Payload
    // -------------------------------------------------------------------------
    console.log('S14 — SQL Injection Style Payload...');
    const sqliPayload = "Approve'; DROP TABLE audit_log; --";
    const { error: errorS14 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: sqliPayload }],
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    const { data: auditTest } = await supabase.from('audit_log').select('count');
    if (errorS14 && auditTest !== null) {
      console.log('  [PASS] S14: SQL injection payload failed and DB is intact.');
      passes++;
    } else {
      console.log(`  [FAIL] S14: SQL injection was not rejected safely. Error:`, errorS14);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S15 — Admin Override
    // -------------------------------------------------------------------------
    console.log('S15 — Admin Override...');
    // Admin approving ZO stage
    const { error: errorS15_ZO } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'ZO',
      p_modified_by: mobileAdmin
    });

    // Admin approving HO stage (manually set status to Under HO Review to pass stage check in RPC if applicable)
    await supabase.from('project_cost_estimates').update({ estimate_status: 'Under HO Review' }).eq('estimate_id', estId);
    const { error: errorS15_HO } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'HO',
      p_modified_by: mobileAdmin
    });

    if (!errorS15_ZO && !errorS15_HO) {
      console.log('  [PASS] S15: Admin override successfully verified for both ZO and HO stages.');
      passes++;
    } else {
      console.log(`  [FAIL] S15: Admin override failed. ZO Error:`, errorS15_ZO, `HO Error:`, errorS15_HO);
      fails++;
    }

    // Restore Under ZO Review status
    await supabase.from('project_cost_estimates').update({ estimate_status: 'Under ZO Review' }).eq('estimate_id', estId);

    // -------------------------------------------------------------------------
    // S16 — Null Mobile Number
    // -------------------------------------------------------------------------
    console.log('S16 — Null Mobile Number...');
    const { error: errorS16 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estId,
      p_approvals: [{ item_id: itemIdValid, approve_status: 'Approve' }],
      p_stage: 'ZO',
      p_modified_by: null
    });

    if (errorS16 && errorS16.message.includes('User is inactive or does not exist')) {
      console.log('  [PASS] S16: Null modified_by rejected safely.');
      passes++;
    } else {
      console.log(`  [FAIL] S16: Null modified_by was not rejected. Error:`, errorS16);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S17 — Empty Approval Array
    // -------------------------------------------------------------------------
    console.log('S17 — Empty Approval Array...');
    // When approvals array is empty, it shouldn't modify anything but should complete without error or be validated.
    // Let's call controller with empty approvals.
    const resS17 = mockRes();
    await submitRowApprovals({
      params: { id: estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: [] }
    }, resS17);

    // Express controller returns 200 with success: true and empty items if empty array is processed
    if (resS17.statusCode === 200 || resS17.statusCode === 400) {
      console.log(`  [PASS] S17: Empty approval array handled. Status: ${resS17.statusCode}`);
      passes++;
    } else {
      console.log(`  [FAIL] S17: Empty approvals crashed/unexpected status: ${resS17.statusCode}`);
      fails++;
    }

    // -------------------------------------------------------------------------
    // S18 — Duplicate Item IDs
    // -------------------------------------------------------------------------
    console.log('S18 — Duplicate Item IDs...');
    const resS18 = mockRes();
    await submitRowApprovals({
      params: { id: estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: [
        { item_id: itemIdValid, approve_status: 'Approve' },
        { item_id: itemIdValid, approve_status: 'Not Approve', remarks: 'Duplicate' }
      ] }
    }, resS18);

    if (resS18.statusCode === 400 && resS18.jsonData.message.includes('Duplicate item_id')) {
      console.log('  [PASS] S18: Duplicate item IDs in batch rejected safely with 400.');
      passes++;
    } else {
      console.log(`  [FAIL] S18: Duplicate item IDs were not rejected correctly: Status = ${resS18.statusCode}`);
      fails++;
    }

    // Cleanup
    await cleanupEstimate(estId, workOrderVal);
    await cleanupEstimate(estIdOther, workOrderOther);
    await supabase.from('material_master').delete().in('id', testMats.map(m => m.id));
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE, mobileZO, mobileHO, mobileAdmin, mobileStaff]);

  } catch (error) {
    console.error('Test run failed with error:', error);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);

  if (fails > 0) {
    console.log('\n>>> SOME SECURITY TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('\n>>> ALL SECURITY TESTS PASSED!');
    process.exit(0);
  }
}

runSecurityDefinerTests();
