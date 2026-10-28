const {supabase}=require('../db/supabase');
const {sendError}=require('./payroll.controller');
const rpc=(name,params,status=200)=>async(req,res)=>{
 try{const {data,error}=await supabase.rpc(name,{...params(req),p_actor_id:req.user.id});if(error)return sendError(res,error);res.set('Cache-Control','no-store');return res.status(status).json({success:true,result:data});}
 catch(error){return sendError(res,error);}
};
module.exports={
 companyList:rpc('get_payroll_company_deduction_setups',r=>({p_search:r.query.search,p_page:r.query.page,p_limit:r.query.limit})),
 companyOptions:rpc('get_payroll_company_deduction_options',r=>({p_state_id:r.query.state_id,p_date:r.query.date,p_page:r.query.page,p_limit:r.query.limit})),
 companySave:rpc('save_payroll_company_deduction_setup',r=>({p_state_id:r.body.state_id,p_establishment:r.body.establishment,p_from:r.body.effective_from,p_rules:r.body.rules,p_evidence:r.body.evidence_reference}),201),
 companyApply:rpc('apply_payroll_company_deduction_setup',r=>({p_setup_id:r.body.setup_id,p_from:r.body.effective_from,p_employees:r.body.employees,p_evidence:r.body.evidence_reference})),
 states:rpc('get_payroll_statutory_states',()=>({})),registerState:rpc('register_payroll_statutory_state',r=>({p_name:r.body.name}),201),
 candidates:rpc('get_payroll_statutory_setup_candidates',r=>({p_search:r.query.search,p_department:r.query.department||null,p_category:r.query.employee_category||null,p_unconfigured_only:r.query.unconfigured_only,p_page:r.query.page,p_limit:r.query.limit})),
 bulk:rpc('bulk_record_payroll_statutory_profiles',r=>({p_employees:r.body.employees,p_interval:r.body.interval,p_evidence:r.body.evidence_reference})),
 context:rpc('get_payroll_statutory_profile_context',r=>({p_search:r.query.search,p_page:r.query.page,p_limit:r.query.limit})),
 history:rpc('get_payroll_statutory_profiles',r=>({p_employee_id:r.params.employeeId})),
 save:rpc('record_payroll_statutory_profiles',r=>({p_employee_id:r.params.employeeId,p_expected_version:r.body.expected_version,p_intervals:r.body.intervals,p_evidence:r.body.evidence_reference}),201),
 scope:rpc('register_payroll_statutory_scope',r=>({p_jurisdiction_code:r.body.jurisdiction_code,p_establishment_code:r.body.establishment_code,p_evidence:r.body.evidence_reference}),201),
 bind:rpc('bind_payroll_statutory_scope',r=>({p_revision_id:r.body.revision_id,p_scope_id:r.body.statutory_scope_id,p_evidence:r.body.evidence_reference}),201)
};
