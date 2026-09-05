import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  createEstimate,
  saveDraftItems,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview,
  reopenEstimate
} = require('../../../src/controllers/estimates.controller');

// Bug: after HO reopens a Final Approved estimate (reopenEstimate), a JE/ZO/HO
// adding a brand-new item and then trying to delete (or edit) that same new
// item was rejected with "Existing items cannot be deleted/modified in
// Estimate Reopened status" — even though the item had never been approved.
// Root cause: saveDraftItems had a blanket `isReopened` guard that fired on
// ANY item already present in the DB, without distinguishing a genuinely
// pre-reopen (always ho_office_approve = 'Approve', guaranteed by
// submit_ho_review's "all rows decided" + zero-rejected check) item from one
// added during the current reopen cycle (ho_office_approve/zo_office_approve
// still null). The fix removes that redundant guard — guard A (locks any
// ho_office_approve = 'Approve' row for everyone) already fully protects
// every real pre-reopen item.
describe('Estimate Reopened — new items stay freely editable/deletable, old items stay locked', () => {
  let suffix;
  let workOrder;
  let jeMobile, zoMobile, hoMobile, adminMobile;
  let estimateId;
  let oldItemId;
  const insertedMaterialIds = [];

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    workOrder = `TEST_WO_REOPEN_${suffix}`;
    jeMobile = `9601${suffix}`;
    zoMobile = `9602${suffix}`;
    hoMobile = `9603${suffix}`;
    adminMobile = `9604${suffix}`;

    await supabase.from('authorised_users').insert([
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO ${suffix}` },
      { mobile_number: hoMobile, role: 'ho', is_active: true, display_name: `HO ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` }
    ]);

    await supabase.from('projects_master').insert({
      work_order_no: workOrder,
      estimate_no: `EST_REOPEN_${suffix}`,
      work_order_value: 1000000.00,
      site_details: 'Test Site',
      state: 'West Bengal',
      district: 'Kolkata',
      zone: 'Kolkata Zone',
      department: 'PWD',
      status: 'Running',
      zo_user_id: zoMobile,
      created_by: adminMobile,
      edited_by: adminMobile
    });

    await supabase.from('je_zo_mappings').insert({ je_user_id: jeMobile, zo_user_id: zoMobile, is_active: true, assigned_by: adminMobile });
    await supabase.from('work_order_mappings').insert({ work_order_no: workOrder, je_user_id: jeMobile, is_active: true, assigned_by: adminMobile, reason: 'Assigned' });

    const { data: mats } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Old Item ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: adminMobile },
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `New Item ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: adminMobile }
    ]).select();
    mats.forEach(m => insertedMaterialIds.push(m.id));

    // 1. Create + submit an estimate with one item, and drive it all the way
    //    to Final Approved through the normal ZO -> HO pipeline.
    const resCreate = mockRes();
    await createEstimate({ user: { mobile_number: jeMobile, role: 'je' }, body: { work_order_no: workOrder, zonal_office_no: 'ZO-10' } }, resCreate);
    estimateId = resCreate.jsonData.estimate.estimate_id;

    await saveDraftItems({
      params: { id: estimateId },
      user: { mobile_number: jeMobile, role: 'je' },
      body: { items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Old Item ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' }] }
    }, mockRes());

    await submitEstimate({ params: { id: estimateId }, user: { mobile_number: jeMobile, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: estimateId }, user: { mobile_number: zoMobile, role: 'zo' } }, mockRes());

    const { data: items1 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', estimateId);
    oldItemId = items1[0].item_id;

    await submitRowApprovals({
      params: { id: estimateId },
      user: { mobile_number: zoMobile, role: 'zo' },
      body: { approvals: [{ item_id: oldItemId, approve_status: 'Approve' }] }
    }, mockRes());
    await submitReview({ params: { id: estimateId }, user: { mobile_number: zoMobile, role: 'zo' }, body: { remarks: 'ok' } }, mockRes());

    await reviewEstimate({ params: { id: estimateId }, user: { mobile_number: hoMobile, role: 'ho' } }, mockRes());
    await submitRowApprovals({
      params: { id: estimateId },
      user: { mobile_number: hoMobile, role: 'ho' },
      body: { approvals: [{ item_id: oldItemId, approve_status: 'Approve' }] }
    }, mockRes());
    const finalRes = mockRes();
    await submitReview({ params: { id: estimateId }, user: { mobile_number: hoMobile, role: 'ho' }, body: { remarks: 'ok' } }, finalRes);
    expect(finalRes.jsonData.estimate.estimate_status).toBe('Final Approved');

    // 2. HO reopens it.
    const reopenRes = mockRes();
    await reopenEstimate({ params: { id: estimateId }, user: { mobile_number: hoMobile, role: 'ho' } }, reopenRes);
    expect(reopenRes.jsonData.estimate.estimate_status).toBe('Estimate Reopened');
  });

  afterAll(async () => {
    await supabase.from('estimate_revision_log').delete().eq('estimate_id', estimateId);
    await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateId);
    await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    await supabase.from('work_order_mappings').delete().eq('work_order_no', workOrder);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    if (insertedMaterialIds.length > 0) {
      await supabase.from('material_master').delete().in('id', insertedMaterialIds);
    }
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile, hoMobile, adminMobile]);
  });

  test('a new item can be added alongside the locked old item', async () => {
    const res = mockRes();
    await saveDraftItems({
      params: { id: estimateId },
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        items: [
          { item_id: oldItemId, material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Old Item ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `New Item ${suffix}`, unit: 'Bag', qty: 5, rate: 50, rate_reference: 'Ref' }
        ]
      }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.items.length).toBe(2);
  });

  test('the new (never-approved) item can be freely edited in the same Estimate Reopened status', async () => {
    const { data: items } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', estimateId);
    const newItem = items.find(i => i.material_details === `New Item ${suffix}`);
    expect(newItem).toBeDefined();
    expect(newItem.ho_office_approve).toBeNull();

    const res = mockRes();
    await saveDraftItems({
      params: { id: estimateId },
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        items: [
          { item_id: oldItemId, material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Old Item ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
          { item_id: newItem.item_id, material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `New Item ${suffix}`, unit: 'Bag', qty: 8, rate: 50, rate_reference: 'Ref' }
        ]
      }
    }, res);

    expect(res.statusCode).toBe(200);
    const updated = res.jsonData.items.find(i => i.item_id === newItem.item_id);
    expect(Number(updated.qty)).toBe(8);
  });

  test('the new (never-approved) item can be deleted — this is the reported bug', async () => {
    const { data: items } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', estimateId);
    const newItem = items.find(i => i.material_details === `New Item ${suffix}`);
    expect(newItem).toBeDefined();

    const res = mockRes();
    await saveDraftItems({
      params: { id: estimateId },
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        items: [
          { item_id: oldItemId, material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Old Item ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' }
        ]
      }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.items.length).toBe(1);
    expect(res.jsonData.items[0].item_id).toBe(oldItemId);
  });

  test('the old, already HO-approved item still cannot be modified by a JE while reopened', async () => {
    const res = mockRes();
    await saveDraftItems({
      params: { id: estimateId },
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        items: [
          { item_id: oldItemId, material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Old Item ${suffix}`, unit: 'Bag', qty: 999, rate: 100, rate_reference: 'Ref' }
        ]
      }
    }, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData.message).toContain('locked');
  });

  test('the old, already HO-approved item still cannot be deleted by a JE while reopened', async () => {
    const res = mockRes();
    await saveDraftItems({
      params: { id: estimateId },
      user: { mobile_number: jeMobile, role: 'je' },
      body: { items: [] }
    }, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData.message).toContain('Final approved rows cannot be deleted');

    // Confirm it's still there afterward (rejection must not have partially applied).
    const { data: items } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', estimateId);
    expect(items.length).toBe(1);
    expect(items[0].item_id).toBe(oldItemId);
  });
});
