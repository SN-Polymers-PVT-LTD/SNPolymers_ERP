'use strict';

const assert = require('assert');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { supabase } = require('../../src/db/supabase');
const { JWT_SECRET } = require('../../src/services/session.service');
const app = require('../../src/app');

const PORT = 5001;
const BASE_URL = `http://localhost:${PORT}/api/v1/auth`;

async function runApiTests() {
  console.log('--- STARTING MILESTONE 10 API INTEGRATION TESTS ---');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[WARNING] Skipping API integration tests: Supabase keys not set in environment.');
    process.exit(0);
  }

  let server;
  const suffix = crypto.randomUUID().substring(0, 8);
  const adminMobile = `+91900000_${suffix.substring(0, 4)}`;
  const zoMobile = `+91900001_${suffix.substring(0, 4)}`;
  const zoMobile2 = `+91900002_${suffix.substring(0, 4)}`;
  const jeMobile = `+91900003_${suffix.substring(0, 4)}`;

  let adminSessionId = crypto.randomUUID();
  let zoSessionId = crypto.randomUUID();
  let zoSessionId2 = crypto.randomUUID();

  let adminToken, zoToken, zoToken2;
  let adminUserId, zoUserId, zoUserId2, jeUserId;

  try {
    // 1. Setup Whitelisted Test Users
    console.log('[TEST] Setting up temporary test users...');
    
    // Clear pre-existing
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, zoMobile2, jeMobile]);

    const { data: users, error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: adminMobile, display_name: 'Test Admin', role: 'admin', is_active: true },
      { mobile_number: zoMobile, display_name: 'Test ZO 1', role: 'zo', is_active: true },
      { mobile_number: zoMobile2, display_name: 'Test ZO 2', role: 'zo', is_active: true },
      { mobile_number: jeMobile, display_name: 'Test JE 1', role: 'je', is_active: true }
    ]).select();

    if (userError) throw userError;

    adminUserId = users.find(u => u.mobile_number === adminMobile).id;
    zoUserId = users.find(u => u.mobile_number === zoMobile).id;
    zoUserId2 = users.find(u => u.mobile_number === zoMobile2).id;
    jeUserId = users.find(u => u.mobile_number === jeMobile).id;

    // 2. Setup Active Sessions
    console.log('[TEST] Setting up sessions...');
    const { error: sessionError } = await supabase.from('sessions').insert([
      { id: adminSessionId, user_id: adminUserId, is_active: true },
      { id: zoSessionId, user_id: zoUserId, is_active: true },
      { id: zoSessionId2, user_id: zoUserId2, is_active: true }
    ]);

    if (sessionError) throw sessionError;

    // 3. Generate Access Tokens
    adminToken = jwt.sign({ user_id: adminUserId, mobile_number: adminMobile, role: 'admin', session_id: adminSessionId }, JWT_SECRET);
    zoToken = jwt.sign({ user_id: zoUserId, mobile_number: zoMobile, role: 'zo', session_id: zoSessionId }, JWT_SECRET);
    zoToken2 = jwt.sign({ user_id: zoUserId2, mobile_number: zoMobile2, role: 'zo', session_id: zoSessionId2 }, JWT_SECRET);

    // 4. Start Server on test port
    console.log(`[TEST] Starting application server on port ${PORT}...`);
    server = app.listen(PORT);

    // 5. Test Endpoint: GET /zo-balances (Role access and scope checks)
    console.log('[TEST] Checking GET /zo-balances endpoint access...');
    
    // ZO 1 balance check
    const zoBalRes = await fetch(`${BASE_URL}/zo-balances`, {
      headers: { Cookie: `accessToken=${zoToken}` }
    });
    const zoBalData = await zoBalRes.json();
    assert.strictEqual(zoBalRes.status, 200);
    assert(zoBalData.success, 'ZO balance query failed.');
    
    // Admin balance check (sees all)
    const adminBalRes = await fetch(`${BASE_URL}/zo-balances`, {
      headers: { Cookie: `accessToken=${adminToken}` }
    });
    const adminBalData = await adminBalRes.json();
    assert.strictEqual(adminBalRes.status, 200);
    assert(adminBalData.success, 'Admin balance query failed.');
    assert(Array.isArray(adminBalData.balances), 'Balances must return as array.');

    // 6. Test Endpoint: POST /zo-balances/reconcile (Permission checking)
    console.log('[TEST] Checking POST /zo-balances/reconcile endpoint...');
    
    // ZO role should be blocked (403 Forbidden)
    const zoReconRes = await fetch(`${BASE_URL}/zo-balances/reconcile`, {
      method: 'POST',
      headers: { 
        Cookie: `accessToken=${zoToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    assert.strictEqual(zoReconRes.status, 403);
    console.log('  ZO reconciliation block (403) verified.');

    // Admin role should be allowed (200 OK)
    const adminReconRes = await fetch(`${BASE_URL}/zo-balances/reconcile`, {
      method: 'POST',
      headers: { 
        Cookie: `accessToken=${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    assert.strictEqual(adminReconRes.status, 200);
    const adminReconData = await adminReconRes.json();
    assert(adminReconData.success, 'Admin reconciliation execution failed.');
    console.log('  Admin reconciliation triggers successfully.');

    // 7. Business Rule Test: Mismatched WO Zonal Mapping (400 Bad Request)
    console.log('[TEST] Verifying project work order mapping consistency checks...');
    
    // Map JE to ZO 1
    await supabase.from('je_zo_mappings').insert({
      je_user_id: jeMobile,
      zo_user_id: zoMobile,
      is_active: true,
      assigned_by: adminMobile
    });

    // Create a project assigned to ZO 2
    const testWO = `WO_${suffix}`;
    await supabase.from('projects_master').insert({
      work_order_no: testWO,
      estimate_no: `EST_${suffix}`,
      zo_user_id: zoMobile2, // Owning Zonal Office is ZO 2
      work_order_value: 50000.00,
      status: 'Running',
      created_by: adminMobile,
      edited_by: adminMobile
    });

    // Attempt to map JE (under ZO 1) to Project (under ZO 2)
    const badMapRes = await fetch(`${BASE_URL}/work-order-mappings`, {
      method: 'POST',
      headers: {
        Cookie: `accessToken=${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        work_order_no: testWO,
        je_mobile_number: jeMobile
      })
    });
    const badMapData = await badMapRes.json();
    assert.strictEqual(badMapRes.status, 400);
    assert(badMapData.message.includes('Zonal Office mismatch'), 'Expected zonal office mismatch error.');
    console.log('  Mismatched WO mapping block (400) verified.');

    // Cleanup mappings & projects
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', testWO);

    // 8. Business Rule Test: Transfer JE Blocked because of pending requisitions
    console.log('[TEST] Checking JE transfer block on pending requisitions...');
    
    // Map JE to ZO 1
    await supabase.from('je_zo_mappings').insert({
      je_user_id: jeMobile,
      zo_user_id: zoMobile,
      is_active: true,
      assigned_by: adminMobile
    });

    // Create a mock pending requisition for this JE
    const reqNo = `REQ_${suffix}`;
    await supabase.from('requisitions').insert({
      requisition_no: reqNo,
      work_order_no: `WO_MOCK_${suffix}`,
      requisition_amount: 15000.00,
      status: 'Pending', // pending requisitions block transfers
      created_by: jeMobile,
      zo_user_id: zoMobile
    });

    // Attempt to transfer JE to ZO 2
    const transferRes = await fetch(`${BASE_URL}/user-mappings`, {
      method: 'POST',
      headers: {
        Cookie: `accessToken=${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        je_mobile_number: jeMobile,
        zo_mobile_number: zoMobile2
      })
    });
    const transferData = await transferRes.json();
    assert.strictEqual(transferRes.status, 400);
    assert(transferData.message.includes('pending or hold'), 'Expected transfer blocked error message.');
    console.log('  JE transfer block on active requisitions verified.');

    // Cleanup requisition
    await supabase.from('requisitions').delete().eq('requisition_no', reqNo);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);

    console.log('--- ALL API INTEGRATION TESTS PASSED SUCCESSFULLY (Exit 0) ---');
    cleanup(0);
  } catch (err) {
    console.error('[ERROR] API integration test failed:', err);
    cleanup(1);
  }

  async function cleanup(exitCode) {
    console.log('[TEST] Cleaning up test records...');
    try {
      if (server) server.close();
      await supabase.from('sessions').delete().in('id', [adminSessionId, zoSessionId, zoSessionId2]);
      await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, zoMobile2, jeMobile]);
    } catch (e) {
      console.error('Cleanup failed:', e);
    }
    process.exit(exitCode);
  }
}

runApiTests();
