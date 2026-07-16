import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');

describe('Payment Requisition Capacity & Zonal Balance Gates Suite', () => {
  let suffix;
  let jeMobile;
  let zoMobile;
  let adminMobile;
  let testWorkOrder;
  let testEstimateNo;

  let estimateId = null;
  let itemIdCement = null;
  let itemIdSand = null;
  let reqAId = null;
  let reqBId = null;
  let reqCId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9511${suffix}`;
    zoMobile = `9512${suffix}`;
    adminMobile = `9513${suffix}`;
    testWorkOrder = `TEST_WO_CAP_${suffix}`;
    testEstimateNo = `EST_CAP_${suffix}`;

    // 1. Setup users
    await setupUsers([
      {
        mobile_number: adminMobile,
        role: 'admin',
        is_active: true,
        display_name: `Test Admin ${suffix}`
      },
      {
        mobile_number: jeMobile,
        role: 'je',
        is_active: true,
        display_name: `Test JE ${suffix}`
      },
      {
        mobile_number: zoMobile,
        role: 'zo',
        is_active: true,
        display_name: `Test ZO ${suffix}`
      }
    ]);

    // 2. Setup project
    await setupProject(testWorkOrder, testEstimateNo, 1000000.00, adminMobile);

    // Update project with zo_user_id
    const { error: projUpdErr } = await supabase
      .from('projects_master')
      .update({ zo_user_id: zoMobile })
      .eq('work_order_no', testWorkOrder);
    if (projUpdErr) throw projUpdErr;

    // 3. Create active JE-ZO mapping: JE mapped to ZO
    const { error: jeZoErr } = await supabase.from('je_zo_mappings').insert([
      {
        je_user_id: jeMobile,
        zo_user_id: zoMobile,
        is_active: true,
        assigned_by: adminMobile
      }
    ]);
    if (jeZoErr) throw jeZoErr;

    // 4. Create active Work Order mapping: JE mapped to Work Order
    const { error: woMapErr } = await supabase.from('work_order_mappings').insert([
      {
        work_order_no: testWorkOrder,
        je_user_id: jeMobile,
        is_active: true,
        reason: 'Assigned',
        assigned_by: adminMobile
      }
    ]);
    if (woMapErr) throw woMapErr;

    // 5. Create Final Approved estimate with total budget 30,000
    const { data: estData, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: testWorkOrder,
        estimate_no: testEstimateNo,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_99',
        estimate_amount: 30000.00,
        estimate_status: 'Final Approved',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();

    if (estErr) throw estErr;
    estimateId = estData.estimate_id;

    // 6. Create Cost Estimate items: Cement (10,000) and Sand (20,000)
    const { data: itemData, error: itemErr } = await supabase
      .from('project_cost_estimate_items')
      .insert([
        {
          estimate_id: estimateId,
          material_main_head: 'Cement',
          material_sub_head: 'PPC',
          material_details: 'Test Cement PPC',
          unit: 'bags',
          qty: 20.00,
          rate: 500.00,
          amount: 10000.00
        },
        {
          estimate_id: estimateId,
          material_main_head: 'Sand',
          material_sub_head: 'Fine',
          material_details: 'Test Fine Sand',
          unit: 'cft',
          qty: 40.00,
          rate: 500.00,
          amount: 20000.00
        }
      ])
      .select();

    if (itemErr) throw itemErr;
    itemIdCement = itemData.find(i => i.material_main_head === 'Cement').item_id;
    itemIdSand = itemData.find(i => i.material_main_head === 'Sand').item_id;

    // 7. Ensure ZO user mapping has balance in zo_balances
    const { error: balErr } = await supabase
      .from('zo_balances')
      .upsert({ zo_user_id: zoMobile, available_balance: 50000.00 })
      .select();
    if (balErr) throw balErr;

    // 8. Insert credit entry to ledger so reconciliation sums correctly
    const { error: ledgerErr } = await supabase
      .from('zo_fund_ledger')
      .insert({
        zo_user_id: zoMobile,
        transaction_type: 'ALLOCATION',
        reference_type: 'FUND_REQUEST',
        reference_id: crypto.randomUUID(),
        amount: 50000.00,
        work_order_no: testWorkOrder,
        created_by: adminMobile
      });
    if (ledgerErr) throw ledgerErr;
  });

  afterAll(async () => {
    // Cleanup database records
    if (reqAId) {
      await supabase.from('requisitions').delete().eq('requisition_id', reqAId);
    }
    if (reqBId) {
      await supabase.from('requisitions').delete().eq('requisition_id', reqBId);
    }
    if (reqCId) {
      await supabase.from('requisitions').delete().eq('requisition_id', reqCId);
    }
    await supabase.from('zo_fund_ledger').delete().eq('zo_user_id', zoMobile);
    if (itemIdCement) {
      await supabase.from('project_cost_estimate_items').delete().eq('item_id', itemIdCement);
    }
    if (itemIdSand) {
      await supabase.from('project_cost_estimate_items').delete().eq('item_id', itemIdSand);
    }
    if (estimateId) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    }
    await supabase.from('work_order_mappings').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('zo_balances').delete().eq('zo_user_id', zoMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile, adminMobile]);
  });

  test('Test 1: Creating a requisition exceeding Main Head capacity fails', async () => {
    const { error } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: jeMobile,
      p_work_order_no: testWorkOrder,
      p_estimate_no: testEstimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_ERR_${suffix}`,
      p_material_main_head: 'Cement',
      p_requisition_pdf_url: 'requisitions/pdf.pdf',
      p_original_filename: 'pdf.pdf',
      p_requisition_amount: 12000.00, // Exceeds 10,000 capacity
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: jeMobile
    });

    expect(error).toBeDefined();
    expect(error.message).toContain('exceeds the remaining Main Head capacity');
  });

  test('Test 2: Creating multiple pending requisitions within initial capacity succeeds', async () => {
    // Req A (8,000)
    const { data: dataA, error: errA } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: jeMobile,
      p_work_order_no: testWorkOrder,
      p_estimate_no: testEstimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_A_${suffix}`,
      p_material_main_head: 'Cement',
      p_requisition_pdf_url: 'requisitions/pdf.pdf',
      p_original_filename: 'pdf.pdf',
      p_requisition_amount: 8000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: jeMobile
    });

    expect(errA).toBeNull();
    reqAId = dataA.requisition_id;

    // Freeze ZO mapping historically for tests
    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqAId);

    // Req B (3,000) -> Succeeds on creation because Req A is still Pending and does not consume capacity yet
    const { data: dataB, error: errB } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: jeMobile,
      p_work_order_no: testWorkOrder,
      p_estimate_no: testEstimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_B_${suffix}`,
      p_material_main_head: 'Cement',
      p_requisition_pdf_url: 'requisitions/pdf2.pdf',
      p_original_filename: 'pdf2.pdf',
      p_requisition_amount: 3000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: jeMobile
    });

    expect(errB).toBeNull();
    reqBId = dataB.requisition_id;

    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqBId);
  });

  test('Test 3: Approving Req A consumes capacity and prevents subsequent approvals exceeding main head capacity', async () => {
    // 1. Approve Req A (8,000)
    const { error: appErrA } = await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqAId,
      p_approved_amount: 8000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved Req A'
    });
    expect(appErrA).toBeNull();

    // 2. Approve Req B (3,000) -> Should fail because remaining capacity is 10,000 - 8,000 = 2,000
    const { error: appErrB } = await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqBId,
      p_approved_amount: 3000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved Req B'
    });
    expect(appErrB).toBeDefined();
    expect(appErrB.message).toContain('exceeds the remaining Main Head capacity');
  });

  test('Test 4: Zonal Available Balance validation prevents approval when funds are insufficient', async () => {
    // 1. Create Req C on Sand (5,000)
    const { data: dataC, error: errC } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: jeMobile,
      p_work_order_no: testWorkOrder,
      p_estimate_no: testEstimateNo,
      p_estimate_amount: 30000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_C_${suffix}`,
      p_material_main_head: 'Sand',
      p_requisition_pdf_url: 'requisitions/pdf3.pdf',
      p_original_filename: 'pdf3.pdf',
      p_requisition_amount: 5000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: jeMobile
    });

    expect(errC).toBeNull();
    reqCId = dataC.requisition_id;
    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqCId);

    // 2. Set ZO balance low (e.g., 2,000)
    await supabase.from('zo_balances').update({ available_balance: 2000.00 }).eq('zo_user_id', zoMobile);

    // 3. Try to approve Req C for 5,000 -> Should fail due to insufficient ZO balance
    const { error: appErrC } = await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqCId,
      p_approved_amount: 5000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved Req C'
    });

    expect(appErrC).toBeDefined();
    expect(appErrC.message).toContain('Insufficient available Zonal Office balance');
  });
});
