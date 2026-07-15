'use strict';

const assert = require('assert');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { supabase } = require('../../src/db/supabase');
const { JWT_SECRET } = require('../../src/services/session.service');
const app = require('../../src/app');

const PORT = 5002;
const BASE_URL = `http://localhost:${PORT}/api/v1/auth`;

async function runUatTests() {
  console.log('--- STARTING MILESTONE 11 UAT INTEGRATION TESTS ---');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[WARNING] Skipping UAT integration tests: Supabase keys not set in environment.');
    process.exit(0);
  }

  let server;
  const suffix = crypto.randomUUID().substring(0, 8);
  const adminMobile = `+91950000_${suffix.substring(0, 4)}`;
  const zoMobile = `+91950001_${suffix.substring(0, 4)}`;
  const zoMobile2 = `+91950002_${suffix.substring(0, 4)}`;
  const jeMobile = `+91950003_${suffix.substring(0, 4)}`;
  const jeMobileUnmapped = `+91950004_${suffix.substring(0, 4)}`;

  let adminSessionId = crypto.randomUUID();
  let zoSessionId = crypto.randomUUID();
  let zoSessionId2 = crypto.randomUUID();
  let jeSessionId = crypto.randomUUID();

  let adminToken, zoToken, zoToken2, jeToken;
  let adminUserId, zoUserId, zoUserId2, jeUserId, jeUserIdUnmapped;

  const testWO = `WO_UAT_${suffix}`;
  const testEst = `EST_UAT_${suffix}`;
  const testReqNo1 = `REQ_UAT1_${suffix}`;
  const testReqNo2 = `REQ_UAT2_${suffix}`;
  const testReqNoHold = `REQ_UAT_HOLD_${suffix}`;
  const testMaterialHead = `UAT_MATERIAL_${suffix}`;

  try {
    // 1. Setup Whitelisted Test Users
    console.log('[UAT] Step 1: Whitelisting test roles...');
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, zoMobile2, jeMobile, jeMobileUnmapped]);

    const { data: users, error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: adminMobile, display_name: 'UAT Admin', role: 'admin', is_active: true },
      { mobile_number: zoMobile, display_name: 'UAT ZO 1', role: 'zo', is_active: true },
      { mobile_number: zoMobile2, display_name: 'UAT ZO 2', role: 'zo', is_active: true },
      { mobile_number: jeMobile, display_name: 'UAT JE 1', role: 'je', is_active: true },
      { mobile_number: jeMobileUnmapped, display_name: 'UAT JE Unmapped', role: 'je', is_active: true }
    ]).select();

    if (userError) throw userError;

    adminUserId = users.find(u => u.mobile_number === adminMobile).id;
    zoUserId = users.find(u => u.mobile_number === zoMobile).id;
    zoUserId2 = users.find(u => u.mobile_number === zoMobile2).id;
    jeUserId = users.find(u => u.mobile_number === jeMobile).id;
    jeUserIdUnmapped = users.find(u => u.mobile_number === jeMobileUnmapped).id;

    // Setup sessions
    await supabase.from('sessions').insert([
      { id: adminSessionId, user_id: adminUserId, is_active: true },
      { id: zoSessionId, user_id: zoUserId, is_active: true },
      { id: zoSessionId2, user_id: zoUserId2, is_active: true },
      { id: jeSessionId, user_id: jeUserId, is_active: true }
    ]);

    // Generate tokens
    adminToken = jwt.sign({ user_id: adminUserId, mobile_number: adminMobile, role: 'admin', session_id: adminSessionId }, JWT_SECRET);
    zoToken = jwt.sign({ user_id: zoUserId, mobile_number: zoMobile, role: 'zo', session_id: zoSessionId }, JWT_SECRET);
    zoToken2 = jwt.sign({ user_id: zoUserId2, mobile_number: zoMobile2, role: 'zo', session_id: zoSessionId2 }, JWT_SECRET);
    jeToken = jwt.sign({ user_id: jeUserId, mobile_number: jeMobile, role: 'je', session_id: jeSessionId }, JWT_SECRET);

    // Seed test material head
    await supabase.from('material_master').delete().eq('Material_Main_Head', testMaterialHead);
    const { error: matInsertErr } = await supabase.from('material_master').insert({
      'Material_Main_Head': testMaterialHead,
      'Material_Sub_Head': 'UAT Sub Head',
      'Material_Details': 'UAT Test Material for Integration Testing',
      'M_Unit': 'NOS',
      created_by: adminMobile
    });
    if (matInsertErr) throw matInsertErr;

    // Start Server
    server = app.listen(PORT);
    console.log(`[UAT] Server started on port ${PORT}.`);

    // ==========================================
    // SCENARIO 1: Mappings Setup
    // ==========================================
    console.log('\n--- Running SCENARIO 1: User Mapping & Work Order Mappings Setup ---');
    
    // Map JE-1 to ZO-1
    console.log('[SCENARIO 1] Mapping JE-1 to ZO-1...');
    const mapJeRes = await fetch(`${BASE_URL}/user-mappings`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ je_mobile_number: jeMobile, zo_mobile_number: zoMobile })
    });
    assert(mapJeRes.status === 200 || mapJeRes.status === 201, `Failed to map JE to ZO. Got ${mapJeRes.status}`);

    // Create Work Order assigned to ZO-1
    console.log('[SCENARIO 1] Creating target Work Order WO-100...');
    const createProjRes = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_order_no: testWO,
        estimate_no: testEst,
        work_order_value: 200000.00,
        site_details: 'UAT Site Location',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        zo_user_id: zoMobile // ZO-1 owns this WO
      })
    });
    assert.strictEqual(createProjRes.status, 201, 'Failed to create work order project.');

    // Assign JE-1 to WO-100
    console.log('[SCENARIO 1] Mapping JE-1 to WO-100...');
    const mapWoRes = await fetch(`${BASE_URL}/work-order-mappings`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_order_no: testWO, je_mobile_number: jeMobile })
    });
    assert(mapWoRes.status === 200 || mapWoRes.status === 201, `Failed to map JE to WO. Got ${mapWoRes.status}`);

    // Try to map Unmapped JE to WO-100 (verify blocks)
    console.log('[SCENARIO 1] Verifying block for unmapped JE-2...');
    const mapUnmappedRes = await fetch(`${BASE_URL}/work-order-mappings`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_order_no: testWO, je_mobile_number: jeMobileUnmapped })
    });
    assert.strictEqual(mapUnmappedRes.status, 400, 'Should block unmapped JE.');

    // ==========================================
    // SCENARIO 2: Fund Allocation and Requisition Flow
    // ==========================================
    console.log('\n--- Running SCENARIO 2: Fund Allocation and Requisition Flow ---');

    // ZO-1 raises Fund Request for ₹1,00,000
    console.log('[SCENARIO 2] ZO-1 raising Fund Request of ₹1,00,000...');
    const fundReqRes = await fetch(`${BASE_URL}/fund-requests`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${zoToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_order_no: testWO, requested_amount: 100000.00, remarks: 'UAT funding requisition' })
    });
    if (fundReqRes.status !== 201) {
      console.error('Fund Request Creation Failed. Status:', fundReqRes.status, 'Body:', await fundReqRes.text());
    }
    assert.strictEqual(fundReqRes.status, 201, 'Failed to create fund request.');
    const fundReqData = await fundReqRes.json();
    const fundRequestId = fundReqData.request?.id || fundReqData.id;

    // HO approves Fund Request
    console.log('[SCENARIO 2] HO approving Fund Request...');
    const approveFundRes = await fetch(`${BASE_URL}/fund-requests/${fundRequestId}/action`, {
      method: 'PATCH',
      headers: { Cookie: `accessToken=${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Approve', approved_amount: 100000.00, remarks: 'Approved by HO' })
    });
    assert.strictEqual(approveFundRes.status, 200, 'Failed to approve fund request.');

    // Verify ZO-1 available balance is ₹1,00,000
    console.log('[SCENARIO 2] Verifying ZO-1 balance is ₹1,00,000...');
    const zoBalCheckRes = await fetch(`${BASE_URL}/zo-balances`, { headers: { Cookie: `accessToken=${zoToken}` } });
    const zoBalCheckData = await zoBalCheckRes.json();
    const zoBalanceData = Array.isArray(zoBalCheckData.balances) ? zoBalCheckData.balances[0] : zoBalCheckData.balance;
    assert.strictEqual(Number(zoBalanceData.available_balance), 100000.00, 'ZO Balance mismatch.');

    // JE-1 submits Payment Requisition for ₹60,000
    console.log('[SCENARIO 2] JE-1 submitting requisition of ₹60,000...');
    const submitReqRes = await fetch(`${BASE_URL}/requisitions`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${jeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requisition_no: testReqNo1,
        work_order_no: testWO,
        requisition_amount: 60000.00,
        material_main_head: testMaterialHead,
        requisition_pdf_url: `test/uat_req1_${suffix}.pdf`,
        gst_bill: 'No',
        bank_details: 'UAT Bank Account - Test IFSC',
        expen_head_remarks: 'First payment request'
      })
    });
    if (submitReqRes.status !== 201) {
      console.error('Failed to submit requisition. Status:', submitReqRes.status, 'Body:', await submitReqRes.text());
    }
    assert.strictEqual(submitReqRes.status, 201, 'Failed to submit payment requisition.');
    const submitReqData = await submitReqRes.json();
    const requisitionId = submitReqData.requisition?.requisition_id || submitReqData.requisition?.id || submitReqData.id;

    // ZO-1 approves Payment Requisition
    console.log('[SCENARIO 2] ZO-1 approving Payment Requisition...');
    const approveReqRes = await fetch(`${BASE_URL}/requisitions/${requisitionId}/action`, {
      method: 'PATCH',
      headers: { Cookie: `accessToken=${zoToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Approve', approved_amount: 60000.00, remarks_approved_authority: 'ZO Approval' })
    });
    if (approveReqRes.status !== 200) {
      console.error('Failed to approve requisition. Status:', approveReqRes.status, 'Body:', await approveReqRes.text());
    }
    assert.strictEqual(approveReqRes.status, 200, 'Failed to approve requisition.');

    // Verify ZO-1 balance drops to ₹40,000
    console.log('[SCENARIO 2] Verifying ZO-1 balance drops to ₹40,000...');
    const zoBalCheckRes2 = await fetch(`${BASE_URL}/zo-balances`, { headers: { Cookie: `accessToken=${zoToken}` } });
    const zoBalCheckData2 = await zoBalCheckRes2.json();
    const zoBalanceData2 = Array.isArray(zoBalCheckData2.balances) ? zoBalCheckData2.balances[0] : zoBalCheckData2.balance;
    assert.strictEqual(Number(zoBalanceData2.available_balance), 40000.00, 'ZO Balance drops failed.');

    // ==========================================
    // SCENARIO 3: Insufficient Balance Requisition Block
    // ==========================================
    console.log('\n--- Running SCENARIO 3: Insufficient Balance Requisition Block ---');

    // JE-1 submits another requisition for ₹50,000
    console.log('[SCENARIO 3] JE-1 submitting requisition of ₹50,000...');
    const submitReqRes2 = await fetch(`${BASE_URL}/requisitions`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${jeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requisition_no: testReqNo2,
        work_order_no: testWO,
        requisition_amount: 50000.00,
        material_main_head: testMaterialHead,
        requisition_pdf_url: `test/uat_req2_${suffix}.pdf`,
        gst_bill: 'No',
        bank_details: 'UAT Bank Account - Test IFSC',
        expen_head_remarks: 'Second payment request'
      })
    });
    if (submitReqRes2.status !== 201) {
      console.error('Failed to submit 2nd requisition. Status:', submitReqRes2.status, 'Body:', await submitReqRes2.text());
    }
    assert.strictEqual(submitReqRes2.status, 201, 'Failed to submit second requisition.');
    const submitReqData2 = await submitReqRes2.json();
    const requisitionId2 = submitReqData2.requisition?.requisition_id || submitReqData2.requisition?.id || submitReqData2.id;

    // ZO-1 attempts to approve (fails)
    console.log('[SCENARIO 3] ZO-1 attempting to approve requisition (should fail 422)...');
    const approveReqRes2 = await fetch(`${BASE_URL}/requisitions/${requisitionId2}/action`, {
      method: 'PATCH',
      headers: { Cookie: `accessToken=${zoToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Approve', approved_amount: 50000.00, remarks_approved_authority: 'ZO Approval attempt' })
    });
    assert.strictEqual(approveReqRes2.status, 422, 'Requisition approval should fail.');
    const approveReqData2 = await approveReqRes2.json();
    assert(approveReqData2.message.includes('balance'), 'Expected insufficient balance error message.');
    console.log('  Insufficient balance block verified successfully.');

    // ==========================================
    // SCENARIO 4: Excess Fund Return Workflow
    // ==========================================
    console.log('\n--- Running SCENARIO 4: Excess Fund Return Workflow ---');

    // HO requests returns of ₹30,000 from ZO-1
    console.log('[SCENARIO 4] HO requesting returns of ₹30,000...');
    const returnReqRes = await fetch(`${BASE_URL}/excess-fund-returns`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zo_user_id: zoMobile,
        work_order_no: testWO,
        requested_amount: 30000.00,
        remarks_ho: 'Returning excess project funds'
      })
    });
    assert.strictEqual(returnReqRes.status, 201, 'Failed to request excess fund returns.');
    const returnReqData = await returnReqRes.json();
    const returnId = returnReqData.returnRequest?.id || returnReqData.id;

    // Get returns record to fetch latest updated_at
    const getReturnDetailsRes = await fetch(`${BASE_URL}/excess-fund-returns`, { headers: { Cookie: `accessToken=${zoToken}` } });
    const getReturnDetails = await getReturnDetailsRes.json();
    const loadedReturnRecord = getReturnDetails.returns.find(r => r.id === returnId);

    // ZO-1 accepts the return request
    console.log('[SCENARIO 4] ZO-1 accepting the return request...');
    const acceptReturnRes = await fetch(`${BASE_URL}/excess-fund-returns/${returnId}/accept`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${zoToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_updated_at: loadedReturnRecord.updated_at,
        breakdown: [{ work_order_no: testWO, amount: 30000.00 }]
      })
    });
    if (acceptReturnRes.status !== 200) {
      console.error('Failed to accept return request. Status:', acceptReturnRes.status, 'Body:', await acceptReturnRes.text());
    }
    assert.strictEqual(acceptReturnRes.status, 200, 'Failed to accept return request.');

    // Verify ZO-1 available balance drops to ₹10,000
    console.log('[SCENARIO 4] Verifying ZO-1 available balance is ₹10,000...');
    const zoBalCheckRes3 = await fetch(`${BASE_URL}/zo-balances`, { headers: { Cookie: `accessToken=${zoToken}` } });
    const zoBalCheckData3 = await zoBalCheckRes3.json();
    const zoBalanceData3 = Array.isArray(zoBalCheckData3.balances) ? zoBalCheckData3.balances[0] : zoBalCheckData3.balance;
    assert.strictEqual(Number(zoBalanceData3.available_balance), 100000.00 - 60000.00 - 30000.00, 'ZO Balance drops failed.');

    // ==========================================
    // SCENARIO 5: JE Transfer and Work Order De-allocation
    // ==========================================
    console.log('\n--- Running SCENARIO 5: JE Transfer and Work Order De-allocation ---');

    // Create a mock requisition on Hold
    const submitReqResHold = await fetch(`${BASE_URL}/requisitions`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${jeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requisition_no: testReqNoHold,
        work_order_no: testWO,
        requisition_amount: 5000.00,
        material_main_head: testMaterialHead,
        requisition_pdf_url: `test/uat_hold_${suffix}.pdf`,
        gst_bill: 'No',
        bank_details: 'UAT Bank Account - Test IFSC',
        expen_head_remarks: 'Hold check request'
      })
    });
    if (submitReqResHold.status !== 201) {
      console.error('Failed to submit hold requisition. Status:', submitReqResHold.status, 'Body:', await submitReqResHold.text());
    }
    assert.strictEqual(submitReqResHold.status, 201);
    const submitReqDataHold = await submitReqResHold.json();
    const requisitionIdHold = submitReqDataHold.requisition?.requisition_id || submitReqDataHold.requisition?.id || submitReqDataHold.id;

    // Set status to Hold
    await fetch(`${BASE_URL}/requisitions/${requisitionIdHold}/action`, {
      method: 'PATCH',
      headers: { Cookie: `accessToken=${zoToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Hold', remarks_approved_authority: 'ZO Hold Action' })
    });

    // HO attempts to transfer JE-1 to ZO-2 (verify blocks)
    console.log('[SCENARIO 5] Attempting to transfer JE-1 to ZO-2 while requisition on Hold (should fail 400)...');
    const transferAttemptRes = await fetch(`${BASE_URL}/user-mappings`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ je_mobile_number: jeMobile, zo_mobile_number: zoMobile2 })
    });
    assert.strictEqual(transferAttemptRes.status, 400, 'Transfer should have been blocked.');

    // Resolve requisition (Cancel it)
    console.log('[SCENARIO 5] Cancelling hold requisition...');
    const cancelRes = await fetch(`${BASE_URL}/requisitions/${requisitionIdHold}/cancel`, {
      method: 'PATCH',
      headers: { Cookie: `accessToken=${jeToken}` }
    });
    if (cancelRes.status !== 200) {
      console.error('Cancel failed. Status:', cancelRes.status, 'Body:', await cancelRes.text());
    }

    console.log('[SCENARIO 5] Cancelling second pending requisition...');
    const cancelRes2 = await fetch(`${BASE_URL}/requisitions/${requisitionId2}/cancel`, {
      method: 'PATCH',
      headers: { Cookie: `accessToken=${jeToken}` }
    });
    if (cancelRes2.status !== 200) {
      console.error('Cancel failed for second requisition. Status:', cancelRes2.status, 'Body:', await cancelRes2.text());
    }

    // Transfer JE-1 to ZO-2 (verify succeeds)
    console.log('[SCENARIO 5] Transferring JE-1 to ZO-2 (should succeed)...');
    const transferSuccessRes = await fetch(`${BASE_URL}/user-mappings`, {
      method: 'POST',
      headers: { Cookie: `accessToken=${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ je_mobile_number: jeMobile, zo_mobile_number: zoMobile2 })
    });
    assert(transferSuccessRes.status === 200 || transferSuccessRes.status === 201, `Transfer failed. Got ${transferSuccessRes.status}`);

    // Verify WO-100 assignment is deactivated automatically
    console.log('[SCENARIO 5] Verifying JE-1 assignment for WO-100 was automatically deactivated...');
    const { data: woMappings, error: woMapErr } = await supabase
      .from('work_order_mappings')
      .select('is_active, reason')
      .eq('work_order_no', testWO)
      .eq('je_user_id', jeMobile)
      .single();

    assert(!woMapErr && woMappings, 'WO mapping record query failed.');
    assert.strictEqual(woMappings.is_active, false, 'Mapping should be inactive.');
    assert.strictEqual(woMappings.reason, 'Transferred', 'Deactivation reason must be Transferred.');
    console.log('  JE transfer de-allocation workflow verified successfully.');

    // ==========================================
    // SCENARIO 6: Concurrency Double Spending Check
    // ==========================================
    console.log('\n--- Running SCENARIO 6: Concurrency Double Spending Stress Check ---');
    
    // Setup balance back to exactly ₹50,000 for ZO-2
    console.log('[SCENARIO 6] Adjusting ZO-2 available balance to exactly ₹50,000...');
    await supabase.rpc('reconcile_zonal_balances', { p_zo_user_id: zoMobile2, p_actioned_by: 'UAT_SETUP' });
    const { error: balanceUpdateErr } = await supabase
      .from('zo_balances')
      .update({ available_balance: 50000.00 })
      .eq('zo_user_id', zoMobile2);

    if (balanceUpdateErr) throw balanceUpdateErr;

    // Register WO-CONCUR owned by ZO-2 and map JE-1 to it
    const concurrentWO = `WO_CONCUR_${suffix}`;
    await supabase.from('projects_master').insert({
      work_order_no: concurrentWO,
      estimate_no: `EST_CONCUR_${suffix}`,
      zo_user_id: zoMobile2,
      work_order_value: 150000.00,
      site_details: 'Testing Site',
      state: 'West Bengal',
      district: 'Kolkata',
      zone: 'Kolkata Zone',
      department: 'PWD',
      status: 'Running',
      created_by: adminMobile,
      edited_by: adminMobile
    });
    await supabase.from('work_order_mappings').insert({
      work_order_no: concurrentWO,
      je_user_id: jeMobile,
      is_active: true,
      assigned_by: adminMobile
    });

    // Create 10 parallel requisitions of ₹10,000 each
    console.log('[SCENARIO 6] Creating 10 parallel requisitions of ₹10,000 each...');
    const reqIds = [];
    for (let i = 0; i < 10; i++) {
      const { data, error } = await supabase.from('requisitions').insert({
        requisition_no: `REQ_CONCUR_${i}_${suffix}`,
        work_order_no: concurrentWO,
        estimate_no: `EST_CONCUR_${suffix}`,
        requisition_amount: 10000.00,
        requisition_status: 'Pending',
        created_by: jeMobile,
        requester_user_id: jeMobile,
        zo_user_id: zoMobile2,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        material_main_head: testMaterialHead,
        requisition_pdf_url: `test/concur_req_${i}_${suffix}.pdf`,
        bank_details: 'Dummy Bank',
        gst_bill: 'No'
      }).select().single();
      if (error) throw error;
      reqIds.push(data.requisition_id || data.id);
    }

    // Fire 10 parallel approval requests concurrently
    console.log('[SCENARIO 6] Dispatching 10 parallel approval requests concurrently...');
    const approvalPromises = reqIds.map(id =>
      fetch(`${BASE_URL}/requisitions/${id}/action`, {
        method: 'PATCH',
        headers: { Cookie: `accessToken=${zoToken2}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'Approve', approved_amount: 10000.00, remarks_approved_authority: 'Concurrent stress' })
      })
    );

    const responses = await Promise.all(approvalPromises);

    // Verify exactly 5 succeed (200 OK) and exactly 5 fail (422 Unprocessable)
    const successCount = responses.filter(r => r.status === 200).length;
    const failCount = responses.filter(r => r.status === 422).length;
    
    console.log(`  Approvals completed. Successes: ${successCount}, Failures: ${failCount}`);
    assert.strictEqual(successCount, 5, 'Exactly 5 approvals must succeed.');
    assert.strictEqual(failCount, 5, 'Exactly 5 approvals must fail due to limit.');

    // Assert final balance is exactly ₹0.00
    const zoBalCheckResConcur = await fetch(`${BASE_URL}/zo-balances`, { headers: { Cookie: `accessToken=${zoToken2}` } });
    const zoBalCheckDataConcur = await zoBalCheckResConcur.json();
    const zoBalanceDataConcur = Array.isArray(zoBalCheckDataConcur.balances) ? zoBalCheckDataConcur.balances[0] : zoBalCheckDataConcur.balance;
    assert.strictEqual(Number(zoBalanceDataConcur.available_balance), 0.00, 'Zonal balance must drop to exactly 0.00.');
    console.log('  Concurrency double spending protection verified successfully.');

    // Cleanup concurrent projects
    await supabase.from('requisitions').delete().filter('work_order_no', 'eq', concurrentWO);
    await supabase.from('work_order_mappings').delete().eq('work_order_no', concurrentWO);
    await supabase.from('projects_master').delete().eq('work_order_no', concurrentWO);

    console.log('\n--- ALL E2E UAT SCENARIOS COMPLETED SUCCESSFULLY (Exit 0) ---');
    cleanup(0);
  } catch (err) {
    console.error('[ERROR] E2E UAT test run failed:', err);
    cleanup(1);
  }

  async function cleanup(exitCode) {
    console.log('[UAT] Cleaning up temporary whitelisted database records...');
    try {
      if (server) server.close();
      
      // Delete requisitions and ledger entries
      await supabase.from('zo_fund_ledger').delete().filter('work_order_no', 'eq', testWO);
      await supabase.from('requisitions').delete().filter('work_order_no', 'eq', testWO);
      await supabase.from('fund_requests').delete().filter('work_order_no', 'eq', testWO);
      await supabase.from('excess_fund_returns').delete().filter('work_order_no', 'eq', testWO);

      // Delete test material
      await supabase.from('material_master').delete().eq('Material_Main_Head', testMaterialHead);

      // Delete mappings and projects
      await supabase.from('work_order_mappings').delete().eq('work_order_no', testWO);
      await supabase.from('projects_master').delete().eq('work_order_no', testWO);
      
      await supabase.from('je_zo_mappings').delete().in('je_user_id', [jeMobile, jeMobileUnmapped]);
      await supabase.from('zo_balances').delete().in('zo_user_id', [zoMobile, zoMobile2]);
      
      await supabase.from('sessions').delete().in('id', [adminSessionId, zoSessionId, zoSessionId2, jeSessionId]);
      await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, zoMobile2, jeMobile, jeMobileUnmapped]);
    } catch (e) {
      console.error('Cleanup failed:', e);
    }
    process.exit(exitCode);
  }
}

runUatTests();
