#!/usr/bin/env node
// Synthetic fixtures only. Fixed local target, transactional seed, no remote URI.
process.env.LOCAL_SUPABASE_TEST_PROFILE = 'payroll';
const {Client} = require('pg');
const {getLocalTestTarget} = require('../src/config/localTestTarget');
const {createReviewUsers} = require('../tests/helpers/payrollReviewFixtures');
const {prepareFinancialReview} = require('../tests/helpers/payrollFinancialFixtures');
async function main() {
 const db = new Client({connectionString:getLocalTestTarget('payroll').dbUri,connectionTimeoutMillis:5000});
 await db.connect();
 try {
  await db.query('BEGIN');
  await db.query("SET LOCAL statement_timeout='45s'");
  const users = await createReviewUsers(db);
  const runs = [];
  for (const [department,officeGroup,officeCategory] of [
   ['Head Office','HO_STAFF','HO Staff'],['Projects','PROJECTS_JE','Junior Engineer'],
   ['Projects','PROJECTS_ZO','Zonal Office'],['Projects','PROJECTS_SUPERVISOR','Local project supervisor'],
   ['Projects','PROJECTS_HEAD_OFFICE','Head office']
  ]) {
   const f = await prepareFinancialReview(db,users,{gate:true,count:3,department,officeGroup,officeCategory});
   runs.push({department,group:officeGroup,run_id:f.run.id,from:f.from,to:f.to});
  }
  await db.query('COMMIT');
  console.log(JSON.stringify({synthetic:true,users:Object.fromEntries(Object.entries(users).map(([role,u])=>[role,{id:u.id,mobile:u.mobile_number}])),runs},null,2));
 } catch (e) { await db.query('ROLLBACK'); throw e; }
 finally { await db.end(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
