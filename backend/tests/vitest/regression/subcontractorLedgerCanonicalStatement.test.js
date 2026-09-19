import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const mockRes = require('../../helpers/mockRes');
const {
  getSubcontractorLedger,
  getSubcontractorLedgerEntries
} = require('../../../src/controllers/requisitions.controller');

describe('Subcontractor Ledger Canonical Payment Statement & Pagination Isolation', () => {
  let suffix;
  let actor;
  let adminUser;
  let zoUser;
  let workOrder;
  let contractorA;
  let contractorB;
  let works = [];
  let estimate;
  let req1;
  let req2;

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

    adminUser = { mobile_number: `9811${suffix}`, role: 'admin', display_name: `Admin ${suffix}`, is_active: true };
    zoUser = { mobile_number: `9812${suffix}`, role: 'zo', display_name: `ZO ${suffix}`, is_active: true };

    const { error: usersError } = await supabase.from('authorised_users').insert([adminUser, zoUser]);
    if (usersError) throw usersError;

    workOrder = `WO-STMT-${suffix}`;
    await supabase.from('projects_master').insert({
      work_order_no: workOrder,
      estimate_no: `EST-STMT-${suffix}`,
      site_details: `Statement Site ${suffix}`,
      state: 'Test State',
      district: 'Test Dist',
      zone: 'Test Zone',
      department: 'Pipeline Division',
      zo_user_id: zoUser.mobile_number,
      created_by: actor,
      edited_by: actor,
      work_order_value: 1000000,
      status: 'Running'
    });

    // Create 18 distinct subcontract work types
    const workInserts = Array.from({ length: 18 }, (_, i) => ({
      sub_head: `Scope Group ${i < 9 ? 'A' : 'B'} ${suffix}`,
      material_details: `Work Item ${String(i + 1).padStart(2, '0')} ${suffix}`,
      unit: 'nos',
      created_by: actor
    }));
    const { data: insertedWorks, error: worksErr } = await supabase
      .from('subcontract_work_master')
      .insert(workInserts)
      .select();
    if (worksErr) throw worksErr;
    works = insertedWorks;

    // Create 2 subcontractors: Contractor A (sorts first) and Contractor B (sorts second)
    const { data: cA, error: cAErr } = await supabase.from('subcontractor_master').insert({
      subcontractor_name: `A1 Contractor ${suffix}`,
      created_by: actor
    }).select().single();
    if (cAErr) throw cAErr;
    contractorA = cA;

    const { data: cB, error: cBErr } = await supabase.from('subcontractor_master').insert({
      subcontractor_name: `B2 Contractor ${suffix}`,
      created_by: actor
    }).select().single();
    if (cBErr) throw cBErr;
    contractorB = cB;

    // Capabilities: Contractor A gets all 18 works; Contractor B gets works[0] and works[1]
    const capA = works.map((w) => ({
      subcontractor_id: contractorA.id,
      subcontract_work_id: w.id,
      created_by: actor
    }));
    const capB = [works[0], works[1]].map((w) => ({
      subcontractor_id: contractorB.id,
      subcontract_work_id: w.id,
      created_by: actor
    }));
    const { error: capsErr } = await supabase.from('subcontractor_work_capabilities').insert([...capA, ...capB]);
    if (capsErr) throw capsErr;

    // Subcontract Estimate on WO
    const { data: est, error: estErr } = await supabase.from('project_subcontract_estimates').insert({
      work_order_no: workOrder,
      created_by: actor,
      estimate_status: 'Final Approved'
    }).select().single();
    if (estErr) throw estErr;
    estimate = est;

    // Contractor A has 18 lines (all 18 scopes, amount: 10,000 each)
    const linesA = works.map((w) => ({
      subcontract_estimate_id: estimate.subcontract_estimate_id,
      subcontractor_id: contractorA.id,
      subcontract_work_id: w.id,
      qty: 10,
      rate: 1000,
      amount: 10000,
      entry_kind: 'BASE',
      final_approved_revision: 0,
      final_approved_at: new Date().toISOString(),
      final_approved_by: actor,
      created_by: actor
    }));

    // Contractor B has 2 lines (amount: 5,000 each)
    const linesB = [works[0], works[1]].map((w) => ({
      subcontract_estimate_id: estimate.subcontract_estimate_id,
      subcontractor_id: contractorB.id,
      subcontract_work_id: w.id,
      qty: 5,
      rate: 1000,
      amount: 5000,
      entry_kind: 'BASE',
      final_approved_revision: 0,
      final_approved_at: new Date().toISOString(),
      final_approved_by: actor,
      created_by: actor
    }));

    const { error: linesErr } = await supabase
      .from('project_subcontract_estimate_lines')
      .insert([...linesA, ...linesB]);
    if (linesErr) throw linesErr;

    // Create 2 requisitions for Contractor A on works[0]
    const baseReq = {
      requester_user_id: adminUser.mobile_number,
      work_order_no: workOrder,
      estimate_no: `EST-STMT-${suffix}`,
      estimate_amount: 10000,
      state: 'Test State',
      district: 'Test Dist',
      area_code: 'Test Area',
      department: 'Pipeline Division',
      site_details: `Statement Site ${suffix}`,
      material_main_head: 'Sub Contractor',
      material_sub_head: works[0].sub_head,
      material_details: works[0].material_details,
      requisition_pdf_url: 'test.pdf',
      gst_bill: 'No',
      bank_details: 'Test Bank',
      requisition_status: 'Approved',
      approved_balance_amount: 0,
      subcontractor_id: contractorA.id,
      subcontract_work_id: works[0].id,
      created_by: actor,
      zo_user_id: zoUser.mobile_number
    };

    const { data: r1, error: r1Err } = await supabase.from('requisitions').insert({
      ...baseReq,
      requisition_no: `REQ-1-${suffix}`,
      requisition_amount: 3000,
      approved_amount: 3000
    }).select().single();
    if (r1Err) throw r1Err;
    req1 = r1;

    const { data: r2, error: r2Err } = await supabase.from('requisitions').insert({
      ...baseReq,
      requisition_no: `REQ-2-${suffix}`,
      requisition_amount: 2000,
      approved_amount: 2000
    }).select().single();
    if (r2Err) throw r2Err;
    req2 = r2;

    // Insert 2 sequential requisition payment transactions for Contractor A on works[0]
    // In canonical subcontract ledger, payments are negative debits
    const baseTime = Date.now();
    const { error: sclErr } = await supabase.from('subcontractor_ledger').insert([
      {
        work_order_no: workOrder,
        subcontractor_id: contractorA.id,
        subcontract_work_id: works[0].id,
        material_main_head: 'Sub Contractor',
        material_sub_head: works[0].sub_head,
        material_details: works[0].material_details,
        transaction_type: 'REQUISITION_PAYMENT',
        reference_type: 'REQUISITION',
        reference_id: req1.requisition_id,
        amount: -3000,
        created_by: actor,
        ledger_visible: true,
        created_at: new Date(baseTime - 60000).toISOString()
      },
      {
        work_order_no: workOrder,
        subcontractor_id: contractorA.id,
        subcontract_work_id: works[0].id,
        material_main_head: 'Sub Contractor',
        material_sub_head: works[0].sub_head,
        material_details: works[0].material_details,
        transaction_type: 'REQUISITION_PAYMENT',
        reference_type: 'REQUISITION',
        reference_id: req2.requisition_id,
        amount: -2000,
        created_by: actor,
        ledger_visible: true,
        created_at: new Date(baseTime).toISOString()
      }
    ]);
    if (sclErr) throw sclErr;
  });

  afterAll(async () => {
    if (contractorA?.id) {
      await supabase.from('subcontractor_ledger').delete().in('subcontractor_id', [contractorA.id, contractorB.id]);
      await supabase.from('project_subcontract_estimate_lines').delete().in('subcontractor_id', [contractorA.id, contractorB.id]);
      await supabase.from('subcontractor_work_capabilities').delete().in('subcontractor_id', [contractorA.id, contractorB.id]);
      await supabase.from('subcontractor_master').delete().in('id', [contractorA.id, contractorB.id]);
    }
    if (req1?.requisition_id) {
      await supabase.from('requisitions').delete().in('requisition_id', [req1.requisition_id, req2.requisition_id]);
    }
    if (estimate?.subcontract_estimate_id) {
      await supabase.from('project_subcontract_estimates').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
    }
    if (works?.length > 0) {
      await supabase.from('subcontract_work_master').delete().in('id', works.map((w) => w.id));
    }
    if (workOrder) {
      await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    }
    if (adminUser?.mobile_number) {
      await supabase.from('authorised_users').delete().in('mobile_number', [adminUser.mobile_number, zoUser.mobile_number]);
    }
  });

  describe('1. Canonical Payment Statement & Cumulative Paid Calculations', () => {
    test('computes positive disbursement amounts and monotonically increasing cumulative_paid', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {
          subcontractor_id: contractorA.id,
          work_order_no: workOrder,
          subcontract_work_id: works[0].id
        }
      };
      const res = mockRes();
      await getSubcontractorLedgerEntries(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      const entries = res.jsonData.entries;
      expect(entries.length).toBe(2);

      // Entries are returned newest first by default:
      // Entry 0 (latest): REQ-2, cumulative_paid = 5000
      // Entry 1 (earlier): REQ-1, cumulative_paid = 3000
      const [latest, earlier] = entries;
      expect(latest.requisition_no).toBe(`REQ-2-${suffix}`);
      expect(earlier.requisition_no).toBe(`REQ-1-${suffix}`);

      // Check cumulative_paid calculation:
      expect(Number(latest.cumulative_paid)).toBe(5000);
      expect(Number(earlier.cumulative_paid)).toBe(3000);

      // Verify no negative values in cumulative_paid
      expect(Number(latest.cumulative_paid)).toBeGreaterThanOrEqual(0);
      expect(Number(earlier.cumulative_paid)).toBeGreaterThanOrEqual(0);

      // Verify scope running balance alias is also populated
      expect(Number(latest.scope_running_balance)).toBe(5000);
      expect(Number(earlier.scope_running_balance)).toBe(3000);
    });
  });

  describe('2. Pagination Scope Isolation & Non-Truncation', () => {
    test('page 1 with limit 1 returns Contractor A and all 18 scopes in balances without truncation', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {
          search: suffix,
          page: '1',
          limit: '1'
        }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const contractors = res.jsonData.contractors;
      expect(contractors.length).toBe(1);
      expect(contractors[0].subcontractor_id).toBe(contractorA.id);

      // Crucial assertion: balances must contain ALL 18 scopes of Contractor A,
      // NOT truncated to limit (1) or legacy slices!
      const balances = res.jsonData.balances;
      expect(balances.length).toBe(18);

      // All returned balances must belong strictly to Contractor A
      for (const b of balances) {
        expect(b.subcontractor_id).toBe(contractorA.id);
        expect(b.work_order_no).toBe(workOrder);
      }
    });

    test('page 2 with limit 1 returns Contractor B and only its 2 scopes in balances', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {
          search: suffix,
          page: '2',
          limit: '1'
        }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const contractors = res.jsonData.contractors;
      expect(contractors.length).toBe(1);
      expect(contractors[0].subcontractor_id).toBe(contractorB.id);

      const balances = res.jsonData.balances;
      expect(balances.length).toBe(2);

      // All returned balances must belong strictly to Contractor B
      for (const b of balances) {
        expect(b.subcontractor_id).toBe(contractorB.id);
        expect(b.work_order_no).toBe(workOrder);
      }
    });
  });

  describe('3. Export Read Path Unpaginated Balances', () => {
    test('export=true returns all matching contractors and all 20 scopes across them', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {
          search: suffix,
          export: 'true'
        }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const contractors = res.jsonData.contractors;
      expect(contractors.length).toBe(2);

      const balances = res.jsonData.balances;
      expect(balances.length).toBe(20);

      const aScopes = balances.filter((b) => b.subcontractor_id === contractorA.id);
      const bScopes = balances.filter((b) => b.subcontractor_id === contractorB.id);
      expect(aScopes.length).toBe(18);
      expect(bScopes.length).toBe(2);
    });
  });

  describe('4. Cross-contractor Canonical Entries Export Query', () => {
    test('queries canonical entries without subcontractor_id and returns scope entries with cumulative_paid', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {
          work_order_no: workOrder,
          search: suffix
        }
      };
      const res = mockRes();
      await getSubcontractorLedgerEntries(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const entries = res.jsonData.entries;
      expect(entries.length).toBeGreaterThanOrEqual(2);

      const matching = entries.filter((e) => e.work_order_no === workOrder);
      expect(matching.length).toBe(2);
      expect(matching[0].subcontractor_name).toBe(contractorA.subcontractor_name);
      expect(Number(matching[0].cumulative_paid)).toBe(5000);
      expect(Number(matching[1].cumulative_paid)).toBe(3000);
    });
  });
});
