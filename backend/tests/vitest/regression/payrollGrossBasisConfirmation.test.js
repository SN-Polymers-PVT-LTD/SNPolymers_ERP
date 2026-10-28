import { beforeAll, afterAll, beforeEach, afterEach, test, expect } from 'vitest';
const { Client } = require('pg');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { createReviewUsers, one, q } = require('../../helpers/payrollReviewFixtures');
const { statutory } = require('../../helpers/payrollMasterFixtures');
let db, users;
beforeAll(async () => { await requireLocalSupabase(); db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI }); await db.connect(); });
afterAll(async () => { await db?.end(); });
beforeEach(async () => { await q(db, 'BEGIN'); users = await createReviewUsers(db); });
afterEach(async () => { await q(db, 'ROLLBACK'); });
const save = async (data, id = null, version = 0, actor = users.accounts.id) => (await one(db, "SELECT save_payroll_master_draft('statutory',$1,$2,$3,$4) r", [id, version, JSON.stringify(data), actor])).r;

test('Accounts save derives confirmation from the writer, reason and database clock even when metadata is omitted or forged', async () => {
 const data = statutory(); for (const k of ['verification_status','advisor_name','verification_reference','verified_on']) delete data[k];
 const created = await save(data);
 const actor = await one(db, "SELECT display_name,(now() AT TIME ZONE 'Asia/Kolkata')::date::text today FROM authorised_users WHERE id=$1", [users.accounts.id]);
 expect(created).toMatchObject({ verification_status:'ACCOUNTS_CONFIRMED', advisor_name:actor.display_name, verification_reference:data.reason, verified_on:actor.today, created_by:users.accounts.id });
 const edited = await save({ ...data, verification_status:'UNVERIFIED', advisor_name:'Forged person', verification_reference:'Forged reference', verified_on:'2099-01-01', configuration:{...data.configuration,employee_rate:'8.125'} },created.id,1);
 expect(edited).toMatchObject({ version:2, verification_status:'ACCOUNTS_CONFIRMED', advisor_name:actor.display_name, verification_reference:data.reason, verified_on:actor.today });
 const events = await q(db,'SELECT action,actor_id,after_snapshot FROM payroll_master_events WHERE statutory_revision_id=$1 ORDER BY id',[created.id]);
 expect(events).toHaveLength(2); expect(events.every(e=>e.actor_id===users.accounts.id)).toBe(true);
 expect(events[1].after_snapshot.configuration.employee_rate).toBe('8.125');
});
test.each(['BASIC','STAFF_WELFARE','OTHER_FIXED'])('retired %s wage component is rejected through the database RPC', async name => {
 const data=statutory();data.configuration.included_components=[name];
 await q(db,'SAVEPOINT retired');await expect(save(data)).rejects.toMatchObject({code:'22023'});await q(db,'ROLLBACK TO SAVEPOINT retired');
});
test.each(['admin','ho','je','zo'])('%s cannot acquire Accounts confirmation through the save RPC', async role => {
 await q(db,'SAVEPOINT forbidden'); await expect(save(statutory(),null,0,users[role].id)).rejects.toMatchObject({code:'42501'}); await q(db,'ROLLBACK TO SAVEPOINT forbidden');
});
test('gross-only authoring helper is removed and published component-based history remains stored', async () => {
 expect((await one(db,"SELECT to_regprocedure('public.hr_create_legacy_pay_structure(uuid,text,numeric,numeric,numeric,numeric,boolean,boolean,text,uuid)') legacy")).legacy).toBeNull();
 const def=(await one(db,"SELECT pg_get_functiondef('public.get_payroll_preview_sources(uuid,uuid)'::regprocedure) body")).body;
 expect(def).toContain("to_jsonb(p)-ARRAY['basic_salary','staff_welfare','other_fixed_components']");
 expect((await one(db,"SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_permanent_pay_structures' AND column_name IN ('basic_salary','staff_welfare','other_fixed_components')")).n).toBe(3);
});

test('exact forward migration preserves published component-rule audit data and does not convert its wages', async () => {
 const fs=require('fs'),path=require('path'),crypto=require('crypto');
 const sql=filename=>fs.readFileSync(path.join(__dirname,'../../../src/db/migrations',filename),'utf8');
 const old=sql('116_payroll_accounts_setup_policies.sql');
 const validator=old.slice(old.indexOf('CREATE OR REPLACE FUNCTION public.payroll_validate_master_106('),old.indexOf('CREATE OR REPLACE FUNCTION public.save_payroll_master_draft('));
 await q(db,validator);
 const data=statutory({jurisdiction:'ARCHIVE_'+crypto.randomUUID()});
 data.configuration.included_components=['BASIC'];
 data.configuration.excluded_components=['STAFF_WELFARE','OTHER_FIXED','PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'];
 const draft=await save(data);
 const preview=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[draft.id,users.accounts.id])).r;
 await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'Synthetic archive fixture',$3)",[draft.id,preview.preview_token,users.accounts.id]);
 const before=await one(db,'SELECT to_jsonb(r) r FROM payroll_statutory_rule_revisions r WHERE id=$1',[draft.id]);
 const events=await q(db,'SELECT * FROM payroll_master_events WHERE statutory_revision_id=$1 ORDER BY id',[draft.id]);
 // Recreate only the now-retired signature so the exact one-time migration can
 // be replayed transactionally; the stub is never called and is dropped by 141.
 await q(db,'CREATE FUNCTION public.hr_create_legacy_pay_structure(uuid,text,numeric,numeric,numeric,numeric,boolean,boolean,text,uuid) RETURNS public.hr_permanent_pay_structures LANGUAGE sql AS $$ SELECT NULL::public.hr_permanent_pay_structures $$');
 await q(db,sql('141_payroll_gross_basis_accounts_confirmation.sql'));
 expect(await one(db,'SELECT to_jsonb(r) r FROM payroll_statutory_rule_revisions r WHERE id=$1',[draft.id])).toEqual(before);
 expect(await q(db,'SELECT * FROM payroll_master_events WHERE statutory_revision_id=$1 ORDER BY id',[draft.id])).toEqual(events);
 await q(db,'SAVEPOINT retired_history');
 await expect(q(db,"SELECT payroll_validate_master('statutory',payroll_master_payload('statutory',to_jsonb(r))) FROM payroll_statutory_rule_revisions r WHERE id=$1",[draft.id])).rejects.toMatchObject({code:'22023'});
 await q(db,'ROLLBACK TO SAVEPOINT retired_history');
});
