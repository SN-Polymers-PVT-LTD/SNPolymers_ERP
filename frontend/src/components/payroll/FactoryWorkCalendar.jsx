import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../AuthContext';
import { Button, Input, Select, Modal } from '../ui';
import { getFactoryCalendar, saveFactoryCalendar } from '../../api/payrollLedgerApi';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const bounds = month => ({ from: `${month}-01`, to: new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).toISOString().slice(0,10) });
const errorText = error => error?.response?.data?.message || error.message;
export default function FactoryWorkCalendar({ department, onDepartmentChange }) {
  const { user } = useAuth();
  const canWrite = ['admin','ho','factory_manager'].includes(user?.role);
  const client = useQueryClient();
  const [month, setMonth] = useState(today().slice(0,7));
  const [start, setStart] = useState('');
  const [edit, setEdit] = useState(null);
  const [message, setMessage] = useState('');
  const range = bounds(month);
  const query = useQuery({ queryKey:['factory-calendar',department,month,user?.id], enabled:!!department, queryFn:async()=>(await getFactoryCalendar({department,...range})).data.result });
  const save = useMutation({ mutationFn: body=>saveFactoryCalendar({ department, expected_version:query.data.version, ...body }), onSuccess:async()=>{
    setEdit(null);setMessage('Calendar saved. Unsubmitted payroll drafts update on their next source check.');
    await Promise.all([client.invalidateQueries({queryKey:['factory-calendar']}),client.invalidateQueries({queryKey:['payroll-employee-review']}),client.invalidateQueries({queryKey:['payroll-review-freshness']})]);
  }, onError:()=>client.invalidateQueries({queryKey:['factory-calendar']}) });
  const days = new Map((query.data?.days || []).map(day=>[day.calendar_date,day]));
  const total = Number(range.to.slice(-2));
  const offset = (new Date(`${range.from}T12:00:00Z`).getUTCDay()+6)%7;
  return <section className="space-y-5">
    <div className="glass-panel p-5 rounded-2xl grid sm:grid-cols-2 gap-4">
      <Select label="Factory" value={department} disabled={save.isPending} options={['SNP Factory','Fabric Factory'].map(value=>({value,label:value}))} onChange={e=>{onDepartmentChange(e.target.value);setMessage('');save.reset();setEdit(null);}}/>
      <Input label="Month" type="month" required value={month} disabled={save.isPending} onChange={e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){setMonth(e.target.value);setMessage('');save.reset();}}}/>
    </div>
    {query.isPending ? <p role="status">Loading calendar…</p> : query.isError ? <div role="alert">{errorText(query.error)} <Button onClick={()=>query.refetch()}>Retry calendar</Button></div> : <>
      {!query.data.schedule ? <form className="glass-panel p-5 rounded-2xl space-y-4" onSubmit={e=>{e.preventDefault();save.mutate({action:'SCHEDULE',date:start,label:'Sunday weekly off'});}}>
        <h2 className="font-bold">Set up your working week</h2><p className="text-sm">Sunday is off. All other days are working days. Add holidays or working Sundays below after setup.</p>
        <p className="text-sm text-slate-500">Pay follows each worker category’s rules. Existing published calendar dates are kept.</p>
        {canWrite ? <><Input label="Applies from" type="date" required value={start} onChange={e=>setStart(e.target.value)}/><Button type="submit" variant="yellow" disabled={save.isPending||!start}>Enable Sunday off</Button></> : <p>Ask Admin, HO or your Factory Manager to enable the calendar.</p>}
      </form> : <div className="flex flex-wrap justify-between gap-3 items-center"><p className="text-sm">Sunday off · applies from {query.data.schedule.applies_on}. Other days are filled automatically.</p>{canWrite&&<Button variant="yellow" disabled={save.isPending} onClick={()=>{save.reset();setEdit({date:range.from,action:'DAY_OFF',label:''});}}>Add day off</Button>}</div>}
      <div className="glass-panel p-4 rounded-2xl overflow-x-auto"><div className="min-w-[490px]">
        <div className="grid grid-cols-7 text-center text-xs font-semibold mb-2">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><span key={d}>{d}</span>)}</div>
        <div className="grid grid-cols-7 gap-1.5">{Array.from({length:offset},(_,i)=><div key={`blank-${i}`}/>)}{Array.from({length:total},(_,i)=>{
          const date=`${month}-${String(i+1).padStart(2,'0')}`,day=days.get(date),off=day?.is_off ?? ['Weekly Off','Paid Holiday','Unpaid Closure'].includes(day?.day_type);
          return <button type="button" key={date} aria-label={`${date}: ${day?.label||day?.day_type||'Not configured'}`} disabled={!canWrite||!query.data.schedule||date<query.data.schedule.applies_on||save.isPending} onClick={()=>{save.reset();setEdit({date,action:off?'WORKING':'DAY_OFF',label:''});}} className={`min-h-20 p-2 rounded-xl border text-left ${off?'border-amber-400/40 bg-amber-400/10':'border-slate-400/20'} disabled:cursor-default`}><span className="text-sm font-bold">{i+1}</span><span className="block text-[11px] mt-1">{day?.label||day?.day_type||'Not configured'}</span></button>;
        })}</div>
      </div></div>
      <p className="text-xs text-slate-500">Click a date to add a day off or make it a working day. Locked payroll cannot be changed.</p>
      {!!query.data.changes.length&&<details className="glass-panel rounded-xl p-4"><summary className="cursor-pointer text-sm">Recent calendar changes</summary><ul className="mt-3 space-y-2 text-sm">{query.data.changes.map(c=><li key={c.id}>{c.applies_on} · {({SCHEDULE:'Sunday off enabled',DAY_OFF:'Day off added',WORKING:'Working day',RESET:'Exception removed'})[c.action]} · {c.label}</li>)}</ul></details>}
    </>}
    {message&&<p role="status" className="text-sm text-emerald-600 dark:text-emerald-300">{message}</p>}
    {save.isError&&!edit&&<p role="alert">{errorText(save.error)}</p>}
    {edit&&<Modal title="Change calendar date" size="sm" role="dialog" aria-modal="true" aria-label="Change calendar date" onClose={()=>{if(!save.isPending)setEdit(null);}} closeDisabled={save.isPending} closeLabel="Close calendar editor">
      <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate(edit);}}>
        <Input label="Date" type="date" required min={query.data?.schedule?.applies_on} value={edit.date} onChange={e=>setEdit({...edit,date:e.target.value})}/>
        <Select label="This date is" value={edit.action} options={[{value:'DAY_OFF',label:'Day off'},{value:'WORKING',label:'Working day'},{value:'RESET',label:'Use normal schedule'}]} onChange={e=>setEdit({...edit,action:e.target.value})}/>
        <Input label={edit.action==='DAY_OFF'?'Holiday name':'Note'} required maxLength={120} placeholder={edit.action==='DAY_OFF'?'e.g. Diwali':'e.g. Production scheduled'} value={edit.label} onChange={e=>setEdit({...edit,label:e.target.value})}/>
        <p className="text-xs text-slate-500">Applies to this factory. Existing attendance stays unchanged; locked payroll is protected.</p>
        {save.isError&&<p role="alert">{errorText(save.error)}</p>}
        <Button type="submit" variant="yellow" disabled={save.isPending||!edit.date||!edit.label.trim()}>Save date</Button>
      </form>
    </Modal>}
  </section>;
}
