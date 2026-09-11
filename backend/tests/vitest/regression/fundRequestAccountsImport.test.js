import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const mockRes = require('../../helpers/mockRes');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const {
  createSheet, updateLineItem, submitSheet, actOnLineItem, deleteLineItem,
  getImportEligibleItems, importLineItem, dismissImportEligibleItem
} = require('../../../src/controllers/acctRequisition.controller');
const { actOnFundRequest } = require('../../../src/controllers/fundRequests.controller');
const { supabase } = require('../../../src/db/supabase');

describe('Fund Request -> Accounts Sheet Integration & ZO Balance Credit', () => {
  let ctx;
  let zoMobile;
  let workOrder;
  let estimateNo;
  let createdFrIds = [];

  async function callCreateSheet(mobile) {
    const req = { body: {}, user: { role: 'accounts', mobile_number: mobile } };
    const res = mockRes();
    await createSheet(req, res);
    return res;
  }

  async function callUpdateLineItem(sheetId, itemId, mobile, body) {
    const req = { params: { sheetId, itemId }, body, user: { role: 'accounts', mobile_number: mobile } };
    const res = mockRes();
    await updateLineItem(req, res);
    return res;
  }

  async function callSubmitSheet(sheetId, mobile) {
    const req = { params: { sheetId }, user: { role: 'accounts', mobile_number: mobile } };
    const res = mockRes();
    await submitSheet(req, res);
    return res;
  }

  async function callActOnLineItem(itemId, mobile, body) {
    const req = { params: { itemId }, body, user: { role: 'ho', mobile_number: mobile, permissions: {} } };
    const res = mockRes();
    await actOnLineItem(req, res);
    return res;
  }

  async function callGetEligible(query, mobile) {
    const req = { query, user: { role: 'accounts', mobile_number: mobile } };
    const res = mockRes();
    await getImportEligibleItems(req, res);
    return res;
  }

  async function callImportLineItem(itemId, targetSheetId, itemType, mobile) {
    const req = {
      params: { itemId },
      body: { target_sheet_id: targetSheetId, item_type: itemType },
      user: { role: 'accounts', mobile_number: mobile }
    };
    const res = mockRes();
    await importLineItem(req, res);
    return res;
  }

  async function callDismissLineItem(itemId, itemType, mobile) {
    const req = {
      params: { itemId },
      body: { item_type: itemType },
      user: { role: 'accounts', mobile_number: mobile }
    };
    const res = mockRes();
    await dismissImportEligibleItem(req, res);
    return res;
  }

  async function callDeleteLineItem(sheetId, itemId, mobile) {
    const req = { params: { sheetId, itemId }, user: { role: 'accounts', mobile_number: mobile } };
    const res = mockRes();
    await deleteLineItem(req, res);
    return res;
  }

  async function callDirectFundRequestAction(fundRequestId, mobile, body) {
    const req = { params: { id: fundRequestId }, body, user: { role: 'accounts', mobile_number: mobile } };
    const res = mockRes();
    await actOnFundRequest(req, res);
    return res;
  }

  async function createTestFundRequest({ amount = 15000, remarks = 'Site advance' } = {}) {
    const frNo = `ZO/FR/TEST/${crypto.randomUUID().substring(0, 8)}`;
    const { data: fr, error } = await supabase
      .from('fund_requests')
      .insert({
        zo_user_id: zoMobile,
        zo_fr_no: frNo,
        zo_fr_amount: amount,
        zo_remarks: remarks,
        work_order_no: workOrder,
        beneficiary_name: 'Test Supplier',
        beneficiary_ac_no: '9876543210',
        beneficiary_ifsc: 'TEST0001234',
        beneficiary_bank_name: 'State Bank of India',
        created_by: zoMobile
      })
      .select()
      .single();

    if (error) throw error;
    createdFrIds.push(fr.fund_request_id);
    return fr;
  }

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();
    zoMobile = `9530${ctx.id}`;
    workOrder = `WO_FR_${ctx.id}`;
    estimateNo = `EST_FR_${ctx.id}`;

    await setupUsers([
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO Test ${ctx.id}` }
    ]);

    await setupProject(workOrder, estimateNo, 500000.00, ctx.adminMobile);

    const { error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: workOrder,
        estimate_no: estimateNo,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO',
        estimate_amount: 200000.00,
        estimate_status: 'Final Approved',
        created_by: ctx.adminMobile,
        last_modified_by: ctx.adminMobile
      });
    if (estErr) throw estErr;
  });

  afterAll(async () => {
    if (createdFrIds.length > 0) {
      await supabase.from('fund_requests').delete().in('fund_request_id', createdFrIds);
    }
    if (workOrder) {
      await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    }
    await supabase.from('authorised_users').delete().eq('mobile_number', zoMobile);
    await cleanupAcctRequisitionScenario(ctx);
  });

  test('ZO-submitted Fund Request appears in Accounts Import Eligible Items list', async () => {
    const fr = await createTestFundRequest({ amount: 12000, remarks: 'Electrical supplies' });

    const res = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);

    const match = (res.jsonData.items || []).find(i => i.id === fr.fund_request_id);
    expect(match).toBeDefined();
    expect(match.item_type).toBe('FUND_REQUEST');
    expect(match.sheet_number).toBe(fr.zo_fr_no);
    expect(match.requisition_status).toBe('Pending Review');
    expect(match.particulars).toBe('Electrical supplies');
    expect(match.req_amount).toBe(12000);
    expect(match.beneficiary_name).toBe('Test Supplier');
  });

  test('Importing a Fund Request creates an Accounts Sheet line item and tracks on fund_requests', async () => {
    const fr = await createTestFundRequest({ amount: 18000, remarks: 'Cement and sand advance' });

    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const importRes = await callImportLineItem(fr.fund_request_id, sheet.id, 'FUND_REQUEST', ctx.accountsMobile);
    expect(importRes.statusCode).toBe(201);
    expect(importRes.jsonData.success).toBe(true);
    expect(importRes.jsonData.item).toBeDefined();

    const createdItem = importRes.jsonData.item;
    ctx.itemIds.push(createdItem.id);
    expect(createdItem.source_fund_request_id).toBe(fr.fund_request_id);
    expect(createdItem.account_sub_title_text).toBe('Fund Request');
    expect(Number(createdItem.req_amount)).toBe(18000);
    expect(createdItem.particulars).toBe('Cement and sand advance');
    expect(createdItem.beneficiary_name).toBe('Test Supplier');

    // Verify fund_requests row is updated with accounts_line_item_id
    const { data: updatedFr } = await supabase
      .from('fund_requests')
      .select('accounts_line_item_id, accounts_imported_at')
      .eq('fund_request_id', fr.fund_request_id)
      .single();

    expect(updatedFr.accounts_line_item_id).toBe(createdItem.id);
    expect(updatedFr.accounts_imported_at).not.toBeNull();

    // Verify it no longer appears in getImportEligibleItems
    const eligibleRes = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    const inEligible = (eligibleRes.jsonData.items || []).find(i => i.id === fr.fund_request_id);
    expect(inEligible).toBeUndefined();
  });

  test('Deleting imported line item from Open sheet resets fund_requests tracking and restores eligibility', async () => {
    const fr = await createTestFundRequest({ amount: 14000, remarks: 'Plumbing materials' });

    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const importRes = await callImportLineItem(fr.fund_request_id, sheet.id, 'FUND_REQUEST', ctx.accountsMobile);
    const itemId = importRes.jsonData.item.id;

    // Delete the imported line item from the open sheet
    const delRes = await callDeleteLineItem(sheet.id, itemId, ctx.accountsMobile);
    expect(delRes.statusCode).toBe(200);

    // Verify fund_requests tracking is cleared
    const { data: clearedFr } = await supabase
      .from('fund_requests')
      .select('accounts_line_item_id, accounts_imported_at')
      .eq('fund_request_id', fr.fund_request_id)
      .single();

    expect(clearedFr.accounts_line_item_id).toBeNull();
    expect(clearedFr.accounts_imported_at).toBeNull();

    // Verify it reappears in eligible list
    const eligibleRes = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    const restored = (eligibleRes.jsonData.items || []).find(i => i.id === fr.fund_request_id);
    expect(restored).toBeDefined();
  });

  test('an imported Fund Request cannot bypass Accounts Sheet approval through the direct action endpoint', async () => {
    const fr = await createTestFundRequest({ amount: 16000, remarks: 'Direct approval bypass guard' });
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const importRes = await callImportLineItem(fr.fund_request_id, sheet.id, 'FUND_REQUEST', ctx.accountsMobile);
    ctx.itemIds.push(importRes.jsonData.item.id);

    const { data: beforeBalance } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zoMobile)
      .maybeSingle();

    const actionRes = await callDirectFundRequestAction(fr.fund_request_id, ctx.accountsMobile, {
      action: 'Approve',
      approve_ho_amount: 16000,
      transfer_from_account: 'CC',
      ho_remarks: 'Must be rejected; request is already in a sheet.'
    });

    expect(actionRes.statusCode).toBe(409);

    const { data: afterFr } = await supabase
      .from('fund_requests')
      .select('request_status, approve_ho_amount, accounts_line_item_id')
      .eq('fund_request_id', fr.fund_request_id)
      .single();
    expect(afterFr.request_status).toBe('Pending');
    expect(afterFr.approve_ho_amount).toBeNull();
    expect(afterFr.accounts_line_item_id).toBe(importRes.jsonData.item.id);

    const { data: afterBalance } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zoMobile)
      .maybeSingle();
    expect(Number(afterBalance?.available_balance || 0)).toBe(Number(beforeBalance?.available_balance || 0));

    const { count: ledgerCount } = await supabase
      .from('zo_fund_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('reference_id', fr.fund_request_id)
      .eq('transaction_type', 'ALLOCATION');
    expect(ledgerCount).toBe(0);
  });

  test('Dismissing an eligible Fund Request removes it from the import list', async () => {
    const fr = await createTestFundRequest({ amount: 5000, remarks: 'Temporary tools' });

    const dismissRes = await callDismissLineItem(fr.fund_request_id, 'FUND_REQUEST', ctx.accountsMobile);
    expect(dismissRes.statusCode).toBe(200);

    const { data: dismissedFr } = await supabase
      .from('fund_requests')
      .select('accounts_import_dismissed')
      .eq('fund_request_id', fr.fund_request_id)
      .single();

    expect(dismissedFr.accounts_import_dismissed).toBe(true);

    const eligibleRes = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    const inEligible = (eligibleRes.jsonData.items || []).find(i => i.id === fr.fund_request_id);
    expect(inEligible).toBeUndefined();
  });

  test('End-to-end: HO approval debits bank, credits ZO balance, logs ledger, and updates Fund Request', async () => {
    const fr = await createTestFundRequest({ amount: 25000, remarks: 'Site fencing and labour advance' });

    // 1. Accounts creates sheet and imports FR
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const importRes = await callImportLineItem(fr.fund_request_id, sheet.id, 'FUND_REQUEST', ctx.accountsMobile);
    const item = importRes.jsonData.item;
    ctx.itemIds.push(item.id);

    // 2. Accounts fills in payment mode and debit bank
    const updateRes = await callUpdateLineItem(sheet.id, item.id, ctx.accountsMobile, {
      debit_bank_ac_type: ctx.bankName,
      payment_mode: 'NEFT'
    });
    expect(updateRes.statusCode).toBe(200);

    // 3. Accounts submits sheet to HO
    const submitRes = await callSubmitSheet(sheet.id, ctx.accountsMobile);
    expect(submitRes.statusCode).toBe(200);

    // Fetch initial bank balance and zo balance
    const { data: bbmBefore } = await supabase
      .from('bank_balance_master')
      .select('available_balance')
      .eq('bank_name', ctx.bankName)
      .single();
    const initialBankBal = Number(bbmBefore.available_balance);

    const { data: zoBalBefore } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zoMobile)
      .maybeSingle();
    const initialZoBal = Number(zoBalBefore?.available_balance || 0);

    // 4. HO approves the line item
    const actRes = await callActOnLineItem(item.id, ctx.ho1Mobile, {
      action: 'Approve',
      ho_pass_amount: 25000,
      ho_remarks: 'Approved for fencing advance'
    });
    expect(actRes.statusCode).toBe(200);

    // 5. Invariant Checks
    // 5a. Bank Balance debited
    const { data: bbmAfter } = await supabase
      .from('bank_balance_master')
      .select('available_balance')
      .eq('bank_name', ctx.bankName)
      .single();
    expect(Number(bbmAfter.available_balance)).toBe(initialBankBal - 25000);

    // 5b. ZO Balance credited
    const { data: zoBalAfter } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zoMobile)
      .single();
    expect(Number(zoBalAfter.available_balance)).toBe(initialZoBal + 25000);

    // 5c. ZO Fund Ledger ALLOCATION row created
    const { data: ledgerEntry } = await supabase
      .from('zo_fund_ledger')
      .select('*')
      .eq('reference_id', fr.fund_request_id)
      .eq('transaction_type', 'ALLOCATION')
      .single();
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.zo_user_id).toBe(zoMobile);
    expect(Number(ledgerEntry.amount)).toBe(25000);
    expect(ledgerEntry.work_order_no).toBe(workOrder);

    // 5d. fund_requests row updated to Approved
    const { data: finalFr } = await supabase
      .from('fund_requests')
      .select('*')
      .eq('fund_request_id', fr.fund_request_id)
      .single();
    expect(finalFr.request_status).toBe('Approved');
    expect(Number(finalFr.approve_ho_amount)).toBe(25000);
    expect(finalFr.transfer_from_account).toBe(ctx.bankName);
    expect(finalFr.approve_ho_user_id).toBe(ctx.ho1Mobile);
    expect(finalFr.ho_remarks).toBe('Approved for fencing advance');
    expect(finalFr.approve_ho_date).not.toBeNull();
  });

  test('HO non-approve action (Hold) propagates to fund_requests without debiting bank or crediting ZO', async () => {
    const fr = await createTestFundRequest({ amount: 16000, remarks: 'Safety gear' });

    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const importRes = await callImportLineItem(fr.fund_request_id, sheet.id, 'FUND_REQUEST', ctx.accountsMobile);
    const item = importRes.jsonData.item;
    ctx.itemIds.push(item.id);

    await callUpdateLineItem(sheet.id, item.id, ctx.accountsMobile, {
      debit_bank_ac_type: ctx.bankName,
      payment_mode: 'NEFT'
    });

    await callSubmitSheet(sheet.id, ctx.accountsMobile);

    const { data: bbmBefore } = await supabase
      .from('bank_balance_master')
      .select('available_balance')
      .eq('bank_name', ctx.bankName)
      .single();

    const { data: zoBalBefore } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zoMobile)
      .maybeSingle();

    // HO puts item on Hold
    const actRes = await callActOnLineItem(item.id, ctx.ho1Mobile, {
      action: 'Hold',
      ho_remarks: 'Needs revised quotation'
    });
    expect(actRes.statusCode).toBe(200);

    // Verify fund_requests status updated to Hold
    const { data: heldFr } = await supabase
      .from('fund_requests')
      .select('request_status, ho_remarks')
      .eq('fund_request_id', fr.fund_request_id)
      .single();
    expect(heldFr.request_status).toBe('Hold');
    expect(heldFr.ho_remarks).toBe('Needs revised quotation');

    // Verify balances untouched
    const { data: bbmAfter } = await supabase
      .from('bank_balance_master')
      .select('available_balance')
      .eq('bank_name', ctx.bankName)
      .single();
    expect(Number(bbmAfter.available_balance)).toBe(Number(bbmBefore.available_balance));

    const { data: zoBalAfter } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zoMobile)
      .maybeSingle();
    expect(Number(zoBalAfter?.available_balance || 0)).toBe(Number(zoBalBefore?.available_balance || 0));
  });
});
