import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture}=require('../../helpers/payrollReviewFixtures');
let db,users;
const save=(version,action,date='2080-01-01',actor)=>one(db,"SELECT save_factory_calendar('SNP Factory',$1,$2,$3,'Synthetic calendar',$4) result",[version,action,date,actor||users.admin.id]);
const resolved=(from,to=from,group='SNP_PERMANENT',dept='SNP Factory')=>one(db,'SELECT resolve_factory_calendar($1,$2,$3,$4) days',[dept,group,from,to]);
async function rejects(fn,code){await q(db,'SAVEPOINT bad');await expect(fn()).rejects.toMatchObject({code});await q(db,'ROLLBACK TO SAVEPOINT bad');}
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});afterAll(async()=>db?.end());
beforeEach(async()=>{await q(db,'BEGIN');users=await createReviewUsers(db);});afterEach(async()=>q(db,'ROLLBACK'));
test('Sunday recurs without writes, weekdays auto-fill and factory/category scopes stay separate',async()=>{
 await save(0,'SCHEDULE');const {days}=await resolved('2080-01-01','2080-01-31');expect(days).toHaveLength(31);
 const sunday=days.find(d=>new Date(d.calendar_date).getUTCDay()===0);expect(sunday.day_type).toBe('Weekly Off');expect(sunday.compensation_treatment).toBe('PAID');
 expect((await resolved(sunday.calendar_date,sunday.calendar_date,'SNP_CASUAL')).days[0].compensation_treatment).toBe('UNPAID');
 expect((await resolved('2080-01-01','2080-01-01','FABRIC_PERMANENT','Fabric Factory')).days).toEqual([]);
 expect((await resolved('2080-02-01','2080-02-29')).days).toHaveLength(29);
 expect((await one(db,"SELECT count(*) n FROM factory_calendar_revisions WHERE department='SNP Factory'")).n).toBe('1');
});
test('date exceptions override Sundays once, reset restores default, versions and history are guarded',async()=>{
 await save(0,'SCHEDULE');const {days}=await resolved('2080-01-01','2080-01-07');const sunday=days.find(d=>new Date(d.calendar_date).getUTCDay()===0).calendar_date;
 await save(1,'WORKING',sunday);expect((await resolved(sunday)).days[0].is_off).toBe(false);
 await save(2,'DAY_OFF',sunday);expect((await resolved(sunday)).days).toHaveLength(1);expect((await resolved(sunday)).days[0].day_type).toBe('Paid Holiday');
 await save(3,'RESET',sunday);expect((await resolved(sunday)).days[0].day_type).toBe('Weekly Off');
 await rejects(()=>save(3,'DAY_OFF',sunday),'PY409');await rejects(()=>q(db,'DELETE FROM factory_calendar_revisions'),'PY409');
});
test('authorization and initialization boundaries are enforced in SQL',async()=>{
 await rejects(()=>save(0,'SCHEDULE','2080-01-01',users.accounts.id),'42501');await rejects(()=>save(0,'DAY_OFF'),'22023');
 await save(0,'SCHEDULE');await rejects(()=>save(1,'SCHEDULE','2080-02-01'),'23505');await rejects(()=>save(1,'DAY_OFF','2079-12-31'),'22023');
 await q(db,'UPDATE authorised_users SET is_active=false WHERE id=$1',[users.admin.id]);await rejects(()=>save(1,'DAY_OFF'),'42501');
});
test('legacy evidence is preserved until explicitly revised; old publisher cannot bypass managed calendar',async()=>{
 await q(db,"SELECT publish_payroll_calendar_days('SNP_PERMANENT','SNP Factory',$1,'Legacy evidence',$2)",[JSON.stringify([{calendar_date:'2080-01-02',day_type:'Unpaid Closure',compensation_treatment:'UNPAID'}]),users.ho.id]);
 await save(0,'SCHEDULE');expect((await resolved('2080-01-02')).days[0].day_type).toBe('Unpaid Closure');
 await save(1,'DAY_OFF','2080-01-02');expect((await resolved('2080-01-02')).days[0].day_type).toBe('Paid Holiday');
 await rejects(()=>q(db,"SELECT publish_payroll_calendar_days('SNP_PERMANENT','SNP Factory',$1,'Bypass',$2)",[JSON.stringify([{calendar_date:'2080-01-03',day_type:'Scheduled Workday',compensation_treatment:'PAID'}]),users.ho.id]),'PY409');
});
test('source getter supplies effective calendar without requiring attendance on an off day',async()=>{
 const f=await createReviewFixture(db,users,{factory:true});await save(0,'SCHEDULE',f.from);
 const {s}=await one(db,'SELECT get_payroll_review_sources($1,$2) s',[f.rows[0].id,users.accounts.id]);expect(s.calendar.length).toBeGreaterThan(0);expect(s.calendar[0].managed).toBe(true);
});
test('calendar writes cannot race review/finalization source locks',async()=>{
 const f=await createReviewFixture(db,users,{factory:true});await q(db,'SELECT payroll_lock_review_sources($1,$2)',[f.employees[0].id,f.run.id]);
 const other=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await other.connect();try{
  await other.query('BEGIN');await expect(other.query("SELECT payroll_source_fence('factory-calendar:SNP Factory',false)")).rejects.toMatchObject({code:'PY409'});
 }finally{await other.query('ROLLBACK');await other.end();}
});
test('locked source months reject calendar changes, future dates remain editable',async()=>{
 const f=await createReviewFixture(db,users,{factory:true});await save(0,'SCHEDULE',f.from);
 await q(db,'SET CONSTRAINTS ALL IMMEDIATE');
 // Rollback-only representation of an already locked permanent split run.
 await q(db,'ALTER TABLE payroll_run_employees DISABLE TRIGGER USER');await q(db,'ALTER TABLE payroll_runs DISABLE TRIGGER USER');
 await q(db,"UPDATE payroll_run_employees SET status='LOCKED' WHERE id=$1",[f.rows[0].id]);await q(db,"UPDATE payroll_runs SET group_code='SNP_PERMANENT' WHERE id=$1",[f.run.id]);
 await q(db,'ALTER TABLE payroll_run_employees ENABLE TRIGGER USER');await q(db,'ALTER TABLE payroll_runs ENABLE TRIGGER USER');
 const end=f.from.slice(0,8)+'31';await rejects(()=>save(1,'DAY_OFF',end),'PY409');
 const next=f.from.slice(0,5)+'11-01';await save(1,'DAY_OFF',next);expect((await resolved(next)).days[0].is_off).toBe(true);
});
test('active FMs can maintain both factories, never office scopes; inactive FMs are denied',async()=>{
 await save(0,'SCHEDULE','2080-01-01',users.fm.id);
 await one(db,"SELECT save_factory_calendar('Fabric Factory',0,'SCHEDULE','2080-01-01','Calendar',$1)",[users.fm.id]);
 await rejects(()=>one(db,"SELECT save_factory_calendar('Head Office',0,'SCHEDULE','2080-01-01','Denied',$1)",[users.fm.id]),'42501');
 await q(db,'UPDATE authorised_users SET is_active=false WHERE id=$1',[users.fm.id]);
 await rejects(()=>save(1,'DAY_OFF','2080-01-02',users.fm.id),'42501');
});
