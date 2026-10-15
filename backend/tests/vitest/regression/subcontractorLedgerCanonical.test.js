import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const mockRes = require('../../helpers/mockRes');
const {
  getSubcontractorLedger,
  getSubcontractorLedgerEntries,
  getSubcontractorRequisitions
} = require('../../../src/controllers/requisitions.controller');

describe('Canonical Subcontractor Ledger & Work Order Access Isolation', () => {
  let suffix;
  let actor;
  let contractorA;
  let contractorB;
  let work1;
  let work2;
  let workOrderA;
  let workOrderB;
  let jeUserA;
  let jeUserB;
  let zoUser;
  let adminUser;
  let estimateA;
  let estimateB;

  beforeAll(async () => {
    await requireLocalSupabase();
    suffix = crypto.randomUUID().slice(0, 8);

    const { data: user, error: userError } = await supabase
      .from('authorised_users')
      .select('mobile_number')
      .limit(1)
      .single();
    if (userError) throw userError;
    actor = user.mobile_number;

    // Test users
    jeUserA = { mobile_number: `9611${suffix}`, role: 'je', display_name: `JE A ${suffix}`, is_active: true };
    jeUserB = { mobile_number: `9612${suffix}`, role: 'je', display_name: `JE B ${suffix}`, is_active: true };
    zoUser = { mobile_number: `9613${suffix}`, role: 'zo', display_name: `ZO ${suffix}`, is_active: true };
    adminUser = { mobile_number: `9614${suffix}`, role: 'admin', display_name: `Admin ${suffix}`, is_active: true };

    const { error: insertUsersError } = await supabase.from('authorised_users').insert([
      jeUserA,
      jeUserB,
      zoUser,
      adminUser
    ]);
    if (insertUsersError) throw insertUsersError;

    // Work orders
    workOrderA = `WO-CANON-A-${suffix}`;
    workOrderB = `WO-CANON-B-${suffix}`;

    await supabase.from('projects_master').insert([
      {
        work_order_no: workOrderA,
        estimate_no: `EST-CANON-A-${suffix}`,
        site_details: 'Canonical test site A',
        state: 'Test',
        district: 'Test',
        zone: 'Test',
        department: 'Dept A',
        zo_user_id: zoUser.mobile_number,
        created_by: actor,
        edited_by: actor,
        work_order_value: 500000,
        status: 'Running'
      },
      {
        work_order_no: workOrderB,
        estimate_no: `EST-CANON-B-${suffix}`,
        site_details: 'Canonical test site B',
        state: 'Test',
        district: 'Test',
        zone: 'Test',
        department: 'Dept B',
        zo_user_id: zoUser.mobile_number,
        created_by: actor,
        edited_by: actor,
        work_order_value: 600000,
        status: 'Running'
      }
    ]);

    // JE-ZO mappings (required before work_order_mappings)
    const { error: jeZoError } = await supabase.from('je_zo_mappings').insert([
      { je_user_id: jeUserA.mobile_number, zo_user_id: zoUser.mobile_number, is_active: true, assigned_by: adminUser.mobile_number },
      { je_user_id: jeUserB.mobile_number, zo_user_id: zoUser.mobile_number, is_active: true, assigned_by: adminUser.mobile_number }
    ]);
    if (jeZoError) throw jeZoError;

    // Work order mappings: JE A -> workOrderA, JE B -> workOrderB
    const { error: womError } = await supabase.from('work_order_mappings').insert([
      { work_order_no: workOrderA, je_user_id: jeUserA.mobile_number, is_active: true, reason: 'Assigned', assigned_by: zoUser.mobile_number },
      { work_order_no: workOrderB, je_user_id: jeUserB.mobile_number, is_active: true, reason: 'Assigned', assigned_by: zoUser.mobile_number }
    ]);
    if (womError) throw womError;

    // Subcontract works
    const { data: w1 } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Pipeline Scope ${suffix}`,
      material_details: `HDPE Trenching ${suffix}`,
      unit: 'mtr',
      created_by: actor
    }).select().single();
    work1 = w1;

    const { data: w2 } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Civil Scope ${suffix}`,
      material_details: `Brick Masonry ${suffix}`,
      unit: 'cum',
      created_by: actor
    }).select().single();
    work2 = w2;

    // Subcontractors
    const { data: cA } = await supabase.from('subcontractor_master').insert({
      subcontractor_name: `Ram Rahim ${suffix}`,
      created_by: actor
    }).select().single();
    contractorA = cA;

    const { data: cB } = await supabase.from('subcontractor_master').insert({
      subcontractor_name: `Shyam Lal ${suffix}`,
      created_by: actor
    }).select().single();
    contractorB = cB;

    // Capabilities: Contractor A does work1 and work2; Contractor B does work1
    await supabase.from('subcontractor_work_capabilities').insert([
      { subcontractor_id: contractorA.id, subcontract_work_id: work1.id, created_by: actor },
      { subcontractor_id: contractorA.id, subcontract_work_id: work2.id, created_by: actor },
      { subcontractor_id: contractorB.id, subcontract_work_id: work1.id, created_by: actor }
    ]);

    // Create Subcontract Estimates:
    // On WO-A: Contractor A has work1 (50,000) and work2 (30,000)
    const { data: estA, error: estAErr } = await supabase.from('project_subcontract_estimates').insert({
      work_order_no: workOrderA,
      created_by: actor,
      estimate_status: 'Final Approved'
    }).select().single();
    if (estAErr) throw estAErr;
    estimateA = estA;

    const { error: lineAErr } = await supabase.from('project_subcontract_estimate_lines').insert([
      {
        subcontract_estimate_id: estimateA.subcontract_estimate_id,
        subcontractor_id: contractorA.id,
        subcontract_work_id: work1.id,
        qty: 500,
        rate: 100,
        amount: 50000,
        entry_kind: 'BASE',
        final_approved_revision: 0,
        final_approved_at: new Date().toISOString(),
        final_approved_by: actor,
        created_by: actor
      },
      {
        subcontract_estimate_id: estimateA.subcontract_estimate_id,
        subcontractor_id: contractorA.id,
        subcontract_work_id: work2.id,
        qty: 100,
        rate: 300,
        amount: 30000,
        entry_kind: 'BASE',
        final_approved_revision: 0,
        final_approved_at: new Date().toISOString(),
        final_approved_by: actor,
        created_by: actor
      }
    ]);
    if (lineAErr) throw lineAErr;

    // On WO-B: Contractor A has work1 (70,000); Contractor B has work1 (40,000)
    const { data: estB, error: estBErr } = await supabase.from('project_subcontract_estimates').insert({
      work_order_no: workOrderB,
      created_by: actor,
      estimate_status: 'Final Approved'
    }).select().single();
    if (estBErr) throw estBErr;
    estimateB = estB;

    const { error: lineBErr } = await supabase.from('project_subcontract_estimate_lines').insert([
      {
        subcontract_estimate_id: estimateB.subcontract_estimate_id,
        subcontractor_id: contractorA.id,
        subcontract_work_id: work1.id,
        qty: 700,
        rate: 100,
        amount: 70000,
        entry_kind: 'BASE',
        final_approved_revision: 0,
        final_approved_at: new Date().toISOString(),
        final_approved_by: actor,
        created_by: actor
      },
      {
        subcontract_estimate_id: estimateB.subcontract_estimate_id,
        subcontractor_id: contractorB.id,
        subcontract_work_id: work1.id,
        qty: 400,
        rate: 100,
        amount: 40000,
        entry_kind: 'BASE',
        final_approved_revision: 0,
        final_approved_at: new Date().toISOString(),
        final_approved_by: actor,
        created_by: actor
      }
    ]);
    if (lineBErr) throw lineBErr;

    // Add ledger credit entries
    const { error: sclErr } = await supabase.from('subcontractor_ledger').insert([
      {
        work_order_no: workOrderA,
        subcontractor_id: contractorA.id,
        subcontract_work_id: work1.id,
        material_main_head: 'Sub Contractor',
        material_sub_head: work1.sub_head,
        material_details: work1.material_details,
        transaction_type: 'ESTIMATE_ITEM_APPROVAL',
        reference_type: 'ESTIMATE_ITEM',
        reference_id: crypto.randomUUID(),
        amount: 50000,
        created_by: actor,
        ledger_visible: true
      },
      {
        work_order_no: workOrderA,
        subcontractor_id: contractorA.id,
        subcontract_work_id: work2.id,
        material_main_head: 'Sub Contractor',
        material_sub_head: work2.sub_head,
        material_details: work2.material_details,
        transaction_type: 'ESTIMATE_ITEM_APPROVAL',
        reference_type: 'ESTIMATE_ITEM',
        reference_id: crypto.randomUUID(),
        amount: 30000,
        created_by: actor,
        ledger_visible: true
      },
      {
        work_order_no: workOrderB,
        subcontractor_id: contractorA.id,
        subcontract_work_id: work1.id,
        material_main_head: 'Sub Contractor',
        material_sub_head: work1.sub_head,
        material_details: work1.material_details,
        transaction_type: 'ESTIMATE_ITEM_APPROVAL',
        reference_type: 'ESTIMATE_ITEM',
        reference_id: crypto.randomUUID(),
        amount: 70000,
        created_by: actor,
        ledger_visible: true
      },
      {
        work_order_no: workOrderB,
        subcontractor_id: contractorB.id,
        subcontract_work_id: work1.id,
        material_main_head: 'Sub Contractor',
        material_sub_head: work1.sub_head,
        material_details: work1.material_details,
        transaction_type: 'ESTIMATE_ITEM_APPROVAL',
        reference_type: 'ESTIMATE_ITEM',
        reference_id: crypto.randomUUID(),
        amount: 40000,
        created_by: actor,
        ledger_visible: true
      }
    ]);
    if (sclErr) throw sclErr;
  });

  afterAll(async () => {
    // Cleanup created test records
    if (contractorA?.id) {
      await supabase.from('subcontractor_ledger').delete().in('subcontractor_id', [contractorA.id, contractorB.id]);
      await supabase.from('project_subcontract_estimate_lines').delete().in('subcontractor_id', [contractorA.id, contractorB.id]);
      await supabase.from('subcontractor_work_capabilities').delete().in('subcontractor_id', [contractorA.id, contractorB.id]);
      await supabase.from('subcontractor_master').delete().in('id', [contractorA.id, contractorB.id]);
    }
    const estIds = [estimateA?.subcontract_estimate_id, estimateB?.subcontract_estimate_id].filter(Boolean);
    if (estIds.length > 0) {
      await supabase.from('project_subcontract_estimates').delete().in('subcontract_estimate_id', estIds);
    }
    if (work1?.id) {
      await supabase.from('subcontract_work_master').delete().in('id', [work1.id, work2.id]);
    }
    if (workOrderA) {
      await supabase.from('work_order_mappings').delete().in('work_order_no', [workOrderA, workOrderB]);
      await supabase.from('je_zo_mappings').delete().in('je_user_id', [jeUserA.mobile_number, jeUserB.mobile_number]);
      await supabase.from('projects_master').delete().in('work_order_no', [workOrderA, workOrderB]);
    }
    if (jeUserA?.mobile_number) {
      await supabase.from('authorised_users').delete().in('mobile_number', [jeUserA.mobile_number, jeUserB.mobile_number, zoUser.mobile_number, adminUser.mobile_number]);
    }
  });

  describe('1. Work Order Access Isolation on Ledger Endpoints', () => {
    test('JE assigned to WO-A querying getSubcontractorLedger with work_order_no=WO-B is rejected with 403', async () => {
      const req = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        query: { work_order_no: workOrderB }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toBe('You are not assigned to this Work Order.');
    });

    test('JE assigned to WO-A querying getSubcontractorLedgerEntries with work_order_no=WO-B is rejected with 403', async () => {
      const req = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        query: {
          subcontractor_id: contractorA.id,
          work_order_no: workOrderB
        }
      };
      const res = mockRes();
      await getSubcontractorLedgerEntries(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toBe('You are not assigned to this Work Order.');
    });

    test('JE assigned to WO-A querying getSubcontractorRequisitions with work_order_no=WO-B is rejected with 403', async () => {
      const req = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        query: { work_order_no: workOrderB }
      };
      const res = mockRes();
      await getSubcontractorRequisitions(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toBe('You are not assigned to this Work Order.');
    });

    test('JE querying without work_order_no only receives scopes/totals for assigned WO-A', async () => {
      const req = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        query: { search: `Ram Rahim ${suffix}` }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const contractor = res.jsonData.contractors.find(c => c.subcontractor_id === contractorA.id);
      expect(contractor).toBeDefined();
      // Only WO-A scopes (50k + 30k = 80k), NOT WO-B (70k)
      expect(Number(contractor.total_approved)).toBe(80000);
      expect(contractor.work_order_count).toBe(1);
      expect(contractor.scopes.every(s => s.work_order_no === workOrderA)).toBe(true);
    });

    test('Admin querying receives all Work Orders and full consolidated totals across projects', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: { search: `Ram Rahim ${suffix}` }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);
      expect(res.statusCode).toBe(200);

      const contractor = res.jsonData.contractors.find(c => c.subcontractor_id === contractorA.id);
      expect(contractor).toBeDefined();
      // Total approved across WO-A (80k) + WO-B (70k) = 150,000
      expect(Number(contractor.total_approved)).toBe(150000);
      expect(contractor.work_order_count).toBe(2);
      expect(contractor.scopes.map(s => s.work_order_no).sort()).toEqual([workOrderA, workOrderB].sort());
    });
  });

  describe('2. Canonical Contractor-Centric Hierarchy & Identity Separation', () => {
    test('Contractor A appears under one profile with nested Work Orders and Work Scopes', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: { subcontractor_id: contractorA.id }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.contractors).toHaveLength(1);

      const c = res.jsonData.contractors[0];
      expect(c.subcontractor_name).toBe(`Ram Rahim ${suffix}`);
      expect(c.scopes).toHaveLength(2);

      const woAScope = c.scopes.find(s => s.work_order_no === workOrderA);
      expect(woAScope.works).toHaveLength(2);
      expect(woAScope.works.map(w => w.subcontract_work_id).sort()).toEqual([work1.id, work2.id].sort());

      const woBScope = c.scopes.find(s => s.work_order_no === workOrderB);
      expect(woBScope.works).toHaveLength(1);
      expect(woBScope.works[0].subcontract_work_id).toBe(work1.id);
    });

    test('Two different contractors performing the exact same subcontract work remain completely distinct', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: { work_order_no: workOrderB }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);
      expect(res.statusCode).toBe(200);

      // Both Contractor A and Contractor B have work1 on WO-B, but must be separate contractors
      const cA = res.jsonData.contractors.find(c => c.subcontractor_id === contractorA.id);
      const cB = res.jsonData.contractors.find(c => c.subcontractor_id === contractorB.id);

      expect(cA).toBeDefined();
      expect(cB).toBeDefined();
      expect(cA.subcontractor_id).not.toBe(cB.subcontractor_id);
      expect(Number(cA.total_approved)).toBe(70000);
      expect(Number(cB.total_approved)).toBe(40000);
    });
  });

  describe('3. Authoritative Capacity Isolation Invariant', () => {
    test('Reservation on WO-A does not reduce remaining capacity on WO-B', async () => {
      // Create a reservation (approval) on WO-A for Contractor A, Work 1
      const { error: resErr } = await supabase.from('subcontractor_ledger').insert({
        work_order_no: workOrderA,
        subcontractor_id: contractorA.id,
        subcontract_work_id: work1.id,
        material_main_head: 'Sub Contractor',
        material_sub_head: work1.sub_head,
        material_details: work1.material_details,
        transaction_type: 'REQUISITION_APPROVAL',
        reference_type: 'REQUISITION',
        reference_id: crypto.randomUUID(),
        amount: -20000,
        settlement_status: 'RESERVED',
        created_by: actor
      });
      if (resErr) throw resErr;

      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: { subcontractor_id: contractorA.id }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);
      expect(res.statusCode).toBe(200);

      const c = res.jsonData.contractors[0];
      const woAScope = c.scopes.find(s => s.work_order_no === workOrderA);
      const woBScope = c.scopes.find(s => s.work_order_no === workOrderB);

      const woAWork1 = woAScope.works.find(w => w.subcontract_work_id === work1.id);
      const woBWork1 = woBScope.works.find(w => w.subcontract_work_id === work1.id);

      // WO-A: 50k approved - 20k reserved = 30k remaining
      expect(Number(woAWork1.reserved)).toBe(20000);
      expect(Number(woAWork1.remaining)).toBe(30000);

      // WO-B: capacity is STRICTLY ISOLATED: remaining remains full 70,000
      expect(Number(woBWork1.reserved)).toBe(0);
      expect(Number(woBWork1.remaining)).toBe(70000);
    });
  });

  describe('4. Canonical Transaction Trail Endpoint', () => {
    test('getSubcontractorLedgerEntries with canonical parameters returns chronological transactions with scope running balances', async () => {
      // Add a payment entry on WO-A for Contractor A, Work 1 so there are multiple visible transactions to verify running balances
      const { error: payErr } = await supabase.from('subcontractor_ledger').insert({
        work_order_no: workOrderA,
        subcontractor_id: contractorA.id,
        subcontract_work_id: work1.id,
        material_main_head: 'Sub Contractor',
        material_sub_head: work1.sub_head,
        material_details: work1.material_details,
        transaction_type: 'REQUISITION_PAYMENT',
        reference_type: 'REQUISITION',
        reference_id: crypto.randomUUID(),
        amount: -15000,
        settlement_status: 'SETTLED',
        settled_at: new Date().toISOString(),
        settled_by: adminUser.mobile_number,
        created_by: adminUser.mobile_number
      });
      if (payErr) throw payErr;

      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {
          subcontractor_id: contractorA.id,
          work_order_no: workOrderA,
          subcontract_work_id: work1.id
        }
      };
      const res = mockRes();
      await getSubcontractorLedgerEntries(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const entries = res.jsonData.entries;
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries[0]).toHaveProperty('scope_running_balance');
      expect(entries[0]).toHaveProperty('credit_amount');
      expect(entries[0]).toHaveProperty('debit_amount');
      expect(entries.every(e => e.work_order_no === workOrderA)).toBe(true);
    });
  });
});
