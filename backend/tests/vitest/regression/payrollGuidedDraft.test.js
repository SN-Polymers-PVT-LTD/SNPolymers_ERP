import { beforeAll, afterAll, beforeEach, afterEach, test, expect } from 'vitest';
const { Client } = require('pg');
const { randomInt } = require('crypto');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
let db, accounts, ho;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
beforeAll(async () => { await requireLocalSupabase(); db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI }); await db.connect(); });
afterAll(async () => { await db?.end(); });
beforeEach(async () => {
 await q('BEGIN');
 for (const role of ['accounts', 'ho']) {
  const [row] = await q('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING id', [String(randomInt(7000000000, 9999999999)), role, 'Guided draft fixture']);
  if (role === 'accounts') accounts = row.id; else ho = row.id;
 }
});
afterEach(async () => { await q('ROLLBACK'); });
test('saves and version-checks drafts, and rejects unauthorized actors', async () => {
 const [created] = await q('SELECT save_payroll_guided_deduction_draft(NULL,0,$1,$2) AS r', [JSON.stringify({ test: true }), accounts]);
 expect(created.r.version).toBe(1);
 const [retrieved] = await q('SELECT get_payroll_guided_deduction_draft($1,$2) AS r', [created.r.id, accounts]);
 expect(retrieved.r.data).toEqual({ test: true });
 const [updated] = await q('SELECT save_payroll_guided_deduction_draft($1,1,$2,$3) AS r', [created.r.id, JSON.stringify({ test: false }), accounts]);
 expect(updated.r.version).toBe(2);
 await q('SAVEPOINT invalid');
 await expect(q('SELECT save_payroll_guided_deduction_draft($1,1,$2,$3)', [created.r.id, '{}', accounts])).rejects.toMatchObject({ code: 'PY409' });
 await q('ROLLBACK TO SAVEPOINT invalid');
 await expect(q('SELECT save_payroll_guided_deduction_draft(NULL,0,$1,$2)', ['{}', ho])).rejects.toMatchObject({ code: '42501' });
});

const { randomUUID } = require('crypto');
const { statutory, pt } = require('../../helpers/payrollMasterFixtures');
async function setupDraft() {
 const [{ id: stateId }] = await q('SELECT id FROM payroll_statutory_states ORDER BY name LIMIT 1');
 const establishment = 'Guided ' + randomUUID();
 const dates = { effective_from: '2098-01-01', effective_to: '2098-12-31' };
 const epf = statutory(dates);
 const rules = { EPF: epf, PT: pt(dates) };
 const data = { state_id: stateId, establishment, effective_from: dates.effective_from, rules };
 const [{ r }] = await q('SELECT save_payroll_guided_deduction_draft(NULL,0,$1,$2) r', [JSON.stringify(data), accounts]);
 return r;
}
async function reviewDraft(draft, actor = accounts) {
 const [{ r }] = await q('SELECT review_payroll_guided_deduction_draft($1,$2,false,$3) r', [draft.id, draft.version, actor]);
 return r;
}
async function publishDraft(draft, token, key) {
 const [{ r }] = await q('SELECT publish_payroll_guided_deduction_draft($1,$2,false,$3,$4,$5,$6) r',
  [draft.id, draft.version, token, 'Synthetic approval', key, accounts]);
 return r;
}
const matchingRules = draft => q('SELECT id, status FROM payroll_statutory_rule_revisions WHERE establishment=$1', [draft.data.establishment]);
async function rejectsWith(action, code) {
 await q('SAVEPOINT guided_error');
 await expect(action()).rejects.toMatchObject({ code });
 await q('ROLLBACK TO SAVEPOINT guided_error');
}

test('review leaves no rules or setup; publish commits all schemes and safely replays', async () => {
 const draft = await setupDraft();
 await rejectsWith(() => reviewDraft(draft, ho), '42501');
 const review = await reviewDraft(draft);
 expect(review).toMatchObject({ publishable: true, blockers: [], effective_to: '2098-12-31' });
 expect(await matchingRules(draft)).toEqual([]);
 expect((await reviewDraft(draft)).review_token).toBe(review.review_token);
 const key = randomUUID();
 const published = await publishDraft(draft, review.review_token, key);
 expect(published.setup.epf_revision_id).toBeTruthy();
 expect(published.setup.pt_revision_id).toBeTruthy();
 expect((await matchingRules(draft)).map(row => row.status)).toEqual(['PUBLISHED', 'PUBLISHED']);
 expect(await publishDraft(draft, review.review_token, key)).toEqual(published);
 await rejectsWith(() => publishDraft(draft, review.review_token, randomUUID()), 'PY409');
 await rejectsWith(() => q('SELECT save_payroll_guided_deduction_draft($1,1,$2,$3)', [draft.id, '{}', accounts]), 'PY409');
});

test('a binding failure during publication rolls back rules, audit events and setup', async () => {
 const draft = await setupDraft();
 const review = await reviewDraft(draft);
 expect(review.publishable).toBe(true);
 await q(`CREATE FUNCTION pg_temp.fail_guided_binding() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
   IF NEW.evidence_reference = 'Synthetic approval' THEN
     RAISE EXCEPTION 'Synthetic binding conflict' USING ERRCODE='23P01';
   END IF;
   RETURN NEW;
 END; $$`);
 await q(`CREATE TRIGGER guided_test_binding_failure BEFORE INSERT ON payroll_statutory_scope_bindings
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_guided_binding()`);
 expect((await reviewDraft(draft)).review_token).toBe(review.review_token);
 const eventsBefore = await q('SELECT count(*) FROM payroll_master_events');
 await rejectsWith(() => publishDraft(draft, review.review_token, randomUUID()), 'PY409');
 expect(await matchingRules(draft)).toEqual([]);
 expect(await q('SELECT id FROM payroll_company_deduction_setups WHERE establishment_name=$1', [draft.data.establishment])).toEqual([]);
 expect(await q('SELECT count(*) FROM payroll_master_events')).toEqual(eventsBefore);
});

test('publication rejects a token issued before the draft was edited', async () => {
 const draft = await setupDraft();
 const review = await reviewDraft(draft);
 const [{ r: updated }] = await q('SELECT save_payroll_guided_deduction_draft($1,$2,$3,$4) r',
  [draft.id, draft.version, JSON.stringify(draft.data), accounts]);
 await rejectsWith(() => publishDraft(updated, review.review_token, randomUUID()), 'PY409');
 expect(await matchingRules(draft)).toEqual([]);
});

test('lists unpublished drafts for Accounts with pagination and state names', async () => {
 const draft = await setupDraft();
 const list = async actor => (await q('SELECT list_payroll_guided_deduction_drafts($1,1,100) AS r', [actor]))[0].r;
 const before = await list(accounts);
 expect(before.drafts).toContainEqual(expect.objectContaining({
  id: draft.id, establishment: draft.data.establishment, state_name: expect.any(String),
 }));
 await rejectsWith(() => list(ho), '42501');
 const review = await reviewDraft(draft);
 await publishDraft(draft, review.review_token, randomUUID());
 const after = await list(accounts);
 expect(after.total).toBe(before.total - 1);
 expect(after.drafts.some(row => row.id === draft.id)).toBe(false);
});
