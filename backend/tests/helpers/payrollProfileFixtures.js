// Synthetic evidence only; these helpers never seed production legal decisions.
const {one,q}=require('./payrollReviewFixtures');
const {statutory,pt}=require('./payrollMasterFixtures');
const crypto=require('crypto');
const interval=(scope,from,to,extra={})=>({effective_from:from,effective_to:to,verification_status:'ADVISOR_VERIFIED',advisor_name:'SYNTHETIC advisor',verification_reference:'ISOLATED TEST ONLY',verified_on:'2020-01-01',schemes:{
 EPF:{statutory_scope_id:scope,applicability:'APPLICABLE',enrolled:true,basis_reference:'SYNTHETIC EPF enrolment'},
 ESI:{statutory_scope_id:scope,applicability:'NOT_APPLICABLE',enrolled:false,basis_reference:'SYNTHETIC ESI nonapplicability'},
 PT:{statutory_scope_id:scope,applicability:'NOT_APPLICABLE',enrolled:null,basis_reference:'SYNTHETIC PT nonapplicability'}},...extra});
const scope=async(db,admin)=>(await one(db,'SELECT register_payroll_statutory_scope($1,$2,$3,$4) id',['TEST_'+crypto.randomUUID().replaceAll('-','').toUpperCase(),'TEST_ESTABLISHMENT','SYNTHETIC scope only',admin])).id;
const save=async(db,employee,admin,version,intervals)=>(await one(db,'SELECT record_payroll_statutory_profiles($1,$2,$3,$4,$5) r',[employee,version,JSON.stringify(intervals),'SYNTHETIC complete timeline',admin])).r;
async function rule(db,admin,scopeId,from,to,bind=true,scheme='EPF'){
 const draft=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify((scheme==='PT'?pt:statutory)({jurisdiction:'TEST_'+crypto.randomUUID(),establishment:'TEST_ONLY',effective_from:from,effective_to:to})),admin])).r;
 const preview=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[draft.id,admin])).r;
 await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC ONLY',$3)",[draft.id,preview.preview_token,admin]);
 if(bind)await q(db,'SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[draft.id,scopeId,'SYNTHETIC explicit binding',admin]);return draft.id;
}
module.exports={interval,scope,save,rule};
