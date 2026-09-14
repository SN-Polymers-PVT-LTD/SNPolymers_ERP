import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Subcontractor Estimate database foundation', () => {
  let suffix;
  let actor;
  let workOrder;
  let work;
  let subcontractor;
  let estimate;
  let costEstimate;
  let costItem;
  let baseLine;

  beforeAll(async () => {
    await requireLocalSupabase();
    suffix = crypto.randomUUID().slice(0, 8);

    const { data: users, error: userError } = await supabase
      .from('authorised_users')
      .select('mobile_number')
      .limit(1);
    if (userError) throw userError;
    if (!users?.[0]) throw new Error('Foundation test requires one authorised user.');
    actor = users[0].mobile_number;

    workOrder = `WO-SUB-FOUND-${suffix}`;
    const { error: projectError } = await supabase.from('projects_master').insert({
      work_order_no: workOrder,
      estimate_no: `EST-SUB-${suffix}`,
      site_details: 'Foundation test site',
      state: 'Test State',
      district: 'Test District',
      zone: 'Test Zone',
      department: 'Test Department',
      created_by: actor,
      edited_by: actor,
      work_order_value: 100000,
      status: 'Running'
    });
    if (projectError) throw projectError;

    const { data: workRow, error: workError } = await supabase
      .from('subcontract_work_master')
      .insert({ sub_head: `Foundation ${suffix}`, material_details: `Pipe ${suffix}`, unit: 'Mtr', created_by: actor })
      .select()
      .single();
    if (workError) throw workError;
    work = workRow;

    const { data: subcontractorRow, error: subcontractorError } = await supabase
      .from('subcontractor_master')
      .insert({ subcontractor_name: `Contractor ${suffix}`, created_by: actor })
      .select()
      .single();
    if (subcontractorError) throw subcontractorError;
    subcontractor = subcontractorRow;

    const { data: estimateRow, error: estimateError } = await supabase
      .from('project_subcontract_estimates')
      .insert({ work_order_no: workOrder, created_by: actor })
      .select()
      .single();
    if (estimateError) throw estimateError;
    estimate = estimateRow;

    const { data: costEstimateRow, error: costEstimateError } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: workOrder,
        estimate_no: `EST-COST-${suffix}`,
        area_code: 'Test Zone',
        zonal_office_no: 'TEST-ZO',
        created_by: actor,
        estimate_status: 'Draft'
      })
      .select()
      .single();
    if (costEstimateError) throw costEstimateError;
    costEstimate = costEstimateRow;
  });

  afterAll(async () => {
    if (estimate?.subcontract_estimate_id) {
      await supabase.from('subcontract_estimate_revision_log').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
      await supabase.from('project_subcontract_estimate_lines').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
      await supabase.from('project_subcontract_estimates').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
    }
    if (costEstimate?.estimate_id) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', costEstimate.estimate_id);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', costEstimate.estimate_id);
    }
    if (workOrder) await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    if (subcontractor?.id) await supabase.from('subcontractor_master').delete().eq('id', subcontractor.id);
    if (work?.id) await supabase.from('subcontract_work_master').delete().eq('id', work.id);
  });

  test('enforces normalized work identity and permits repeated source lines', async () => {
    const { error: duplicateError } = await supabase.from('subcontract_work_master').insert({
      sub_head: ` foundation ${suffix} `,
      material_details: ` PIPE ${suffix} `,
      unit: 'mtr',
      created_by: actor
    });
    expect(duplicateError).toBeTruthy();

    const first = await supabase.from('project_subcontract_estimate_lines').insert({
      subcontract_estimate_id: estimate.subcontract_estimate_id,
      subcontractor_id: subcontractor.id,
      subcontract_work_id: work.id,
      qty: 400,
      rate: 100,
      amount: 40000,
      created_by: actor,
      entry_kind: 'BASE'
    }).select().single();
    if (first.error) throw first.error;
    baseLine = first.data;

    const second = await supabase.from('project_subcontract_estimate_lines').insert({
      subcontract_estimate_id: estimate.subcontract_estimate_id,
      subcontractor_id: subcontractor.id,
      subcontract_work_id: work.id,
      qty: 150,
      rate: 105,
      amount: 15750,
      created_by: actor,
      entry_kind: 'ADDITION'
    });
    expect(second.error).toBeNull();
  });

  test('supports signed adjustment structure without mutating the source line', async () => {
    const { error } = await supabase.from('project_subcontract_estimate_lines').insert({
      subcontract_estimate_id: estimate.subcontract_estimate_id,
      subcontractor_id: subcontractor.id,
      subcontract_work_id: work.id,
      qty: -50,
      rate: 100,
      amount: -5000,
      created_by: actor,
      entry_kind: 'ADJUSTMENT',
      adjusts_line_id: baseLine.line_id
    });
    expect(error).toBeNull();

    const { data: unchanged, error: readError } = await supabase
      .from('project_subcontract_estimate_lines')
      .select('qty, rate, amount, entry_kind')
      .eq('line_id', baseLine.line_id)
      .single();
    if (readError) throw readError;
    expect(unchanged).toMatchObject({ qty: 400, rate: 100, amount: 40000, entry_kind: 'BASE' });
  });

  test('requires adjustment references and blocks duplicate generated work rows', async () => {
    const badAdjustment = await supabase.from('project_subcontract_estimate_lines').insert({
      subcontract_estimate_id: estimate.subcontract_estimate_id,
      subcontractor_id: subcontractor.id,
      subcontract_work_id: work.id,
      qty: -1,
      rate: 100,
      amount: -100,
      created_by: actor,
      entry_kind: 'ADJUSTMENT'
    });
    expect(badAdjustment.error).toBeTruthy();

    const firstItem = await supabase.from('project_cost_estimate_items').insert({
      estimate_id: costEstimate.estimate_id,
      material_main_head: 'Sub Contractor',
      material_sub_head: `Foundation ${suffix}`,
      material_details: `Pipe ${suffix}`,
      unit: 'Mtr', qty: 500, rate: 111.5, amount: 55750,
      source_type: 'SUBCONTRACT_ESTIMATE', subcontract_work_id: work.id
    }).select().single();
    if (firstItem.error) throw firstItem.error;
    costItem = firstItem.data;

    const duplicateItem = await supabase.from('project_cost_estimate_items').insert({
      estimate_id: costEstimate.estimate_id,
      material_main_head: 'Sub Contractor',
      material_sub_head: `Foundation ${suffix}`,
      material_details: `Pipe ${suffix}`,
      unit: 'Mtr', qty: 1, rate: 1, amount: 1,
      source_type: 'SUBCONTRACT_ESTIMATE', subcontract_work_id: work.id
    });
    expect(duplicateItem.error).toBeTruthy();
  });
});
