const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const setupUsers = require('./setupUsers');
const setupProject = require('./setupProject');

async function ensureMaterialHead(materialMainHead, adminMobile) {
  const { data: existing } = await supabase
    .from('material_master')
    .select('Material_Main_Head')
    .eq('Material_Main_Head', materialMainHead)
    .limit(1)
    .maybeSingle();

  if (existing) return;

  const { error } = await supabase.from('material_master').insert({
    Material_Main_Head: materialMainHead,
    Material_Sub_Head: 'Test',
    Material_Details: `Financial fixture ${materialMainHead}`,
    M_Unit: 'Unit',
    is_active: true,
    created_by: adminMobile
  });

  if (error) throw error;
}

/**
 * Seeds JE/ZO/HO/admin users, project, mappings, estimate, ZO balance + ledger credit.
 */
async function seedFinancialScenario({
  suffix: suffixInput,
  estimateAmount = 30000,
  cementHeadAmount = 10000,
  sandHeadAmount = 20000,
  zoBalance = 50000,
  workOrderValue = 1000000
} = {}) {
  // authorised_users.mobile_number is VARCHAR(15) — keep test mobiles numeric and short.
  const id = (suffixInput || crypto.randomUUID()).replace(/\D/g, '').substring(0, 8);
  const jeMobile = `9100${id}`;
  const zoMobile = `9200${id}`;
  const hoMobile = `9300${id}`;
  const adminMobile = `9400${id}`;
  const workOrder = `TEST_WO_FIN_${id}`;
  const estimateNo = `EST_FIN_${id}`;

  await setupUsers([
    {
      mobile_number: adminMobile,
      role: 'admin',
      is_active: true,
      display_name: `Fin Admin ${id}`,
      permissions: {}
    },
    {
      mobile_number: jeMobile,
      role: 'je',
      is_active: true,
      display_name: `Fin JE ${id}`,
      permissions: {}
    },
    {
      mobile_number: zoMobile,
      role: 'zo',
      is_active: true,
      display_name: `Fin ZO ${id}`,
      permissions: {}
    },
    {
      mobile_number: hoMobile,
      role: 'ho',
      is_active: true,
      display_name: `Fin HO ${id}`,
      permissions: {}
    }
  ]);

  await setupProject(workOrder, estimateNo, workOrderValue, adminMobile);

  const { error: projUpdErr } = await supabase
    .from('projects_master')
    .update({ zo_user_id: zoMobile })
    .eq('work_order_no', workOrder);
  if (projUpdErr) throw projUpdErr;

  const { error: jeZoErr } = await supabase.from('je_zo_mappings').insert({
    je_user_id: jeMobile,
    zo_user_id: zoMobile,
    is_active: true,
    assigned_by: adminMobile
  });
  if (jeZoErr) throw jeZoErr;

  const { error: woMapErr } = await supabase.from('work_order_mappings').insert({
    work_order_no: workOrder,
    je_user_id: jeMobile,
    is_active: true,
    reason: 'Assigned',
    assigned_by: adminMobile
  });
  if (woMapErr) throw woMapErr;

  await ensureMaterialHead('Cement', adminMobile);
  await ensureMaterialHead('Sand', adminMobile);

  const { data: estData, error: estErr } = await supabase
    .from('project_cost_estimates')
    .insert({
      work_order_no: workOrder,
      estimate_no: estimateNo,
      area_code: 'Kolkata Zone',
      estimate_revision: 0,
      zonal_office_no: 'TEST_ZO_FIN',
      estimate_amount: estimateAmount,
      estimate_status: 'Final Approved',
      created_by: adminMobile,
      last_modified_by: adminMobile
    })
    .select()
    .single();
  if (estErr) throw estErr;

  const estimateItems = [];
  if (cementHeadAmount > 0) {
    estimateItems.push({
      estimate_id: estData.estimate_id,
      material_main_head: 'Cement',
      material_sub_head: 'PPC',
      material_details: 'Fixture Cement',
      unit: 'bags',
      qty: 20,
      rate: cementHeadAmount / 20,
      amount: cementHeadAmount
    });
  }
  if (sandHeadAmount > 0) {
    estimateItems.push({
      estimate_id: estData.estimate_id,
      material_main_head: 'Sand',
      material_sub_head: 'Fine',
      material_details: 'Fixture Sand',
      unit: 'cft',
      qty: 40,
      rate: sandHeadAmount / 40,
      amount: sandHeadAmount
    });
  }

  let itemIds = [];
  if (estimateItems.length > 0) {
    const { data: itemData, error: itemErr } = await supabase
      .from('project_cost_estimate_items')
      .insert(estimateItems)
      .select();
    if (itemErr) throw itemErr;
    itemIds = (itemData || []).map((item) => item.item_id);
  }

  const { error: balErr } = await supabase
    .from('zo_balances')
    .upsert({ zo_user_id: zoMobile, available_balance: zoBalance });
  if (balErr) throw balErr;

  const ledgerSeedId = crypto.randomUUID();
  const { error: ledgerErr } = await supabase.from('zo_fund_ledger').insert({
    zo_user_id: zoMobile,
    transaction_type: 'ALLOCATION',
    reference_type: 'FUND_REQUEST',
    reference_id: ledgerSeedId,
    amount: zoBalance,
    work_order_no: workOrder,
    created_by: adminMobile
  });
  if (ledgerErr) throw ledgerErr;

  return {
    suffix: id,
    jeMobile,
    zoMobile,
    hoMobile,
    adminMobile,
    workOrder,
    estimateNo,
    estimateId: estData.estimate_id,
    itemIds,
    ledgerSeedId,
    requisitionIds: [],
    fundRequestIds: [],
    draftEstimateIds: [],
    extraWorkOrders: []
  };
}

async function insertRequisitionDirect(ctx, fields) {
  const {
    requisition_no,
    requisition_amount,
    requisition_status = 'Pending',
    material_main_head = 'Cement',
    approved_amount = null,
    approved_balance_amount = null,
    zo_user_id = ctx.zoMobile
  } = fields;

  const { data, error } = await supabase
    .from('requisitions')
    .insert({
      requester_user_id: ctx.jeMobile,
      work_order_no: ctx.workOrder,
      estimate_no: ctx.estimateNo,
      estimate_amount: fields.estimate_amount ?? null,
      state: 'West Bengal',
      district: 'Kolkata',
      area_code: 'Kolkata Zone',
      department: 'PWD',
      site_details: 'Fixture site',
      requisition_no,
      material_main_head,
      requisition_pdf_url: `fixtures/${requisition_no}.pdf`,
      requisition_amount,
      gst_bill: 'No',
      bank_details: 'Test bank',
      requisition_status,
      zo_user_id,
      approved_user_id: requisition_status === 'Approved' ? ctx.adminMobile : null,
      payment_date: requisition_status === 'Approved' ? new Date().toISOString() : null,
      approve_type: requisition_status === 'Approved' ? 'Approve' : null,
      approved_amount,
      approved_balance_amount,
      created_by: ctx.jeMobile
    })
    .select()
    .single();

  if (error) throw error;
  ctx.requisitionIds.push(data.requisition_id);
  return data;
}

async function insertRequisitionViaRpc(ctx, fields) {
  const { data, error } = await supabase.rpc('create_requisition_secure', {
    p_requester_user_id: ctx.jeMobile,
    p_work_order_no: ctx.workOrder,
    p_estimate_no: ctx.estimateNo,
    p_estimate_amount: fields.estimate_amount ?? null,
    p_state: 'West Bengal',
    p_district: 'Kolkata',
    p_area_code: 'Kolkata Zone',
    p_department: 'PWD',
    p_site_details: 'Fixture site',
    p_requisition_no: fields.requisition_no,
    p_material_main_head: fields.material_main_head || 'Cement',
    p_requisition_pdf_url: `fixtures/${fields.requisition_no}.pdf`,
    p_original_filename: `${fields.requisition_no}.pdf`,
    p_requisition_amount: fields.requisition_amount,
    p_gst_bill: 'No',
    p_gst_bill_pdf_url: null,
    p_bank_details: 'Test bank',
    p_expen_head_remarks: null,
    p_requisition_status: fields.requisition_status || 'Pending',
    p_created_by: ctx.jeMobile
  });

  if (error) throw error;

  await supabase
    .from('requisitions')
    .update({ zo_user_id: ctx.zoMobile })
    .eq('requisition_id', data.requisition_id);

  ctx.requisitionIds.push(data.requisition_id);
  return data;
}

async function getZoBalance(zoMobile) {
  const { data } = await supabase
    .from('zo_balances')
    .select('available_balance')
    .eq('zo_user_id', zoMobile)
    .maybeSingle();
  return Number(data?.available_balance || 0);
}

async function countLedgerRows({ zoMobile, referenceId, transactionType } = {}) {
  let query = supabase
    .from('zo_fund_ledger')
    .select('ledger_id', { count: 'exact', head: true });

  if (zoMobile) query = query.eq('zo_user_id', zoMobile);
  if (referenceId) query = query.eq('reference_id', referenceId);
  if (transactionType) query = query.eq('transaction_type', transactionType);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function getLedgerRows({ zoMobile, referenceId } = {}) {
  let query = supabase.from('zo_fund_ledger').select('*');
  if (zoMobile) query = query.eq('zo_user_id', zoMobile);
  if (referenceId) query = query.eq('reference_id', referenceId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Draft estimate on a separate work order (no Final Approved row) for submit idempotency tests.
 */
async function seedDraftEstimate(ctx) {
  const draftWorkOrder = `TEST_WO_DRAFT_${ctx.suffix}`;
  const draftEstimateNo = `EST_DRAFT_${ctx.suffix}`;

  await setupProject(draftWorkOrder, draftEstimateNo, 500000, ctx.adminMobile);

  const { error: projUpdErr } = await supabase
    .from('projects_master')
    .update({ zo_user_id: ctx.zoMobile })
    .eq('work_order_no', draftWorkOrder);
  if (projUpdErr) throw projUpdErr;

  const { error: woMapErr } = await supabase.from('work_order_mappings').insert({
    work_order_no: draftWorkOrder,
    je_user_id: ctx.jeMobile,
    is_active: true,
    reason: 'Assigned',
    assigned_by: ctx.adminMobile
  });
  if (woMapErr) throw woMapErr;

  await ensureMaterialHead('Raw Materials', ctx.adminMobile);

  const { data: estData, error: estErr } = await supabase
    .from('project_cost_estimates')
    .insert({
      work_order_no: draftWorkOrder,
      estimate_no: draftEstimateNo,
      area_code: 'Kolkata Zone',
      estimate_revision: 0,
      zonal_office_no: 'TEST_ZO_FIN',
      estimate_amount: 50000,
      estimate_status: 'Draft',
      created_by: ctx.jeMobile,
      last_modified_by: ctx.jeMobile,
      je_user_id: ctx.jeMobile
    })
    .select()
    .single();
  if (estErr) throw estErr;

  const { error: itemErr } = await supabase.from('project_cost_estimate_items').insert({
    estimate_id: estData.estimate_id,
    material_main_head: 'Raw Materials',
    material_sub_head: 'Cement',
    material_details: 'Draft item',
    unit: 'Bag',
    qty: 10,
    rate: 100,
    rate_reference: 'Fixture ref',
    amount: 1000
  });
  if (itemErr) throw itemErr;

  ctx.draftEstimateIds.push(estData.estimate_id);
  ctx.extraWorkOrders.push(draftWorkOrder);

  return {
    estimateId: estData.estimate_id,
    workOrder: draftWorkOrder
  };
}

async function cleanupFinancialScenario(ctx) {
  if (!ctx) return;

  if (ctx.requisitionIds?.length) {
    await supabase.from('requisitions').delete().in('requisition_id', ctx.requisitionIds);
  }
  if (ctx.fundRequestIds?.length) {
    await supabase.from('fund_requests').delete().in('fund_request_id', ctx.fundRequestIds);
  }

  await supabase.from('zo_fund_ledger').delete().eq('zo_user_id', ctx.zoMobile);
  await supabase.from('zo_balances').delete().eq('zo_user_id', ctx.zoMobile);

  for (const estimateId of ctx.draftEstimateIds || []) {
    await supabase.from('estimate_revision_log').delete().eq('estimate_id', estimateId);
    await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateId);
    await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
  }

  if (ctx.itemIds?.length) {
    await supabase.from('project_cost_estimate_items').delete().in('item_id', ctx.itemIds);
  }
  if (ctx.estimateId) {
    await supabase.from('project_cost_estimates').delete().eq('estimate_id', ctx.estimateId);
  }

  for (const workOrder of ctx.extraWorkOrders || []) {
    await supabase.from('work_order_mappings').delete().eq('work_order_no', workOrder);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
  }

  await supabase.from('work_order_mappings').delete().eq('work_order_no', ctx.workOrder);
  await supabase.from('je_zo_mappings').delete().eq('je_user_id', ctx.jeMobile);
  await supabase.from('projects_master').delete().eq('work_order_no', ctx.workOrder);

  await supabase.from('authorised_users').delete().in('mobile_number', [
    ctx.jeMobile,
    ctx.zoMobile,
    ctx.hoMobile,
    ctx.adminMobile
  ]);
}

module.exports = {
  seedFinancialScenario,
  seedDraftEstimate,
  insertRequisitionDirect,
  insertRequisitionViaRpc,
  getZoBalance,
  countLedgerRows,
  getLedgerRows,
  cleanupFinancialScenario
};
