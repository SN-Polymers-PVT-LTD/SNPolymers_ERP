import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');

// Migration 052: Payment Requisition -> ZO Payment / Accounts Routing.
// approve_requisition_transact no longer debits zo_balances - that moved into
// select_zo_balance_payment_transact, run only when the ZO explicitly picks
// the ZO Balance route. route_requisition_to_accounts_transact is the other
// route: it creates an Accounts line item (source_requisition_id-linked) in
// an Open sheet, prefilled from Finance data, leaving Accounts-owned fields
// (debit account / payment mode / cheque) NULL.
describe('Payment Requisition -> ZO Payment / Accounts Routing', () => {
  let suffix;
  let jeMobile, zoMobile, adminMobile;
  let workOrder, estimateNo, estimateId, itemId;
  const createdReqIds = [];
  const createdItemIds = [];
  const createdSheetIds = [];

  async function createApprovedRequisition({ amount, approvedAmount, beneficiary = true, remarks = 'Pipe material' }) {
    const reqNo = `REQ_RTE_${crypto.randomUUID().substring(0, 8)}`;
    const { data: created, error: createErr } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: jeMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: reqNo,
      p_material_main_head: 'Material',
      p_requisition_pdf_url: 'requisitions/pdf.pdf',
      p_original_filename: 'pdf.pdf',
      p_requisition_amount: amount,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: remarks,
      p_requisition_status: 'Pending',
      p_created_by: jeMobile,
      p_beneficiary_name: beneficiary ? 'ABC Contractors' : null,
      p_beneficiary_ac_no: beneficiary ? '1234567890' : null,
      p_beneficiary_ifsc: beneficiary ? 'TEST0001234' : null,
      p_beneficiary_bank_name: beneficiary ? 'Test Bank' : null
    });
    if (createErr) throw createErr;
    const reqId = created.requisition_id;
    createdReqIds.push(reqId);

    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqId);

    const { error: appErr } = await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqId,
      p_approved_amount: approvedAmount,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved for routing test'
    });
    if (appErr) throw appErr;

    return reqId;
  }

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9531${suffix}`;
    zoMobile = `9532${suffix}`;
    adminMobile = `9533${suffix}`;
    workOrder = `TEST_WO_RTE_${suffix}`;
    estimateNo = `EST_RTE_${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Test Admin ${suffix}` },
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `Test JE ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `Test ZO ${suffix}` }
    ]);

    await setupProject(workOrder, estimateNo, 1000000.00, adminMobile);

    const { data: estData, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrder,
        estimate_no: estimateNo,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_RTE',
        estimate_amount: 100000.00,
        estimate_status: 'Final Approved',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();
    if (estErr) throw estErr;
    estimateId = estData.estimate_id;

    const { data: itemData, error: itemErr } = await supabase
      .from('project_cost_estimate_items')
      .insert([{
        estimate_id: estimateId,
        material_main_head: 'Material',
        material_sub_head: 'General',
        material_details: 'Test Material',
        unit: 'nos',
        qty: 100.00,
        rate: 1000.00,
        amount: 100000.00
      }])
      .select()
      .single();
    if (itemErr) throw itemErr;
    itemId = itemData.item_id;

    const { error: balErr } = await supabase
      .from('zo_balances')
      .upsert({ zo_user_id: zoMobile, available_balance: 20000.00 })
      .select();
    if (balErr) throw balErr;
  });

  afterAll(async () => {
    for (const itemId of createdItemIds) {
      await supabase.from('acct_requisition_line_items').delete().eq('id', itemId);
    }
    for (const sheetId of createdSheetIds) {
      await supabase.from('acct_requisition_sheets').delete().eq('id', sheetId);
    }
    for (const reqId of createdReqIds) {
      await supabase.from('requisitions').delete().eq('requisition_id', reqId);
    }
    await supabase.from('zo_fund_ledger').delete().eq('zo_user_id', zoMobile);
    if (itemId) await supabase.from('project_cost_estimate_items').delete().eq('item_id', itemId);
    if (estimateId) await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    await supabase.from('zo_balances').delete().eq('zo_user_id', zoMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile, adminMobile]);
  });

  test('approve_requisition_transact no longer touches zo_balances', async () => {
    const balBefore = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;

    const reqId = await createApprovedRequisition({ amount: 5000, approvedAmount: 5000 });

    const balAfter = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;
    expect(Number(balAfter)).toBe(Number(balBefore));

    const { data: req } = await supabase.from('requisitions').select('*').eq('requisition_id', reqId).single();
    expect(req.requisition_status).toBe('Approved');
    expect(req.payment_destination).toBeNull();
  });

  test('route_requisition_to_accounts_transact creates a line item with the correct field mapping and never touches zo_balances', async () => {
    const balBefore = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;

    // Partial approval: requisition_amount 10,000, approved_amount 6,000 -
    // the Accounts line item must receive the approved amount, not the requested one.
    const reqId = await createApprovedRequisition({ amount: 10000, approvedAmount: 6000, remarks: '  Pipe material  ' });

    const { data, error } = await supabase.rpc('route_requisition_to_accounts_transact', {
      p_requisition_id: reqId,
      p_actor: zoMobile
    });
    expect(error).toBeNull();
    createdItemIds.push(data.line_item.id);
    createdSheetIds.push(data.sheet.id);

    expect(data.line_item.source_requisition_id).toBe(reqId);
    expect(Number(data.line_item.req_amount)).toBe(6000);
    expect(data.line_item.particulars).toBe('Pipe material');
    expect(data.line_item.account_sub_title_text).toBe('Material');
    expect(data.line_item.beneficiary_name).toBe('ABC Contractors');
    expect(data.line_item.beneficiary_ac_no).toBe('1234567890');
    expect(data.line_item.beneficiary_ifsc).toBe('TEST0001234');
    expect(data.line_item.work_order_no).toBe(workOrder);
    expect(data.line_item.debit_bank_ac_type).toBeNull();
    expect(data.line_item.payment_mode).toBeNull();
    expect(data.line_item.cheque_no).toBeNull();
    expect(data.line_item.cheque_date).toBeNull();
    // requisition_status stays NULL while the sheet is Open, same as any
    // manually-added line item (021_create_accounts_ho_approval.sql).
    expect(data.line_item.requisition_status).toBeNull();

    expect(data.requisition.payment_destination).toBe('ACCOUNTS');
    expect(data.requisition.accounts_line_item_id).toBe(data.line_item.id);
    expect(data.requisition.accounts_sent_by).toBe(zoMobile);

    const balAfter = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;
    expect(Number(balAfter)).toBe(Number(balBefore));
  });

  test('duplicate routing is rejected - sequential and concurrent calls create exactly one line item', async () => {
    const reqId = await createApprovedRequisition({ amount: 4000, approvedAmount: 4000 });

    const [first, second] = await Promise.all([
      supabase.rpc('route_requisition_to_accounts_transact', { p_requisition_id: reqId, p_actor: zoMobile }),
      supabase.rpc('route_requisition_to_accounts_transact', { p_requisition_id: reqId, p_actor: zoMobile })
    ]);

    const results = [first, second];
    const succeeded = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].error.code).toBe('RTE01');
    createdItemIds.push(succeeded[0].data.line_item.id);
    createdSheetIds.push(succeeded[0].data.sheet.id);

    const { data: lineItems } = await supabase
      .from('acct_requisition_line_items')
      .select('id')
      .eq('source_requisition_id', reqId);
    expect(lineItems.length).toBe(1);

    // A third, purely sequential attempt after the fact also fails deterministically.
    const { error: thirdErr } = await supabase.rpc('route_requisition_to_accounts_transact', {
      p_requisition_id: reqId,
      p_actor: zoMobile
    });
    expect(thirdErr).toBeDefined();
    expect(thirdErr.code).toBe('RTE01');
  });

  test('select_zo_balance_payment_transact debits zo_balances and blocks a later send-to-accounts', async () => {
    const balBefore = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;

    const reqId = await createApprovedRequisition({ amount: 3000, approvedAmount: 3000 });

    const { data: paid, error: payErr } = await supabase.rpc('select_zo_balance_payment_transact', {
      p_requisition_id: reqId,
      p_actioned_by: zoMobile
    });
    expect(payErr).toBeNull();
    expect(paid.payment_destination).toBe('ZO_BALANCE');

    const balAfter = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;
    expect(Number(balAfter)).toBe(Number(balBefore) - 3000);

    const { data: ledgerRows } = await supabase
      .from('zo_fund_ledger')
      .select('*')
      .eq('reference_type', 'REQUISITION')
      .eq('reference_id', reqId);
    expect(ledgerRows.length).toBe(1);
    expect(Number(ledgerRows[0].amount)).toBe(-3000);

    const { error: routeErr } = await supabase.rpc('route_requisition_to_accounts_transact', {
      p_requisition_id: reqId,
      p_actor: zoMobile
    });
    expect(routeErr).toBeDefined();
    expect(routeErr.code).toBe('RTE01');
  });

  test('select_zo_balance_payment_transact rejects insufficient balance without partially debiting', async () => {
    const reqId = await createApprovedRequisition({ amount: 50000, approvedAmount: 50000 });

    const balBefore = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;

    const { error: payErr } = await supabase.rpc('select_zo_balance_payment_transact', {
      p_requisition_id: reqId,
      p_actioned_by: zoMobile
    });
    expect(payErr).toBeDefined();
    expect(payErr.code).toBe('BAL01');

    const balAfter = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;
    expect(Number(balAfter)).toBe(Number(balBefore));

    const { data: req } = await supabase.from('requisitions').select('payment_destination').eq('requisition_id', reqId).single();
    expect(req.payment_destination).toBeNull();
  });

  test('a non-Approved requisition cannot be routed to Accounts or paid from ZO Balance', async () => {
    const reqNo = `REQ_RTE_PENDING_${crypto.randomUUID().substring(0, 8)}`;
    const { data: created, error: createErr } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: jeMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: reqNo,
      p_material_main_head: 'Material',
      p_requisition_pdf_url: 'requisitions/pdf.pdf',
      p_original_filename: 'pdf.pdf',
      p_requisition_amount: 1000,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: jeMobile
    });
    expect(createErr).toBeNull();
    const reqId = created.requisition_id;
    createdReqIds.push(reqId);
    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqId);

    const { error: routeErr } = await supabase.rpc('route_requisition_to_accounts_transact', {
      p_requisition_id: reqId,
      p_actor: zoMobile
    });
    expect(routeErr).toBeDefined();
    expect(routeErr.code).toBe('STA01');

    const { error: payErr } = await supabase.rpc('select_zo_balance_payment_transact', {
      p_requisition_id: reqId,
      p_actioned_by: zoMobile
    });
    expect(payErr).toBeDefined();
    expect(payErr.code).toBe('STA01');

    const { data: lineItems } = await supabase
      .from('acct_requisition_line_items')
      .select('id')
      .eq('source_requisition_id', reqId);
    expect(lineItems.length).toBe(0);
  });
});
