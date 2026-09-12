import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');

describe('Subcontractor ledger P0 remediation invariants', () => {
  let suffix;
  let adminMobile;
  let zoMobile;
  let hoMobile;
  let workOrder;
  let estimateNo;
  let estimateId;
  const requisitionIds = [];
  const fundRequestIds = [];
  const sheetIds = [];
  const lineItemIds = [];

  beforeAll(async () => {
    suffix = crypto.randomUUID().slice(0, 8);
    adminMobile = `9951${suffix}`;
    zoMobile = `9952${suffix}`;
    hoMobile = `9953${suffix}`;
    workOrder = `WO_P0_LEDGER_${suffix}`;
    estimateNo = `EST_P0_LEDGER_${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `P0 Admin ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `P0 ZO ${suffix}` },
      { mobile_number: hoMobile, role: 'ho', is_active: true, display_name: `P0 HO ${suffix}` }
    ]);
    await setupProject(workOrder, estimateNo, 100000, adminMobile);

    const { data: estimate, error: estimateError } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: workOrder,
        estimate_no: estimateNo,
        area_code: 'P0 Zone',
        estimate_revision: 0,
        zonal_office_no: 'P0_ZO',
        estimate_amount: 10000,
        estimate_status: 'Final Approved',
        created_by: adminMobile,
        last_modified_by: adminMobile
      })
      .select()
      .single();
    if (estimateError) throw estimateError;
    estimateId = estimate.estimate_id;
  });

  afterAll(async () => {
    for (const id of lineItemIds) await supabase.from('acct_requisition_line_items').delete().eq('id', id);
    for (const id of sheetIds) await supabase.from('acct_requisition_sheets').delete().eq('id', id);
    for (const id of requisitionIds) await supabase.from('subcontractor_ledger').delete().eq('reference_id', id);
    for (const id of requisitionIds) await supabase.from('requisitions').delete().eq('requisition_id', id);
    await supabase.from('subcontractor_ledger').delete().eq('work_order_no', workOrder);
    await supabase.from('subcontractor_balances').delete().eq('work_order_no', workOrder);
    for (const id of fundRequestIds) await supabase.from('fund_requests').delete().eq('fund_request_id', id);
    if (estimateId) await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, hoMobile]);
  });

  test('stale Accounts descendants fail settlement with STA11 and create no payment row', async () => {
    const { data: req, error: reqError } = await supabase.from('requisitions').insert({
      requester_user_id: hoMobile,
      work_order_no: workOrder,
      estimate_no: estimateNo,
      estimate_amount: 10000,
      state: 'West Bengal',
      district: 'Kolkata',
      area_code: 'P0 Zone',
      department: 'PWD',
      site_details: 'P0 stale descendant',
      requisition_no: `REQ_P0_STALE_${suffix}`,
      material_main_head: 'Sub Contractor',
      material_sub_head: 'P0 Subcontractor',
      material_details: 'P0 Details',
      requisition_pdf_url: 'p0/stale.pdf',
      requisition_amount: 1000,
      gst_bill: 'No',
      bank_details: 'P0 Bank',
      requisition_status: 'Approved',
      approved_amount: 1000,
      approved_balance_amount: 0,
      created_by: hoMobile,
      zo_user_id: zoMobile
    }).select().single();
    if (reqError) throw reqError;
    requisitionIds.push(req.requisition_id);

    const makeSheet = async (number) => {
      const { data, error } = await supabase.from('acct_requisition_sheets').insert({
        sheet_number: number,
        sheet_status: 'Open',
        created_by: adminMobile
      }).select().single();
      if (error) throw error;
      sheetIds.push(data.id);
      return data.id;
    };
    const makeItem = async (sheetId, importedFromItemId = null, status = 'On Hold') => {
      const { data, error } = await supabase.from('acct_requisition_line_items').insert({
        sheet_id: sheetId,
        imported_from_item_id: importedFromItemId,
        source_requisition_id: req.requisition_id,
        created_by: adminMobile,
        account_sub_title_text: 'P0 Payment',
        particulars: 'P0 stale descendant',
        beneficiary_ac_no: '9876543210',
        beneficiary_name: 'P0 Supplier',
        beneficiary_ifsc: 'TEST0001234',
        beneficiary_bank_name: 'P0 Bank',
        req_amount: 1000,
        payment_mode: 'NEFT',
        work_order_no: workOrder,
        requisition_status: status
      }).select().single();
      if (error) throw error;
      lineItemIds.push(data.id);
      return data;
    };

    const sheetA = await makeSheet(`P0-A-${suffix}`);
    const itemA = await makeItem(sheetA);
    const sheetB = await makeSheet(`P0-B-${suffix}`);
    const itemB = await makeItem(sheetB, itemA.id, 'On Hold');
    await supabase.from('requisitions').update({ accounts_line_item_id: itemB.id }).eq('requisition_id', req.requisition_id);

    const { error: settleError } = await supabase.from('acct_requisition_line_items')
      .update({ requisition_status: 'Approved', ho_process: 'Approved', ho_actioned_by: hoMobile, ho_actioned_at: new Date().toISOString(), ho_pass_amount: 1000 })
      .eq('id', itemA.id);
    expect(settleError).toBeDefined();
    expect(settleError.code).toBe('STA11');

    const { data: payments, error: paymentError } = await supabase
      .from('subcontractor_ledger')
      .select('ledger_id')
      .eq('reference_type', 'REQUISITION')
      .eq('reference_id', req.requisition_id)
      .eq('transaction_type', 'REQUISITION_PAYMENT');
    expect(paymentError).toBeNull();
    expect(payments).toHaveLength(0);
  });

  test('concurrent Fund Request approvals serialize per work order: one succeeds and one returns BUD02', async () => {
    const makeFundRequest = async (number) => {
      const { data, error } = await supabase.from('fund_requests').insert({
        zo_user_id: zoMobile,
        work_order_no: workOrder,
        zo_fr_no: number,
        zo_fr_amount: 7000,
        zo_remarks: 'P0 concurrent capacity test',
        // Draft rows are not commitments yet. Once both are linked to their
        // Accounts rows, concurrent approval is the race under test: the
        // first approval consumes the remaining capacity and the second must
        // observe it under the work-order lock.
        request_status: 'Draft',
        created_by: zoMobile
      }).select().single();
      if (error) throw error;
      fundRequestIds.push(data.fund_request_id);
      return data;
    };
    const first = await makeFundRequest(`FR_P0_A_${suffix}`);
    const second = await makeFundRequest(`FR_P0_B_${suffix}`);

    const makeLinkedLine = async (fundRequest, label) => {
      const { data: sheet, error: sheetError } = await supabase.from('acct_requisition_sheets').insert({
        sheet_number: `P0-FR-${label}-${suffix}`,
        sheet_status: 'Submitted',
        created_by: adminMobile,
        submitted_by: adminMobile,
        submitted_at: new Date().toISOString()
      }).select().single();
      if (sheetError) throw sheetError;
      sheetIds.push(sheet.id);
      const { data: item, error: itemError } = await supabase.from('acct_requisition_line_items').insert({
        sheet_id: sheet.id,
        source_fund_request_id: fundRequest.fund_request_id,
        created_by: adminMobile,
        account_sub_title_text: 'P0 Fund Request',
        particulars: 'P0 concurrent approval',
        beneficiary_ac_no: '9876543210',
        beneficiary_name: 'P0 Supplier',
        beneficiary_ifsc: 'TEST0001234',
        beneficiary_bank_name: 'P0 Bank',
        req_amount: 7000,
        payment_mode: 'NEFT',
        work_order_no: workOrder,
        requisition_status: 'Pending HO Review'
      }).select().single();
      if (itemError) throw itemError;
      lineItemIds.push(item.id);
      const { error: linkError } = await supabase.from('fund_requests')
        .update({ accounts_line_item_id: item.id }).eq('fund_request_id', fundRequest.fund_request_id);
      if (linkError) throw linkError;
    };
    await makeLinkedLine(first, 'A');
    await makeLinkedLine(second, 'B');

    const approve = (fundRequest) => supabase.from('fund_requests').update({
      request_status: 'Approved',
      approve_ho_amount: 7000,
      approve_ho_user_id: hoMobile,
      approve_ho_date: new Date().toISOString(),
      transfer_from_account: 'CC',
      ho_remarks: 'P0 concurrent approval'
    }).eq('fund_request_id', fundRequest.fund_request_id);
    const results = await Promise.all([approve(first), approve(second)]);

    const successes = results.filter(result => !result.error);
    const failures = results.filter(result => result.error);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error.code).toBe('BUD02');

    const { data: approved, error } = await supabase.from('fund_requests')
      .select('request_status, approve_ho_amount')
      .in('fund_request_id', [first.fund_request_id, second.fund_request_id]);
    expect(error).toBeNull();
    expect(approved.filter(row => row.request_status === 'Approved')).toHaveLength(1);
    expect(approved.filter(row => row.request_status === 'Draft')).toHaveLength(1);
  });

  test('partial payment settles the reservation metadata before releasing the unpaid remainder', async () => {
    const { data: req, error: reqError } = await supabase.from('requisitions').insert({
      requester_user_id: hoMobile,
      work_order_no: workOrder,
      estimate_no: estimateNo,
      estimate_amount: 10000,
      state: 'West Bengal', district: 'Kolkata', area_code: 'P0 Zone', department: 'PWD',
      site_details: 'P0 partial payment', requisition_no: `REQ_P0_PARTIAL_${suffix}`,
      material_main_head: 'Sub Contractor', material_sub_head: 'P0 Partial', material_details: 'P0 Partial Details',
      requisition_pdf_url: 'p0/partial.pdf', requisition_amount: 1000, gst_bill: 'No', bank_details: 'P0 Bank',
      requisition_status: 'Approved', approved_amount: 1000, approved_balance_amount: 0,
      created_by: hoMobile, zo_user_id: zoMobile
    }).select().single();
    if (reqError) throw reqError;
    requisitionIds.push(req.requisition_id);

    await supabase.from('subcontractor_balances').insert({
      work_order_no: workOrder, material_main_head: 'Sub Contractor', material_sub_head: 'P0 Partial',
      material_details: 'P0 Partial Details', estimated_total: 1000, paid_total: 1000, available_balance: 0
    });
    const { data: reservation, error: reservationError } = await supabase.from('subcontractor_ledger').insert({
      work_order_no: workOrder, material_main_head: 'Sub Contractor', material_sub_head: 'P0 Partial',
      material_details: 'P0 Partial Details', transaction_type: 'REQUISITION_APPROVAL',
      reference_type: 'REQUISITION', reference_id: req.requisition_id, amount: -1000,
      created_by: zoMobile, settlement_status: 'RESERVED'
    }).select().single();
    if (reservationError) throw reservationError;

    const { data: sheet, error: sheetError } = await supabase.from('acct_requisition_sheets').insert({
      sheet_number: `P0-PARTIAL-${suffix}`, sheet_status: 'Submitted', created_by: adminMobile
    }).select().single();
    if (sheetError) throw sheetError;
    sheetIds.push(sheet.id);
    const { data: item, error: itemError } = await supabase.from('acct_requisition_line_items').insert({
      sheet_id: sheet.id, source_requisition_id: req.requisition_id, created_by: adminMobile,
      account_sub_title_text: 'P0 Payment', particulars: 'P0 partial payment', req_amount: 1000,
      payment_mode: 'NEFT', work_order_no: workOrder, requisition_status: 'Pending HO Review'
    }).select().single();
    if (itemError) throw itemError;
    lineItemIds.push(item.id);
    await supabase.from('requisitions').update({ accounts_line_item_id: item.id }).eq('requisition_id', req.requisition_id);

    const { error: updateError } = await supabase.from('acct_requisition_line_items').update({
      requisition_status: 'Partially Approved', ho_process: 'Partially Approved', ho_actioned_by: hoMobile,
      ho_actioned_at: new Date().toISOString(), ho_pass_amount: 600
    }).eq('id', item.id);
    expect(updateError).toBeNull();

    const { data: settled, error: settledError } = await supabase.from('subcontractor_ledger')
      .select('settlement_status').eq('ledger_id', reservation.ledger_id).single();
    expect(settledError).toBeNull();
    expect(settled.settlement_status).toBe('SETTLED');
  });
});
