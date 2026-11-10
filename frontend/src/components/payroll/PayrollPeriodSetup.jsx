import React,{useState} from 'react';
import {Link} from 'react-router-dom';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Button,Input,Select} from '../ui';
import {setPayrollCutoff,publishPayrollCalendar} from '../../api/payrollLedgerApi';
const message=e=>e?.response?.data?.message||e.message;
export default function PayrollPeriodSetup({run,cutoff,user}){
 const client=useQueryClient(),[date,setDate]=useState(''),[reason,setReason]=useState(''),[calendar,setCalendar]=useState({from:'',to:'',day_type:'Scheduled Workday',compensation_treatment:'PAID',evidence_reference:''});
 const refresh=()=>client.invalidateQueries({queryKey:['payroll-employee-review']});
 const save=useMutation({mutationFn:action=>setPayrollCutoff(run.id,{action,expected_version:cutoff?.version||0,cutoff_at:action==='propose'?new Date(date).toISOString():null,evidence_reference:reason.trim()}),onSuccess:refresh});
 const publish=useMutation({mutationFn:()=>{const days=[];for(let d=calendar.from;d<=calendar.to;d=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10)){if(days.length>=732)throw new Error('Publish at most 732 days per request.');days.push({calendar_date:d,day_type:calendar.day_type,compensation_treatment:calendar.compensation_treatment});}if(!days.length)throw new Error('Select a valid calendar range.');return publishPayrollCalendar({group_code:run.group_code,department:run.department,days,evidence_reference:calendar.evidence_reference.trim()});},onSuccess:refresh});
  return (
    <details className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-4 text-xs space-y-3 transition-colors duration-200 group">
      <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between select-none">
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Payroll cutoff
        </span>
        <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
      </summary>

      <div className="pt-2 space-y-3 text-slate-600 dark:text-slate-300">
        <div className="p-3 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-1">
          <p className="font-medium text-slate-800 dark:text-slate-200">
            Cutoff: {cutoff ? `${cutoff.status} · ${cutoff.cutoff_at} · version ${cutoff.version}` : 'Not configured'}. Accounts proposes; HO independently approves. Locking also requires the cutoff to have passed.
          </p>
        </div>

        {['accounts', 'ho'].includes(user.role) && run.status !== 'COMPLETE' && (
          <form
            onSubmit={e => {
              e.preventDefault();
              save.mutate(user.role === 'accounts' ? 'propose' : 'approve');
            }}
            className="p-3.5 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-3"
          >
            {user.role === 'accounts' && (
              <Input
                label="Proposed payroll cutoff"
                type="datetime-local"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            )}
            <Input
              label="Cutoff approval evidence"
              required
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={2000}
            />
            <Button
              type="submit"
              disabled={
                save.isPending ||
                !reason.trim() ||
                (user.role === 'ho' && (cutoff?.status !== 'PROPOSED' || cutoff.proposed_by === user.id))
              }
            >
              {user.role === 'accounts' ? 'Propose cutoff' : 'Approve cutoff'}
            </Button>
          </form>
        )}

        {['SNP Factory', 'Fabric Factory'].includes(run.department) && (
          <p className="my-3 text-sm">
            <Link
              className="underline text-amber-600 dark:text-amber-300 font-medium hover:text-amber-500"
              to={`/factory-masters?tab=calendar&department=${encodeURIComponent(run.department)}`}
            >
              Open factory work calendar
            </Link>
          </p>
        )}

        {!['SNP Factory', 'Fabric Factory'].includes(run.department) && ['ho', 'admin'].includes(user.role) && (
          <form
            onSubmit={e => {
              e.preventDefault();
              publish.mutate();
            }}
            className="p-3.5 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-3"
          >
            <p className="text-slate-600 dark:text-slate-400">
              Publish the same explicit entitlement for the selected dates. Paid rest days must be recorded separately. Existing published evidence is immutable; conflicting dates are rejected.
            </p>
            {['from', 'to'].map(key => (
              <Input
                key={key}
                label={`Calendar ${key}`}
                type="date"
                required
                value={calendar[key]}
                onChange={e => setCalendar(c => ({ ...c, [key]: e.target.value }))}
              />
            ))}
            <Select
              label="Calendar day classification"
              value={calendar.day_type}
              options={['Scheduled Workday', 'Weekly Off', 'Paid Holiday', 'Unpaid Closure', 'Special Working Day'].map(value => ({ value, label: value }))}
              onChange={e => setCalendar(c => ({ ...c, day_type: e.target.value }))}
            />
            <Select
              label="Calendar pay entitlement"
              value={calendar.compensation_treatment}
              options={['PAID', 'UNPAID'].map(value => ({ value, label: value }))}
              onChange={e => setCalendar(c => ({ ...c, compensation_treatment: e.target.value }))}
            />
            <Input
              label="Calendar evidence reference"
              required
              maxLength={2000}
              value={calendar.evidence_reference}
              onChange={e => setCalendar(c => ({ ...c, evidence_reference: e.target.value }))}
            />
            <Button type="submit" disabled={publish.isPending}>
              Publish calendar evidence
            </Button>
          </form>
        )}

        {[save.error, publish.error].filter(Boolean).map((e, i) => (
          <p key={i} role="alert" className="text-rose-500 font-medium text-xs">
            {message(e)}
          </p>
        ))}
        {(save.isSuccess || publish.isSuccess) && (
          <p role="status" className="text-emerald-500 font-medium text-xs">
            Evidence recorded. Recalculate affected salary reviews.
          </p>
        )}
      </div>
    </details>
  );
}
