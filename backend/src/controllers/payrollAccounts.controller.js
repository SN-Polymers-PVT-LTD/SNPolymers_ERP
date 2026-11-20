const {supabase}=require('../db/supabase');
const {sendError}=require('./payroll.controller');
const {calculatePreview}=require('../domain/payroll/preview');
const rpc=(name,params,key)=>async(req,res)=>{
 try{
  const {data,error}=await supabase.rpc(name,{...params(req),p_actor_id:req.user.id});
  if(error)return sendError(res,error);
  return res.set('Cache-Control','no-store').json({success:true,[key]:data});
 }catch(error){return sendError(res,error);}
};
module.exports={
 cutover:rpc('get_payroll_accounts_cutover',r=>({p_page:r.query.page,p_limit:r.query.limit}),'preview'),
 async convert(req,res){
  const results=[];
  for(const row of req.body.rows){
   try{
    const {data,error}=await supabase.rpc('deliver_payroll_to_accounts',{p_row_id:row.row_id,p_expected_version:row.expected_version,p_expected_review_version:row.expected_review_version,p_fingerprint:row.source_fingerprint,p_migrate:true,p_actor_id:req.user.id});
    if(error){const mapped={statusCode:500,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};sendError(mapped,error);results.push({row_id:row.row_id,success:false,error:mapped.body});}
    else results.push({row_id:row.row_id,success:true,result:data});
   }catch(error){results.push({row_id:row.row_id,success:false,error:{message:error.message}});}
  }
  return res.json({success:results.every(r=>r.success),results});
 },
 sheet:rpc('get_payroll_accounts_sheet',r=>({p_sheet_id:r.params.sheetId,p_page:r.query.page||1,p_limit:r.query.limit||20}),'payroll'),
 submit:rpc('submit_payroll_accounts_sheet',r=>({p_sheet_id:r.params.sheetId}),'result'),
 payment:rpc('save_payroll_payment_details',r=>({p_delivery_id:r.params.deliveryId,p_expected_version:r.body.expected_version,p_bank:r.body.bank,p_mode:r.body.mode,p_beneficiary_id:r.body.beneficiary_id,p_cheque_no:r.body.cheque_no||null,p_cheque_date:r.body.cheque_date||null}),'result'),
 resubmit:rpc('resubmit_payroll_payment',r=>({p_delivery_id:r.params.deliveryId,p_expected_version:r.body.expected_version}),'result'),
 confirm:rpc('confirm_payroll_payment',r=>({p_delivery_id:r.params.deliveryId,p_paid_on:r.body.paid_on,p_reference:r.body.reference}),'payment'),
 async action(req,res){
  try{
   let source=null,calculation=null;
   if(req.body.action==='Approve'){
    // Only server-derived sources and decimal calculations reach the finalizer.
    const link=await supabase.from('payroll_accounts_deliveries').select('row_id').eq('id',req.params.deliveryId).maybeSingle();
    if(link.error)return sendError(res,link.error);
    if(!link.data)return res.status(404).json({success:false,message:'Salary delivery not found.'});
    const fetched=await supabase.rpc('get_payroll_review_sources',{p_row_id:link.data.row_id,p_actor_id:req.user.id});
    if(fetched.error)return sendError(res,fetched.error);
    source=fetched.data;calculation=calculatePreview(source);
   }
   const {data,error}=await supabase.rpc('act_payroll_accounts_item',{p_delivery_id:req.params.deliveryId,p_expected_version:req.body.expected_version,p_action:req.body.action,p_reason:req.body.reason||null,p_source:source,p_calculation:calculation,p_actor_id:req.user.id});
   if(error)return sendError(res,error);
   return res.json({success:true,result:data});
  }catch(error){return sendError(res,error);}
 }
};
