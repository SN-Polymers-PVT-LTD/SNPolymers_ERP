import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const mockRes = require('../../helpers/mockRes');
const {
  getSubcontractorLedger,
  getSubcontractorLedgerEntries
} = require('../../../src/controllers/requisitions.controller');

describe('Subcontractor Ledger Legacy Fallback & Unpaginated Export', () => {
  let suffix;
  let actor;
  let adminUser;
  let workOrder;
  let legacyScopes = [];

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

    adminUser = { mobile_number: `9711${suffix}`, role: 'admin', display_name: `Admin ${suffix}`, is_active: true };
    const { error: usersError } = await supabase.from('authorised_users').insert([adminUser]);
    if (usersError) throw usersError;

    workOrder = `WO-LEGACY-${suffix}`;
    await supabase.from('projects_master').insert({
      work_order_no: workOrder,
      estimate_no: `EST-LEGACY-${suffix}`,
      site_details: `Legacy Site ${suffix}`,
      state: 'Test State',
      district: 'Test Dist',
      zone: 'Test Zone',
      department: 'Legacy Division',
      created_by: actor,
      edited_by: actor,
      work_order_value: 500000,
      status: 'Running'
    });

    legacyScopes = [
      {
        work_order_no: workOrder,
        material_main_head: 'Sub Contractor',
        material_sub_head: `Legacy Civil ${suffix}`,
        material_details: `Contractor Alpha ${suffix}`,
        estimated_total: 10000,
        paid_total: 3000,
        available_balance: 7000
      },
      {
        work_order_no: workOrder,
        material_main_head: 'Sub Contractor',
        material_sub_head: `Legacy Civil ${suffix}`,
        material_details: `Contractor Beta ${suffix}`,
        estimated_total: 20000,
        paid_total: 5000,
        available_balance: 15000
      },
      {
        work_order_no: workOrder,
        material_main_head: 'Sub Contractor',
        material_sub_head: `Legacy Electrical ${suffix}`,
        material_details: `Contractor Gamma ${suffix}`,
        estimated_total: 30000,
        paid_total: 0,
        available_balance: 30000
      }
    ];

    const { error: balErr } = await supabase.from('subcontractor_balances').insert(legacyScopes);
    if (balErr) throw balErr;

    // Insert legacy ledger entry for Contractor Alpha
    const { error: sclErr } = await supabase.from('subcontractor_ledger').insert({
      work_order_no: workOrder,
      material_main_head: 'Sub Contractor',
      material_sub_head: legacyScopes[0].material_sub_head,
      material_details: legacyScopes[0].material_details,
      transaction_type: 'ESTIMATE_ITEM_APPROVAL',
      reference_type: 'ESTIMATE_ITEM',
      reference_id: crypto.randomUUID(),
      amount: 10000,
      created_by: actor,
      ledger_visible: true
    });
    if (sclErr) throw sclErr;
  });

  afterAll(async () => {
    if (workOrder) {
      await supabase.from('subcontractor_ledger').delete().eq('work_order_no', workOrder);
      await supabase.from('subcontractor_balances').delete().eq('work_order_no', workOrder);
      await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    }
    if (adminUser?.mobile_number) {
      await supabase.from('authorised_users').delete().eq('mobile_number', adminUser.mobile_number);
    }
  });

  describe('1. Legacy Balances Fallback', () => {
    test('returns legacy balances and legacy: true when no canonical contractor matches', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: { work_order_no: workOrder }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      // Must NOT fabricate canonical contractors
      expect(res.jsonData.contractors).toEqual([]);
      expect(res.jsonData.legacy).toBe(true);

      // Must return the legacy scopes in balances
      const balances = res.jsonData.balances;
      expect(balances.length).toBe(3);

      const alpha = balances.find((b) => b.material_details === legacyScopes[0].material_details);
      expect(alpha).toBeDefined();
      expect(Number(alpha.estimated_total)).toBe(10000);
      expect(Number(alpha.paid_total)).toBe(3000);
      expect(Number(alpha.available_balance)).toBe(7000);
    });
  });

  describe('2. Legacy Export Read Path', () => {
    test('export=true returns all legacy scopes without pagination range slicing', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {
          work_order_no: workOrder,
          export: 'true'
        }
      };
      const res = mockRes();
      await getSubcontractorLedger(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.contractors).toEqual([]);
      expect(res.jsonData.legacy).toBe(true);

      const balances = res.jsonData.balances;
      expect(balances.length).toBe(3);
      expect(res.jsonData.pagination.totalPages).toBe(1);
    });
  });

  describe('3. Legacy Transactions Trail Query', () => {
    test('queries legacy transaction entries with material_sub_head and material_details', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {
          work_order_no: workOrder,
          material_sub_head: legacyScopes[0].material_sub_head,
          material_details: legacyScopes[0].material_details
        }
      };
      const res = mockRes();
      await getSubcontractorLedgerEntries(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const entries = res.jsonData.entries;
      expect(entries.length).toBe(1);
      expect(entries[0].work_order_no).toBe(workOrder);
      expect(entries[0].material_details).toBe(legacyScopes[0].material_details);
      expect(Number(entries[0].amount)).toBe(10000);
    });
  });
});
