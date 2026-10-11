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
async function detail(req,res){
 try{
  const {data,error}=await supabase.rpc('get_payroll_employee_review',{p_row_id:req.params.rowId,p_actor_id:req.user.id});
  if(error)return sendError(res,error);
  const current=data.source?calculatePreview(data.source):null,latest=data.revisions.at(-1)?.calculation_snapshot||null;
  const revisions=data.revisions.map((v,i)=>{
   const note=data.content_versions.find(c=>c.version===v.content_version)?.note||'';
   const previous=data.revisions[i-1],oldNote=data.content_versions.find(c=>c.version===previous?.content_version)?.note||'';
   return {...v,content_note:note,changes:[...previewChanges(previous?.calculation_snapshot,v.calculation_snapshot),...(previous&&oldNote!==note?[{field:'correction_note',before:oldNote,after:note}]:[])]};
  });
  const {source,...review}=data;
  const assignmentCandidates=(source?.assignments||[]).filter(a=>a.group_code===data.run.group_code&&a.department===data.run.department&&a.effective_from<=data.row.period_from&&(!a.effective_to||data.row.period_to<=a.effective_to)).map(a=>({id:a.id,group_code:a.group_code,effective_from:a.effective_from,effective_to:a.effective_to}));
  return res.json({success:true,review:{...review,revisions,assignment_candidates:assignmentCandidates,current_preview:current,source_stale:current?!!latest&&latest.source_fingerprint!==current.source_fingerprint:null,changes_since_saved:current?previewChanges(latest,current):[],available_actions:availableActions({...data.row,employee_self:data.employee_self},req.user.role,req.user.id,['SNP Factory','Fabric Factory'].includes(data.run.department)).filter(action=>current||!['calculate','submit','forward','approve_lock'].includes(action))}});
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
module.exports={queue,detail,act,bulk};
