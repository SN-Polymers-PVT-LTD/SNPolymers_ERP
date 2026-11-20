const {supabase}=require('../db/supabase');
const {sendError}=require('./payroll.controller');
const guidedReviewParams = req => ({
 p_id: req.params.id,
 p_expected_version: req.body.expected_version,
 p_initial: req.body.initial_setup,
});
const rpc=(name,params,status=200)=>async(req,res)=>{
 try{const {data,error}=await supabase.rpc(name,{...params(req),p_actor_id:req.user.id});if(error)return sendError(res,error);res.set('Cache-Control','no-store');return res.status(status).json({success:true,result:data});}
 catch(error){return sendError(res,error);}
};
module.exports={
 epfWageBases:rpc('get_payroll_epf_wage_bases',r=>({p_employee_id:r.params.employeeId})),
 confirmEpfWageBasis:rpc('confirm_payroll_epf_wage_basis',r=>({
  p_employee_id:r.params.employeeId,p_pay_structure_id:r.body.pay_structure_id,p_effective_from:r.body.effective_from,
 })),
 recordEpfWageBasis:rpc('record_payroll_epf_wage_basis',r=>({
  p_employee_id:r.params.employeeId,
  p_pay_structure_id:r.body.pay_structure_id,
  p_effective_from:r.body.effective_from,
  p_regular_wages:r.body.regular_wages,
  p_reason:r.body.reason,
 }),201),
 guidedList:rpc('list_payroll_guided_deduction_drafts',r=>({p_page:r.query.page,p_limit:r.query.limit})),
 guidedReview:rpc('review_payroll_guided_deduction_draft',guidedReviewParams),
 guidedPublish:rpc('publish_payroll_guided_deduction_draft',req=>({
  ...guidedReviewParams(req),
  p_review_token: req.body.review_token,
  p_reference: req.body.approval_reference ?? null,
  p_key: req.body.idempotency_key,
 }),201),
 guidedSave:rpc('save_payroll_guided_deduction_draft',r=>({p_id:r.body.id,p_expected_version:r.body.expected_version,p_data:r.body.data}),201),
 guidedGet:rpc('get_payroll_guided_deduction_draft',r=>({p_id:r.params.id})),
 companyList:rpc('get_payroll_company_deduction_setups',r=>({p_search:r.query.search,p_page:r.query.page,p_limit:r.query.limit})),
 companyOptions:rpc('get_payroll_company_deduction_options',r=>({p_state_id:r.query.state_id ?? null,p_date:r.query.date,p_page:r.query.page,p_limit:r.query.limit})),
 companySave:rpc('save_payroll_company_deduction_setup',r=>({p_state_id:r.body.state_id,p_establishment:r.body.establishment,p_from:r.body.effective_from,p_rules:r.body.rules,p_evidence:r.body.evidence_reference}),201),
 companyPreview:rpc('review_company_deduction_assignment_dates',r=>({
  p_setup_id:r.body.setup_id,p_pt_setup_id:r.body.pt_setup_id ?? null,p_from:r.body.effective_from,
  p_employees:r.body.employees,p_evidence:null,p_confirmed_dates:null,
 })),
 companyApply:(req,res)=>{
  const {setup_id,pt_setup_id,effective_from,employees,evidence_reference,confirmed_dates}=req.body;
  const params={p_setup_id:setup_id,p_from:effective_from,p_employees:employees,p_evidence:evidence_reference};
  if(confirmed_dates) return rpc('review_company_deduction_assignment_dates',()=>({...params,p_pt_setup_id:pt_setup_id ?? null,p_confirmed_dates:confirmed_dates}))(req,res);
  return pt_setup_id
   ? rpc('apply_payroll_company_deduction_setups',()=>({...params,p_pt_setup_id:pt_setup_id}))(req,res)
   : rpc('apply_payroll_company_deduction_setup',()=>params)(req,res);
 },
 states:rpc('get_payroll_statutory_states',()=>({})),registerState:rpc('register_payroll_statutory_state',r=>({p_name:r.body.name}),201),
 candidates:rpc('get_payroll_statutory_setup_candidates',r=>({p_search:r.query.search,p_department:r.query.department||null,p_category:r.query.employee_category||null,p_unconfigured_only:r.query.unconfigured_only,p_status:r.query.status||null,p_page:r.query.page,p_limit:r.query.limit})),
 bulk:rpc('bulk_record_payroll_statutory_profiles',r=>({p_employees:r.body.employees,p_interval:r.body.interval,p_evidence:r.body.evidence_reference})),
 context:rpc('get_payroll_statutory_profile_context',r=>({p_search:r.query.search,p_page:r.query.page,p_limit:r.query.limit})),
 history:rpc('get_payroll_statutory_profiles',r=>({p_employee_id:r.params.employeeId})),
 save:rpc('record_payroll_statutory_profiles',r=>({p_employee_id:r.params.employeeId,p_expected_version:r.body.expected_version,p_intervals:r.body.intervals,p_evidence:r.body.evidence_reference}),201),
 scope:rpc('register_payroll_statutory_scope',r=>({p_jurisdiction_code:r.body.jurisdiction_code,p_establishment_code:r.body.establishment_code,p_evidence:r.body.evidence_reference}),201),
 bind:rpc('bind_payroll_statutory_scope',r=>({p_revision_id:r.body.revision_id,p_scope_id:r.body.statutory_scope_id,p_evidence:r.body.evidence_reference}),201)
};
