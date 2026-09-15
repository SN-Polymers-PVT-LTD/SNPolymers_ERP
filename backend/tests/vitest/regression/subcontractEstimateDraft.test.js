import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Subcontractor Estimate Phase 4A Draft RPC', () => {
  let suffix; let actor; let workOrder; let otherWorkOrder; let work; let contractor; let estimate; let otherEstimate;

  beforeAll(async () => {
    await requireLocalSupabase();
    suffix = crypto.randomUUID().slice(0, 8);
    const { data: user, error: userError } = await supabase.from('authorised_users').select('mobile_number').eq('role', 'admin').limit(1).maybeSingle();
    if (userError) throw userError;
    if (!user) throw new Error('Draft RPC test requires an admin actor.');
    actor = user.mobile_number;
    workOrder = `WO-SUB-DRAFT-${suffix}`;
    const { error: projectError } = await supabase.from('projects_master').insert({ work_order_no: workOrder, estimate_no: `EST-SUB-DRAFT-${suffix}`, site_details: 'Draft test', state: 'Test', district: 'Test', zone: 'Test', department: 'Test', created_by: actor, edited_by: actor, work_order_value: 100000, status: 'Running' });
    if (projectError) throw projectError;
    const workResult = await supabase.from('subcontract_work_master').insert({ sub_head: `Draft ${suffix}`, material_details: `Pipe ${suffix}`, unit: 'Mtr', created_by: actor }).select().single();
    if (workResult.error) throw workResult.error;
    work = workResult.data;
    const contractorResult = await supabase.from('subcontractor_master').insert({ subcontractor_name: `Draft Contractor ${suffix}`, created_by: actor }).select().single();
    if (contractorResult.error) throw contractorResult.error;
    contractor = contractorResult.data;
    const estimateResult = await supabase.from('project_subcontract_estimates').insert({ work_order_no: workOrder, created_by: actor, last_modified_by: actor }).select().single();
    if (estimateResult.error) throw estimateResult.error;
    estimate = estimateResult.data;
    otherWorkOrder = `WO-SUB-DRAFT-OTHER-${suffix}`;
    const otherProject = await supabase.from('projects_master').insert({ work_order_no: otherWorkOrder, estimate_no: `EST-SUB-DRAFT-OTHER-${suffix}`, site_details: 'Other Draft test', state: 'Test', district: 'Test', zone: 'Test', department: 'Test', created_by: actor, edited_by: actor, work_order_value: 100000, status: 'Running' });
    if (otherProject.error) throw otherProject.error;
    const otherEstimateResult = await supabase.from('project_subcontract_estimates').insert({ work_order_no: otherWorkOrder, created_by: actor, last_modified_by: actor }).select().single();
    if (otherEstimateResult.error) throw otherEstimateResult.error;
    otherEstimate = otherEstimateResult.data;
  });

  afterAll(async () => {
    if (estimate?.subcontract_estimate_id) await supabase.from('project_subcontract_estimate_lines').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
    if (estimate?.subcontract_estimate_id) await supabase.from('project_subcontract_estimates').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
    if (otherEstimate?.subcontract_estimate_id) await supabase.from('project_subcontract_estimates').delete().eq('subcontract_estimate_id', otherEstimate.subcontract_estimate_id);
    if (contractor?.id) await supabase.from('subcontractor_master').delete().eq('id', contractor.id);
    if (work?.id) await supabase.from('subcontract_work_master').delete().eq('id', work.id);
    if (workOrder) await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    if (otherWorkOrder) await supabase.from('projects_master').delete().eq('work_order_no', otherWorkOrder);
  });

  test('reconciles Draft lines and recalculates the server total', async () => {
    const first = await supabase.rpc('save_subcontract_estimate_draft_lines', { p_estimate_id: estimate.subcontract_estimate_id, p_actor: actor, p_expected_updated_at: estimate.updated_at, p_lines: [{ subcontractor_id: contractor.id, subcontract_work_id: work.id, qty: 4, rate: 125, amount: 999, created_by: 'spoofed' }] });
    expect(first.error).toBeNull();
    const refreshed = await supabase.from('project_subcontract_estimates').select('estimate_amount, updated_at').eq('subcontract_estimate_id', estimate.subcontract_estimate_id).single();
    expect(refreshed.error).toBeNull();
    expect(Number(refreshed.data.estimate_amount)).toBe(500);
    estimate.updated_at = refreshed.data.updated_at;
  });

  test('rejects a stale full-state save without changing lines', async () => {
    const stale = await supabase.rpc('save_subcontract_estimate_draft_lines', { p_estimate_id: estimate.subcontract_estimate_id, p_actor: actor, p_expected_updated_at: '2000-01-01T00:00:00.000Z', p_lines: [] });
    expect(stale.error?.code).toBe('PSE09');
    const lines = await supabase.from('project_subcontract_estimate_lines').select('qty, rate').eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
    expect(lines.data).toHaveLength(1);
    expect(lines.data[0]).toMatchObject({ qty: 4, rate: 125 });
  });

  test('preserves optional line metadata and rejects cross-estimate line ids', async () => {
    const line = await supabase.from('project_subcontract_estimate_lines').select('line_id').eq('subcontract_estimate_id', estimate.subcontract_estimate_id).single();
    const saved = await supabase.rpc('save_subcontract_estimate_draft_lines', { p_estimate_id: estimate.subcontract_estimate_id, p_actor: actor, p_expected_updated_at: estimate.updated_at, p_lines: [{ line_id: line.data.line_id, subcontractor_id: contractor.id, subcontract_work_id: work.id, qty: 4, rate: 125, rate_reference: 'SOR', remarks: 'updated' }] });
    expect(saved.error).toBeNull();
    const current = await supabase.from('project_subcontract_estimate_lines').select('rate_reference, remarks').eq('line_id', line.data.line_id).single();
    expect(current.data).toMatchObject({ rate_reference: 'SOR', remarks: 'updated' });
    const crossEstimate = await supabase.rpc('save_subcontract_estimate_draft_lines', { p_estimate_id: otherEstimate.subcontract_estimate_id, p_actor: actor, p_expected_updated_at: otherEstimate.updated_at, p_lines: [{ line_id: line.data.line_id, subcontractor_id: contractor.id, subcontract_work_id: work.id, qty: 4, rate: 125 }] });
    expect(crossEstimate.error?.code).toBe('PSE08');
  });
});
