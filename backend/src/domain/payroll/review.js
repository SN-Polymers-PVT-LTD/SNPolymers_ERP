// Workflow presentation only. PostgreSQL is authoritative for all transitions.
const statuses=['DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED'];
function availableActions(row,role,actorId,isFactory){
 if(['LOCKED','CANCELLED_DRAFT'].includes(row.status))return [];
 const owner=row.created_by===actorId,preparer=owner&&role===(isFactory?'factory_manager':'accounts');
 if(preparer&&['DRAFT','CALCULATED','RETURNED_TO_CREATOR'].includes(row.status))return ['calculate','correct','cancel',...(row.status==='CALCULATED'?['submit']:[])];
 if(row.employee_self===true)return [];
 if(role==='accounts'&&row.status==='PENDING_ACCOUNTS_REVIEW'&&!owner&&row.submitted_by!==actorId)return ['forward','return'];
 if(['ho','admin'].includes(role)&&row.status==='PENDING_HO_APPROVAL'&&!owner&&row.submitted_by!==actorId&&row.accounts_verified_by!==actorId)return ['approve_lock','return'];
 return [];
}
function previewChanges(previous,next){
 if(!previous)return [];
 const fields=['period_from','period_to','earnings','deductions','gross_after_lop','final_net_salary','statutory','enrolment','monthly_reconciliation','source_references','configuration_warnings','blockers'];
 return fields.filter(field=>JSON.stringify(previous[field])!==JSON.stringify(next[field])).map(field=>({field,before:previous[field]??null,after:next[field]??null}));
}
module.exports={statuses,availableActions,previewChanges};
