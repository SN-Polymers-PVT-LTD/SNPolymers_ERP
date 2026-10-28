import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {policy}=require('../../helpers/payrollMasterFixtures');
let db,admin;
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const save=async(data)=>(await one("SELECT save_payroll_master_draft('policies',NULL,0,$1,$2) r",[JSON.stringify(data),admin])).r;
const publish=async r=>{const p=(await one("SELECT preview_payroll_master_publication('policies',$1,$2) r",[r.id,admin])).r;expect(p.publishable,JSON.stringify(p)).toBe(true);return (await one("SELECT publish_payroll_master('policies',$1,$2,$3,'Synthetic approval',$4) r",[r.id,r.version,p.preview_token,admin])).r;};
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});afterAll(async()=>db?.end());
beforeEach(async()=>{await db.query('BEGIN');admin=(await one("INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,'admin','Open policy test',true) RETURNING id",[String(crypto.randomInt(7000000000,9999999999))])).id;});afterEach(async()=>db.query('ROLLBACK'));
test('ongoing global policy publishes, resolves in later years and closes only its future tail',async()=>{
 const first=await save(policy({effective_from:'9000-01-01',effective_to:null}));await publish(first);
 const resolved=(await one("SELECT resolve_payroll_master('policies',$1,'9005-01-01',$2) r",[JSON.stringify({group_code:'SNP_PERMANENT'}),admin])).r;expect(resolved.revision_id).toBe(first.id);
 const next=await save(policy({effective_from:'9001-01-01',effective_to:null}));await publish(next);
 expect(await one('SELECT effective_to::text,published_effective_to FROM payroll_policy_master_revisions WHERE id=$1',[first.id])).toEqual({effective_to:'9000-12-31',published_effective_to:null});
 expect((await one('SELECT effective_to FROM payroll_policy_master_revisions WHERE id=$1',[next.id])).effective_to).toBe(null);
});
test('invalid bounded date range is rejected',async()=>{
 await db.query('SAVEPOINT bad');await expect(save(policy({effective_to:'2089-12-31'}))).rejects.toBeTruthy();await db.query('ROLLBACK TO SAVEPOINT bad');
});
