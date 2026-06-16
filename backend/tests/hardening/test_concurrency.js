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

async function runConcurrencyTests() {
  console.log('=== RUNNING CONCURRENCY MODEL TESTS ===\n');
  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(10000 + Math.random() * 90000);
  const mobileJE = `+9190100${suffix}`;
  const mobileZO_A = `+9190200${suffix}`;
  const mobileZO_B = `+9190300${suffix}`;
  const mobileHO_A = `+9190400${suffix}`;
  const mobileHO_B = `+9190500${suffix}`;
  const mobileAdmin = `+9190600${suffix}`;

  try {
    // 0. Setup whitelisted users
    await setupUsers([
      { mobile_number: mobileJE, display_name: 'JE', role: 'je', is_active: true },
      { mobile_number: mobileZO_A, display_name: 'ZO A', role: 'zo', is_active: true },
      { mobile_number: mobileZO_B, display_name: 'ZO B', role: 'zo', is_active: true },
      { mobile_number: mobileHO_A, display_name: 'HO A', role: 'ho', is_active: true },
      { mobile_number: mobileHO_B, display_name: 'HO B', role: 'ho', is_active: true },
      { mobile_number: mobileAdmin, display_name: 'Admin', role: 'admin', is_active: true }
    ]);

    // Setup materials
    const { data: testMats, error: matErr } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Cement Concur A ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Cement Concur B ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
    ]).select();
    if (matErr) throw matErr;

    const setupProjectAndEstimate = async (testName) => {
      const wo = `TEST_WO_CONC_${testName}_${suffix}`;
      await setupProject(wo, `EST_CONC_${testName}_${suffix}`, 5000000.00, mobileAdmin);

      const res = mockRes();
      await createEstimate({
        user: { mobile_number: mobileJE, role: 'je' },
        body: { work_order_no: wo, zonal_office_no: 'ZO-1' }
      }, res);
      
      if (res.statusCode !== 201) {
        throw new Error(`Failed to create estimate: ${res.jsonData.message}`);
      }
      return { wo, estId: res.jsonData.estimate.estimate_id };
    };

    const saveItems = async (id, count = 2, qty = 10) => {
      const items = [];
      for (let i = 0; i < count; i++) {
        items.push({
          material_main_head: 'Raw Materials',
          material_sub_head: 'Cement',
          material_details: testMats[i % testMats.length].Material_Details,
          unit: 'Bag',
          qty,
          rate: 100,
          rate_reference: 'Ref'
        });
      }
      const res = mockRes();
      await saveDraftItems({
        params: { id },
        user: { mobile_number: mobileJE, role: 'je' },
        body: { items }
      }, res);
      return res.jsonData;
    };

    // -------------------------------------------------------------------------
    // C1 — Simultaneous ZO Open Review
    // -------------------------------------------------------------------------
    console.log('C1 — Simultaneous ZO Open Review...');
    const c1Data = await setupProjectAndEstimate('C1');
    await saveItems(c1Data.estId);
    await submitEstimate({ params: { id: c1Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());

    const resC1_A = mockRes();
    const resC1_B = mockRes();
    await Promise.all([
      reviewEstimate({ params: { id: c1Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, resC1_A),
      reviewEstimate({ params: { id: c1Data.estId }, user: { mobile_number: mobileZO_B, role: 'zo' } }, resC1_B)
    ]);

    const { data: estC1 } = await supabase.from('project_cost_estimates').select('*').eq('estimate_id', c1Data.estId).single();
    const { data: auditC1 } = await supabase.from('audit_log').select('*').eq('record_identifier', c1Data.estId.toString()).eq('action', 'STATUS_CHANGE');

    const successCountC1 = (resC1_A.statusCode === 200 ? 1 : 0) + (resC1_B.statusCode === 200 ? 1 : 0);
    // Audit transitions: Draft -> Submitted, then Submitted -> Under ZO Review. Total 2.
    if (successCountC1 === 1 && estC1.estimate_status === 'Under ZO Review' && auditC1.length === 2) {
      console.log('  [PASS] C1: Exactly one succeeded (optimistic lock active), state is Under ZO Review, valid status changes.');
      passes++;
    } else {
      console.log(`  [FAIL] C1: successes=${successCountC1}, status=${estC1.estimate_status}, audit_logs=${auditC1.length}`);
      fails++;
    }
    await cleanupEstimate(c1Data.estId, c1Data.wo);

    // -------------------------------------------------------------------------
    // C2 — Simultaneous ZO Row Approval (Direct DB Lock Contention)
    // -------------------------------------------------------------------------
    console.log('C2 — Simultaneous ZO Row Approval...');
    const c2Data = await setupProjectAndEstimate('C2');
    await saveItems(c2Data.estId, 1);
    await submitEstimate({ params: { id: c2Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: c2Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, mockRes());

    const { data: itemsC2 } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', c2Data.estId);
    const targetItemId = itemsC2[0].item_id;

    // Call submit_row_approvals RPC directly to check DB-level locking/concurrency
    const resC2_A = supabase.rpc('submit_row_approvals', {
      p_estimate_id: c2Data.estId,
      p_approvals: [{ item_id: targetItemId, approve_status: 'Approve' }],
      p_stage: 'ZO',
      p_modified_by: mobileZO_A
    });

    const resC2_B = supabase.rpc('submit_row_approvals', {
      p_estimate_id: c2Data.estId,
      p_approvals: [{ item_id: targetItemId, approve_status: 'Not Approve', remarks: 'Rejecting' }],
      p_stage: 'ZO',
      p_modified_by: mobileZO_B
    });

    await Promise.all([resC2_A, resC2_B]);

    const { data: updatedItemC2 } = await supabase.from('project_cost_estimate_items').select('zo_office_approve').eq('item_id', targetItemId).single();
    if (['Approve', 'Not Approve'].includes(updatedItemC2.zo_office_approve)) {
      console.log(`  [PASS] C2: Row updated to valid state under contention: ${updatedItemC2.zo_office_approve}`);
      passes++;
    } else {
      console.log(`  [FAIL] C2: Row has invalid state: ${updatedItemC2.zo_office_approve}`);
      fails++;
    }
    await cleanupEstimate(c2Data.estId, c2Data.wo);

    // -------------------------------------------------------------------------
    // C3 — Mixed Approval Batch Collision
    // -------------------------------------------------------------------------
    console.log('C3 — Mixed Approval Batch Collision...');
    const c3Data = await setupProjectAndEstimate('C3');
    await saveItems(c3Data.estId, 5);
    await submitEstimate({ params: { id: c3Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: c3Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, mockRes());

    const { data: itemsC3 } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', c3Data.estId).order('created_at', { ascending: true });

    const approvals1 = [
      { item_id: itemsC3[0].item_id, approve_status: 'Approve' },
      { item_id: itemsC3[1].item_id, approve_status: 'Approve' },
      { item_id: itemsC3[2].item_id, approve_status: 'Approve' }
    ];
    const approvals2 = [
      { item_id: itemsC3[2].item_id, approve_status: 'Not Approve', remarks: 'Reject C' },
      { item_id: itemsC3[3].item_id, approve_status: 'Approve' },
      { item_id: itemsC3[4].item_id, approve_status: 'Approve' }
    ];

    const resC3_A = mockRes();
    const resC3_B = mockRes();
    await Promise.all([
      submitRowApprovals({ params: { id: c3Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' }, body: { approvals: approvals1 } }, resC3_A),
      submitRowApprovals({ params: { id: c3Data.estId }, user: { mobile_number: mobileZO_B, role: 'zo' }, body: { approvals: approvals2 } }, resC3_B)
    ]);

    const { data: finalItemsC3 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', c3Data.estId).order('created_at', { ascending: true });
    const nullCount = finalItemsC3.filter(i => i.zo_office_approve === null).length;
    if (nullCount === 0 && resC3_A.statusCode === 200 && resC3_B.statusCode === 200) {
      console.log('  [PASS] C3: All rows have non-null decisions. No database errors.');
      passes++;
    } else {
      console.log(`  [FAIL] C3: Leftover null rows = ${nullCount}, Codes: ${resC3_A.statusCode}, ${resC3_B.statusCode}`);
      fails++;
    }
    await cleanupEstimate(c3Data.estId, c3Data.wo);

    // -------------------------------------------------------------------------
    // C4 — Simultaneous submitReview (Direct DB RPC Locking)
    // -------------------------------------------------------------------------
    console.log('C4 — Simultaneous submitReview...');
    const c4Data = await setupProjectAndEstimate('C4');
    await saveItems(c4Data.estId, 2);
    await submitEstimate({ params: { id: c4Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: c4Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, mockRes());

    const { data: itemsC4 } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', c4Data.estId);
    await submitRowApprovals({
      params: { id: c4Data.estId },
      user: { mobile_number: mobileZO_A, role: 'zo' },
      body: { approvals: itemsC4.map(i => ({ item_id: i.item_id, approve_status: 'Approve' })) }
    }, mockRes());

    // Call submit_zo_review RPC directly to test lock contention
    const callRPCReview = (reviewer) => supabase.rpc('submit_zo_review', {
      p_estimate_id: c4Data.estId,
      p_reviewer: reviewer,
      p_remarks: 'Approved review'
    });

    const [resC4_RPC_A, resC4_RPC_B] = await Promise.all([
      callRPCReview(mobileZO_A),
      callRPCReview(mobileZO_B)
    ]);

    const { data: estC4 } = await supabase.from('project_cost_estimates').select('*').eq('estimate_id', c4Data.estId).single();
    const { data: auditC4 } = await supabase.from('audit_log').select('*').eq('record_identifier', c4Data.estId.toString()).eq('action', 'STATUS_CHANGE');

    const successCountC4 = (resC4_RPC_A.error ? 0 : 1) + (resC4_RPC_B.error ? 0 : 1);
    if (successCountC4 === 1 && estC4.estimate_status === 'ZO Approved' && auditC4.length === 3) {
      console.log('  [PASS] C4: Exactly one submit_zo_review RPC call succeeded (lock contention worked). Status: ZO Approved.');
      passes++;
    } else {
      console.log(`  [FAIL] C4: Successes=${successCountC4}, status=${estC4.estimate_status}, audit_logs=${auditC4.length}`);
      fails++;
    }
    await cleanupEstimate(c4Data.estId, c4Data.wo);

    // -------------------------------------------------------------------------
    // C5 — Simultaneous JE Draft Save (Documented Strategy)
    // -------------------------------------------------------------------------
    console.log('C5 — Simultaneous JE Draft Save...');
    const c5Data = await setupProjectAndEstimate('C5');
    const resC5_A = mockRes();
    const resC5_B = mockRes();
    
    await Promise.all([
      saveDraftItems({
        params: { id: c5Data.estId },
        user: { mobile_number: mobileJE, role: 'je' },
        body: {
          items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' }]
        }
      }, resC5_A),
      saveDraftItems({
        params: { id: c5Data.estId },
        user: { mobile_number: mobileJE, role: 'je' },
        body: {
          items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 20, rate: 100, rate_reference: 'Ref' }]
        }
      }, resC5_B)
    ]);

    const { data: itemsC5 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', c5Data.estId);
    // Under non-transactional REST design, both inserts succeed, resulting in 2 items in DB
    if (itemsC5.length === 2) {
      console.log('  [PASS] C5: Confirmed design allows double-inserts under concurrency (no locking in controller). Items count = 2.');
      passes++;
    } else {
      console.log(`  [FAIL] C5: Unexpected items count:`, itemsC5);
      fails++;
    }
    await cleanupEstimate(c5Data.estId, c5Data.wo);

    // -------------------------------------------------------------------------
    // C6 — JE Submit While Saving Draft
    // -------------------------------------------------------------------------
    console.log('C6 — JE Submit While Saving Draft...');
    const c6Data = await setupProjectAndEstimate('C6');
    await saveItems(c6Data.estId, 1, 5);

    const resC6_Save = mockRes();
    const resC6_Sub = mockRes();
    await Promise.all([
      saveDraftItems({
        params: { id: c6Data.estId },
        user: { mobile_number: mobileJE, role: 'je' },
        body: {
          items: [
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 50, rate: 100, rate_reference: 'Ref' }
          ]
        }
      }, resC6_Save),
      submitEstimate({ params: { id: c6Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, resC6_Sub)
    ]);

    const { data: estC6 } = await supabase.from('project_cost_estimates').select('*').eq('estimate_id', c6Data.estId).single();
    const { data: itemsC6 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', c6Data.estId);
    
    const expectedSum = itemsC6.reduce((acc, it) => acc + Number(it.amount), 0);
    const amountMatches = Number(estC6.estimate_amount) === expectedSum;
    if (amountMatches) {
      console.log(`  [PASS] C6: Core state is consistent. Status: ${estC6.estimate_status}, Header Amount: ${estC6.estimate_amount}, Item Amount: ${expectedSum}`);
      passes++;
    } else {
      console.log(`  [FAIL] C6: Inconsistent state. Header: ${estC6.estimate_amount}, Item Sum: ${expectedSum}`);
      fails++;
    }
    await cleanupEstimate(c6Data.estId, c6Data.wo);

    // -------------------------------------------------------------------------
    // C7 — ZO Review While JE Resubmits
    // -------------------------------------------------------------------------
    console.log('C7 — ZO Review While JE Resubmits...');
    const c7Data = await setupProjectAndEstimate('C7');
    await saveItems(c7Data.estId, 2);
    
    await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Revision Requested', estimate_revision: 1 }).eq('estimate_id', c7Data.estId);
    await supabase.from('estimate_revision_log').insert({
      estimate_id: c7Data.estId,
      revision_cycle: 1,
      stage: 'ZO',
      requested_by: mobileZO_A,
      revision_deadline: new Date(Date.now() + 60000).toISOString()
    });

    const resC7_Sub = mockRes();
    const resC7_Rev = mockRes();
    await Promise.all([
      submitEstimate({ params: { id: c7Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, resC7_Sub),
      reviewEstimate({ params: { id: c7Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, resC7_Rev)
    ]);

    const { data: estC7_Final } = await supabase.from('project_cost_estimates').select('estimate_status').eq('estimate_id', c7Data.estId).single();
    if (['Submitted', 'Under ZO Review', 'ZO Revision Requested'].includes(estC7_Final.estimate_status)) {
      console.log(`  [PASS] C7: Safe workflow state resolved. Status: ${estC7_Final.estimate_status}`);
      passes++;
    } else {
      console.log(`  [FAIL] C7: State corruption occurred: ${estC7_Final.estimate_status}`);
      fails++;
    }
    await cleanupEstimate(c7Data.estId, c7Data.wo);

    // -------------------------------------------------------------------------
    // C8 — HO Review Collision (Locked Row Approvals)
    // -------------------------------------------------------------------------
    console.log('C8 — HO Review Collision...');
    const c8Data = await setupProjectAndEstimate('C8');
    await saveItems(c8Data.estId, 2);
    await submitEstimate({ params: { id: c8Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: c8Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, mockRes());
    
    const { data: itemsC8 } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', c8Data.estId);
    await submitRowApprovals({
      params: { id: c8Data.estId },
      user: { mobile_number: mobileZO_A, role: 'zo' },
      body: { approvals: itemsC8.map(i => ({ item_id: i.item_id, approve_status: 'Approve' })) }
    }, mockRes());
    await submitReview({ params: { id: c8Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, mockRes());

    // Move to Under HO Review
    await reviewEstimate({ params: { id: c8Data.estId }, user: { mobile_number: mobileHO_A, role: 'ho' } }, mockRes());
    
    // Concurrent HO Row Approvals calling submit_row_approvals RPC directly (locks FOR UPDATE)
    const callHOApproval = (approver, status) => supabase.rpc('submit_row_approvals', {
      p_estimate_id: c8Data.estId,
      p_approvals: itemsC8.map(i => ({ item_id: i.item_id, approve_status: status })),
      p_stage: 'HO',
      p_modified_by: approver
    });

    const [resC8_RPC_A, resC8_RPC_B] = await Promise.all([
      callHOApproval(mobileHO_A, 'Approve'),
      callHOApproval(mobileHO_B, 'Not Approve') // trying to reject it concurrently
    ]);

    const { data: itemsC8Final } = await supabase.from('project_cost_estimate_items').select('ho_office_approve').eq('estimate_id', c8Data.estId);
    const uniqueDecisions = [...new Set(itemsC8Final.map(i => i.ho_office_approve))];

    if (uniqueDecisions.length === 1 && ['Approve', 'Not Approve'].includes(uniqueDecisions[0])) {
      console.log(`  [PASS] C8: Workflow locking handled HO row approvals collision cleanly. Unified Decision: ${uniqueDecisions[0]}`);
      passes++;
    } else {
      console.log(`  [FAIL] C8: Inconsistent HO row approval decisions:`, uniqueDecisions);
      fails++;
    }
    await cleanupEstimate(c8Data.estId, c8Data.wo);

    // -------------------------------------------------------------------------
    // C9 — Revision Request Collision
    // -------------------------------------------------------------------------
    console.log('C9 — Revision Request Collision...');
    const c9Data = await setupProjectAndEstimate('C9');
    await saveItems(c9Data.estId, 2);
    await submitEstimate({ params: { id: c9Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: c9Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, mockRes());
    const { data: itemsC9 } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', c9Data.estId);
    
    await submitRowApprovals({
      params: { id: c9Data.estId },
      user: { mobile_number: mobileZO_A, role: 'zo' },
      body: { approvals: [
        { item_id: itemsC9[0].item_id, approve_status: 'Approve' },
        { item_id: itemsC9[1].item_id, approve_status: 'Not Approve', remarks: 'Rej' }
      ] }
    }, mockRes());

    const resC9_A = mockRes();
    const resC9_B = mockRes();
    await Promise.all([
      submitReview({ params: { id: c9Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' }, body: { remarks: 'Revision A' } }, resC9_A),
      submitReview({ params: { id: c9Data.estId }, user: { mobile_number: mobileZO_B, role: 'zo' }, body: { remarks: 'Revision B' } }, resC9_B)
    ]);

    const successCountC9 = (resC9_A.statusCode === 200 ? 1 : 0) + (resC9_B.statusCode === 200 ? 1 : 0);
    if (successCountC9 === 1) {
      console.log('  [PASS] C9: Exactly one review submission succeeded concurrently.');
      passes++;
    } else {
      console.log(`  [FAIL] C9: Success count = ${successCountC9}`);
      fails++;
    }
    await cleanupEstimate(c9Data.estId, c9Data.wo);

    // -------------------------------------------------------------------------
    // C10 — 500 Row Approval Batch Under Load
    // -------------------------------------------------------------------------
    console.log('C10 — 500 Row Approval Batch Under Load...');
    const c10Data = await setupProjectAndEstimate('C10');
    await saveItems(c10Data.estId, 500);
    await submitEstimate({ params: { id: c10Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: c10Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' } }, mockRes());

    const { data: itemsC10 } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', c10Data.estId);
    
    const midPoint = 250;
    const batch1 = itemsC10.slice(0, midPoint).map(it => ({ item_id: it.item_id, approve_status: 'Approve' }));
    const batch2 = itemsC10.slice(midPoint).map(it => ({ item_id: it.item_id, approve_status: 'Approve' }));

    const resC10_A = mockRes();
    const resC10_B = mockRes();
    await Promise.all([
      submitRowApprovals({ params: { id: c10Data.estId }, user: { mobile_number: mobileZO_A, role: 'zo' }, body: { approvals: batch1 } }, resC10_A),
      submitRowApprovals({ params: { id: c10Data.estId }, user: { mobile_number: mobileZO_B, role: 'zo' }, body: { approvals: batch2 } }, resC10_B)
    ]);

    const { data: itemsC10Final } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', c10Data.estId);
    const approvedCount = itemsC10Final.filter(i => i.zo_office_approve === 'Approve').length;

    if (approvedCount === 500 && resC10_A.statusCode === 200 && resC10_B.statusCode === 200) {
      console.log('  [PASS] C10: All 500 rows updated under load, no timeouts, no partial commits.');
      passes++;
    } else {
      console.log(`  [FAIL] C10: Approved count = ${approvedCount}/500. Codes: A=${resC10_A.statusCode}, B=${resC10_B.statusCode}`);
      fails++;
    }
    await cleanupEstimate(c10Data.estId, c10Data.wo);

    // Final clean up of static entities
    await supabase.from('material_master').delete().in('id', testMats.map(m => m.id));
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE, mobileZO_A, mobileZO_B, mobileHO_A, mobileHO_B, mobileAdmin]);

  } catch (error) {
    console.error('Test run failed with error:', error);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);

  if (fails > 0) {
    console.log('\n>>> SOME CONCURRENCY TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('\n>>> ALL CONCURRENCY TESTS PASSED!');
    process.exit(0);
  }
}

runConcurrencyTests();
