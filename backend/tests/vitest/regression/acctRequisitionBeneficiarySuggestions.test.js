import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const mockRes = require('../../helpers/mockRes');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const {
  upsertBeneficiary,
  searchBeneficiariesByAcNo
} = require('../../../src/controllers/acctRequisition.controller');
const { supabase } = require('../../../src/db/supabase');

async function callUpsertBeneficiary(mobile, body) {
  const req = { body, user: { role: 'accounts', mobile_number: mobile } };
  const res = mockRes();
  await upsertBeneficiary(req, res);
  return res;
}

async function callSearchByAcNo(prefix, mobile, limit) {
  const req = { query: { prefix, ...(limit != null ? { limit } : {}) }, user: { role: 'accounts', mobile_number: mobile } };
  const res = mockRes();
  await searchBeneficiariesByAcNo(req, res);
  return res;
}

// Backs the line-item entry row's live A/C No. typeahead
// (BeneficiaryAcNoSuggestions.jsx) — a left-anchored prefix match over
// beneficiary_master, most-recently-used first, distinct from
// getBeneficiaries' substring/alphabetical search (Beneficiary Master page).
describe('searchBeneficiariesByAcNo — prefix match for the A/C No. typeahead', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();
  });

  afterAll(async () => {
    await cleanupAcctRequisitionScenario(ctx);
    // Best-effort: beneficiary_master rows this suite created directly
    // (not tracked by the shared fixture's cleanup).
    await supabase.from('beneficiary_master').delete().in('account_number', [
      `9110${ctx.id}001`, `9110${ctx.id}002`, `9220${ctx.id}001`
    ]);
  });

  test('a prefix under 3 characters returns an empty list without querying the DB', async () => {
    const res = await callSearchByAcNo('91', ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.beneficiaries).toEqual([]);
  });

  test('matches only account numbers starting with the given prefix, most recently used first', async () => {
    const acNoOld = `9110${ctx.id}001`;
    const acNoNew = `9110${ctx.id}002`;
    const acNoOther = `9220${ctx.id}001`;

    await callUpsertBeneficiary(ctx.accountsMobile, {
      account_number: acNoOld, ifsc: 'HDFC0000106', beneficiary_name: 'Older Match', beneficiary_bank_name: 'HDFC Bank'
    });
    // Ensure a distinguishable last_used_at ordering between the two matches.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await callUpsertBeneficiary(ctx.accountsMobile, {
      account_number: acNoNew, ifsc: 'HDFC0000106', beneficiary_name: 'Newer Match', beneficiary_bank_name: 'HDFC Bank'
    });
    await callUpsertBeneficiary(ctx.accountsMobile, {
      account_number: acNoOther, ifsc: 'HDFC0000106', beneficiary_name: 'Should Not Match', beneficiary_bank_name: 'HDFC Bank'
    });

    const res = await callSearchByAcNo(`9110${ctx.id}`, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    const acNos = res.jsonData.beneficiaries.map((b) => b.account_number);
    expect(acNos).toEqual([acNoNew, acNoOld]);
    expect(acNos).not.toContain(acNoOther);
  });

  test('a non-matching prefix returns an empty array, not an error', async () => {
    const res = await callSearchByAcNo('00000000000000nomatch', ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.beneficiaries).toEqual([]);
  });

  test('caps the result count at the requested limit', async () => {
    const res = await callSearchByAcNo(`9110${ctx.id}`, ctx.accountsMobile, 1);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.beneficiaries.length).toBe(1);
  });
});
