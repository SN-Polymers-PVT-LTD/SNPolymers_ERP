import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input, Select, Table, TableHeader, TableBody, TableRow, TableCell, Pagination } from '../../components/ui';
import { CATEGORIES } from '../admin/employeeConstants';
import { loadAttendanceSheet, populateAttendanceSheet, saveAttendanceRows, saveFactoryLeave, submitAttendanceSheet, getAttendanceHistory } from '../../api/hrAttendanceApi';

const categories = CATEGORIES.filter(c => !['HO Staff','Projects Department Employees'].includes(c));
const localCategory = 'Local Daily-Wage Workers';
const statuses = ['Present','Absent','Medical Leave','Paid Leave','Unpaid Leave','Compensatory Off','Management Issue'];
const options = values => values.map(value => ({ value, label: value }));
const errorText = error => error?.response?.data?.message || 'Unable to complete attendance operation.';
// datetime-local has no timezone. All entry/display is explicitly India factory time.
const businessDate = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
function localTimestamp(value) {
  if (!value) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p => [p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
const timestampValue = value => value ? `${value.length === 16 ? `${value}:00` : value}+05:30` : null;

export default function DailyAttendance() {
  const [params,setParams] = useSearchParams();
  const category = categories.includes(params.get('category')) ? params.get('category') : categories[0];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : businessDate(new Date());
  const [dirty,setDirty] = useState(false);
  const [busy,setBusy] = useState(false);
  const change = values => { setDirty(false); setParams(prev => { const next = new URLSearchParams(prev); Object.entries(values).forEach(([k,v]) => next.set(k,v)); return next; }); };
  return <div className="space-y-5">
    <h1 className="text-2xl font-bold">Daily Attendance</h1>
    <div className="grid md:grid-cols-2 gap-4">
      <Select label="Employee Category" value={category} disabled={dirty || busy} options={options(categories)} onChange={e => change({category:e.target.value})} />
      <Input label="Attendance Date" type="date" value={date} disabled={dirty || busy} onChange={e => e.target.value && change({date:e.target.value})} />
    </div>
    {dirty && <p className="text-sm text-amber-400">Save or discard changes before switching date/category.</p>}
    <AttendanceSheet key={`${category}:${date}`} category={category} date={date} onDirty={setDirty} onBusy={setBusy} />
  </div>;
}

function AttendanceSheet({ category,date,onDirty,onBusy }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const canWrite = ['factory_manager','admin'].includes(user?.role);
  const key = ['hr-attendance',category,date];
  const query = useQuery({queryKey:key,queryFn:async () => (await loadAttendanceSheet({employee_category:category,date})).data,refetchOnWindowFocus:false});
  const [patches,setPatches] = useState({});
  const [leaveEmployee,setLeaveEmployee] = useState(null);
  const [message,setMessage] = useState('');
  const sheet = query.data?.sheet;
  const editable = canWrite && ['Draft','Returned for Correction'].includes(sheet?.status);
  const local = category === localCategory;
  const storedRows = new Map((query.data?.rows || []).map(row => [row.employee_id,row]));
  const rows = (query.data?.rows || []).map(row => ({...row,...patches[row.employee_id]}));
  const dirty = Object.keys(patches).length > 0;
  const standardHours = [...new Set(rows.map(row => row.rule?.standard_duty_hours).filter(value => value != null))];
  const mutation = useMutation({mutationFn: async ({action,body}) => {
    if (action === 'populate') return populateAttendanceSheet({employee_category:category,date});
    if (action === 'save') return saveAttendanceRows(sheet.id,Object.entries(patches).map(([employee_id,patch]) => ({employee_id,...patch})));
    if (action === 'leave') return saveFactoryLeave(sheet.id,body);
    return submitAttendanceSheet(sheet.id);
  },onSuccess:async (_data,{action}) => {
    // Daily edits must be saved before opening leave entry. Refresh authoritative rows after every write.
    if (action === 'leave') {
      setPatches({}); onDirty(false);
      setLeaveEmployee(null);
    } else { setPatches({}); onDirty(false); }
    await client.invalidateQueries({queryKey:key});
    client.invalidateQueries({queryKey:['hr-attendance-history',sheet?.id]});
    setMessage(action === 'submit' ? 'Submitted to HO.' : action === 'leave' ? 'Leave and attendance row saved.' : 'Draft saved.');
  }});
  const pending = mutation.isPending;
  const blocked = pending || Boolean(leaveEmployee);
  useEffect(() => { onBusy(blocked); return () => onBusy(false); }, [blocked,onBusy]);
  const change = (row,patch) => { setMessage(''); mutation.reset(); setPatches(prev => ({...prev,[row.employee_id]:{...prev[row.employee_id],...patch}})); onDirty(true); };
  const statusChange = (row,value) => {
    const working = ['Present','Management Issue'].includes(value);
    change(row,{attendance_status:value || null,leave_request_id:null,holiday_pay_eligible:false,
      ...(!working ? {entry_timestamp:null,exit_timestamp:null,duty_type:null} : {duty_type:local ? row.duty_type : null})});
  };
  const attach = row => {
    const l = row.available_leave;
    change(row,{leave_request_id:l.id,attendance_status:l.leave_type === 'Medical Leave' ? 'Medical Leave' : l.approval_status === 'Approved' ? l.pay_treatment === 'Paid' ? 'Paid Leave' : 'Unpaid Leave' : l.leave_type === 'Paid Leave' ? 'Paid Leave' : 'Unpaid Leave',entry_timestamp:null,exit_timestamp:null,duty_type:null,holiday_pay_eligible:false});
  };
  if (query.isPending) return <p role="status">Loading attendance…</p>;
  if (query.isError) return <p role="alert">Unable to load attendance. <Button onClick={() => query.refetch()}>Retry</Button></p>;
  return <div className="space-y-4">
    <p className="text-sm">All timestamps use India time (Asia/Kolkata). Attendance date is the duty start date. Enter the exit date explicitly for overnight or 24-hour duty.</p>
    {local && <p className="text-sm">FM classifies Single/Double Duty. Double Duty has zero OT. Local leave is always Unpaid; holiday eligibility does not apply.</p>}
    {sheet ? <div className="rounded-xl p-4 bg-white/5 space-y-2">
      <p>Sheet status: <strong>{sheet.status}</strong> · Submissions: {sheet.submission_count} · Roster: {rows.length}</p>
      <p>Standard Duty Hours on saved rows: {standardHours.length ? standardHours.join(', ') : 'Not configured'}</p>
      {sheet.return_remarks && <p className="text-amber-400">Last return remarks: {sheet.return_remarks}</p>}
      {sheet.review_remarks && <p>HO remarks: {sheet.review_remarks}</p>}
      {!editable && <p>This sheet is read-only.{sheet.status === 'Submitted' ? ' HO must return it before correction.' : ''}</p>}
    </div> : <p>No sheet exists for this date/category.</p>}
    {canWrite && (!sheet || editable) && <div className="flex flex-wrap gap-3">
      <Button disabled={blocked || dirty} onClick={() => mutation.mutate({action:'populate'})}>{sheet ? 'Refresh Roster' : 'Create Attendance Sheet'}</Button>
      {editable && <>
        <Button disabled={blocked || !rows.some(r => !r.attendance_status)} onClick={() => rows.filter(r => !r.attendance_status).forEach(r => change(r,{attendance_status:'Present',...(local ? {duty_type:'Single Duty'} : {})}))}>Mark All Present</Button>
        <Button disabled={blocked || !dirty} onClick={() => mutation.mutate({action:'save'})}>Save Draft</Button>
        <Button variant="secondary" disabled={blocked || !dirty} onClick={() => {setPatches({});onDirty(false);mutation.reset();setMessage('Changes discarded.');}}>Discard Changes</Button>
        <Button disabled={blocked || dirty || !rows.length} onClick={() => mutation.mutate({action:'submit'})}>{sheet.status === 'Returned for Correction' ? 'Resubmit to HO' : 'Submit to HO'}</Button>
      </>}
    </div>}
    {editable && <p className="text-sm text-slate-400">Mark All Present marks unmarked rows only. Enter timestamps and save before submission or recording leave. Saved Actual/OT Hours come from the server.</p>}
    {mutation.isError && <p role="alert">{errorText(mutation.error)}</p>}
    {message && <p role="status">{message}</p>}
    {!!rows.length && <p className="text-sm text-slate-400">Scroll the table horizontally to view duty, leave and remarks.</p>}
    {sheet && !rows.length && <p>No eligible employees. Employees must be Active and joined on or before this date.</p>}
    {!!rows.length && <Table className="min-w-[1650px]">
      <TableHeader><TableRow>{['Employee','Attendance Status','Entry Timestamp','Exit Timestamp','Actual Hours','OT Hours',...(local ? ['Duty Type'] : ['Holiday Eligible']),'Leave / Exception','Remarks'].map(label => <TableCell isHeader key={label}>{label}</TableCell>)}</TableRow></TableHeader>
      <TableBody>{rows.map(row => {
        const stored = storedRows.get(row.employee_id);
        const leave = row.leave_request_id === stored.leave?.id ? stored.leave : row.leave_request_id === stored.available_leave?.id ? stored.available_leave : null;
        const working = ['Present','Management Issue'].includes(row.attendance_status);
        const label = row.employee?.employee_name || row.employee_id;
        return <TableRow key={row.id}>
          <TableCell><span className="font-bold">{label}</span><br/>{row.employee?.employee_code}<br/>{row.employee?.active_status}</TableCell>
          <TableCell><Select className="min-w-[180px]" aria-label={`Status for ${label}`} disabled={!editable || blocked} value={row.attendance_status || ''} options={[{value:'',label:'Unmarked'},...options(statuses.filter(s => !local || s !== 'Paid Leave'))]} onChange={e => statusChange(row,e.target.value)} /></TableCell>
          {['entry_timestamp','exit_timestamp'].map(field => <TableCell key={field}><Input className="min-w-[240px]" aria-label={`${field === 'entry_timestamp' ? 'Entry' : 'Exit'} for ${label}`} type="datetime-local" step="1" disabled={!editable || blocked || !working} value={localTimestamp(row[field])} onChange={e => change(row,{[field]:timestampValue(e.target.value)})} /></TableCell>)}
          <TableCell>{Number(stored.actual_hours).toFixed(2)}</TableCell><TableCell>{Number(stored.ot_hours).toFixed(2)}{patches[row.employee_id] && <span className="block text-amber-400">Save to refresh hours</span>}</TableCell>
          <TableCell>{local ? <Select className="min-w-[180px]" aria-label={`Duty for ${label}`} disabled={!editable || blocked || !working} value={row.duty_type || ''} options={[{value:'',label:'Select duty'},...options(['Single Duty','Double Duty'])]} onChange={e => change(row,{duty_type:e.target.value || null})} /> : <input aria-label={`Holiday for ${label}`} type="checkbox" disabled={!editable || blocked || row.attendance_status !== 'Present' || !row.rule?.holiday_pay_enabled} checked={row.holiday_pay_eligible} onChange={e => change(row,{holiday_pay_eligible:e.target.checked})} />}</TableCell>
          <TableCell>
            {leave && <p>{leave.leave_type}: {leave.from_date} – {leave.to_date}<br/>{leave.approval_status} · {leave.pay_treatment}<br/>{leave.reason}{leave.decision_remarks && <><br/>{leave.decision_remarks}</>}</p>}
            {editable && <div className="space-y-2">
              {leave?.approval_status !== 'Approved' && <Button size="sm" disabled={blocked || dirty} onClick={() => { mutation.reset(); setLeaveEmployee({...row,leave}); }}>{leave?.approval_status === 'Pending' ? 'Edit Leave' : 'Record Leave'}</Button>}
              {!row.leave_request_id && row.available_leave && <Button size="sm" disabled={blocked || dirty} onClick={() => attach(row)}>Use Existing Leave</Button>}
            </div>}
          </TableCell>
          <TableCell><Input aria-label={`Remarks for ${label}`} maxLength={2000} disabled={!editable || blocked} value={row.remarks || ''} onChange={e => change(row,{remarks:e.target.value || null})} /></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>}
    {leaveEmployee && editable && <LeaveForm key={leaveEmployee.employee_id} row={leaveEmployee} date={date} local={local} pending={pending}
      onClose={() => setLeaveEmployee(null)} onSave={body => mutation.mutate({action:'leave',body})} />}
    {sheet && <SheetHistory id={sheet.id} />}
  </div>;
}

function LeaveForm({ row,date,local,pending,onSave,onClose }) {
  const leave = row.leave?.approval_status === 'Pending' ? row.leave : null;
  const [form,setForm] = useState({employee_id:row.employee_id,leave_id:leave?.id || null,from_date:leave?.from_date || date,to_date:leave?.to_date || date,
    leave_type:leave?.leave_type || (local ? 'Leave / Not Working' : 'Medical Leave'),reason:leave?.reason || '',pay_treatment:local ? 'Unpaid' : leave?.pay_treatment || 'Pending'});
  const field = name => ({value:form[name],onChange:e => setForm(prev => ({...prev,[name]:e.target.value}))});
  return <form className="p-5 rounded-xl border border-white/10 space-y-4" onSubmit={e => {e.preventDefault();onSave(form);}}>
    <h2 className="font-bold">Factory Leave — {row.employee?.employee_name}</h2>
    <p className="text-sm">Saving records this range request and links this attendance row together. Its duty timestamps will be cleared.</p>
    <fieldset disabled={pending} className="grid md:grid-cols-2 gap-4">
      <Input label="From Date" type="date" autoFocus required {...field('from_date')} /><Input label="To Date" type="date" required min={form.from_date} {...field('to_date')} />
      <Select label="Leave Type" options={options(['Medical Leave',...(!local ? ['Paid Leave'] : []),'Unpaid Leave','Leave / Not Working'])} {...field('leave_type')} />
      <Select label="Pay Treatment" disabled={local} options={options(local ? ['Unpaid'] : ['Pending','Paid','Unpaid'])} {...field('pay_treatment')} />
      <Input label="Leave Reason" required maxLength={2000} {...field('reason')} />
    </fieldset>
    <div className="flex gap-3"><Button type="submit" disabled={pending}>Save Leave</Button><Button type="button" variant="secondary" disabled={pending} onClick={onClose}>Cancel Leave Entry</Button></div>
  </form>;
}

function SheetHistory({ id }) {
  const [open,setOpen] = useState(false);
  const [page,setPage] = useState(1);
  const query = useQuery({queryKey:['hr-attendance-history',id,page],queryFn:async () => (await getAttendanceHistory(id,{page,limit:20})).data,enabled:open});
  return <div className="space-y-3"><Button variant="secondary" onClick={() => setOpen(v => !v)}>{open ? 'Hide History' : 'Show History'}</Button>
    {open && (query.isPending ? <p role="status">Loading history…</p> : query.isError ? <p role="alert">Unable to load history. <Button onClick={() => query.refetch()}>Retry History</Button></p> : <>
      {!query.data.history.length ? <p>No history for this sheet.</p> : <Table><TableHeader><TableRow>{['When','Action','Actor'].map(label => <TableCell isHeader key={label}>{label}</TableCell>)}</TableRow></TableHeader>
        <TableBody>{query.data.history.map(log => <TableRow key={log.id}><TableCell>{localTimestamp(log.timestamp).replace('T',' ')}</TableCell><TableCell>{log.action}</TableCell><TableCell>{log.user_name}</TableCell></TableRow>)}</TableBody></Table>}
      <Pagination currentPage={page} totalPages={query.data.pagination.totalPages} onPageChange={setPage} />
    </>)}
  </div>;
}
