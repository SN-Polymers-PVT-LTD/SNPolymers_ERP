const { supabase } = require('../../src/db/supabase');
const telegramService = require('../../src/services/telegram.service');
const {
  createEstimate,
  saveDraftItems,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview
} = require('../../src/controllers/estimates.controller');

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

async function testMilestone8() {
  console.log('=== RUNNING MILESTONE 8 INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const testZoMobile = '+918000000001';
  const testJeMobile = '+918000000002';
  const testOtherMobile = '+918000000003';
  const testHoMobile = '+918000000004';
  const testAdminMobile = '+918276071523';
  const testWorkOrder = 'WB_BAN_102'; // Running work order

  let testEstimateId = null;
  let testItemId = null;

  try {
    // 0. Setup: Prepare test users and estimate
    console.log('Setup: Preparing test users and estimate...');
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);

    // Insert Users (unconfigured telegram_chat_id initially)
    await supabase.from('authorised_users').insert([
      { mobile_number: testZoMobile, display_name: 'Test ZO User', role: 'zo', is_active: true, telegram_chat_id: null },
      { mobile_number: testJeMobile, display_name: 'Test JE User', role: 'je', is_active: true, telegram_chat_id: null },
      { mobile_number: testOtherMobile, display_name: 'Other JE User', role: 'je', is_active: true, telegram_chat_id: null },
      { mobile_number: testHoMobile, display_name: 'Test HO User', role: 'ho', is_active: true, telegram_chat_id: null }
    ]);

    // Clear active estimates for this work order to bypass unique checks
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Rejected by ZO', last_modified_by: testAdminMobile })
      .eq('work_order_no', testWorkOrder);

    // Insert test estimate in Draft
    const { data: estimate, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: testWorkOrder,
        estimate_no: 'EST-M8-TEMP',
        area_code: 'South Bengal',
        estimate_revision: 0,
        zonal_office_no: 'ZO-01',
        estimate_amount: 50000,
        estimate_status: 'Draft',
        created_by: testJeMobile,
        last_modified_by: testJeMobile
      })
      .select()
      .single();

    if (estErr) throw estErr;
    testEstimateId = estimate.estimate_id;

    // Create line item
    const { data: item, error: itemErr } = await supabase
      .from('project_cost_estimate_items')
      .insert({
        estimate_id: testEstimateId,
        material_main_head: 'Labour',
        material_sub_head: 'Unskilled',
        material_details: 'Unskilled Worker',
        unit: 'Nos',
        qty: 100,
        rate: 500,
        amount: 50000,
        rate_reference: 'M8 Test Reference'
      })
      .select()
      .single();

    if (itemErr) throw itemErr;
    testItemId = item.item_id;

    // -------------------------------------------------------------
    // Test 1: Verify Telegram module exports
    // -------------------------------------------------------------
    console.log('Test 1: Verifying Telegram service exports...');
    const hasSendOtp = typeof telegramService.sendOtp === 'function';
    const hasStartPolling = typeof telegramService.startPolling === 'function';
    const hasNotifyZo = typeof telegramService.notifyZoEstimateSubmitted === 'function';
    const hasNotifyHo = typeof telegramService.notifyHoEstimateApproved === 'function';

    if (hasSendOtp && hasStartPolling && hasNotifyZo && hasNotifyHo) {
      console.log('  [PASS] All 4 Telegram service functions are exported correctly.');
      passes++;
    } else {
      console.log('  [FAIL] Missing Telegram service exports:', { hasSendOtp, hasStartPolling, hasNotifyZo, hasNotifyHo });
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2a: Telegram Fallback - Missing Token
    // -------------------------------------------------------------
    console.log('\nTest 2a: Testing Telegram fallback (missing bot token)...');
    
    // Save token and unset it
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    const reqSubmit = {
      params: { id: testEstimateId },
      user: { role: 'je', mobile_number: testJeMobile }
    };
    const res2a = mockRes();
    
    try {
      // Attempt submit estimate
      await submitEstimate(reqSubmit, res2a);
    } finally {
      // Restore token immediately
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }

    // Verify 200 and successful transition in DB (no transaction rollback)
    const { data: dbEst2a } = await supabase
      .from('project_cost_estimates')
      .select('estimate_status')
      .eq('estimate_id', testEstimateId)
      .single();

    if (res2a.statusCode === 200 && dbEst2a.estimate_status === 'Submitted') {
      console.log('  [PASS] Gracefully submitted estimate with missing token (Transitions succeeded, no rollbacks).');
      passes++;
    } else {
      console.log('  [FAIL] Missing token caused failure or rollback. Status:', res2a.statusCode, 'DB Status:', dbEst2a?.estimate_status);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2b: Telegram Fallback - Zero Recipients
    // -------------------------------------------------------------
    console.log('\nTest 2b: Testing Telegram fallback (zero recipients configured)...');
    
    // Reset status back to Draft to re-submit
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Draft', estimate_revision: 0 })
      .eq('estimate_id', testEstimateId);

    // Keep bot token, but ZO user has null telegram_chat_id (configured in setup)
    const res2b = mockRes();
    await submitEstimate(reqSubmit, res2b);

    const { data: dbEst2b } = await supabase
      .from('project_cost_estimates')
      .select('estimate_status')
      .eq('estimate_id', testEstimateId)
      .single();

    if (res2b.statusCode === 200 && dbEst2b.estimate_status === 'Submitted') {
      console.log('  [PASS] Gracefully submitted estimate with zero ZO telegram users configured (Transitions succeeded).');
      passes++;
    } else {
      console.log('  [FAIL] Zero recipients fallback failed. Status:', res2b.statusCode, 'DB Status:', dbEst2b?.estimate_status);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2c: Telegram Fallback - API Failure simulation
    // -------------------------------------------------------------
    console.log('\nTest 2c: Testing Telegram fallback (simulated API failure)...');
    
    // Reset status back to Draft
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Draft', estimate_revision: 0 })
      .eq('estimate_id', testEstimateId);

    // Stub notifyZoEstimateSubmitted to throw a simulated error
    const originalNotify = telegramService.notifyZoEstimateSubmitted;
    telegramService.notifyZoEstimateSubmitted = async () => {
      throw new Error('Simulated Telegram API crash');
    };

    const res2c = mockRes();
    try {
      await submitEstimate(reqSubmit, res2c);
    } finally {
      // Restore stub
      telegramService.notifyZoEstimateSubmitted = originalNotify;
    }

    const { data: dbEst2c } = await supabase
      .from('project_cost_estimates')
      .select('estimate_status')
      .eq('estimate_id', testEstimateId)
      .single();

    if (res2c.statusCode === 200 && dbEst2c.estimate_status === 'Submitted') {
      console.log('  [PASS] Gracefully submitted estimate despite simulated Telegram crash (No transaction rollback occurred).');
      passes++;
    } else {
      console.log('  [FAIL] Simulated Telegram crash broke flow or rolled back status. Status:', res2c.statusCode, 'DB Status:', dbEst2c?.estimate_status);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Manual Audit Log Validation (Multiple Workflow Transitions)
    // -------------------------------------------------------------
    console.log('\nTest 3: Verifying manual status transition audit record structure...');
    
    // Clean up audit logs for this estimate first to be precise
    await supabase.from('audit_log').delete().eq('record_identifier', String(testEstimateId));

    // Transition A: Draft -> Submitted (performed by JE testJeMobile)
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Draft', estimate_revision: 0 })
      .eq('estimate_id', testEstimateId);

    const resSubmit = mockRes();
    await submitEstimate(reqSubmit, resSubmit);

    // Retrieve audit logs for Transition A
    const { data: auditLogsA } = await supabase
      .from('audit_log')
      .select('*')
      .eq('record_identifier', String(testEstimateId))
      .eq('action', 'STATUS_CHANGE')
      .order('timestamp', { ascending: false });

    let stepAPass = false;
    if (auditLogsA && auditLogsA.length > 0) {
      const log = auditLogsA[0];
      const hasAction = log.action === 'STATUS_CHANGE';
      const hasModule = log.module_name === 'Project Cost Estimate';
      const hasRecord = log.record_identifier === String(testEstimateId);
      const hasUser = log.user_id === testJeMobile;
      const hasOldValue = log.old_value?.estimate_status === 'Draft' && log.old_value?.estimate_revision === 0;
      const hasNewValue = log.new_value?.estimate_status === 'Submitted' && log.new_value?.estimate_revision === 1;

      if (hasAction && hasModule && hasRecord && hasUser && hasOldValue && hasNewValue) {
        console.log('  [PASS] Transition A (Draft -> Submitted) STATUS_CHANGE audit entry verified.');
        stepAPass = true;
      } else {
        console.log('  [FAIL] Transition A audit log values mismatch:', { log });
      }
    } else {
      console.log('  [FAIL] No STATUS_CHANGE audit log record found for Transition A.');
    }

    // Transition B: Submitted -> Under ZO Review (performed by ZO testZoMobile)
    const reqZoReview = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile }
    };
    const resZoReview = mockRes();
    await reviewEstimate(reqZoReview, resZoReview);

    // Retrieve audit logs for Transition B
    const { data: auditLogsB } = await supabase
      .from('audit_log')
      .select('*')
      .eq('record_identifier', String(testEstimateId))
      .eq('action', 'STATUS_CHANGE')
      .order('timestamp', { ascending: false });

    let stepBPass = false;
    if (auditLogsB && auditLogsB.length > 0) {
      const log = auditLogsB[0];
      const hasAction = log.action === 'STATUS_CHANGE';
      const hasModule = log.module_name === 'Project Cost Estimate';
      const hasRecord = log.record_identifier === String(testEstimateId);
      const hasUser = log.user_id === testZoMobile;
      const hasOldValue = log.old_value?.estimate_status === 'Submitted' && log.old_value?.estimate_revision === 1;
      const hasNewValue = log.new_value?.estimate_status === 'Under ZO Review' && log.new_value?.estimate_revision === 1;

      if (hasAction && hasModule && hasRecord && hasUser && hasOldValue && hasNewValue) {
        console.log('  [PASS] Transition B (Submitted -> Under ZO Review) STATUS_CHANGE audit entry verified.');
        stepBPass = true;
      } else {
        console.log('  [FAIL] Transition B audit log values mismatch:', { log });
      }
    } else {
      console.log('  [FAIL] No STATUS_CHANGE audit log record found for Transition B.');
    }

    // Transition C: Under ZO Review -> ZO Approved
    await supabase.from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Approve' })
      .eq('estimate_id', testEstimateId);

    const reqZoSubmitReview = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile },
      body: { remarks: 'ZO approved' }
    };
    const resZoSubmitReview = mockRes();
    await submitReview(reqZoSubmitReview, resZoSubmitReview);

    // Retrieve audit logs for Transition C
    const { data: auditLogsC } = await supabase
      .from('audit_log')
      .select('*')
      .eq('record_identifier', String(testEstimateId))
      .eq('action', 'STATUS_CHANGE')
      .order('timestamp', { ascending: false });

    let stepCPass = false;
    if (auditLogsC && auditLogsC.length > 0) {
      const log = auditLogsC[0];
      const hasAction = log.action === 'STATUS_CHANGE';
      const hasModule = log.module_name === 'Project Cost Estimate';
      const hasRecord = log.record_identifier === String(testEstimateId);
      const hasUser = log.user_id === testZoMobile;
      const hasOldValue = log.old_value?.estimate_status === 'Under ZO Review' && log.old_value?.estimate_revision === 1;
      const hasNewValue = log.new_value?.estimate_status === 'ZO Approved' && log.new_value?.estimate_revision === 1;

      if (hasAction && hasModule && hasRecord && hasUser && hasOldValue && hasNewValue) {
        console.log('  [PASS] Transition C (Under ZO Review -> ZO Approved) STATUS_CHANGE audit entry verified.');
        stepCPass = true;
      } else {
        console.log('  [FAIL] Transition C audit log values mismatch:', { log });
      }
    } else {
      console.log('  [FAIL] No STATUS_CHANGE audit log record found for Transition C.');
    }

    // Transition D: ZO Approved -> Under HO Review (performed by HO testHoMobile)
    const reqHoReview = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile }
    };
    const resHoReview = mockRes();
    await reviewEstimate(reqHoReview, resHoReview);

    // Retrieve audit logs for Transition D
    const { data: auditLogsD } = await supabase
      .from('audit_log')
      .select('*')
      .eq('record_identifier', String(testEstimateId))
      .eq('action', 'STATUS_CHANGE')
      .order('timestamp', { ascending: false });

    let stepDPass = false;
    if (auditLogsD && auditLogsD.length > 0) {
      const log = auditLogsD[0];
      const hasAction = log.action === 'STATUS_CHANGE';
      const hasModule = log.module_name === 'Project Cost Estimate';
      const hasRecord = log.record_identifier === String(testEstimateId);
      const hasUser = log.user_id === testHoMobile;
      const hasOldValue = log.old_value?.estimate_status === 'ZO Approved' && log.old_value?.estimate_revision === 1;
      const hasNewValue = log.new_value?.estimate_status === 'Under HO Review' && log.new_value?.estimate_revision === 1;

      if (hasAction && hasModule && hasRecord && hasUser && hasOldValue && hasNewValue) {
        console.log('  [PASS] Transition D (ZO Approved -> Under HO Review) STATUS_CHANGE audit entry verified.');
        stepDPass = true;
      } else {
        console.log('  [FAIL] Transition D audit log values mismatch:', { log });
      }
    } else {
      console.log('  [FAIL] No STATUS_CHANGE audit log record found for Transition D.');
    }

    // Transition E: Under HO Review -> Final Approved (performed by HO testHoMobile)
    await supabase.from('project_cost_estimate_items')
      .update({ ho_office_approve: 'Approve' })
      .eq('estimate_id', testEstimateId);

    const reqHoSubmitReview = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile },
      body: { remarks: 'HO approved' }
    };
    const resHoSubmitReview = mockRes();
    await submitReview(reqHoSubmitReview, resHoSubmitReview);

    // Retrieve audit logs for Transition E
    const { data: auditLogsE } = await supabase
      .from('audit_log')
      .select('*')
      .eq('record_identifier', String(testEstimateId))
      .eq('action', 'STATUS_CHANGE')
      .order('timestamp', { ascending: false });

    let stepEPass = false;
    if (auditLogsE && auditLogsE.length > 0) {
      const log = auditLogsE[0];
      const hasAction = log.action === 'STATUS_CHANGE';
      const hasModule = log.module_name === 'Project Cost Estimate';
      const hasRecord = log.record_identifier === String(testEstimateId);
      const hasUser = log.user_id === testHoMobile;
      const hasOldValue = log.old_value?.estimate_status === 'Under HO Review' && log.old_value?.estimate_revision === 1;
      const hasNewValue = log.new_value?.estimate_status === 'Final Approved' && log.new_value?.estimate_revision === 1;

      if (hasAction && hasModule && hasRecord && hasUser && hasOldValue && hasNewValue) {
        console.log('  [PASS] Transition E (Under HO Review -> Final Approved) STATUS_CHANGE audit entry verified.');
        stepEPass = true;
      } else {
        console.log('  [FAIL] Transition E audit log values mismatch:', { log });
      }
    } else {
      console.log('  [FAIL] No STATUS_CHANGE audit log record found for Transition E.');
    }

    if (stepAPass && stepBPass && stepCPass && stepDPass && stepEPass) {
      console.log('  [PASS] All manual status transitions and their audit logs are fully verified.');
      passes++;
    } else {
      console.log('  [FAIL] One or more manual audit transition checks failed.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Auto-Resubmit Audit Log Validation
    // -------------------------------------------------------------
    console.log('\nTest 4: Verifying auto-resubmission AUTO_RESUBMIT audit record structure...');
    
    // Set to ZO Revision Requested status
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'ZO Revision Requested', estimate_revision: 1 })
      .eq('estimate_id', testEstimateId);

    // Clean up audit logs first so we can assert exact count
    await supabase.from('audit_log').delete().eq('record_identifier', String(testEstimateId)).eq('action', 'AUTO_RESUBMIT');

    // Create expired revision log
    const expiredDate = new Date();
    expiredDate.setMinutes(expiredDate.getMinutes() - 10);
    
    const { error: logErr } = await supabase.from('estimate_revision_log').insert({
      estimate_id: testEstimateId,
      revision_cycle: 1,
      stage: 'ZO',
      requested_by: testZoMobile,
      revision_deadline: expiredDate.toISOString(),
      created_at: expiredDate.toISOString()
    });
    if (logErr) throw logErr;

    // Trigger auto-resubmit via reviewEstimate call
    const reqReview = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile }
    };
    await reviewEstimate(reqReview, mockRes());

    // Fetch the AUTO_RESUBMIT audit log
    const { data: resubAuditLogs } = await supabase
      .from('audit_log')
      .select('*')
      .eq('record_identifier', String(testEstimateId))
      .eq('action', 'AUTO_RESUBMIT');

    if (resubAuditLogs && resubAuditLogs.length === 1) {
      const log = resubAuditLogs[0];
      const hasAction = log.action === 'AUTO_RESUBMIT';
      const hasModule = log.module_name === 'Project Cost Estimate';
      const isUserIdNull = log.user_id === null; // Strictly NULL
      const isUserIdNotSystem = log.user_id !== 'SYSTEM'; // Guard against legacy string
      const oldStatusOk = log.old_value?.estimate_status === 'ZO Revision Requested';
      const newStatusOk = log.new_value?.estimate_status === 'Submitted';

      if (hasAction && hasModule && isUserIdNull && isUserIdNotSystem && oldStatusOk && newStatusOk) {
        console.log('  [PASS] Auto-resubmission AUTO_RESUBMIT audit entry fully verified (user_id is strictly null and not "SYSTEM").');
        passes++;
      } else {
        console.log('  [FAIL] AUTO_RESUBMIT audit log values mismatch:', {
          hasAction, hasModule, isUserIdNull, isUserIdNotSystem, oldStatusOk, newStatusOk, log
        });
        fails++;
      }
    } else {
      console.log('  [FAIL] Expected exactly one AUTO_RESUBMIT audit log entry, found:', resubAuditLogs?.length);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Verify Auth OTP delivery console fallback intact
    // -------------------------------------------------------------
    console.log('\nTest 5: Verifying Phase 1 auth OTP delivery console fallback remains functional...');
    
    const otpResult = await telegramService.sendOtp(null, '123456');
    
    if (otpResult && otpResult.success && otpResult.mode === 'console') {
      console.log('  [PASS] sendOtp console fallback works correctly without regression.');
      passes++;
    } else {
      console.log('  [FAIL] sendOtp console fallback failed:', otpResult);
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error during test run:', err);
    fails++;
  } finally {
    // Clean up test data
    console.log('\nCleaning up integration test data...');
    if (testEstimateId) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', testEstimateId);
      await supabase.from('project_cost_estimates')
        .update({
          estimate_status: 'Rejected by ZO',
          created_by: '+918276071523',
          last_modified_by: '+918276071523',
          je_user_id: '+918276071523',
          zo_approved_by: null,
          ho_approved_by: null
        })
        .eq('estimate_id', testEstimateId);
      await supabase.from('estimate_revision_log').delete().eq('estimate_id', testEstimateId);
    }
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);
    console.log('  [PASS] Test data cleaned up.');
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE 8 INTEGRATION TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME INTEGRATION TESTS FAILED. <<<');
    process.exit(1);
  }
}

module.exports = { testMilestone8 };

// If run directly
if (require.main === module) {
  testMilestone8();
}
