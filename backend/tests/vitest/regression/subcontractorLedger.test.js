import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const mockRes = require('../../helpers/mockRes');
const { getSubcontractorLedger, getSubcontractorLedgerEntries, getSubcontractorRequisitions } = require('../../../src/controllers/requisitions.controller');

// Migration 047: The Subcontractor Ledger.
// A Cost Estimate line item against a Material_Main_Head = 'Sub Contractor'
// row credits subcontractor_balances the moment HO approves it (with ZO
// already approved) — submit_row_approvals. A Requisition against the same
// subcontractor debits it the moment its approval lands — approve_requisition
// _transact, gated by create_requisition_secure's BUD03 pre-check. Both are
// independent, additive gates layered on top of the existing Main Head /
// zo_balances checks (BUD01/BUD02/BAL01), which must keep working unchanged.
describe('Subcontractor Ledger — credit on estimate item HO approval, debit on requisition approval', () => {
  let suffix;
  let adminMobile, zoMobile, hoMobile;
  let workOrder, estimateNo, estimateId;
  let workOrder2, estimateNo2, estimateId2;

  const SUB_HEAD = 'Pipe Line HDPE Work';
  const DETAILS = 'Jahangir Mandal';

  let itemA, itemA2, itemB, itemC;
  let reqXId, reqYId, reqMaterialId, reqScopeId;

  async function getBalance(wo, subHead = SUB_HEAD, details = DETAILS) {
    const { data } = await supabase
      .from('subcontractor_balances')
      .select('*')
      .eq('work_order_no', wo)
      .eq('material_sub_head', subHead)
      .eq('material_details', details)
      .maybeSingle();
    return data;
  }

  async function approveItem(itemId, actor, stage) {
    return supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateId,
      p_approvals: [{ item_id: itemId, approve_status: 'Approve', remarks: null }],
      p_stage: stage,
      p_modified_by: actor
    });
  }

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    adminMobile = `9521${suffix}`;
    zoMobile = `9522${suffix}`;
    hoMobile = `9523${suffix}`;
    workOrder = `TEST_WO_SC_${suffix}`;
    estimateNo = `EST_SC_${suffix}`;
    workOrder2 = `TEST_WO_SC2_${suffix}`;
    estimateNo2 = `EST_SC2_${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Test Admin ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `Test ZO ${suffix}` },
      { mobile_number: hoMobile, role: 'ho', is_active: true, display_name: `Test HO ${suffix}` }
    ]);

    await setupProject(workOrder, estimateNo, 1000000.00, adminMobile);
    await setupProject(workOrder2, estimateNo2, 1000000.00, adminMobile);

    const { error: balErr } = await supabase
      .from('zo_balances')
      .upsert({ zo_user_id: zoMobile, available_balance: 100000.00 })
      .select();
    if (balErr) throw balErr;

    const { error: ledgerErr } = await supabase
      .from('zo_fund_ledger')
      .insert({
        zo_user_id: zoMobile,
        transaction_type: 'ALLOCATION',
        reference_type: 'FUND_REQUEST',
        reference_id: crypto.randomUUID(),
        amount: 100000.00,
        work_order_no: workOrder,
        created_by: adminMobile
      });
    if (ledgerErr) throw ledgerErr;

    // Work order 1: Final Approved estimate with a Sub Contractor item (A),
    // a second Sub Contractor item under a different subcontractor (B), and
    // a plain Material item (C) — for the non-subcontractor regression check.
    const { data: estData, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrder,
        estimate_no: estimateNo,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_SC',
        estimate_amount: 30000.00,
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
      .insert([
        { estimate_id: estimateId, material_main_head: 'Sub Contractor', material_sub_head: SUB_HEAD, material_details: DETAILS, unit: 'lot', qty: 1, rate: 20000.00, amount: 20000.00 },
        { estimate_id: estimateId, material_main_head: 'Sub Contractor', material_sub_head: SUB_HEAD, material_details: `${DETAILS} B`, unit: 'lot', qty: 1, rate: 5000.00, amount: 5000.00 },
        { estimate_id: estimateId, material_main_head: 'Material', material_sub_head: 'Cement', material_details: 'OPC', unit: 'bags', qty: 10, rate: 500.00, amount: 5000.00 }
      ])
      .select();
    if (itemErr) throw itemErr;
    itemA = itemData.find(i => i.material_details === DETAILS);
    itemB = itemData.find(i => i.material_details === `${DETAILS} B`);
    itemC = itemData.find(i => i.material_main_head === 'Material');
  });

  afterAll(async () => {
    for (const id of [reqXId, reqYId, reqMaterialId, reqScopeId]) {
      if (id) await supabase.from('requisitions').delete().eq('requisition_id', id);
    }
    if (estimateId) {
      await supabase.from('subcontractor_ledger').delete().eq('work_order_no', workOrder);
      await supabase.from('subcontractor_balances').delete().eq('work_order_no', workOrder);
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateId);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    }
    if (estimateId2) {
      await supabase.from('subcontractor_ledger').delete().eq('work_order_no', workOrder2);
      await supabase.from('subcontractor_balances').delete().eq('work_order_no', workOrder2);
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateId2);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId2);
    }
    await supabase.from('zo_fund_ledger').delete().eq('zo_user_id', zoMobile);
    await supabase.from('zo_balances').delete().eq('zo_user_id', zoMobile);
    await supabase.from('projects_master').delete().in('work_order_no', [workOrder, workOrder2]);
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, hoMobile]);
  });

  test('1. HO approval (with ZO already approved) credits subcontractor_balances and inserts a positive ledger row', async () => {
    const { error: zoErr } = await approveItem(itemA.item_id, zoMobile, 'ZO');
    expect(zoErr).toBeNull();

    const { error: hoErr } = await approveItem(itemA.item_id, hoMobile, 'HO');
    expect(hoErr).toBeNull();

    const balance = await getBalance(workOrder);
    expect(balance).not.toBeNull();
    expect(Number(balance.estimated_total)).toBe(20000);
    expect(Number(balance.available_balance)).toBe(20000);
    expect(Number(balance.paid_total)).toBe(0);

    const { data: ledgerRows } = await supabase
      .from('subcontractor_ledger')
      .select('*')
      .eq('reference_type', 'ESTIMATE_ITEM')
      .eq('reference_id', itemA.item_id);
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].transaction_type).toBe('ESTIMATE_ITEM_APPROVAL');
    expect(Number(ledgerRows[0].amount)).toBe(20000);
  });

  test('2. ZO-only approval does not touch subcontractor_balances', async () => {
    const { error } = await approveItem(itemB.item_id, zoMobile, 'ZO');
    expect(error).toBeNull();

    const balance = await getBalance(workOrder, SUB_HEAD, `${DETAILS} B`);
    expect(balance).toBeNull();
  });

  test('3. HO approval on a non-Sub-Contractor item never touches subcontractor_balances', async () => {
    const { error: zoErr } = await approveItem(itemC.item_id, zoMobile, 'ZO');
    expect(zoErr).toBeNull();
    const { error: hoErr } = await approveItem(itemC.item_id, hoMobile, 'HO');
    expect(hoErr).toBeNull();

    const { data: rows } = await supabase
      .from('subcontractor_balances')
      .select('*')
      .eq('work_order_no', workOrder)
      .eq('material_sub_head', itemC.material_sub_head)
      .eq('material_details', itemC.material_details);
    expect(rows.length).toBe(0);
  });

  test('4. Reopen top-up: a brand-new item row for the same subcontractor compounds the balance', async () => {
    const { data: inserted, error: insErr } = await supabase
      .from('project_cost_estimate_items')
      .insert([{ estimate_id: estimateId, material_main_head: 'Sub Contractor', material_sub_head: SUB_HEAD, material_details: DETAILS, unit: 'lot', qty: 1, rate: 15000.00, amount: 15000.00 }])
      .select()
      .single();
    if (insErr) throw insErr;
    itemA2 = inserted;

    const { error: zoErr } = await approveItem(itemA2.item_id, zoMobile, 'ZO');
    expect(zoErr).toBeNull();
    const { error: hoErr } = await approveItem(itemA2.item_id, hoMobile, 'HO');
    expect(hoErr).toBeNull();

    const balance = await getBalance(workOrder);
    expect(Number(balance.estimated_total)).toBe(35000);
    expect(Number(balance.available_balance)).toBe(35000);
  });

  test('5. create_requisition_secure rejects with BUD03 when amount exceeds the subcontractor balance', async () => {
    const { error } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_SC_ERR_${suffix}`,
      p_material_main_head: 'Sub Contractor',
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_requisition_pdf_url: 'requisitions/sc.pdf',
      p_original_filename: 'sc.pdf',
      p_requisition_amount: 36000.00, // exceeds 35,000 subcontractor balance but fits the 40,000 Main Head capacity
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });
    expect(error).toBeDefined();
    expect(error.code).toBe('BUD03');
  });

  test('6. create_requisition_secure rejects with VAL01 when sub head/details are missing on a Sub Contractor requisition', async () => {
    const { error } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_SC_VAL_${suffix}`,
      p_material_main_head: 'Sub Contractor',
      p_material_sub_head: null,
      p_material_details: null,
      p_requisition_pdf_url: 'requisitions/sc2.pdf',
      p_original_filename: 'sc2.pdf',
      p_requisition_amount: 1000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });
    expect(error).toBeDefined();
    expect(error.code).toBe('VAL01');
  });

  test('7. approve_requisition_transact debits subcontractor_balances and inserts a negative ledger row (zo_balances still debited as before)', async () => {
    const { data: reqX, error: reqXErr } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_SC_X_${suffix}`,
      p_material_main_head: 'Sub Contractor',
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_requisition_pdf_url: 'requisitions/scx.pdf',
      p_original_filename: 'scx.pdf',
      p_requisition_amount: 10000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });
    expect(reqXErr).toBeNull();
    reqXId = reqX.requisition_id;
    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqXId);

    const zoBalanceBefore = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;

    const { error: appErr } = await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqXId,
      p_approved_amount: 10000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved Req X'
    });
    expect(appErr).toBeNull();

    const balance = await getBalance(workOrder);
    expect(Number(balance.available_balance)).toBe(25000);
    expect(Number(balance.paid_total)).toBe(10000);

    const { data: ledgerRows } = await supabase
      .from('subcontractor_ledger')
      .select('*')
      .eq('reference_type', 'REQUISITION')
      .eq('reference_id', reqXId);
    expect(ledgerRows.length).toBe(1);
    expect(Number(ledgerRows[0].amount)).toBe(-10000);

    const zoBalanceAfter = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;
    expect(Number(zoBalanceAfter)).toBe(Number(zoBalanceBefore) - 10000);
  });

  test('8. approve_requisition_transact rejects with BUD04 over the remaining subcontractor balance, without touching zo_balances or subcontractor_balances', async () => {
    // Req X (test 7) already debited the balance to 25,000. Insert Req Y
    // directly at Pending (bypassing create_requisition_secure, which is
    // already covered by test 5) so this test isolates the approve-time
    // BUD04 guard: an amount that would have fit the balance when the
    // requisition was first raised, but no longer does by approval time.
    const { data: directInsert, error: directErr } = await supabase
      .from('requisitions')
      .insert({
        requester_user_id: hoMobile,
        work_order_no: workOrder,
        estimate_no: estimateNo,
        estimate_amount: 30000.00,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        requisition_no: `REQ_SC_Y_${suffix}`,
        material_main_head: 'Sub Contractor',
        material_sub_head: SUB_HEAD,
        material_details: DETAILS,
        requisition_pdf_url: 'requisitions/scy.pdf',
        requisition_amount: 28000.00,
        gst_bill: 'No',
        bank_details: 'Bank Details',
        requisition_status: 'Pending',
        created_by: hoMobile,
        zo_user_id: zoMobile
      })
      .select()
      .single();
    if (directErr) throw directErr;
    reqYId = directInsert.requisition_id;

    const balanceBefore = await getBalance(workOrder);
    const zoBalanceBefore = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;

    const { error: appErr } = await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqYId,
      p_approved_amount: 28000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved Req Y'
    });
    expect(appErr).toBeDefined();
    expect(appErr.code).toBe('BUD04');

    const balanceAfter = await getBalance(workOrder);
    expect(Number(balanceAfter.available_balance)).toBe(Number(balanceBefore.available_balance));
    const zoBalanceAfter = (await supabase.from('zo_balances').select('available_balance').eq('zo_user_id', zoMobile).single()).data.available_balance;
    expect(Number(zoBalanceAfter)).toBe(Number(zoBalanceBefore));
  });

  test('9. Non-Sub-Contractor requisitions never touch subcontractor_balances/subcontractor_ledger', async () => {
    const { data: reqM, error: reqMErr } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_MAT_${suffix}`,
      p_material_main_head: 'Material',
      p_requisition_pdf_url: 'requisitions/mat.pdf',
      p_original_filename: 'mat.pdf',
      p_requisition_amount: 2000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });
    expect(reqMErr).toBeNull();
    reqMaterialId = reqM.requisition_id;
    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqMaterialId);

    const { count: countBefore } = await supabase.from('subcontractor_ledger').select('*', { count: 'exact', head: true }).eq('work_order_no', workOrder);

    const { error: appErr } = await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqMaterialId,
      p_approved_amount: 2000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved Material Req'
    });
    expect(appErr).toBeNull();

    const { count: countAfter } = await supabase.from('subcontractor_ledger').select('*', { count: 'exact', head: true }).eq('work_order_no', workOrder);
    expect(countAfter).toBe(countBefore);
  });

  test('10. Ledger scope is per work order — the same sub head + details on a different work order is an independent balance', async () => {
    const { data: estData2, error: estErr2 } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrder2,
        estimate_no: estimateNo2,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_SC2',
        estimate_amount: 12000.00,
        estimate_status: 'Final Approved',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();
    if (estErr2) throw estErr2;
    estimateId2 = estData2.estimate_id;

    const { data: item2, error: item2Err } = await supabase
      .from('project_cost_estimate_items')
      .insert([{ estimate_id: estimateId2, material_main_head: 'Sub Contractor', material_sub_head: SUB_HEAD, material_details: DETAILS, unit: 'lot', qty: 1, rate: 12000.00, amount: 12000.00 }])
      .select()
      .single();
    if (item2Err) throw item2Err;

    const balanceWo1Before = await getBalance(workOrder);

    await supabase.rpc('submit_row_approvals', { p_estimate_id: estimateId2, p_approvals: [{ item_id: item2.item_id, approve_status: 'Approve', remarks: null }], p_stage: 'ZO', p_modified_by: zoMobile });
    await supabase.rpc('submit_row_approvals', { p_estimate_id: estimateId2, p_approvals: [{ item_id: item2.item_id, approve_status: 'Approve', remarks: null }], p_stage: 'HO', p_modified_by: hoMobile });

    const balanceWo2 = await getBalance(workOrder2);
    expect(balanceWo2).not.toBeNull();
    expect(Number(balanceWo2.estimated_total)).toBe(12000);

    const balanceWo1After = await getBalance(workOrder);
    expect(Number(balanceWo1After.available_balance)).toBe(Number(balanceWo1Before.available_balance));
  });

  test('11. getSubcontractorLedger lists balances filtered by work order, enriched with project info', async () => {
    const req = { query: { work_order_no: workOrder } };
    const res = mockRes();
    await getSubcontractorLedger(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    const row = res.jsonData.balances.find(b => b.material_details === DETAILS);
    expect(row).toBeDefined();
    expect(Number(row.available_balance)).toBe(25000);
    expect(row.project?.department).toBe('PWD');
  });

  test('12. getSubcontractorLedgerEntries returns the full transaction trail for one balance, newest first', async () => {
    const req = { query: { work_order_no: workOrder, material_sub_head: SUB_HEAD, material_details: DETAILS } };
    const res = mockRes();
    await getSubcontractorLedgerEntries(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    const entries = res.jsonData.entries;
    // Credits from itemA (20,000) + itemA2 (15,000), debit from Req X (-10,000)
    expect(entries.length).toBe(3);
    expect(entries.every(e => e.created_by_name)).toBe(true);
    const total = entries.reduce((sum, e) => sum + Number(e.amount), 0);
    expect(total).toBe(25000);
    for (let i = 1; i < entries.length; i++) {
      expect(new Date(entries[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(new Date(entries[i].created_at).getTime());
    }
  });

  test('13. getSubcontractorRequisitions lists every requisition for a Sub Contractor, filterable by work order', async () => {
    const req = { query: { work_order_no: workOrder } };
    const res = mockRes();
    await getSubcontractorRequisitions(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    const ids = res.jsonData.requisitions.map(r => r.requisition_id);
    expect(ids).toContain(reqXId);
    expect(ids).toContain(reqYId);
    expect(res.jsonData.requisitions.every(r => r.material_main_head === 'Sub Contractor')).toBe(true);
    expect(res.jsonData.requisitions.every(r => r.requester_name)).toBe(true);
    // The Material requisition (test 9) must never leak into this Sub Contractor-only view.
    expect(ids).not.toContain(reqMaterialId);
  });

  test('14. getSubcontractorRequisitions date_from filter excludes requisitions created before the cutoff', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const req = { query: { work_order_no: workOrder, date_from: future } };
    const res = mockRes();
    await getSubcontractorRequisitions(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.requisitions.length).toBe(0);
  });

  test('15. getSubcontractorRequisitions search filter matches on subcontractor name', async () => {
    const req = { query: { work_order_no: workOrder, search: DETAILS.toLowerCase() } };
    const res = mockRes();
    await getSubcontractorRequisitions(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.requisitions.length).toBeGreaterThan(0);
    expect(res.jsonData.requisitions.every(r => r.material_details === DETAILS)).toBe(true);

    const resNoMatch = mockRes();
    await getSubcontractorRequisitions({ query: { work_order_no: workOrder, search: 'no-such-subcontractor-xyz' } }, resNoMatch);
    expect(resNoMatch.jsonData.requisitions.length).toBe(0);
  });

  test('16. resubmitting an already HO-Approved item does not credit the ledger again (idempotent)', async () => {
    // itemA (test 1) is already zo+ho Approved. A reopen's "resubmit all rows"
    // batch can resend that same Approve decision unchanged alongside a
    // genuinely new item — this must be a no-op for the ledger, not a
    // second credit.
    const balanceBefore = await getBalance(workOrder);
    const { count: ledgerCountBefore } = await supabase
      .from('subcontractor_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('reference_type', 'ESTIMATE_ITEM')
      .eq('reference_id', itemA.item_id);

    const { error } = await approveItem(itemA.item_id, hoMobile, 'HO');
    expect(error).toBeNull();

    const balanceAfter = await getBalance(workOrder);
    expect(Number(balanceAfter.estimated_total)).toBe(Number(balanceBefore.estimated_total));
    expect(Number(balanceAfter.available_balance)).toBe(Number(balanceBefore.available_balance));

    const { count: ledgerCountAfter } = await supabase
      .from('subcontractor_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('reference_type', 'ESTIMATE_ITEM')
      .eq('reference_id', itemA.item_id);
    expect(ledgerCountAfter).toBe(ledgerCountBefore);
  });
});
