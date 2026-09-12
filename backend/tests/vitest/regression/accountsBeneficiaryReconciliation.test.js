import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');

describe('Accounts beneficiary reconciliation at sheet submission', () => {
  let suffix;
  let adminMobile;
  let accountsMobile;
  let zoMobile;
  let workOrder;
  let estimateNo;
  let estimateId;
  let bankId;
  let debitBankName;
  const sourceFrIds = [];
  const sourceReqIds = [];
  const sheetIds = [];
  const itemIds = [];

  beforeAll(async () => {
    suffix = crypto.randomUUID().slice(0, 8);
    adminMobile = `9911${suffix}`;
    accountsMobile = `9912${suffix}`;
    zoMobile = `9913${suffix}`;
    workOrder = `WO_BEN_RECON_${suffix}`;
    estimateNo = `EST_BEN_RECON_${suffix}`;
    debitBankName = `BEN RECON BANK ${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Beneficiary Admin ${suffix}` },
      { mobile_number: accountsMobile, role: 'accounts', is_active: true, display_name: `Beneficiary Accounts ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `Beneficiary ZO ${suffix}` }
    ]);
    await setupProject(workOrder, estimateNo, 100000, adminMobile);

    const { error: debitBankError } = await supabase.from('bank_balance_master').upsert({
      bank_name: debitBankName,
      balance_date: new Date().toISOString().slice(0, 10),
      available_balance: 100000,
      account_number: `BENRECON${suffix}`,
      created_by: accountsMobile,
      updated_by: accountsMobile
    }, { onConflict: 'bank_name' });
    if (debitBankError) throw debitBankError;

    const { data: bank, error: bankError } = await supabase
      .from('indian_bank_master')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .single();
    if (bankError) throw bankError;
    bankId = bank.id;
  });

  afterAll(async () => {
    for (const id of itemIds) await supabase.from('acct_requisition_line_items').delete().eq('id', id);
    for (const id of sheetIds) await supabase.from('acct_requisition_sheets').delete().eq('id', id);
    for (const id of sourceFrIds) {
      await supabase.from('audit_log').delete().eq('record_identifier', id);
      await supabase.from('fund_requests').delete().eq('fund_request_id', id);
    }
    for (const id of sourceReqIds) {
      await supabase.from('audit_log').delete().eq('record_identifier', id);
      await supabase.from('requisitions').delete().eq('requisition_id', id);
    }
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    await supabase.from('bank_balance_master').delete().eq('bank_name', debitBankName);
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, accountsMobile, zoMobile]);
  });

  async function createOpenSheet(number) {
    const { data, error } = await supabase.from('acct_requisition_sheets').insert({
      sheet_number: number,
      sheet_status: 'Open',
      created_by: accountsMobile
    }).select().single();
    if (error) throw error;
    sheetIds.push(data.id);
    return data;
  }

  test('Fund Request Accounts edits become the reconciled source snapshot with audit history', async () => {
    const oldDetails = {
      beneficiary_name: 'Original Fund Supplier',
      beneficiary_ac_no: '1111111111',
      beneficiary_ifsc: 'SBIN0001234',
      beneficiary_bank_name: 'Original Bank',
      beneficiary_bank_id: bankId
    };
    const newDetails = {
      beneficiary_name: 'Accounts Fund Supplier',
      beneficiary_ac_no: '2222222222',
      beneficiary_ifsc: 'HDFC0001234',
      beneficiary_bank_name: 'Accounts Bank',
      beneficiary_bank_id: bankId
    };

    const { data: fr, error: frError } = await supabase.from('fund_requests').insert({
      zo_user_id: zoMobile,
      work_order_no: workOrder,
      zo_fr_no: `FR_BEN_RECON_${suffix}`,
      zo_fr_amount: 1000,
      zo_remarks: 'beneficiary reconciliation test',
      request_status: 'Pending',
      created_by: zoMobile,
      ...oldDetails
    }).select().single();
    if (frError) throw frError;
    sourceFrIds.push(fr.fund_request_id);

    const sheet = await createOpenSheet(`SHEET_FR_BEN_${suffix}`);
    const { data: item, error: itemError } = await supabase.from('acct_requisition_line_items').insert({
      sheet_id: sheet.id,
      source_fund_request_id: fr.fund_request_id,
      created_by: accountsMobile,
      particulars: 'Fund Request beneficiary reconciliation',
      req_amount: 1000,
      payment_mode: 'NEFT',
      debit_bank_ac_type: debitBankName,
      work_order_no: workOrder,
      ...newDetails
    }).select().single();
    if (itemError) throw itemError;
    itemIds.push(item.id);

    const { error: linkError } = await supabase.from('fund_requests')
      .update({ accounts_line_item_id: item.id })
      .eq('fund_request_id', fr.fund_request_id);
    if (linkError) throw linkError;

    const { error: submitError } = await supabase.rpc('submit_acct_sheet_transact', {
      p_sheet_id: sheet.id,
      p_submitted_by: accountsMobile
    });
    expect(submitError).toBeNull();

    const { data: reconciled } = await supabase.from('fund_requests')
      .select('beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_name, beneficiary_bank_id, request_status')
      .eq('fund_request_id', fr.fund_request_id).single();
    expect(reconciled).toMatchObject({ ...newDetails, request_status: 'Pending' });

    const { data: auditRows, error: auditError } = await supabase.from('audit_log')
      .select('old_value, new_value, user_id, action')
      .eq('module_name', 'Fund Request')
      .eq('record_identifier', fr.fund_request_id)
      .eq('action', 'BENEFICIARY_RECONCILED');
    expect(auditError).toBeNull();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].user_id).toBe(accountsMobile);
    expect(auditRows[0].old_value.beneficiary_ac_no).toBe(oldDetails.beneficiary_ac_no);
    expect(auditRows[0].new_value.beneficiary_ac_no).toBe(newDetails.beneficiary_ac_no);

    const { data: submittedItem } = await supabase.from('acct_requisition_line_items')
      .select('requisition_status').eq('id', item.id).single();
    expect(submittedItem.requisition_status).toBe('Pending HO Review');
  });

  test('Payment Requisition Accounts edits reconcile only the current descendant', async () => {
    const oldDetails = {
      beneficiary_name: 'Original Payment Supplier',
      beneficiary_ac_no: '3333333333',
      beneficiary_ifsc: 'SBIN0001234',
      beneficiary_bank_name: 'Original Bank',
      beneficiary_bank_id: bankId
    };
    const newDetails = {
      beneficiary_name: 'Accounts Payment Supplier',
      beneficiary_ac_no: '4444444444',
      beneficiary_ifsc: 'HDFC0001234',
      beneficiary_bank_name: 'Accounts Bank',
      beneficiary_bank_id: bankId
    };

    const { data: req, error: reqError } = await supabase.from('requisitions').insert({
      requester_user_id: zoMobile,
      work_order_no: workOrder,
      estimate_no: estimateNo,
      estimate_amount: 100000,
      state: 'Test State',
      district: 'Test District',
      area_code: 'Test Area',
      department: 'PWD',
      site_details: 'beneficiary reconciliation test',
      requisition_no: `REQ_BEN_RECON_${suffix}`,
      material_main_head: 'Materials',
      requisition_pdf_url: `test/${suffix}.pdf`,
      original_filename: `${suffix}.pdf`,
      requisition_amount: 1000,
      gst_bill: 'No',
      bank_details: 'Test Bank',
      requisition_status: 'Approved',
      approved_amount: 1000,
      approved_balance_amount: 0,
      created_by: zoMobile,
      zo_user_id: zoMobile,
      ...oldDetails
    }).select().single();
    if (reqError) throw reqError;
    sourceReqIds.push(req.requisition_id);

    const sheet = await createOpenSheet(`SHEET_REQ_BEN_${suffix}`);
    const { data: item, error: itemError } = await supabase.from('acct_requisition_line_items').insert({
      sheet_id: sheet.id,
      source_requisition_id: req.requisition_id,
      created_by: accountsMobile,
      particulars: 'Payment Requisition beneficiary reconciliation',
      req_amount: 1000,
      payment_mode: 'NEFT',
      debit_bank_ac_type: debitBankName,
      work_order_no: workOrder,
      ...newDetails
    }).select().single();
    if (itemError) throw itemError;
    itemIds.push(item.id);

    const { error: linkError } = await supabase.from('requisitions')
      .update({ accounts_line_item_id: item.id })
      .eq('requisition_id', req.requisition_id);
    if (linkError) throw linkError;

    const { error: submitError } = await supabase.rpc('submit_acct_sheet_transact', {
      p_sheet_id: sheet.id,
      p_submitted_by: accountsMobile
    });
    expect(submitError).toBeNull();

    const { data: reconciled } = await supabase.from('requisitions')
      .select('beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_name, beneficiary_bank_id')
      .eq('requisition_id', req.requisition_id).single();
    expect(reconciled).toEqual(expect.objectContaining(newDetails));

    const { data: auditRows, error: auditError } = await supabase.from('audit_log')
      .select('old_value, new_value, user_id')
      .eq('module_name', 'Payment Requisition')
      .eq('record_identifier', req.requisition_id)
      .eq('action', 'BENEFICIARY_RECONCILED');
    expect(auditError).toBeNull();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].user_id).toBe(accountsMobile);
    expect(auditRows[0].old_value.beneficiary_name).toBe(oldDetails.beneficiary_name);
    expect(auditRows[0].new_value.beneficiary_name).toBe(newDetails.beneficiary_name);
  });
});
