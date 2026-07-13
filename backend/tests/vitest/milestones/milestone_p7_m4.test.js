import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const mockRes = require('../../helpers/mockRes');
const {
  getZonalBalances,
  getZonalLedger,
  reconcileZonalBalances
} = require('../../../src/controllers/zoBalances.controller');

describe('Milestone P7-M4 — Zonal Ledger & Balance Engine Controller Integration Tests', () => {
  let suffix;
  let zoMobile1;
  let zoMobile2;
  let adminMobile;
  let workOrderNo;
  let ledgerId1;
  let ledgerId2;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    zoMobile1 = `9301${suffix}`;
    zoMobile2 = `9302${suffix}`;
    adminMobile = `9303${suffix}`;
    workOrderNo = `WO-P7-M4-${suffix}`;

    // Create test users
    await setupUsers([
      {
        mobile_number: zoMobile1,
        role: 'zo',
        is_active: true,
        display_name: `Test ZO 1 ${suffix}`
      },
      {
        mobile_number: zoMobile2,
        role: 'zo',
        is_active: true,
        display_name: `Test ZO 2 ${suffix}`
      },
      {
        mobile_number: adminMobile,
        role: 'admin',
        is_active: true,
        display_name: `Test Admin ${suffix}`
      }
    ]);

    // Create a project/work order owned by ZO 1
    const { error: projectErr } = await supabase
      .from('projects_master')
      .insert([
        {
          work_order_no: workOrderNo,
          estimate_no: `EST-M4-${suffix}`,
          site_details: `Site Details M4-${suffix}`,
          zo_user_id: zoMobile1,
          state: 'State',
          district: 'District',
          zone: 'Zone',
          department: 'Dept',
          created_by: adminMobile,
          edited_by: adminMobile,
          work_order_value: 500000.00
        }
      ]);

    if (projectErr) {
      throw new Error(`Failed to set up test project: ${projectErr.message}`);
    }

    // Set up some mock ledger entries for ZO 1 (Positive allocation & negative spent)
    ledgerId1 = crypto.randomUUID();
    ledgerId2 = crypto.randomUUID();

    const { error: ledgErr1 } = await supabase
      .from('zo_fund_ledger')
      .insert({
        ledger_id: ledgerId1,
        zo_user_id: zoMobile1,
        transaction_type: 'ALLOCATION',
        reference_type: 'FUND_REQUEST',
        reference_id: ledgerId1,
        amount: 10000.00,
        work_order_no: workOrderNo,
        created_by: adminMobile
      });
    expect(ledgErr1).toBeNull();

    const { error: ledgErr2 } = await supabase
      .from('zo_fund_ledger')
      .insert({
        ledger_id: ledgerId2,
        zo_user_id: zoMobile1,
        transaction_type: 'REQUISITION_APPROVAL',
        reference_type: 'REQUISITION',
        reference_id: ledgerId2,
        amount: -3000.00,
        work_order_no: workOrderNo,
        created_by: zoMobile1
      });
    expect(ledgErr2).toBeNull();
  });

  afterAll(async () => {
    // Clean up created records in reverse order
    await supabase.from('zo_balances').delete().in('zo_user_id', [zoMobile1, zoMobile2]);
    await supabase.from('zo_fund_ledger').delete().in('ledger_id', [ledgerId1, ledgerId2]);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrderNo);
    await supabase.from('authorised_users').delete().in('mobile_number', [zoMobile1, zoMobile2, adminMobile]);
  });

  test('M4-TC-01: ZO retrieves own balance correctly', async () => {
    const req = {
      user: { mobile_number: zoMobile1, role: 'zo' }
    };
    const res = mockRes();
    await getZonalBalances(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.balances.length).toBe(1);
    expect(res.jsonData.balances[0].zo_user_id).toBe(zoMobile1);
  });

  test('M4-TC-02: ZO retrieves own ledger logs with pagination', async () => {
    const req = {
      user: { mobile_number: zoMobile1, role: 'zo' },
      query: { page: 1, limit: 10 }
    };
    const res = mockRes();
    await getZonalLedger(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.ledger.length).toBe(2);
    expect(res.jsonData.pagination).toBeDefined();
    expect(res.jsonData.pagination.page).toBe(1);
    expect(res.jsonData.pagination.limit).toBe(10);
    expect(res.jsonData.pagination.total).toBe(2);
  });

  test('M4-TC-03: Access Control: ZOs cannot query another ZO balance or ledger', async () => {
    // 1. Zonal balance check filter bypass block
    const reqBal = {
      user: { mobile_number: zoMobile2, role: 'zo' }
    };
    const resBal = mockRes();
    await getZonalBalances(reqBal, resBal);

    expect(resBal.statusCode).toBe(200);
    // Even if zoMobile2 doesn't have a balance row, it returns empty list or own list (length <= 1)
    resBal.jsonData.balances.forEach(b => {
      expect(b.zo_user_id).toBe(zoMobile2);
    });

    // 2. Zonal ledger query bypass block (should overwrite filter with their own number)
    const reqLedg = {
      user: { mobile_number: zoMobile2, role: 'zo' },
      query: { zo_user_id: zoMobile1 } // Attempting to query zoMobile1
    };
    const resLedg = mockRes();
    await getZonalLedger(reqLedg, resLedg);

    expect(resLedg.statusCode).toBe(200);
    // Should filter by zoMobile2 and return 0 rows since zoMobile2 has no transactions
    expect(resLedg.jsonData.ledger.length).toBe(0);
  });

  test('M4-TC-04: Reconciliation corrects ZO balance and creates audit entry', async () => {
    // 1. Force balance discrepancy in the cache
    await supabase.from('zo_balances').upsert({
      zo_user_id: zoMobile1,
      available_balance: 50000.00, // Discrepancy (correct sum should be 10000 - 3000 = 7000)
      updated_at: new Date().toISOString()
    });

    // 2. Run reconciliation as Admin
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { zo_user_id: zoMobile1 }
    };
    const res = mockRes();
    await reconcileZonalBalances(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.processed).toBe(1);
    expect(res.jsonData.adjusted).toBe(1);
    expect(res.jsonData.results[0].zo_user_id).toBe(zoMobile1);
    expect(Number(res.jsonData.results[0].old_balance)).toBe(50000.00);
    expect(Number(res.jsonData.results[0].new_balance)).toBe(7000.00);
    expect(Number(res.jsonData.results[0].difference)).toBe(-43000.00);
    expect(res.jsonData.results[0].adjusted).toBe(true);

    // 3. Verify balance is corrected in the database
    const { data: balData } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zoMobile1)
      .single();
    expect(Number(balData.available_balance)).toBe(7000.00);

    // 4. Verify audit log entry was recorded
    const { data: auditLogs, error: auditErr } = await supabase
      .from('audit_log')
      .select('*')
      .eq('module_name', 'zo_balances')
      .eq('record_identifier', zoMobile1)
      .order('timestamp', { ascending: false })
      .limit(1);

    expect(auditErr).toBeNull();
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('UPDATE');
    expect(auditLogs[0].user_id).toBe(adminMobile);
    expect(Number(auditLogs[0].old_value.available_balance)).toBe(50000.00);
    expect(Number(auditLogs[0].new_value.available_balance)).toBe(7000.00);
  });

  test('M4-TC-05: Reconciliation is idempotent', async () => {
    // 1. Run reconciliation again (no changes should occur)
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { zo_user_id: zoMobile1 }
    };
    const res = mockRes();
    await reconcileZonalBalances(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.processed).toBe(1);
    expect(res.jsonData.adjusted).toBe(0);
    expect(res.jsonData.results[0].zo_user_id).toBe(zoMobile1);
    expect(res.jsonData.results[0].adjusted).toBe(false);
  });

  test('M4-TC-06: Reconciliation validates target ZO user (400)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { zo_user_id: `9399${suffix}` } // Non-existent user
    };
    const res = mockRes();
    await reconcileZonalBalances(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('is not a Zonal Office user');
  });
});
