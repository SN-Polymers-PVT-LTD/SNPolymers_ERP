import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button, Input, Select, Pagination } from '../ui';
import PayrollSheetTable from './PayrollSheetTable';
import {
  getPayrollFoundationContext,
  generatePayrollRun,
  getPayrollDraftCandidates,
  addPayrollDraftEmployee,
} from '../../api/payrollReviewApi';

const message = (e) => e?.response?.data?.message || e.message;

export default function PayrollDraftEditor({ user, run, onRunChange, onUpdated, onReviewRow, onDeleted }) {
  const preparer = ['accounts', 'factory_manager'].includes(user?.role);
  const owned = !!run && !!user?.id && run.created_by === user.id && user.role === (['SNP Factory','Fabric Factory'].includes(run.department)?'factory_manager':'accounts');

  const [group, setGroup] = useState('');
  const [from, setFrom] = useState(owned ? run.period_from : '');
  const [to, setTo] = useState(owned ? run.period_to : '');
  const [cycle, setCycle] = useState('Monthly');
  const [candidate, setCandidate] = useState('');
  const [page, setPage] = useState(1);
  const [added, setAdded] = useState(false);

  const context = useQuery({
    queryKey: ['payroll-preparation-context', user?.id, user?.role],
    enabled: preparer && !owned,
    queryFn: async () => (await getPayrollFoundationContext()).data.context,
  });

  const candidates = useQuery({
    queryKey: ['payroll-preparation-candidates', user?.id, user?.role, run?.id, page],
    enabled: preparer && owned,
    queryFn: async () => (await getPayrollDraftCandidates(run.id, { page, limit: 20 })).data.selection,
  });

  const create = useMutation({
    mutationFn: () => {
      const selected = context.data.groups.find((g) => `${g.code}:${g.department}` === group);
      return generatePayrollRun({
        group_code: selected.code,
        department: selected.department,
        period_from: from,
        period_to: to,
        cycle,
      });
    },
    onSuccess: (r) => {
      onRunChange({ ...r.data.run, generation: r.data.generation });
      onUpdated();
    },
  });

  const add = useMutation({
    mutationFn: () =>
      addPayrollDraftEmployee(run.id, {
        assignment_id: candidate,
        period_from: from,
        period_to: to,
      }),
    onSuccess: () => {
      setAdded(true);
      setCandidate('');
      onUpdated();
      candidates.refetch();
    },
  });

  if (!preparer) return null;

  const busy = create.isPending || add.isPending;
  const valid = from && to && from <= to;

  const availableGroups = (context.data?.groups || []).filter((g) =>
    user?.role === 'factory_manager'
      ? ['SNP Factory', 'Fabric Factory'].includes(g.department)
      : ['Head Office', 'Projects'].includes(g.department)
  );

  return (
    <section
      aria-label="Payroll Sheet Draft Preparation"
      className="p-5 rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-white/10 shadow-2xl space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold">
            {owned ? '📝' : '📄'}
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              {owned ? 'Prepare employee payroll' : 'Generate payroll sheet'}
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20">
                {owned ? 'Draft In Progress' : 'New Sheet'}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {owned
                ? 'Add verified employee assignments to this draft sheet interval.'
                : 'Populate eligible recorded assignments and calculate salaries for the selected category and period.'}
            </p>
          </div>
        </div>
      </div>

      {owned ? (
        <div className="space-y-4">
          <PayrollSheetTable run={run} user={user} onUpdated={onUpdated} onReviewRow={onReviewRow} onDeleted={onDeleted} />
          <details className="border border-white/10 rounded-xl p-4">
          <summary className="cursor-pointer text-sm font-semibold">Add an individual employee interval (exception)</summary>
          <p className="text-xs text-slate-300 font-medium">
            {run.group_code} / {run.department} / {run.period_from} – {run.period_to}. Add only evidenced assignment intervals.
          </p>

          {candidates.isPending ? (
            <p role="status" className="text-xs text-slate-400 animate-pulse">
              Loading evidenced employees…
            </p>
          ) : candidates.isError ? (
            <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
              <span>{message(candidates.error)}</span>
              <Button size="sm" onClick={() => candidates.refetch()}>
                Retry candidates
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Select
                label="Evidenced employee assignment"
                value={candidate}
                options={[
                  { value: '', label: 'Select an employee interval' },
                  ...candidates.data.candidates.map((a) => ({
                    value: a.id,
                    label: `${a.employee_name} / ${a.employee_code} / ${a.payable_from} – ${a.payable_to}`,
                  })),
                ]}
                onChange={(e) => {
                  setCandidate(e.target.value);
                  setAdded(false);
                  const a = candidates.data.candidates.find((c) => c.id === e.target.value);
                  if (a) {
                    setFrom(a.payable_from);
                    setTo(a.payable_to);
                  }
                }}
              />

              {!candidates.data.candidates.length && (
                <p className="text-xs text-slate-400 italic">
                  No evidenced assignments for this group and period. Admin must record the historical sources.
                </p>
              )}

              <Pagination
                currentPage={page}
                totalPages={Math.ceil(candidates.data.total_intervals / 20)}
                onPageChange={(p) => {
                  setPage(p);
                  setCandidate('');
                }}
              />
            </div>
          )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            aria-label="Draft period from"
            label="Draft period from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            aria-label="Draft period to"
            label="Draft period to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
            <Button
              disabled={busy || !candidate || !valid}
              onClick={() => add.mutate()}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-lg shadow-emerald-500/20"
            >
              Add employee draft
            </Button>
          {added && <p role="status" className="text-xs text-emerald-300">Employee draft added. Refresh eligible employees to calculate unfinished drafts.</p>}
          </details>
        </div>
      ) : context.isPending ? (
        <p role="status" className="text-xs text-slate-400 animate-pulse">
          Loading payroll groups…
        </p>
      ) : context.isError ? (
        <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
          <span>{message(context.error)}</span>
          <Button size="sm" onClick={() => context.refetch()}>
            Retry groups
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {availableGroups.length === 0 && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2.5">
              <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <span className="font-semibold text-amber-200">No payroll groups available</span>
                <p className="text-amber-300/80 mt-0.5">
                  {user.role === 'factory_manager'
                    ? 'Factory payroll groups are unavailable. Ask an administrator to check payroll configuration.'
                    : 'No payroll groups found for your role.'}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Select
              label="Payroll group / department"
              value={group}
              options={[
                { value: '', label: 'Select an authorized payroll group' },
                ...availableGroups.map((g) => ({
                  value: `${g.code}:${g.department}`,
                  label: `${g.code} / ${g.department}`,
                })),
              ]}
              onChange={(e) => setGroup(e.target.value)}
            />

            <Select
              label="Payroll cycle"
              value={cycle}
              options={['Monthly', 'Fortnightly', 'Weekly', 'Custom'].map((v) => ({
                value: v,
                label: v,
              }))}
              onChange={(e) => setCycle(e.target.value)}
            />

            <Input
              aria-label="Draft period from"
              label="Draft period from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />

            <Input
              aria-label="Draft period to"
              label="Draft period to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        {owned ? <Button disabled={busy} variant="ghost" onClick={()=>onRunChange(null)}>Prepare a new sheet</Button> : (
          <Button disabled={busy||!group||!valid} onClick={()=>create.mutate()}>Generate payroll</Button>
        )}
      </div>

      {(create.error || add.error) && (
        <p role="alert" className="text-xs font-semibold text-rose-400">
          {message(create.error || add.error)}
        </p>
      )}
    </section>
  );
}
