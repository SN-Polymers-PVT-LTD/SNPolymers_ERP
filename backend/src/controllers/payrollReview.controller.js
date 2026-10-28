const {supabase}=require('../db/supabase');
const {sendError}=require('./payroll.controller');
const {calculatePreview}=require('../domain/payroll/preview');
const {previewChanges,availableActions}=require('../domain/payroll/review');
async function queue(req,res){
 try{
  const {data,error}=await supabase.rpc('get_payroll_review_queue',{p_actor_id:req.user.id,p_run_id:req.query.run_id||null,p_status:req.query.status||null,p_page:req.query.page,p_limit:req.query.limit});
  if(error)return sendError(res,error);
  return res.json({success:true,queue:{...data,rows:data.rows.map(row=>({...row,available_actions:availableActions(row,req.user.role,req.user.id,['SNP Factory','Fabric Factory'].includes(row.department))}))}});
 }catch(error){return sendError(res,error);}
}
async function freshness(req,res){
 try{
  const {data,error}=await supabase.rpc('get_payroll_review_queue',{p_actor_id:req.user.id,p_run_id:req.query.run_id,p_status:null,p_page:req.query.page,p_limit:req.query.limit});
  if(error)return sendError(res,error);
  const checks=new Array(data.rows.length);let cursor=0;
  // Page bounded to 20, at most four source snapshots in flight. Every RPC
  // independently enforces current actor scope; no generation or writes occur.
  await Promise.all(Array.from({length:Math.min(4,data.rows.length)},async()=>{
   while(cursor<data.rows.length){const index=cursor++,row=data.rows[index];
    try{const result=await supabase.rpc('get_payroll_employee_review',{p_row_id:row.id,p_actor_id:req.user.id});
     if(result.error)throw result.error;
     checks[index]=require('../domain/payroll/freshness').sourceCheck(result.data);
    }catch{checks[index]={row_id:row.id,current_version:row.current_version,review_revision:row.review_revision,review_version:row.review_version,source_fingerprint:row.source_fingerprint,status:'UNAVAILABLE',reasons:['Current payroll sources could not be verified.']};}
   }
  }));
  return res.set('Cache-Control','no-store').json({success:true,freshness:{checks,total:data.total}});
 }catch(error){return sendError(res,error);}
}
async function autoRecalculate(req,res){
 try{
  const {run_id,page,limit}=req.body;
  const scope=await supabase.rpc('get_payroll_draft_run',{p_run_id:run_id,p_actor_id:req.user.id,p_page:1,p_limit:1});
  if(scope.error)return sendError(res,scope.error);
  if(!scope.data?.run)return res.status(404).json({success:false,message:'Payroll run not found.'});
  const role=['SNP Factory','Fabric Factory'].includes(scope.data.run.department)?'factory_manager':'accounts';
  if(scope.data.run.created_by!==req.user.id||req.user.role!==role)return res.status(403).json({success:false,message:'Only the originating preparer may automatically recalculate this sheet.'});
  const fetched=await supabase.rpc('get_payroll_review_queue',{p_actor_id:req.user.id,p_run_id:run_id,p_status:null,p_page:page,p_limit:limit});
  if(fetched.error)return sendError(res,fetched.error);
  const results=[];
  for(const row of fetched.data.rows){
   if(!['DRAFT','CALCULATED'].includes(row.status)){results.push({row_id:row.id,status:'PRESERVED'});continue;}
   try{
    const review=await supabase.rpc('get_payroll_employee_review',{p_row_id:row.id,p_actor_id:req.user.id});
    if(review.error)throw review.error;
    const current=review.data;
    // Recheck after the queue read: another tab may have submitted the row.
    if(!['DRAFT','CALCULATED'].includes(current.row.status)){results.push({row_id:row.id,status:'PRESERVED'});continue;}
    const check=require('../domain/payroll/freshness').sourceCheck(current);
    if(check.status==='CURRENT'){results.push({row_id:row.id,status:'CURRENT'});continue;}
    if(check.status==='UNAVAILABLE'){results.push({row_id:row.id,status:'UNAVAILABLE',message:current.source_error?.message||'Current sources could not be calculated.'});continue;}
    const result=await apply(row.id,{action:'calculate',expected_version:current.row.current_version,expected_review_version:current.row.review_version,reason:'Automatic recalculation using latest payroll setup'},req.user.id);
    if(result.error)results.push({row_id:row.id,status:'FAILED',code:result.error.code,message:'Sources or review state changed; check current sources and retry.'});
    else results.push({row_id:row.id,status:'UPDATED',calculation_status:result.data.calculation?.status||null});
   }catch{results.push({row_id:row.id,status:'UNAVAILABLE',message:'Current sources could not be calculated.'});}
  }
  return res.set('Cache-Control','no-store').json({success:true,automatic:{results}});
 }catch(error){return sendError(res,error);}
}
async function detail(req,res){
 try{
  const {data,error}=await supabase.rpc('get_payroll_employee_review',{p_row_id:req.params.rowId,p_actor_id:req.user.id});
  if(error)return sendError(res,error);
  const current=data.row.status==='LOCKED'?data.locked_calculation:(data.source?calculatePreview(data.source):null),latest=data.revisions.at(-1)?.calculation_snapshot||null;
  const revisions=data.revisions.map((v,i)=>{
   const note=data.content_versions.find(c=>c.version===v.content_version)?.note||'';
   const previous=data.revisions[i-1],oldNote=data.content_versions.find(c=>c.version===previous?.content_version)?.note||'';
   return {...v,content_note:note,changes:[...previewChanges(previous?.calculation_snapshot,v.calculation_snapshot),...(previous&&oldNote!==note?[{field:'correction_note',before:oldNote,after:note}]:[])]};
  });
  const {source,...review}=data;
  const assignmentCandidates=(source?.assignments||[]).filter(a=>a.group_code===data.run.group_code&&a.department===data.run.department&&a.effective_from<=data.row.period_from&&(!a.effective_to||data.row.period_to<=a.effective_to)).map(a=>({id:a.id,group_code:a.group_code,effective_from:a.effective_from,effective_to:a.effective_to}));
  return res.json({success:true,review:{...review,revisions,assignment_candidates:assignmentCandidates,current_preview:current,source_stale:data.row.status==='LOCKED'?false:current?!!latest&&latest.source_fingerprint!==current.source_fingerprint:null,changes_since_saved:current?previewChanges(latest,current):[],available_actions:availableActions({...data.row,employee_self:data.employee_self},req.user.role,req.user.id,['SNP Factory','Fabric Factory'].includes(data.run.department)).filter(action=>current||!['calculate','submit','forward','approve_lock'].includes(action))}});
 }catch(error){return sendError(res,error);}
}
// Both single and bulk actions call the same single-employee transactional RPC.
// No client amounts, calculation payloads or actor overrides reach this method.
async function apply(rowId,request,actorId){
 const {action,expected_version,expected_review_version,...data}=request;
 if(['calculate','approve_lock'].includes(action)){
  const fetched=await supabase.rpc('get_payroll_review_sources',{p_row_id:rowId,p_actor_id:actorId});
  if(fetched.error)return {error:fetched.error};
  data.source=fetched.data;data.calculation=calculatePreview(fetched.data);
 }
 return supabase.rpc('transition_payroll_employee_review',{p_row_id:rowId,p_expected_version:expected_version,p_expected_review_version:expected_review_version,p_action:action,p_data:data,p_actor_id:actorId});
}
async function act(req,res){
 try{
  const {data,error}=await apply(req.params.rowId,req.body,req.user.id);
  if(error)return sendError(res,error);
  return res.status(data.applied?200:422).json({success:data.applied,result:data});
 }catch(error){return sendError(res,error);}
}
async function bulk(req,res){
 const results=[];
 for(const item of req.body.actions){
  try{
   const {data,error}=await apply(item.row_id,item.request,req.user.id);
   // Preserve per-row transaction boundaries; an error must not roll back peers.
   if(error){const mapped={statusCode:500,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};sendError(mapped,error);results.push({row_id:item.row_id,action:item.request.action,success:false,status:mapped.statusCode,error:mapped.body});}
   else results.push({row_id:item.row_id,action:item.request.action,success:data.applied,status:data.applied?200:422,result:data});
  }catch(error){console.error('Payroll employee batch action failed:',error.code);results.push({row_id:item.row_id,action:item.request.action,success:false,status:500,error:{code:'PAYROLL_REVIEW_FAILED',message:'Employee review failed.'}});}
 }
 return res.json({success:results.every(r=>r.success),results,financial_finalization_enabled:false});
}
async function generateSheet(runId,actorId){
 const populated=await supabase.rpc('populate_payroll_draft_run',{p_run_id:runId,p_actor_id:actorId});
 if(populated.error)return populated;
 const {rows,saved_rows,...generation}=populated.data,results=[],source_checks=[];
 for(const row of rows){
  try{
   const result=await apply(row.id,{action:'calculate',expected_version:row.current_version,expected_review_version:row.review_version,reason:'Initial automatic payroll generation'},actorId);
   if(result.error)results.push({row_id:row.id,success:false,code:result.error.code,message:result.error.message});
   else results.push({row_id:row.id,success:result.data.applied});
  }catch(error){
   console.error('Payroll generation calculation failed:',error.code);
   results.push({row_id:row.id,success:false,code:'PAYROLL_CALCULATION_FAILED',message:'Calculation failed; retry initial calculations or inspect employee details.'});
  }
 }
 for(const saved of saved_rows){
  try{
   const current=await supabase.rpc('get_payroll_review_sources',{p_row_id:saved.row_id,p_actor_id:actorId});
   if(current.error)source_checks.push({row_id:saved.row_id,status:'UNAVAILABLE',code:current.error.code,message:current.error.message});
   else source_checks.push({row_id:saved.row_id,status:calculatePreview(current.data).source_fingerprint===saved.source_fingerprint?'CURRENT':'CHANGED'});
  }catch{source_checks.push({row_id:saved.row_id,status:'UNAVAILABLE',message:'Unable to check current salary sources.'});}
 }
 return {data:{...generation,results,source_checks}};
}
async function generate(req,res){
 try{
  const result=await generateSheet(req.params.runId,req.user.id);
  if(result.error)return sendError(res,result.error);
  return res.set('Cache-Control','no-store').json({success:true,generation:result.data});
 }catch(error){return sendError(res,error);}
}
async function generateNew(req,res){
 try{
  const {group_code,department,period_from,period_to,cycle}=req.body;
  const created=await supabase.rpc('create_payroll_draft_run',{p_group_code:group_code,p_department:department,p_from:period_from,p_to:period_to,p_cycle:cycle,p_actor_id:req.user.id});
  if(created.error)return sendError(res,created.error);
  // Returning the created sheet on population failure lets the UI retry this
  // sheet instead of creating another run and losing the recovery path.
  let generation;
  try{
   const result=await generateSheet(created.data.id,req.user.id);
   generation=result.error?{issues:[{code:result.error.code,message:result.error.message}],results:[],added:0,retained:0}:result.data;
  }catch{generation={issues:[{code:'PAYROLL_GENERATION_FAILED',message:'Sheet created; retry population on this sheet.'}],results:[],added:0,retained:0};}
  return res.set('Cache-Control','no-store').status(201).json({success:true,run:created.data,generation});
 }catch(error){return sendError(res,error);}
}
async function cancelRun(req,res){
 try{
  const {data,error}=await supabase.rpc('cancel_payroll_draft_run',{p_run_id:req.params.runId,p_reason:req.body.reason,p_actor_id:req.user.id});
  if(error)return sendError(res,error);
  return res.set('Cache-Control','no-store').json({success:true,result:data});
 }catch(error){return sendError(res,error);}
}
module.exports={queue,freshness,autoRecalculate,detail,act,bulk,generate,generateNew,cancelRun};
