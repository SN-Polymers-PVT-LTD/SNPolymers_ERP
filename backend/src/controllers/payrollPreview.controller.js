const {supabase}=require('../db/supabase');
const {sendError}=require('./payroll.controller');
const {calculatePreview}=require('../domain/payroll/preview');
async function preview(req,res){
 try {
  const {data,error}=await supabase.rpc('get_payroll_preview_sources',{p_row_id:req.params.rowId,p_actor_id:req.user.id});
  if(error)return sendError(res,error);
  const result=calculatePreview(data);
  if(req.body.expected_source_fingerprint&&req.body.expected_source_fingerprint!==result.source_fingerprint)return res.status(409).json({success:false,code:'STALE_PAYROLL_PREVIEW',message:'Payroll sources changed. Generate and review a fresh preview.'});
  return res.json({success:true,preview:result});
 }catch(error){return sendError(res,error);}
}
async function list(req,res){try{const {data,error}=await supabase.rpc('list_payroll_preview_runs',{p_actor_id:req.user.id,p_page:req.query.page,p_limit:req.query.limit});if(error)return sendError(res,error);return res.json({success:true,selection:data});}catch(error){return sendError(res,error);}}
module.exports={preview,list};
