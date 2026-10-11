const {supabase}=require('../db/supabase');
const {sendError}=require('./payroll.controller');
const {excelReport,printableSummary}=require('../domain/payroll/reports');
const MAX_EXPORT_ROWS=10000;
const fetchRegister=(actor,filters,page,limit)=>supabase.rpc('get_payroll_salary_register',{p_actor_id:actor,p_filters:filters,p_page:page,p_limit:limit});
async function register(req,res){
 try{
  const {page,limit,...filters}=req.query;
  const {data,error}=await fetchRegister(req.user.id,filters,page,limit);if(error)return sendError(res,error);
  res.set('Cache-Control','no-store');return res.json({success:true,register:data});
 }catch(error){return sendError(res,error);}
}
async function exportReport(req,res){
 try{
  const {format,report,...filters}=req.query;
  // One authoritative read supplies rows AND matching summaries; no page drift.
  const {data,error}=await fetchRegister(req.user.id,filters,1,MAX_EXPORT_ROWS);if(error)return sendError(res,error);
  if(data.total>MAX_EXPORT_ROWS)return res.status(413).json({success:false,code:'PAYROLL_EXPORT_TOO_LARGE',message:'More than 10,000 employee rows match. Narrow the period or department; no partial export was generated.'});
  const buffer=format==='html'?printableSummary(data):await excelReport(data,report);
  res.set('Cache-Control','no-store');res.set('Content-Disposition',`attachment; filename="payroll-${report}-diagnostic.${format}"`);
  res.type(format==='html'?'text/html':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return res.send(buffer);
 }catch(error){if(error.code==='PAYROLL_EXPORT_DETAILS_TOO_LARGE')return res.status(413).json({success:false,code:error.code,message:error.message});return sendError(res,error);}
}
async function payslip(req,res){
 try{
  // The existing detail RPC authorizes both current AND historical scopes.
  const {data,error}=await supabase.rpc('get_payroll_employee_review',{p_actor_id:req.user.id,p_row_id:req.params.rowId});if(error)return sendError(res,error);
  if(req.query.mode==='official')return res.status(409).json({success:false,code:'OFFICIAL_PAYSLIP_UNAVAILABLE',message:'Official payslips require an immutable Locked financial snapshot. Final locking and financial snapshots are not enabled.'});
  const saved=data.revisions.at(-1);
  if(data.row.status==='LOCKED'||data.row.status==='CANCELLED_DRAFT'||!saved||saved.content_version!==data.row.current_version)return res.status(409).json({success:false,code:'DIAGNOSTIC_PAYSLIP_UNAVAILABLE',message:'Save a calculation revision for the current employee content before creating a diagnostic payslip.'});
  res.set('Cache-Control','no-store');return res.json({success:true,payslip:{kind:'DIAGNOSTIC',watermark:'DIAGNOSTIC PREVIEW — NOT AN OFFICIAL PAYSLIP',row_id:data.row.id,review_status:data.row.status,payment_status:'NOT_ELIGIBLE',revision:saved.revision,content_version:saved.content_version,generated_at:new Date().toISOString(),source_freshness:'NOT_REVALIDATED',source_error:data.source_error,department:data.run.department,group_code:data.run.group_code,cycle:data.run.cycle,calculation:saved.calculation_snapshot,official:false}});
 }catch(error){return sendError(res,error);}
}
module.exports={register,exportReport,payslip};
