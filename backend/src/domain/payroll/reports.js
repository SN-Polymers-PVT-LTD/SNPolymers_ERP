const ExcelJS=require('exceljs');
const NOTICE='Saved diagnostic evidence — not approved liability or payment instruction. Sources have not been revalidated. Overlapping drafts may duplicate entitlement. Date filters include whole overlapping salary rows; amounts are not prorated. Unresolved amounts are unavailable, never zero.';
// Excel cells are explicitly strings (including money), so large decimal values
// retain their exact digits. Prefix hostile text for compatibility with CSV copy.
const safeCell=value=>value==null?'Unavailable':/^[\s\u0000-\u001f]*[=+\-@]/.test(String(value))?"'"+String(value):String(value);
const escapeHtml=value=>String(value??'Unavailable').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const columns=[['Employee Code','employee_code'],['Employee Name','employee_name'],['Staff Category','employee_category'],['Department','department'],['Payroll Group','group_code'],['From','period_from'],['To','period_to'],['Cycle','cycle'],['Known Earnings (INR)','earnings_total'],['LOP / Without Pay (INR)','lop'],['Gross after LOP (INR)','gross_after_lop'],['EPF Employee (INR)','epf'],['ESI Employee (INR)','esi'],['Professional Tax (INR)','pt'],['Net Salary (INR)','net_salary'],['Review Status','status'],['Payment Status','payment_status'],['Evidence Status','evidence_status'],['Return Reason','last_return_reason'],['Run ID','run_id'],['Row ID','id'],['Content Version','current_version'],['Calculation Revision','revision'],['Calculated At','calculated_at'],['Source Fingerprint','source_fingerprint'],['Source Freshness','source_freshness']];
const summaryColumns=[['Department','department'],['Review Status','status'],['Employee Rows','row_count'],['Rows with Known Gross','gross_known_rows'],['Known Gross Subtotal (INR)','known_gross_total'],['Complete Gross Total (INR)','gross_total'],['Known LOP Subtotal (INR)','known_lop_total']];
function addSheet(workbook,name,headings,rows){
 const sheet=workbook.addWorksheet(name);sheet.addRow([NOTICE]);sheet.addRow(headings);sheet.getRow(2).font={bold:true};sheet.views=[{state:'frozen',ySplit:2}];
 for(const row of rows)sheet.addRow(row.map(safeCell));
 sheet.columns.forEach(c=>{c.width=24;c.numFmt='@';});
 if(rows.length)sheet.autoFilter={from:{row:2,column:1},to:{row:rows.length+2,column:headings.length}};
 return sheet;
}
async function excelReport(report,kind='register'){
 const componentRows=report.rows.reduce((count,r)=>count+r.earnings.length+r.deductions.length+r.monthly_reconciliation.reduce((n,m)=>n+(m.contract_diagnostics||[]).reduce((sum,c)=>sum+Object.keys(c.components).length,0),0),0);
 if(kind==='register'&&componentRows>100000){const error=new Error('More than 100,000 component lines match. Narrow the report period or department; no partial export was generated.');error.code='PAYROLL_EXPORT_DETAILS_TOO_LARGE';throw error;}
 const workbook=new ExcelJS.Workbook();workbook.creator='SN Polymers ERP';
 const metadata=workbook.addWorksheet('Report Information');
 for(const row of [['S. N. POLYMERS PVT. LTD.','Payroll saved salary register'],['Status',NOTICE],['Generated At',report.generated_at],['Filters',JSON.stringify(report.filters)],['Amount Basis',report.amount_basis],['Matching employee rows',report.total],['Official payslips','Disabled'],['Currency','INR; exact decimal strings']])metadata.addRow(row.map(safeCell));metadata.columns=[{width:28},{width:110}];
 if(kind==='register'){
  addSheet(workbook,'Salary Register',['SL. NO',...columns.map(c=>c[0])],report.rows.map((r,i)=>[i+1,...columns.map(c=>r[c[1]])]));
  const lines=[],references=[];
  for(const r of report.rows){
   for(const kind of ['earnings','deductions'])for(const line of r[kind])lines.push([r.id,r.employee_code,r.department,r.period_from,r.period_to,r.revision,kind,line.code,line.date||line.salary_month,line.amount,JSON.stringify(line.contract_components||{}),JSON.stringify(line.source_ids||[])]);
   for(const month of r.monthly_reconciliation)for(const contract of month.contract_diagnostics||[])for(const [code,value] of Object.entries(contract.components))
    lines.push([r.id,r.employee_code,r.department,r.period_from,r.period_to,r.revision,'CONTRACT_EVIDENCE_NOT_ADDITIONAL_EARNINGS',code,month.salary_month,value,JSON.stringify({pay_basis:contract.pay_basis,agreed_amount:contract.agreed_amount}),JSON.stringify([contract.pay_structure_id])]);
   for(const field of ['source_references','monthly_reconciliation','blockers']){
    const text=JSON.stringify(r[field]??null);
    for(let offset=0;offset<text.length;offset+=30000)references.push([r.id,field,Math.floor(offset/30000)+1,text.slice(offset,offset+30000)]);
   }
  }
  addSheet(workbook,'Salary Components',['Row ID','Employee Code','Department','From','To','Revision','Line Type','Component','Date / Month','Amount (INR)','Contract components (evidence only)','Source IDs'],lines);
  addSheet(workbook,'Source Evidence',['Row ID','Evidence type','Part','Evidence text (ordered parts)'],references);
 }
 addSheet(workbook,'Department Summary',summaryColumns.map(c=>c[0]),report.summaries.map(r=>summaryColumns.map(c=>r[c[1]])));
 return workbook.xlsx.writeBuffer();
}
function printableSummary(report){
 const table=(cols,rows)=>`<table><thead><tr>${cols.map(c=>`<th>${escapeHtml(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${escapeHtml(r[c[1]])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SN Polymers payroll diagnostic summary</title><style>body{font:12px sans-serif}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #777;padding:5px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}@page{size:landscape;margin:12mm}</style></head><body><h1>S. N. POLYMERS PVT. LTD.</h1><h2>Payroll diagnostic summary</h2><p>${escapeHtml(NOTICE)}</p><p>Generated: ${escapeHtml(report.generated_at)} · Matching employee rows: ${report.total}</p><p>Filters: ${escapeHtml(JSON.stringify(report.filters))}</p>${table(summaryColumns,report.summaries)}${table(columns.filter(c=>['employee_name','department','period_from','period_to','gross_after_lop','lop','net_salary','status','payment_status','evidence_status'].includes(c[1])),report.rows)}<p>Print using your browser. Official payslips and financial finalization remain disabled.</p></body></html>`;
}
module.exports={NOTICE,safeCell,escapeHtml,excelReport,printableSummary};
