import { beforeAll, afterAll, beforeEach, afterEach, test, expect } from 'vitest';
const { Client } = require('pg');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { createReviewUsers, createReviewFixture, one, q } = require('../../helpers/payrollReviewFixtures');
const { interval, scope, save } = require('../../helpers/payrollProfileFixtures');
const { statutory, pt } = require('../../helpers/payrollMasterFixtures');
const { calculatePreview } = require('../../../src/domain/payroll/preview');
let db, users, fixture, scopeId;
beforeAll(async () => { await requireLocalSupabase(); db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI }); await db.connect(); });
afterAll(async () => db?.end());
beforeEach(async () => {
 await q(db, 'BEGIN'); users = await createReviewUsers(db);
 fixture = await createReviewFixture(db, users, { factory: false, esiEnrolment: true });
 scopeId = await scope(db, users.accounts.id);
 await save(db, fixture.employees[0].id, users.accounts.id, 0, [interval(scopeId, fixture.from, fixture.to, { verification_status: 'ACCOUNTS_CONFIRMED' })]);
});
afterEach(async () => q(db, 'ROLLBACK'));
async function rule(scheme, { from = fixture.from, to = null, bindScope = scopeId, publish = true } = {}) {
 const data = (scheme === 'PT' ? pt : statutory)({ scheme, jurisdiction: 'SYNTHETIC_' + scopeId, establishment: scheme, effective_from: from, effective_to: to });
 const draft = (await one(db, "SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r", [JSON.stringify(data), users.accounts.id])).r;
 if (publish) {
  const preview = (await one(db, "SELECT preview_payroll_master_publication('statutory',$1,$2) r", [draft.id, users.accounts.id])).r;
  expect(preview.publishable).toBe(true);
  await q(db, "SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC date coverage',$3)", [draft.id, preview.preview_token, users.accounts.id]);
  if (bindScope) await q(db, 'SELECT bind_payroll_statutory_scope($1,$2,$3,$4)', [draft.id, bindScope, 'SYNTHETIC binding', users.accounts.id]);
 }
 return draft.id;
}
const source = async (name = 'get_payroll_review_sources') => (await one(db, `SELECT ${name}($1,$2) r`, [fixture.rows[0].id, users.accounts.id])).r;

test('both source RPCs expose published ongoing EPF, ESI and PT rules without changing saved data', async () => {
 const ids = await Promise.all(['EPF', 'ESI', 'PT'].map(s => rule(s)));
 const before = await q(db, 'SELECT * FROM payroll_review_revisions WHERE row_id=$1', [fixture.rows[0].id]);
 for (const name of ['get_payroll_preview_sources', 'get_payroll_review_sources']) {
  const current = await source(name);
  expect(current.statutory_calculation_rules.map(r => r.id).sort()).toEqual(ids.sort());
  expect(current.statutory_calculation_rules.every(r => r.effective_to === null)).toBe(true);
  expect(current.statutory_calculation_rules.find(r => r.scheme === 'PT').slabs).toHaveLength(24);
  expect(calculatePreview(current).blockers.some(b => b.code === 'STATUTORY_MONTH_START_RULE_REQUIRED')).toBe(false);
 }
 expect(await q(db, 'SELECT * FROM payroll_review_revisions WHERE row_id=$1', [fixture.rows[0].id])).toEqual(before);
});
test('a finite rule ending exactly at month start remains included', async () => {
 const id = await rule('EPF', { to: fixture.from });
 expect((await source()).statutory_calculation_rules.map(r => r.id)).toEqual([id]);
});
test.each(['expired', 'future'])('%s rules stay outside the payroll source window', async when => {
 const year = Number(fixture.from.slice(0, 4));
 await rule('EPF', when === 'expired' ? { from: `${year}-01-01`, to: `${year}-09-30` } : { from: `${year}-11-01` });
 expect((await source()).statutory_calculation_rules).toEqual([]);
});
test('draft and foreign-scope rules stay excluded', async () => {
 await rule('EPF', { publish: false });
 await rule('ESI', { bindScope: await scope(db, users.accounts.id) });
 expect((await source()).statutory_calculation_rules).toEqual([]);
});
