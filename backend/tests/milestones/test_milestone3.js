const { supabase } = require('../../src/db/supabase');
const {
  createEstimate,
  saveDraftItems,
  getEstimates,
  getEstimateById
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

async function testMilestone3() {
  console.log('=== RUNNING MILESTONE 3 BACKEND TESTS ===\n');

  let passes = 0;
  let fails = 0;

  // Generate unique suffix for test isolation
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const activeWorkOrder = `TEST_WO_M3_ACTIVE_${suffix}`;
  const activeWorkOrder2 = `TEST_WO_M3_ACTIVE2_${suffix}`;
  const closedWorkOrder = `TEST_WO_M3_CLOSED_${suffix}`;

  const mobileJE_A = `+91900000${suffix}`;
  const mobileJE_B = `+91911111${suffix}`;
  const mobileZO = `+91922222${suffix}`;
  const mobileAdmin = `+91933333${suffix}`;

  let createdEstimateId = null;
  let createdEstimateId2 = null;
  const insertedMaterialIds = [];

  try {
    // 0. Setup: Clean up and insert test records
    console.log('0. Setting up isolated test records...');

    // Delete existing records to avoid conflict (only delete projects without FK dependencies first, i.e. users, materials, and non-referenced projects)
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_A, mobileJE_B, mobileZO, mobileAdmin]);

    // Insert Users
    const { error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: mobileJE_A, display_name: 'JE User A', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileJE_B, display_name: 'JE User B', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true, permissions: {} }
    ]);
    if (userError) throw userError;

    // Insert Projects
    const { error: projError } = await supabase.from('projects_master').insert([
      {
        work_order_no: activeWorkOrder,
        estimate_no: `EST_M3_A_${suffix}`,
        work_order_value: 1000000.00,
        site_details: 'Staging Site A',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      },
      {
        work_order_no: activeWorkOrder2,
        estimate_no: `EST_M3_A2_${suffix}`,
        work_order_value: 1200000.00,
        site_details: 'Staging Site A2',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      },
      {
        work_order_no: closedWorkOrder,
        estimate_no: `EST_M3_B_${suffix}`,
        work_order_value: 2000000.00,
        site_details: 'Staging Site B',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Closed',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);
    if (projError) throw projError;

    // Dynamically insert 4 test materials to ensure unit validation passes cleanly
    const { data: testMats, error: matsError } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Labour', Material_Sub_Head: 'Skilled', Material_Details: `Test Labour ${suffix}`, M_Unit: 'Day', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Transport', Material_Sub_Head: 'Local', Material_Details: `Test Transport ${suffix}`, M_Unit: 'Nos', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Miscellaneous', Material_Sub_Head: 'Misc', Material_Details: `Test Misc ${suffix}`, M_Unit: 'Nos', is_active: true, created_by: mobileAdmin }
    ]).select();

    if (matsError) throw matsError;
    if (testMats) {
      testMats.forEach(m => insertedMaterialIds.push(m.id));
    }

    console.log('   Test records inserted successfully.');

    // 1a. createEstimate on Closed project (should return 403)
    console.log('\n1a. Testing createEstimate on a Closed project...');
    const req1a = {
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: { work_order_no: closedWorkOrder, zonal_office_no: 'ZO-10' }
    };
    const res1a = mockRes();
    await createEstimate(req1a, res1a);

    if (res1a.statusCode === 403 && res1a.jsonData.message.includes('Closed')) {
      console.log('   [PASS] createEstimate rejected closed project correctly.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 403, got: ${res1a.statusCode}`, res1a.jsonData);
      fails++;
    }

    // 1b. createEstimate on Non-existent project (should return 404)
    console.log('\n1b. Testing createEstimate on a non-existent project...');
    const req1b = {
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: { work_order_no: `NON_EXISTENT_WO_${suffix}`, zonal_office_no: 'ZO-10' }
    };
    const res1b = mockRes();
    await createEstimate(req1b, res1b);

    if (res1b.statusCode === 404 && res1b.jsonData.message.includes('Project not found')) {
      console.log('   [PASS] createEstimate rejected non-existent project correctly.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 404, got: ${res1b.statusCode}`, res1b.jsonData);
      fails++;
    }

    // 2. createEstimate with blank zonal_office_no (should return 400)
    console.log('\n2. Testing createEstimate with blank/whitespace zonal_office_no...');
    const req2 = {
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: { work_order_no: activeWorkOrder, zonal_office_no: '   ' }
    };
    const res2 = mockRes();
    await createEstimate(req2, res2);

    if (res2.statusCode === 400 && res2.jsonData.message.includes('zonal_office_no')) {
      console.log('   [PASS] createEstimate rejected blank zonal_office_no correctly.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 400, got: ${res2.statusCode}`, res2.jsonData);
      fails++;
    }

    // 3. createEstimate with valid active project (should return 201)
    console.log('\n3. Testing createEstimate with valid active project (asserting auto-populated fields)...');
    const req3 = {
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: { work_order_no: activeWorkOrder, zonal_office_no: 'ZO-10', je_remarks: 'First draft remarks' }
    };
    const res3 = mockRes();
    await createEstimate(req3, res3);

    if (res3.statusCode === 201 && res3.jsonData.success && res3.jsonData.estimate) {
      createdEstimateId = res3.jsonData.estimate.estimate_id;
      const est = res3.jsonData.estimate;

      const autoPopulatedOk =
        est.estimate_no === `EST_M3_A_${suffix}` &&
        est.area_code === 'Kolkata Zone' &&
        est.estimate_revision === 0 &&
        est.estimate_status === 'Draft';

      if (autoPopulatedOk) {
        console.log(`   [PASS] createEstimate created estimate correctly with auto-populated fields. ID: ${createdEstimateId}`);
        passes++;
      } else {
        console.log(`   [FAIL] Field auto-population failed:`, est);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 201, got: ${res3.statusCode}`, res3.jsonData);
      fails++;
    }

    // Create a second estimate (for ordering and sorting tests later)
    const req3b = {
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: { work_order_no: activeWorkOrder2, zonal_office_no: 'ZO-10', je_remarks: 'Second draft remarks' }
    };
    const res3b = mockRes();
    await createEstimate(req3b, res3b);
    if (res3b.statusCode === 201 && res3b.jsonData.estimate) {
      createdEstimateId2 = res3b.jsonData.estimate.estimate_id;
    }

    // 4. createEstimate duplicate gate (should return 409)
    console.log('\n4. Testing createEstimate duplicate gate for active work order...');
    const req4 = {
      user: { mobile_number: mobileJE_B, role: 'je' },
      body: { work_order_no: activeWorkOrder, zonal_office_no: 'ZO-12' }
    };
    const res4 = mockRes();
    await createEstimate(req4, res4);

    if (res4.statusCode === 409 && res4.jsonData.message.includes('active estimate already exists')) {
      console.log('   [PASS] createEstimate duplicate gate blocked second active estimate correctly.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 409, got: ${res4.statusCode}`, res4.jsonData);
      fails++;
    }

    // 5a. saveDraftItems unit mismatch (should return 400)
    console.log('\n5a. Testing saveDraftItems unit validation check...');
    const req5a = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: {
        items: [
          {
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Kg', // Cement is dynamically inserted with unit 'Bag'
            qty: 10,
            rate: 450,
            rate_reference: 'Contract Price'
          }
        ]
      }
    };
    const res5a = mockRes();
    await saveDraftItems(req5a, res5a);

    if (res5a.statusCode === 400 && res5a.jsonData.message.includes('Unit mismatch')) {
      console.log('   [PASS] saveDraftItems rejected unit mismatch correctly.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 400, got: ${res5a.statusCode}`, res5a.jsonData);
      fails++;
    }

    // 5b. saveDraftItems negative validation check (should return 400)
    console.log('\n5b. Testing saveDraftItems negative quantity and rate validation...');
    const req5b = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: {
        items: [
          {
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: -1,
            rate: 450,
            rate_reference: 'Contract Price'
          }
        ]
      }
    };
    const res5b = mockRes();
    await saveDraftItems(req5b, res5b);

    const req5c = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: {
        items: [
          {
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 1,
            rate: -450,
            rate_reference: 'Contract Price'
          }
        ]
      }
    };
    const res5c = mockRes();
    await saveDraftItems(req5c, res5c);

    if (res5b.statusCode === 400 && res5c.statusCode === 400) {
      console.log('   [PASS] saveDraftItems successfully blocked negative quantity and rate.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 400 for negative inputs. Qty: ${res5b.statusCode}, Rate: ${res5c.statusCode}`);
      fails++;
    }

    // 6. saveDraftItems valid items saving & client-side amount override check
    console.log('\n6. Testing saveDraftItems with valid items (assert amount auto-calculated & UUID scan)...');
    const req6 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: {
        items: [
          {
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 10,
            rate: 450,
            rate_reference: 'Contract Price',
            amount: 9999.00 // Mismatched
          },
          {
            material_main_head: 'Labour',
            material_sub_head: 'Skilled',
            material_details: `Test Labour ${suffix}`,
            unit: 'Day',
            qty: 5,
            rate: 500,
            rate_reference: 'Rate Contract'
          }
        ]
      }
    };

    const res6 = mockRes();
    await saveDraftItems(req6, res6);

    if (res6.statusCode === 200 && res6.jsonData.success && res6.jsonData.items.length === 2) {
      const savedItems = res6.jsonData.items;
      const expectedAmount0 = Math.round(req6.body.items[0].qty * req6.body.items[0].rate * 100) / 100;
      const expectedAmount1 = Math.round(req6.body.items[1].qty * req6.body.items[1].rate * 100) / 100;

      const amt0Pass = Number(savedItems[0].amount) === expectedAmount0;
      const amt1Pass = Number(savedItems[1].amount) === expectedAmount1;
      const uuidGenerated = savedItems[0].item_id && savedItems[1].item_id && savedItems[0].item_id !== savedItems[1].item_id;

      if (amt0Pass && amt1Pass && uuidGenerated) {
        console.log('   [PASS] saveDraftItems successfully saved items, calculated amount, and scanned UUIDs.');
        passes++;
      } else {
        console.log(`   [FAIL] Item checks failed. amt0Pass: ${amt0Pass}, amt1Pass: ${amt1Pass}, uuidGenerated: ${uuidGenerated}. Items:`, savedItems);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200, got: ${res6.statusCode}`, res6.jsonData);
      fails++;
    }

    // 7. saveDraftItems ownership gate (unauthorized JE_B tries to modify JE_A's draft)
    console.log('\n7. Testing saveDraftItems ownership gating...');
    const req7 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_B, role: 'je' },
      body: { items: [] }
    };
    const res7 = mockRes();
    await saveDraftItems(req7, res7);

    if (res7.statusCode === 403 && res7.jsonData.message.includes('Access denied')) {
      console.log('   [PASS] saveDraftItems blocked unauthorized ownership correctly.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 403, got: ${res7.statusCode}`, res7.jsonData);
      fails++;
    }

    // 8. getEstimateById role-based visibility gating
    console.log('\n8. Testing getEstimateById role gating...');
    const res8a = mockRes();
    await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileJE_A, role: 'je' } }, res8a);

    const res8b = mockRes();
    await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileJE_B, role: 'je' } }, res8b);

    const res8c = mockRes();
    await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, res8c);

    const res8d = mockRes();
    await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileAdmin, role: 'admin' } }, res8d);

    const gatePass = res8a.statusCode === 200 && res8b.statusCode === 404 && res8c.statusCode === 404 && res8d.statusCode === 200;

    if (gatePass) {
      console.log('   [PASS] getEstimateById visibility gating matches spec role filters.');
      passes++;
    } else {
      console.log(`   [FAIL] Gating check failed: A=${res8a.statusCode}, B=${res8b.statusCode}, ZO=${res8c.statusCode}, Admin=${res8d.statusCode}`);
      fails++;
    }

    // 9a. getEstimates role filters & list pagination/sorting/admin checks
    console.log('\n9a. Testing getEstimates role filters, sorting, and Admin list access...');
    const res9a = mockRes();
    await getEstimates({ query: {}, user: { mobile_number: mobileJE_A, role: 'je' } }, res9a);

    const res9b = mockRes();
    await getEstimates({ query: {}, user: { mobile_number: mobileJE_B, role: 'je' } }, res9b);

    const res9c = mockRes();
    await getEstimates({ query: {}, user: { mobile_number: mobileZO, role: 'zo' } }, res9c);

    const res9d = mockRes();
    await getEstimates({ query: {}, user: { mobile_number: mobileAdmin, role: 'admin' } }, res9d);

    const hasA = res9a.jsonData.estimates.some(e => e.estimate_id === createdEstimateId);
    const hasA2 = res9a.jsonData.estimates.some(e => e.estimate_id === createdEstimateId2);
    const hasB = res9b.jsonData.estimates.some(e => e.estimate_id === createdEstimateId);
    const hasZO = res9c.jsonData.estimates.some(e => e.estimate_id === createdEstimateId);
    const hasAdmin = res9d.jsonData.estimates.some(e => e.estimate_id === createdEstimateId);

    // Verify sorting (most recently updated should be first)
    const listEstimates = res9a.jsonData.estimates.filter(e => [createdEstimateId, createdEstimateId2].includes(e.estimate_id));
    let sortingOk = false;
    if (listEstimates.length >= 2) {
      const idx1 = res9a.jsonData.estimates.findIndex(e => e.estimate_id === createdEstimateId);
      const idx2 = res9a.jsonData.estimates.findIndex(e => e.estimate_id === createdEstimateId2);
      // Since createdEstimateId was updated after createdEstimateId2 creation, it should appear earlier (lower index)
      sortingOk = idx1 < idx2;
    } else {
      sortingOk = true;
    }

    const listPass = hasA && hasA2 && !hasB && !hasZO && hasAdmin && sortingOk;

    if (listPass) {
      console.log('   [PASS] getEstimates lists filtered correct estimates per role, verified Admin access, and validated ordering.');
      passes++;
    } else {
      console.log(`   [FAIL] Filters/Sorting checks failed: JE_A has A: ${hasA}, has A2: ${hasA2}, JE_B has A: ${hasB}, ZO has A: ${hasZO}, Admin has A: ${hasAdmin}, sortingOk: ${sortingOk}`);
      fails++;
    }

    // 9b. getEstimates pagination cap test
    console.log('\n9b. Testing getEstimates pagination limit cap at 100...');
    const res9e = mockRes();
    await getEstimates({ query: { limit: 105 }, user: { mobile_number: mobileAdmin, role: 'admin' } }, res9e);

    if (res9e.statusCode === 200 && res9e.jsonData.pagination.limit === 100) {
      console.log('   [PASS] getEstimates correctly capped limit parameter to 100.');
      passes++;
    } else {
      console.log(`   [FAIL] Limit capping failed. Returned limit: ${res9e.jsonData?.pagination?.limit}`);
      fails++;
    }

    // 10. getEstimateById dynamic summary category mapping
    console.log('\n10. Testing getEstimateById dynamic summary category mapping...');
    const req10 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: {
        items: [
          {
            material_main_head: 'Labour',
            material_sub_head: 'Skilled',
            material_details: `Test Labour ${suffix}`,
            unit: 'Day',
            qty: 2,
            rate: 200 // 400
          },
          {
            material_main_head: 'Transport',
            material_sub_head: 'Local',
            material_details: `Test Transport ${suffix}`,
            unit: 'Nos',
            qty: 1,
            rate: 150 // 150
          },
          {
            material_main_head: 'Miscellaneous',
            material_sub_head: 'Misc',
            material_details: `Test Misc ${suffix}`,
            unit: 'Nos',
            qty: 1,
            rate: 250 // 250
          },
          {
            material_main_head: 'Raw Materials', // maps to gross_material_cost
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 10,
            rate: 100 // 1000
          }
        ]
      }
    };
    const res10_save = mockRes();
    await saveDraftItems(req10, res10_save);

    if (res10_save.statusCode !== 200) {
      throw new Error(`Failed to save draft items in Test 10: ${res10_save.jsonData?.message}`);
    }

    const res10_get = mockRes();
    await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileJE_A, role: 'je' } }, res10_get);

    if (res10_get.statusCode === 200 && res10_get.jsonData.success) {
      const summary = res10_get.jsonData.summary;
      const labPass = Number(summary.gross_labour_cost) === 400;
      const trnPass = Number(summary.gross_transport_cost) === 150;
      const mscPass = Number(summary.gross_misc_cost) === 250;
      const matPass = Number(summary.gross_material_cost) === 1000;
      const totPass = Number(summary.gross_total) === 1800;
      const apvPass = Number(summary.approved_grand_total) === 1800;

      if (labPass && trnPass && mscPass && matPass && totPass && apvPass) {
        console.log('   [PASS] getEstimateById summary dynamic category mapping verified.');
        passes++;
      } else {
        console.log(`   [FAIL] Summary mapping mismatch:`, summary);
        fails++;
      }
    } else {
      console.log(`   [FAIL] getEstimateById failed on fetch. Status: ${res10_get.statusCode}`);
      fails++;
    }

    // 11. Empty item array safety & recalculation to 0 test
    console.log('\n11. Testing saveDraftItems with empty payload (items: [])...');
    const req11 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: { items: [] }
    };
    const res11 = mockRes();
    await saveDraftItems(req11, res11);

    if (res11.statusCode === 200 && res11.jsonData.success && res11.jsonData.items.length === 0) {
      const { data: finalHeader } = await supabase
        .from('project_cost_estimates')
        .select('estimate_amount')
        .eq('estimate_id', createdEstimateId)
        .single();

      if (finalHeader && Number(finalHeader.estimate_amount) === 0) {
        console.log('   [PASS] saveDraftItems with empty items array successfully removed items and recalculated amount to 0.');
        passes++;
      } else {
        console.log(`   [FAIL] Recalculation failed. estimate_amount: ${finalHeader?.estimate_amount}`);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Empty array save failed. Status: ${res11.statusCode}`, res11.jsonData);
      fails++;
    }

    // 12. Submitted estimate cannot be edited test
    console.log('\n12. Testing edit gating when estimate is in Submitted status (should block with 403)...');
    // Direct DB status update to bypass submitEstimate controller flow for isolated M3 testing
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Submitted' })
      .eq('estimate_id', createdEstimateId);

    const req12 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_A, role: 'je' },
      body: {
        items: [
          {
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 5,
            rate: 400,
            rate_reference: 'Ref'
          }
        ]
      }
    };
    const res12 = mockRes();
    await saveDraftItems(req12, res12);

    // Reset status back to Draft for cleanup to run successfully
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Draft' })
      .eq('estimate_id', createdEstimateId);

    if (res12.statusCode === 403 && res12.jsonData.message.includes('edited in its current status')) {
      console.log('   [PASS] saveDraftItems successfully blocked edits on a Submitted estimate.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 403 edit block on Submitted status, got: ${res12.statusCode}`, res12.jsonData);
      fails++;
    }

  } catch (err) {
    console.error('Unexpected test exception:', err);
    fails++;
  } finally {
    console.log('\nCleaning up verification records...');
    try {
      if (createdEstimateId) {
        await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId);
        await supabase.from('project_cost_estimates').update({
          work_order_no: 'WB_BAN_102',
          created_by: '+918276071523',
          last_modified_by: '+918276071523',
          je_user_id: '+918276071523',
          zo_approved_by: null,
          ho_approved_by: null
        }).eq('estimate_id', createdEstimateId);
      }
      if (createdEstimateId2) {
        await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId2);
        await supabase.from('project_cost_estimates').update({
          work_order_no: 'WB_BAN_102',
          created_by: '+918276071523',
          last_modified_by: '+918276071523',
          je_user_id: '+918276071523',
          zo_approved_by: null,
          ho_approved_by: null
        }).eq('estimate_id', createdEstimateId2);
      }
      if (insertedMaterialIds.length > 0) {
        await supabase.from('material_master').delete().in('id', insertedMaterialIds);
      }
      // Delete projects master rows
      await supabase.from('projects_master').delete().in('work_order_no', [activeWorkOrder, activeWorkOrder2, closedWorkOrder]);
      // Delete test users
      await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_A, mobileJE_B, mobileZO, mobileAdmin]);
      console.log('   Cleanup done.');
    } catch (cleanupErr) {
      console.warn('   Cleanup error:', cleanupErr.message);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE 3 TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME TESTS FAILED. <<<');
    process.exit(1);
  }
}

testMilestone3();
