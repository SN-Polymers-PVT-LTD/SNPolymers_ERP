import React, {useState} from 'react';
import {Link} from 'react-router-dom';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '../AuthContext';
import {Button,Input,Select,TextArea,Modal,Badge,Pagination,Table,TableHeader,TableBody,TableRow,TableCell} from '../ui';
import {getBankBalances} from '../../api/acctRequisitionsApi';
import {getPayrollAccountsSheet,getFullPayrollAccountsSheet,submitPayrollAccountsSheet,saveSalaryPaymentDetails,actOnSalary,resubmitSalaryPayment,recordSalaryPayment} from '../../api/payrollAccountsApi';
import BankBalanceBanner from '../acctRequisition/BankBalanceBanner';
import BulkNeftExportButton from '../acctRequisition/BulkNeftExportButton';
import ExportCsvStatusModal from '../acctRequisition/ExportCsvStatusModal';
import {buildSheetCsv} from '../../utils/acctSheetCsv';
import SalaryPreview from './SalaryPreview';
import BeneficiaryDetails from '../acctRequisition/BeneficiaryDetails';
import PayrollBeneficiaryField from './PayrollBeneficiaryField';
import {formatINR,payrollGroupName} from '../../utils/payrollDisplay';

const labels={WITH_ACCOUNTS:'With Accounts',WITH_HO:'With HO',RETURNED:'Returned to preparer',PAYMENT_RETURN:'Payment details returned',HOLD:'On hold',APPROVED:'Approved'};
const selectionKey=row=>`${row.delivery_id}:${row.delivery_version}`;
const errorText=e=>e?.response?.data?.message||e.message;
const positive=row=>!/^0(?:\.0+)?$/.test(String(row.salary.final_net_salary));
const csvStatus=row=>row.payment?'Paid':labels[row.disposition]||row.disposition;
const csvColumns=[
 ['Sheet Number',(_,sheet)=>sheet.sheet_number],
 ['Employee Code',row=>row.employee_code],
 ['Employee Name',row=>row.employee_name],
 ['Period From',row=>row.period_from],
 ['Period To',row=>row.period_to],
 ['Beneficiary Name',row=>row.beneficiary_name],
 ['Beneficiary A/C No',row=>row.beneficiary_ac_no],
 ['Beneficiary IFSC',row=>row.beneficiary_ifsc],
 ['Beneficiary Bank',row=>row.beneficiary_bank_name],
 ['Debit Bank',row=>row.debit_bank_ac_type],
 ['Take-home Pay',row=>row.salary.final_net_salary],
 ['Payment Mode',row=>row.payment_mode],
 ['Cheque No',row=>row.cheque_no],
 ['Cheque Date',row=>row.cheque_date],
 ['Remarks',row=>row.remarks],
 ['Status',csvStatus],
 ['Paid On',row=>row.payment?.paid_on],
 ['Bank Reference',row=>row.payment?.reference],
];

const cents = value => {
 const match = String(value ?? '').match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
 if (!match) return null;
 return (match[1] ? -1n : 1n) * (BigInt(match[2])*100n+BigInt((match[3]||'').padEnd(2,'0')));
};
const decimal = value => {
 const digits = String(value < 0n ? -value : value).padStart(3,'0');
 return `${value < 0n ? '-' : ''}${digits.slice(0,-2)}.${digits.slice(-2)}`;
};

export default function PayrollAccountsSheet({sheetId,ho=false}){
 const {user}=useAuth(),client=useQueryClient();
 const accounts=!ho&&['accounts','admin'].includes(user?.role);
 const [page,setPage]=useState(1),[selected,setSelected]=useState([]),[dialog,setDialog]=useState(null),[notice,setNotice]=useState('');
 const [form,setForm]=useState({}),[drafts,setDrafts]=useState({}),[failures,setFailures]=useState([]);
 const [csvOpen,setCsvOpen]=useState(false);
 const query=useQuery({queryKey:['payroll-accounts-sheet',user?.id,sheetId,page],queryFn:async()=>(await getPayrollAccountsSheet(sheetId,{page,limit:20})).data.payroll});
 const needsAllRows=accounts&&query.data?.total>query.data?.rows.length;
 const allRows=useQuery({
  queryKey:['payroll-accounts-sheet',user?.id,sheetId,'export'],
  queryFn:()=>getFullPayrollAccountsSheet(sheetId),
  enabled:needsAllRows,
 });
 const csvExport=useMutation({mutationFn:async status=>{
  const {sheet,rows}=await getFullPayrollAccountsSheet(sheetId);
  const items=status==='All'?rows:rows.filter(row=>csvStatus(row)===status);
  const blob=new Blob([buildSheetCsv(sheet,items,csvColumns)],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;
  link.download=`${sheet.sheet_number}${status==='All'?'':`-${status.replace(/\s+/g,'-')}`}.csv`;
  link.click();
  URL.revokeObjectURL(url);
 }});
 const banks=useQuery({queryKey:['acctBankBalances'],queryFn:async()=>(await getBankBalances()).data.bankBalances||[]});
 const refresh=()=>{
  return Promise.all(['payroll-accounts-sheet','acctSheet','acctSheets','acctHoSheets','acctHoQueue','acctBankBalances','payroll-review-queue','payroll-employee-review','salary-register','payroll-sheet-register','payroll-sheet-freshness'].map(key=>client.invalidateQueries({queryKey:[key]})));
 };
 const mutation=useMutation({mutationFn:async input=>{
  const task=typeof input==='string'?input:input.kind;
  if(task==='send'){await submitPayrollAccountsSheet(sheetId);return {message:'Salary sheet sent to HO.'};}
  if(task==='draft'){
   const errors=[],savedPaymentKeys=[];
   for(const [key,draft] of Object.entries(drafts)){
    try {
     const {row,payment}=draft;
     await saveSalaryPaymentDetails(row.delivery_id,{expected_version:row.delivery_version,
      bank:payment.bank||null,mode:payment.mode||null,beneficiary_id:payment.beneficiary.value||null,
      cheque_no:payment.mode==='Cheque'?payment.cheque_no||null:null,
      cheque_date:payment.mode==='Cheque'?payment.cheque_date||null:null});
     savedPaymentKeys.push(key);
    } catch(e){errors.push(`${draft.row.employee_name}: ${errorText(e)}`);}
   }
   return {message:`Draft saved for ${savedPaymentKeys.length} employees.`,errors,savedPaymentKeys};
  }
  const chosen=task==='approve'?rows.filter(r=>selected.includes(selectionKey(r))):[input.row||dialog?.row];
  if(task==='defaults'){
   const targets=rows.filter(r=>r.active&&['WITH_ACCOUNTS','PAYMENT_RETURN'].includes(r.disposition)&&positive(r)&&r.beneficiary_id&&(!r.debit_bank_ac_type||!r.payment_mode));
   const errors=[];
   for(const r of targets)try{await saveSalaryPaymentDetails(r.delivery_id,{expected_version:r.delivery_version,bank:r.debit_bank_ac_type||form.bank,mode:r.payment_mode||form.mode,beneficiary_id:r.beneficiary_id,cheque_no:r.cheque_no||null,cheque_date:r.cheque_date||null});}catch(e){errors.push(`${r.employee_name}: ${errorText(e)}`);}
   return {message:`Payment defaults applied to ${targets.length-errors.length} employees.`,errors};
  }
  const errors=[];
  for(const row of chosen)try{
   if(task==='payment'){
    const {bank,mode,beneficiary,cheque_no,cheque_date}=input.payment;
    await saveSalaryPaymentDetails(row.delivery_id,{expected_version:row.delivery_version,bank,mode,beneficiary_id:beneficiary.value,cheque_no:mode==='Cheque'?cheque_no:null,cheque_date:mode==='Cheque'?cheque_date:null});
   }
   else if(task==='resubmit')await resubmitSalaryPayment(row.delivery_id,row.delivery_version);
   else if(task==='paid')await recordSalaryPayment(row.delivery_id,{paid_on:form.paid_on,reference:form.reference});
   else await actOnSalary(row.delivery_id,{expected_version:row.delivery_version,action:task==='approve'?'Approve':form.action, ...(form.reason?.trim()?{reason:form.reason.trim()}:{})});
  }catch(e){errors.push(`${row.employee_name}: ${errorText(e)}`);}
  return {message:errors.length?'Some salaries need attention.':'Changes saved.',errors,savedPaymentKeys:task==='payment'&&!errors.length?[selectionKey(input.row)]:[]};
 },onSuccess:async result=>{setNotice(result.message);setFailures(result.errors||[]);if(!result.errors?.length){setDialog(null);setSelected([]);}await refresh();if(result.savedPaymentKeys?.length)setDrafts(current=>Object.fromEntries(Object.entries(current).filter(([key])=>!result.savedPaymentKeys.includes(key))));},onError:refresh});
 const rows=query.data?.rows||[],busy=mutation.isPending;
 const open=(kind,row)=>{mutation.reset();setFailures([]);setDialog({kind,row});setForm(kind==='defaults'?{bank:'',mode:'NEFT'}:kind==='paid'?{paid_on:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),reference:''}:{action:'ReturnSalary',reason:''});};
 if(query.isPending)return <p role="status">Loading salary sheet…</p>;
 if(query.isError)return <div role="alert">{errorText(query.error)} <Button onClick={()=>query.refetch()}>Retry salary sheet</Button></div>;
 const {sheet,run}=query.data;
 const finalizationDisabled=query.data.financial_finalization_enabled===false;
 const eligible=rows.filter(r=>r.active&&['WITH_HO','HOLD'].includes(r.disposition)&&!r.source_stale&&r.independent_reviewer!==false&&r.payment_details_current!==false);
 const neft=(needsAllRows?(allRows.isError?[]:allRows.data?.rows||[]):rows)
  .filter(r=>r.active&&r.disposition==='APPROVED'&&!r.payment&&positive(r)&&r.payment_mode==='Bulk NEFT');
 const paymentReady=r=>!positive(r)||!!(r.beneficiary_id&&r.beneficiary_ac_no&&r.debit_bank_ac_type&&r.payment_mode&&(r.payment_mode!=='Cheque'||r.cheque_no&&r.cheque_date));
 const active=rows.filter(r=>r.active);
 const hasEdits=Object.keys(drafts).length>0;
 const debitBanks=(banks.data||[]).filter(bank=>!bank.is_virtual&&bank.bank_name.trim().toLowerCase()!=='credit');
 const commitments=query.data.bank_commitments;
 const hasFullSheet=page===1&&(query.data.total??rows.length)===rows.length;
 const pendingDebit=row=>row.active&&['WITH_ACCOUNTS','PAYMENT_RETURN','WITH_HO','HOLD'].includes(row.disposition);

 const bankProjection=bank=>{
  const balance=cents(bank.available_balance);
  if(balance===null||(!commitments&&!hasFullSheet))return null;
  const savedDebit=commitments ? cents(commitments[bank.bank_name]??'0') : rows
   .filter(row=>pendingDebit(row)&&row.debit_bank_ac_type===bank.bank_name)
   .reduce((total,row)=>total+(cents(row.salary.final_net_salary)??0n),0n);
  if(savedDebit===null)return null;
  let projected=balance-savedDebit;
  for(const {row,payment} of Object.values(drafts)){
   const currentRow=rows.find(item=>item.delivery_id===row.delivery_id);
   if(currentRow&&selectionKey(currentRow)!==selectionKey(row))continue;
   const amount=cents(row.salary.final_net_salary)??0n;
   if(row.debit_bank_ac_type===bank.bank_name)projected+=amount;
   if(payment.bank===bank.bank_name)projected-=amount;
  }
  return decimal(projected);
 };
 const canSend=!hasEdits&&accounts&&sheet.sheet_status==='Open'&&(query.data.summary?.active??active.length)>0&&!(query.data.summary?.payment_missing)&&active.every(r=>r.disposition==='WITH_ACCOUNTS'&&!r.source_stale&&r.independent_accounts!==false&&r.payment_details_current!==false&&paymentReady(r));
 const picked=eligible.filter(r=>selected.includes(selectionKey(r)));
 // The API already applies the page offset.
 const current=rows;
 const modalError=mutation.isError&&errorText(mutation.error);
 const fieldsReady=dialog?.kind==='defaults'?!!form.bank:dialog?.kind==='paid'?!!(form.paid_on&&form.reference?.trim()):!!form.reason?.trim();
 return <div className="w-full mx-auto space-y-6 text-slate-100">
  <header className="flex flex-wrap justify-between items-start gap-4">
   <div><p className="text-xs text-amber-400 font-bold uppercase tracking-widest">Payroll · {sheet.sheet_number}</p><h1 className="text-3xl font-bold mt-2">{run.department} salaries</h1><p className="text-sm text-slate-400 mt-2">{payrollGroupName(run.group_code)}{run.group_code?' · ':''}{run.period_from} to {run.period_to} · {query.data.total??rows.length} salary entries</p></div>
   <Link to={ho?'/acct-requisitions/ho-queue':'/acct-requisitions'}><Button variant="glass">Back to sheets</Button></Link>
  </header>
  <div className="glass-panel rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
   <p className="text-sm max-w-xl">{accounts?'Choose the beneficiary, debit bank, and payment mode on each row. Save the draft as you work, then send the completed sheet to HO.':'Approve full salaries or return them with a reason. Approval records the bank debit; Accounts records payment separately.'}</p>
   <div className="flex flex-wrap gap-3">{accounts&&sheet.sheet_status==='Open'&&<><Button variant="glass" disabled={busy||banks.isError||hasEdits} onClick={()=>open('defaults')}>Payment defaults</Button><Button variant="yellow" disabled={busy||!canSend} onClick={()=>mutation.mutate('send')}>Send to HO</Button></>}{ho&&<Button variant="yellow" disabled={busy||!picked.length||finalizationDisabled} onClick={()=>mutation.mutate('approve')}>Approve selected ({picked.length})</Button>}</div>
  </div>
  {accounts&&!!debitBanks.length&&<section aria-label="Bank balances" className="glass-panel p-5 rounded-2xl mb-8 border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02]">
   <div className="flex flex-wrap gap-4">
   {debitBanks.map(bank=><BankBalanceBanner key={bank.bank_name} bankBalance={bank} projectedBalance={bankProjection(bank)}/>)}
   </div>
   {!commitments&&!hasFullSheet&&<p className="mt-3 text-sm">Whole-sheet projections require payroll migration 198.</p>}
  </section>}
  {ho&&finalizationDisabled&&<p role="status" className="text-sm text-amber-300">Final salary approval is disabled in this environment. Returns and holds remain available.</p>}
  {accounts&&sheet.sheet_status!=='Open'&&<p className="text-sm text-slate-600 dark:text-slate-300">{rows.some(r=>r.disposition==='PAYMENT_RETURN')?'Next: correct the returned payment details below, then resend to HO.':rows.some(r=>r.disposition==='APPROVED'&&!r.payment&&positive(r))?'Next: record payment below after completing the bank transfer.':rows.some(r=>['WITH_HO','HOLD'].includes(r.disposition))?'Next: HO reviews this sheet in the Accounts approval queue.':rows.every(r=>r.disposition==='APPROVED')?'Payments on this page are recorded. View saved results in the Payroll Register.':'Returned salaries are corrected from Payroll. Their earlier records stay available here.'} <Link className="underline" to="/hr/payroll/register">Open Payroll Register</Link></p>}
  {notice&&<p role="status" className="text-sm text-emerald-300">{notice}</p>}
  {(mutation.isError||!!failures.length)&&<div role="alert" className="p-4 rounded-xl border border-red-500/30 text-red-300 space-y-2">{mutation.isError&&errorText(mutation.error)}{failures.map(f=><p key={f}>{f}</p>)}</div>}
  {hasEdits&&<div className="flex flex-wrap items-center gap-3 text-sm"><span>Save edited rows before sending to HO.</span><Button variant="glass" size="sm" disabled={busy} onClick={()=>setDrafts({})}>Discard unsaved payment edits</Button></div>}
  {accounts&&banks.isError&&<p role="alert">Could not load debit banks. <Button onClick={()=>banks.refetch()}>Retry banks</Button></p>}
  {accounts&&sheet.sheet_status==='Open'&&!canSend&&!hasEdits&&<p className="text-sm text-amber-300">Complete missing payment details. Return any salary marked “Needs update” to its preparer.</p>}
  <div className="glass-panel rounded-2xl overflow-hidden"><div className="overflow-x-auto"><Table className="min-w-[1200px]"><TableHeader><TableRow hover={false}>
   {ho&&<TableCell isHeader><input aria-label="Select all salaries ready for approval on this page" type="checkbox" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(r=>selected.includes(selectionKey(r)))} onChange={e=>setSelected(e.target.checked?eligible.map(selectionKey):[])}/></TableCell>}
   {['Employee','Beneficiary','Debit bank','Take-home pay','Payment mode','Remarks','Status','Actions'].map(x=><TableCell key={x} isHeader>{x}</TableCell>)}
  </TableRow></TableHeader><TableBody>{current.map(row=>{
   const key=selectionKey(row);
   const editable=accounts&&row.active&&positive(row)&&['WITH_ACCOUNTS','PAYMENT_RETURN'].includes(row.disposition);
   const savedPayment={
    bank:row.debit_bank_ac_type||'',mode:row.payment_mode||'',cheque_no:row.cheque_no||'',cheque_date:row.cheque_date||'',
    beneficiary:{value:row.beneficiary_id||'',details:{
     name:row.beneficiary_name,account:row.beneficiary_ac_no,
     ifsc:row.beneficiary_ifsc,bank:row.beneficiary_bank_name,
    }},
   };
   const payment=drafts[key]?.payment||savedPayment;
   const change=patch=>setDrafts(current=>({...current,[key]:{row,payment:{...(current[key]?.payment||savedPayment),...patch}}}));
   const paymentComplete=payment.bank&&payment.mode&&payment.beneficiary.value&&(payment.mode!=='Cheque'||payment.cheque_no&&payment.cheque_date);
   return <TableRow key={key}>
   {ho&&<TableCell><input aria-label={`Select ${row.employee_name}`} type="checkbox" disabled={busy||!eligible.includes(row)} checked={selected.includes(selectionKey(row))} onChange={e=>setSelected(ids=>e.target.checked?[...ids,selectionKey(row)]:ids.filter(id=>id!==selectionKey(row)))}/></TableCell>}
   <TableCell><div className="font-semibold">{row.employee_name}</div><div className="text-xs text-slate-400 mt-1">{row.employee_code}</div><div className="text-xs mt-1">{row.period_from} to {row.period_to}</div></TableCell>
   <TableCell className="min-w-56">{editable?<PayrollBeneficiaryField row={row} selection={payment.beneficiary} onSelect={beneficiary=>change({beneficiary})} disabled={busy}/>:!positive(row)?'No payout required':<BeneficiaryDetails {...savedPayment.beneficiary.details} name={row.beneficiary_name||'Beneficiary needed'}/>}</TableCell>
   <TableCell className="min-w-52">{editable?<Select aria-label={`Debit bank for ${row.employee_name}`} size="md" className="pr-10" value={payment.bank} disabled={busy||banks.isPending||banks.isError} onChange={e=>change({bank:e.target.value})} options={[
    {value:'',label:'Choose debit bank'},
    ...Array.from(new Set([payment.bank,...debitBanks.map(bank=>bank.bank_name)].filter(Boolean))).map(bank=>({value:bank,label:bank})),
   ]}/>:positive(row)?row.debit_bank_ac_type||'Choose debit bank':'—'}</TableCell>
   <TableCell><span className="font-semibold whitespace-nowrap">{formatINR(row.salary.final_net_salary)}</span></TableCell>
   <TableCell className="min-w-44">{editable?<div className="space-y-2">
    <Select aria-label={`Payment mode for ${row.employee_name}`} size="md" className="pr-10" value={payment.mode} disabled={busy} onChange={e=>change({mode:e.target.value})} options={[{value:'',label:'Choose mode'},...['NEFT','Bulk NEFT','RTGS','Cheque'].map(mode=>({value:mode,label:mode}))]}/>
    {payment.mode==='Cheque'&&<>
     <Input label={`Cheque number for ${row.employee_name}`} size="sm" value={payment.cheque_no} disabled={busy} onChange={e=>change({cheque_no:e.target.value})}/>
     <Input label={`Cheque date for ${row.employee_name}`} size="sm" type="date" value={payment.cheque_date} disabled={busy} onChange={e=>change({cheque_date:e.target.value})}/>
    </>}
   </div>:positive(row)?row.payment_mode||'Choose mode':'—'}</TableCell>
   <TableCell className="min-w-24">{row.ho_remarks||'—'}</TableCell>
   <TableCell><Badge variant={row.disposition==='APPROVED'?'emerald':row.disposition==='RETURNED'?'rose':'amber'}>{labels[row.disposition]}</Badge>{row.source_stale&&row.active&&<p className="mt-2 text-amber-300 text-xs">Needs update — salary inputs changed</p>}{ho&&row.independent_reviewer===false&&<p className="mt-2 text-xs text-amber-300">Independent reviewer required</p>}{accounts&&row.independent_accounts===false&&<p className="mt-2 text-xs text-amber-300">Another Accounts user must send this salary</p>}{row.active&&row.disposition!=='APPROVED'&&row.payment_details_current===false&&<p className="mt-2 text-xs text-amber-300">Payment details need checking</p>}{row.disposition==='APPROVED'&&<p className="mt-2 text-xs">{!positive(row)?'No payment required':row.payment?`Paid on ${row.payment.paid_on} · ${row.payment.reference}`:'Payment not recorded'}</p>}</TableCell>
   <TableCell className="w-28"><div className="grid w-24 gap-1.5"><Button variant="glass" size="sm" disabled={busy} aria-label="View salary" onClick={()=>open('salary',row)}>View</Button>
    {editable&&<Button size="sm" variant="yellow" disabled={busy||!paymentComplete||(!drafts[key]&&row.payment_details_current!==false)} aria-label="Save payment details" onClick={()=>mutation.mutate({kind:'payment',row,payment})}>Save</Button>}
    {accounts&&row.disposition==='PAYMENT_RETURN'&&<Button size="sm" disabled={busy||!!drafts[key]||!paymentReady(row)} onClick={()=>mutation.mutate({kind:'resubmit',row})}>Resend to HO</Button>}
    {accounts&&row.disposition==='WITH_ACCOUNTS'&&<Button size="sm" variant="danger" aria-label="Return salary" disabled={busy} onClick={()=>open('return',row)}>Return</Button>}
    {ho&&row.active&&['WITH_HO','HOLD'].includes(row.disposition)&&<Button size="sm" variant="danger" aria-label="Return or hold" disabled={busy} onClick={()=>open('decision',row)}>Return / hold</Button>}
    {accounts&&row.disposition==='APPROVED'&&positive(row)&&!row.payment&&<Button size="sm" variant="yellow" disabled={busy} onClick={()=>open('paid',row)}>Record payment</Button>}
   </div></TableCell>
  </TableRow>;
  })}</TableBody></Table></div>{!rows.length&&<p className="p-6">No salaries on this sheet.</p>}<Pagination currentPage={page} totalPages={Math.ceil((query.data.total??rows.length)/20)} onPageChange={p=>{setPage(p);setSelected([]);}}/></div>
  {accounts&&(sheet.sheet_status==='Open'||hasEdits)&&<div className="glass-panel rounded-2xl p-5 flex justify-end">
   <Button variant="glass" disabled={busy||!hasEdits} onClick={()=>mutation.mutate('draft')}>Save draft</Button>
  </div>}
  {(accounts||ho)&&<div className="glass-panel rounded-2xl p-5 flex flex-wrap items-start gap-3">
   <Button variant="glass" disabled={csvExport.isPending||!(query.data.total??rows.length)} onClick={()=>{csvExport.reset();setCsvOpen(true);}}>Export to CSV</Button>
   {accounts&&neft.length>0&&<BulkNeftExportButton sheetId={sheetId} items={neft} onExported={refresh}/>}
   {needsAllRows&&allRows.isPending&&<p role="status">Loading Bulk NEFT items…</p>}
   {needsAllRows&&allRows.isError&&<div role="alert">Could not load Bulk NEFT items. <Button onClick={()=>allRows.refetch()}>Retry</Button></div>}
   {csvExport.isError&&<p role="alert">{errorText(csvExport.error)}</p>}
  </div>}
  {csvOpen&&<ExportCsvStatusModal isOpen onClose={()=>setCsvOpen(false)} onExport={csvExport.mutate} statusOptions={[...Object.values(labels),'Paid']}/>}
  {dialog&&<Modal title={dialog.kind==='salary'?'Salary details':dialog.kind==='defaults'?'Payment defaults':dialog.kind==='paid'?'Record salary payment':'Return or hold salary'} subtitle={dialog.row?`${dialog.row.employee_name} · ${dialog.row.employee_code}`:sheet.sheet_number} size={dialog.kind==='salary'?'lg':'md'} onClose={()=>{if(!busy)setDialog(null);}} closeDisabled={busy} role="dialog" aria-modal="true" aria-label="Salary sheet details" footer={dialog.kind==='salary'?null:<><Button variant="glass" disabled={busy} onClick={()=>setDialog(null)}>Cancel</Button><Button variant="yellow" disabled={busy||!fieldsReady} loading={busy} onClick={()=>mutation.mutate(dialog.kind==='decision'||dialog.kind==='return'?'decision':dialog.kind)}>Save {dialog.kind==='defaults'?'defaults':dialog.kind==='paid'?'payment':''}</Button></>}>
   <div className="space-y-4">
    {dialog.kind==='salary'?<SalaryPreview preview={dialog.row.beneficiary_ac_no ? {...dialog.row.salary,beneficiary:{status:'RECORDED',beneficiary_name:dialog.row.beneficiary_name,masked_account_number:`****${dialog.row.beneficiary_ac_no.slice(-4)}`,ifsc:dialog.row.beneficiary_ifsc,bank_name:dialog.row.beneficiary_bank_name}} : dialog.row.salary} beneficiaryContext={dialog.row.beneficiary_ac_no?'payment':'employee'} inModal isSnapshot/>:<>
     {dialog.kind==='defaults'&&<><Select label="Debit bank" value={form.bank} onChange={e=>setForm({...form,bank:e.target.value})} options={[{value:'',label:'Choose bank'},...debitBanks.map(b=>({value:b.bank_name,label:b.bank_name}))]}/><Select label="Payment mode" value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})} options={(dialog.kind==='defaults'?['NEFT','Bulk NEFT','RTGS']:['NEFT','Bulk NEFT','RTGS','Cheque']).map(m=>({value:m,label:m}))}/>{banks.isError&&<p role="alert">Could not load banks. <Button onClick={()=>banks.refetch()}>Retry</Button></p>}{form.mode==='Cheque'&&<><Input label="Cheque number" value={form.cheque_no} onChange={e=>setForm({...form,cheque_no:e.target.value})}/><Input label="Cheque date" type="date" value={form.cheque_date} onChange={e=>setForm({...form,cheque_date:e.target.value})}/></>}{dialog.kind==='defaults'&&<p className="text-sm text-slate-400">Applies to employees on this page with a saved beneficiary and missing bank or payment mode. Existing payment choices stay as entered.</p>}</>}
     {['decision','return'].includes(dialog.kind)&&<>{dialog.kind==='decision'&&<Select label="What needs to happen?" value={form.action} onChange={e=>setForm({...form,action:e.target.value})} options={[{value:'ReturnSalary',label:'Return salary calculation to preparer'},{value:'ReturnPayment',label:'Return payment details to Accounts'},{value:'Hold',label:'Hold salary for later review'}]}/>}<TextArea aria-label="Reason" label="Reason" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} maxLength={2000} rows={3}/></>}
     {dialog.kind==='paid'&&<><p className="font-semibold">{formatINR(dialog.row.salary.final_net_salary)}</p><p className="text-sm">Record a completed bank transfer. This does not initiate a transfer or debit the bank balance again.</p><Input type="date" label="Paid on" value={form.paid_on} onChange={e=>setForm({...form,paid_on:e.target.value})}/><Input label="Bank reference" value={form.reference} maxLength={200} onChange={e=>setForm({...form,reference:e.target.value})}/></>}
    </>}
    {modalError&&<p role="alert" className="text-red-300">{modalError}</p>}{failures.map(f=><p role="alert" key={f} className="text-red-300">{f}</p>)}
   </div>
  </Modal>}
 </div>;
}
