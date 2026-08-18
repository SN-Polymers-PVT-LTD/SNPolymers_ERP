const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const setupUsers = require('./setupUsers');

/**
 * Seeds accounts/ho1/ho2/admin test users plus a bank_balance_master row.
 * Mirrors financialFixture.js's seedFinancialScenario shape/conventions.
 *
 * NOTE on cleanup: acct_requisition_sheets are permanently hard-delete-blocked
 * (021_create_accounts_ho_approval.sql, unconditional trigger), and
 * acct_requisition_line_items become permanently blocked once requisition_status
 * is non-NULL (NB3 conditional trigger) — i.e. as soon as a sheet is submitted.
 * bank_balance_master rows are permanently hard-delete-blocked too. Cleanup here
 * is therefore best-effort (errors ignored), exactly like
 * financialFixture.js's cleanupFinancialScenario — most rows created by a
 * lifecycle test will legitimately outlive the test run.
 */
async function seedAcctRequisitionScenario({ suffix: suffixInput, bankBalance = 100000 } = {}) {
  const id = (suffixInput || crypto.randomUUID()).replace(/\D/g, '').substring(0, 8) || '00000000';
  const accountsMobile = `9500${id}`;
  const ho1Mobile = `9600${id}`;
  const ho2Mobile = `9700${id}`;
  const adminMobile = `9800${id}`;
  const bankName = `TEST BANK ${id}`;

  await setupUsers([
    { mobile_number: accountsMobile, role: 'accounts', is_active: true, display_name: `Acct Test ${id}`, permissions: {} },
    { mobile_number: ho1Mobile, role: 'ho', is_active: true, display_name: `HO1 Test ${id}`, permissions: { 'ho.requisition.reopen': true } },
    { mobile_number: ho2Mobile, role: 'ho', is_active: true, display_name: `HO2 Test ${id}`, permissions: { 'ho.requisition.reopen': true } },
    { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin Test ${id}`, permissions: {} }
  ]);

  const { error: bankErr } = await supabase
    .from('bank_balance_master')
    .upsert(
      {
        bank_name: bankName,
        balance_date: new Date().toISOString().substring(0, 10),
        available_balance: bankBalance,
        // Required by exportBulkNeft's file-generation step (024_add_bank_account_number.sql) —
        // any test that exports Bulk NEFT needs this present on the seeded bank.
        account_number: `TESTACC${id}`,
        created_by: accountsMobile,
        updated_by: accountsMobile
      },
      { onConflict: 'bank_name' }
    );
  if (bankErr) throw bankErr;

  return {
    id,
    accountsMobile,
    ho1Mobile,
    ho2Mobile,
    adminMobile,
    bankName,
    sheetIds: [],
    itemIds: []
  };
}

/**
 * Best-effort cleanup (errors ignored), matching cleanupFinancialScenario's
 * convention — see the permanence note above for why most rows survive.
 */
async function cleanupAcctRequisitionScenario(ctx) {
  if (!ctx) return;

  for (const itemId of ctx.itemIds || []) {
    await supabase.from('acct_requisition_line_items').delete().eq('id', itemId);
  }
  for (const sheetId of ctx.sheetIds || []) {
    await supabase.from('acct_requisition_sheets').delete().eq('id', sheetId);
  }

  await supabase.from('authorised_users').delete().in('mobile_number', [
    ctx.accountsMobile, ctx.ho1Mobile, ctx.ho2Mobile, ctx.adminMobile
  ]);
}

module.exports = { seedAcctRequisitionScenario, cleanupAcctRequisitionScenario };
