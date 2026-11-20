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
test('statutory review only warns about active adjustment types', async () => {
 const [{ warnings }] = await q("SELECT payroll_master_configuration_warnings('statutory', $1) AS warnings", [statutory()]);
 expect(warnings.filter(issue => issue.code === 'ADJUSTMENT_CLASSIFICATION_REQUIRED').map(issue => issue.field))
  .toEqual(['adjustment_basis.REIMBURSEMENT', 'adjustment_basis.RECOVERY']);
});

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

test('publishes without a reference and replays an equivalent blank reference', async () => {
 const draft = await setupDraft();
 const review = await reviewDraft(draft);
 const key = randomUUID();
 const publishWith = async reference => {
  const [{ r }] = await q('SELECT publish_payroll_guided_deduction_draft($1,$2,false,$3,$4,$5,$6) r',
   [draft.id, draft.version, review.review_token, reference, key, accounts]);
  return r;
 };
 const result = await publishWith(null);
 expect(result.setup.evidence_reference).toBe('Guided Accounts publication (no approval reference supplied)');
 expect(await publishWith(' ')).toEqual(result);
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

test('publishes the same Pan India and state PT revisions to both factory scopes', async () => {
 const original = await setupDraft();
 const data = { ...original.data, establishment: 'All factories', all_factories: true };
 const [{ r: draft }] = await q('SELECT save_payroll_guided_deduction_draft($1,1,$2,$3) r',
  [original.id, JSON.stringify(data), accounts]);
 const reviewed = await reviewDraft(draft);
 expect(reviewed.blockers).toEqual([]);
 expect(reviewed.publishable).toBe(true);
 const key = randomUUID();
 const result = await publishDraft(draft, reviewed.review_token, key);
 expect(result.setups.map(s => s.establishment_name)).toEqual(['Fabric Factory','S.N. Polymers Factory']);
 expect(new Set(result.setups.map(s => s.statutory_scope_id)).size).toBe(2);
 for (const scheme of ['epf', 'pt']) {
  const ids = new Set(result.setups.map(s => s[scheme + '_revision_id']));
  expect(ids.size).toBe(1);
  const revisionId = [...ids][0];
  const bindings = await q('SELECT statutory_scope_id FROM payroll_statutory_scope_bindings WHERE revision_id=$1', [revisionId]);
  expect(new Set(bindings.map(b => b.statutory_scope_id))).toEqual(new Set(result.setups.map(s => s.statutory_scope_id)));
  for (const setup of result.setups) {
   const [{ r }] = await q("SELECT resolve_payroll_master('statutory',$1,'2098-01-01',$2) r",
    [{ scheme: scheme.toUpperCase(), statutory_scope_id: setup.statutory_scope_id }, accounts]);
   expect(r).toMatchObject({revision_id:revisionId,statutory_scope_id:setup.statutory_scope_id});
  }
 }
 expect(await publishDraft(draft, reviewed.review_token, key)).toEqual(result);
 const [{ id: otherState }] = await q('SELECT id FROM payroll_statutory_states WHERE id<>$1 ORDER BY name LIMIT 1', [data.state_id]);
 await rejectsWith(() => q("SELECT save_payroll_company_deduction_setup($1,'Third factory','2098-01-01',$2,'Synthetic test',$3)",
  [otherState, {PT:result.setup.pt_revision_id}, accounts]), '22023');
 const [{ r: reuseDraft }] = await q('SELECT save_payroll_guided_deduction_draft(NULL,0,$1,$2) r',
  [{ ...data, all_factories:false, state_id:otherState, establishment:'Third factory', rules:{EPF:{revision_id:result.setup.epf_revision_id}} }, accounts]);
 const reuseReview = await reviewDraft(reuseDraft);
 expect(reuseReview.rules.EPF.reused).toBe(true);
 expect(reuseReview.blockers).toEqual([]);
 const reused = await publishDraft(reuseDraft, reuseReview.review_token, randomUUID());
 expect(reused.setup.epf_revision_id).toBe(result.setup.epf_revision_id);
});

test('publishes a Pan India EPF-only setup without collecting a state', async () => {
 const original = await setupDraft();
 const data = {
  ...original.data, state_id: null, pan_india: true,
  rules: { EPF: original.data.rules.EPF },
 };
 const [{r: draft}] = await q('SELECT save_payroll_guided_deduction_draft($1,1,$2,$3) r', [original.id, data, accounts]);
 const reviewed = await reviewDraft(draft);
 expect(reviewed.blockers).toEqual([]);
 const published = await publishDraft(draft, reviewed.review_token, randomUUID());
 expect(published.setup).toMatchObject({state_id:null,state_name:'Pan India',pt_revision_id:null});
 const [{r: options}] = await q("SELECT get_payroll_company_deduction_options(NULL,'2098-01-01',$1,1,100) r",[accounts]);
 expect(options.rules.map(rule=>rule.id)).toContain(published.setup.epf_revision_id);
 const [{r: listed}] = await q('SELECT get_payroll_company_deduction_setups($1,$2,1,100) r',[accounts, data.establishment]);
 expect(listed.setups).toContainEqual(expect.objectContaining({id:published.setup.id,state_name:'Pan India'}));
});
