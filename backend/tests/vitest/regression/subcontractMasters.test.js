import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const schemas = require('../../../src/validation/subcontractMasters.schema');
const requireRole = require('../../../src/middleware/requireRole');

describe('Subcontract master contracts', () => {
  let suffix; let actor; let work; let duplicateWork; let contractor; let estimate; let beneficiary; let workOrder;

  beforeAll(async () => {
    await requireLocalSupabase();
    suffix = crypto.randomUUID().slice(0, 8);
    const { data: user, error: userError } = await supabase.from('authorised_users').select('mobile_number').limit(1).single();
    if (userError) throw userError;
    actor = user.mobile_number;
    workOrder = `WO-MASTER-${suffix}`;
    const { error: projectError } = await supabase.from('projects_master').insert({ work_order_no: workOrder, estimate_no: `EST-MASTER-${suffix}`, site_details: 'Master test site', state: 'Test', district: 'Test', zone: 'Test', department: 'Test', created_by: actor, edited_by: actor, work_order_value: 10000, status: 'Running' });
    if (projectError) throw projectError;
    const { data: workRow, error: workError } = await supabase.from('subcontract_work_master').insert({ sub_head: `Master ${suffix}`, material_details: `Pipe ${suffix}`, unit: 'Mtr', created_by: actor }).select().single();
    if (workError) throw workError;
    work = workRow;
    const { data: contractorRow, error: contractorError } = await supabase.from('subcontractor_master').insert({ subcontractor_name: `Contractor ${suffix}`, email: '', contact_person: '', created_by: actor }).select().single();
    if (contractorError) throw contractorError;
    contractor = contractorRow;
    const { data: beneficiaryRow, error: beneficiaryError } = await supabase.from('projects_beneficiary_master').select('id').limit(1).maybeSingle();
    if (beneficiaryError) throw beneficiaryError;
    beneficiary = beneficiaryRow;
  });

  afterAll(async () => {
    if (estimate?.subcontract_estimate_id) await supabase.from('project_subcontract_estimate_lines').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
    if (estimate?.subcontract_estimate_id) await supabase.from('project_subcontract_estimates').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
    if (contractor?.id) await supabase.from('subcontractor_master').delete().eq('id', contractor.id);
    if (beneficiary?.id && contractor?.id) await supabase.from('subcontractor_master').update({ primary_beneficiary_id: null }).eq('id', contractor.id);
    if (duplicateWork?.id) await supabase.from('subcontract_work_master').delete().eq('id', duplicateWork.id);
    if (work?.id) await supabase.from('subcontract_work_master').delete().eq('id', work.id);
    if (workOrder) await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
  });

  test('normalizes blank filters, optional strings, email, and invalid UUIDs', () => {
    const parsed = schemas.subcontractorListSchema.query.parse({ is_active: '', beneficiary_status: '' });
    expect(parsed.is_active).toBeUndefined();
    expect(parsed.beneficiary_status).toBeUndefined();
    const create = schemas.subcontractorCreateSchema.body.parse({ subcontractor_name: 'X', email: '', contact_person: '', mobile: '', address: '', pan_no: '', gst_no: '' });
    expect(create.email).toBeNull();
    expect(create.contact_person).toBeNull();
    expect(schemas.subcontractorIdSchema.params.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  test('Accounts cannot read master data while Projects roles can', () => {
    const next = () => {};
    const denied = { user: { role: 'accounts' }, status: code => ({ json: () => code }) };
    let deniedCode;
    requireRole(['je', 'zo', 'ho', 'admin'])({ user: denied.user }, { status: code => ({ json: () => { deniedCode = code; } }) }, next);
    expect(deniedCode).toBe(403);
    expect(() => requireRole(['je', 'zo', 'ho', 'admin'])({ user: { role: 'je' } }, {}, next)).not.toThrow();
  });

  test('duplicate work is rejected after normalized identity, but duplicate contractor names are legal', async () => {
    const workDuplicate = await supabase.from('subcontract_work_master').insert({ sub_head: ` master ${suffix} `, material_details: ` PIPE ${suffix} `, unit: 'mtr', created_by: actor });
    expect(workDuplicate.error?.code).toBe('23505');
    const { data, error } = await supabase.from('subcontractor_master').insert({ subcontractor_name: `Contractor ${suffix}`, created_by: actor }).select().single();
    if (error) throw error;
    duplicateWork = data;
  });

  test('inactive rows are hidden from active queries and can be explicitly selected', async () => {
    const { error } = await supabase.from('subcontractor_master').update({ is_active: false }).eq('id', duplicateWork.id);
    if (error) throw error;
    const active = await supabase.from('subcontractor_master').select('id').eq('id', duplicateWork.id).eq('is_active', true);
    expect(active.data).toHaveLength(0);
    const all = await supabase.from('subcontractor_master').select('id').eq('id', duplicateWork.id).eq('is_active', false);
    expect(all.data).toHaveLength(1);
  });

  test('referenced work identity cannot be changed at the database boundary', async () => {
    const { data: estimateRow, error: estimateError } = await supabase.from('project_subcontract_estimates').insert({ work_order_no: workOrder, created_by: actor }).select().single();
    if (estimateError) throw estimateError;
    estimate = estimateRow;
    const { error: lineError } = await supabase.from('project_subcontract_estimate_lines').insert({ subcontract_estimate_id: estimate.subcontract_estimate_id, subcontractor_id: contractor.id, subcontract_work_id: work.id, qty: 1, rate: 10, amount: 10, created_by: actor, entry_kind: 'BASE' });
    if (lineError) throw lineError;
    const update = await supabase.from('subcontract_work_master').update({ material_details: `Changed ${suffix}` }).eq('id', work.id);
    expect(update.error?.code).toBe('23514');
    const statusUpdate = await supabase.from('subcontract_work_master').update({ is_active: false }).eq('id', work.id);
    expect(statusUpdate.error).toBeNull();
  });
});
