const {q,one,createReviewFixture}=require('./payrollReviewFixtures');
const {interval,scope,save}=require('./payrollProfileFixtures');
const {statutory,pt}=require('./payrollMasterFixtures');
async function prepareFinancialReview(db,users,{gate=false,count=1,split=false,factory=false,cutoffReady=true,department,officeGroup,officeCategory}={}){
 if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');
 const f=await createReviewFixture(db,users,{count,factory,...(department?{department}:{}),...(officeGroup?{officeGroup,officeCategory}:{}),...(split?{policyOverrides:{split_period_allocation_method:'CALENDAR_WEIGHTED_WITH_RESIDUAL',rounding:{lop:{method:'HALF_UP',precision:2,stage:'MONTH'},proration:{method:'UNRESOLVED',precision:null,stage:'UNRESOLVED'},allocation:{method:'HALF_UP',precision:2,stage:'LINE'}}}}:{})}),scopeId=await scope(db,users.accounts.id);
 for(const employee of f.employees)await save(db,employee.id,users.accounts.id,0,[interval(scopeId,f.from,f.to,{verification_status:'ACCOUNTS_CONFIRMED',advisor_name:'SYNTHETIC Accounts setup'})]);
 const d=statutory({jurisdiction:'SYNTHETIC_'+scopeId,establishment:'SYNTHETIC',effective_from:f.from,effective_to:f.to,verification_status:'ACCOUNTS_CONFIRMED',advisor_name:'SYNTHETIC Accounts setup'});
 Object.assign(d.configuration,{collection_timing:'INCREMENTAL_MONTHLY',lop_wage_basis:'PROPORTIONAL_COMPONENTS',arrears_period:'CURRENT_RUN_MONTH',eligibility:'ENROLLED',rounding:{method:'HALF_UP',precision:2,stage:'MONTH'},adjustment_basis:{BONUS:'EXCLUDE',SALARY_ARREARS:'EXCLUDE',REIMBURSEMENT:'EXCLUDE',RECOVERY:'DEDUCTION_ONLY'}});
 if(factory){d.configuration.included_components=['DAILY_WAGE'];d.configuration.excluded_components=['PACKAGE_BALANCE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'];}
 const draft=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify(d),users.accounts.id])).r;
 const p=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[draft.id,users.accounts.id])).r;
 await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC setup',$3)",[draft.id,p.preview_token,users.accounts.id]);await q(db,'SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[draft.id,scopeId,'SYNTHETIC explicit binding',users.accounts.id]);
 // Synthetic zero PT slab preserves the focus of unrelated financial invariants.
 const tax=pt({...d,scheme:'PT',configuration:{...d.configuration,employee_rate:null,employer_rate:null,eligibility:'JURISDICTION_PROFILE',eligibility_ceiling:null,wage_ceiling:null,calculation_method:'SLABS'},slabs:Array.from({length:12},(_,i)=>({month:i+1,lower_bound:'0',upper_bound:null,deduction_amount:'0'}))});
 const td=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify(tax),users.accounts.id])).r;
 const tp=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[td.id,users.accounts.id])).r;
 await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC zero PT slab',$3)",[td.id,tp.preview_token,users.accounts.id]);await q(db,'SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[td.id,scopeId,'SYNTHETIC PT binding',users.accounts.id]);
 const cutoff=`${Number(f.to.slice(0,4))+1}-01-01T00:00:00+05:30`;
 if(cutoffReady){await q(db,"SELECT set_payroll_period_cutoff($1,0,'propose',$2,'SYNTHETIC cutoff',$3)",[f.run.id,cutoff,users.accounts.id]);await q(db,"SELECT set_payroll_period_cutoff($1,1,'approve',NULL,'SYNTHETIC HO cutoff',$2)",[f.run.id,users.ho.id]);}
 // Owner-only test substitutions are transaction-scoped and rolled back.
 if(gate){await q(db,'CREATE OR REPLACE FUNCTION payroll_financial_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$');await q(db,`CREATE OR REPLACE FUNCTION payroll_financial_clock() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT '${cutoff}'::timestamptz $$`);}
 return {...f,scopeId,cutoff};
}
module.exports={prepareFinancialReview};
