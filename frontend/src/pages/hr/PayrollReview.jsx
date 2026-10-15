import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Select, Pagination, Input, TextArea, Badge } from '../../components/ui';
import SalaryPreview from '../../components/payroll/SalaryPreview';
import EmployeeAdjustments from '../../components/payroll/EmployeeAdjustments';
import PayrollPeriodSetup from '../../components/payroll/PayrollPeriodSetup';
import PayrollDraftEditor from '../../components/payroll/PayrollDraftEditor';
import PayrollSheetTable from '../../components/payroll/PayrollSheetTable';
import {getPayrollRun} from '../../api/payrollPreviewApi';
import {
  getPayrollReviewQueue,
  getPayrollEmployeeReview,
  actOnPayrollEmployee,
  actOnPayrollEmployees
} from '../../api/payrollReviewApi';

const labels = {
  calculate: 'Save calculation revision',
  correct: 'Save correction',
  submit: 'Submit employee',
  forward: 'Verify and forward',
  return: 'Return for correction',
  approve_lock: 'Check final lock',
  cancel: 'Withdraw draft'
};

const states = [
  'DRAFT',
  'CALCULATED',
  'PENDING_ACCOUNTS_REVIEW',
  'PENDING_HO_APPROVAL',
  'RETURNED_TO_CREATOR',
  'CANCELLED_DRAFT',
  'LOCKED'
];

const getStatusBadgeVariant = (st) => {
  switch (st) {
    case 'LOCKED':
      return 'emerald';
    case 'PENDING_HO_APPROVAL':
      return 'indigo';
    case 'PENDING_ACCOUNTS_REVIEW':
      return 'sky';
    case 'CALCULATED':
      return 'teal';
    case 'RETURNED_TO_CREATOR':
      return 'rose';
    case 'CANCELLED_DRAFT':
      return 'slate';
    case 'DRAFT':
    default:
      return 'amber';
  }
};

const errorMessage = (e) =>
  e?.response?.data?.message || e?.response?.data?.result?.code || e.message;

export default function PayrollReview() {
  const [searchParams,setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const allowed = ['admin', 'accounts', 'ho', 'factory_manager'].includes(user?.role);
  const client = useQueryClient();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [rowId, setRowId] = useState(searchParams.get('row') || '');
  const [selected, setSelected] = useState([]);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [assignment, setAssignment] = useState('');
  const [results, setResults] = useState([]);
  const [lockBlockers, setLockBlockers] = useState([]);
  const [deletedMessage,setDeletedMessage]=useState('');
  const [editingRun, setEditingRun] = useState(null);
  const runParam=searchParams.get('run')||'';
  const restoredRun=useQuery({queryKey:['payroll-selected-run',user?.id,user?.role,runParam],enabled:allowed&&!!runParam&&editingRun?.id!==runParam,queryFn:async()=>(await getPayrollRun(runParam,{page:1,limit:1})).data.draft.run});
  const activeRun=runParam?(editingRun?.id===runParam?editingRun:restoredRun.data):null;
  const canPrepareRun=activeRun?.created_by===user?.id&&user?.role===(['SNP Factory','Fabric Factory'].includes(activeRun?.department)?'factory_manager':'accounts');
  const changeRun=run=>{
    setEditingRun(run);setRowId('');setSelected([]);
    setSearchParams(previous=>{const next=new URLSearchParams(previous);next.delete('row');if(run)next.set('run',run.id);else next.delete('run');return next;});
  };

  const queue = useQuery({
    queryKey: ['payroll-review-queue', user?.id, user?.role, page, status],
    enabled: allowed,
    queryFn: async () => (await getPayrollReviewQueue({ page, limit: 20, ...(status ? { status } : {}) })).data.queue
  });

  const detail = useQuery({
    queryKey: ['payroll-employee-review', user?.id, user?.role, rowId],
    enabled: allowed && !!rowId,
    queryFn: async () => (await getPayrollEmployeeReview(rowId)).data.review
  });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['payroll-review-queue'] });
    client.invalidateQueries({ queryKey: ['payroll-employee-review'] });
    client.invalidateQueries({ queryKey: ['payroll-preview-run'] });
    client.invalidateQueries({ queryKey: ['salary-register'] });
    client.invalidateQueries({ queryKey: ['payroll-sheet-register'] });
    client.invalidateQueries({ queryKey: ['payroll-sheet-actions'] });
  };

  const requestFor = (row, actionKind, fp) => ({
    action: actionKind,
    expected_version: row.current_version,
    expected_review_version: row.review_version,
    ...(['calculate', 'correct', 'return', 'cancel'].includes(actionKind) ? { reason: reason.trim() } : {}),
    ...(actionKind === 'correct' ? { note: note.trim(), ...(assignment ? { assignment_id: assignment } : {}) } : {}),
    ...(['submit', 'forward', 'approve_lock'].includes(actionKind) ? { source_fingerprint: fp || row.source_fingerprint } : {})
  });

  const action = useMutation({
    mutationFn: ({ row, action: kind, fp }) => actOnPayrollEmployee(row.id, requestFor(row, kind, fp)),
    onMutate: () => {
      setResults([]);
      setLockBlockers([]);
    },
    onSuccess: (r) => {
      setResults([{ row_id: r.data.result.row.id, success: true, status: 200 }]);
      setLockBlockers([]);
      refresh();
    },
    onError: (e) => {
      setLockBlockers(e.response?.data?.result?.blockers || []);
      refresh();
    }
  });

  const bulk = useMutation({
    mutationFn: (kind) =>
      actOnPayrollEmployees(
        queue.data.rows
          .filter((r) => selected.includes(r.id))
          .map((r) => ({ row_id: r.id, request: requestFor(r, kind) }))
      ),
    onMutate: () => {
      setResults([]);
      setLockBlockers([]);
    },
    onSuccess: (r) => {
      setResults(r.data.results);
      setSelected((prev) => prev.filter((id) => !r.data.results.some((res) => res.row_id === id && res.success)));
      refresh();
    }
  });

  const busy = action.isPending || bulk.isPending;
  const needsReason = (kind) => ['calculate', 'correct', 'return', 'cancel'].includes(kind);
  const picked = queue.data?.rows.filter((r) => selected.includes(r.id)) || [];
  const bulkActions = ['submit', 'forward', 'return', 'approve_lock', 'cancel'].filter(
    (kind) => picked.length && picked.every((r) => (r.available_actions || []).includes(kind))
  );

  if (!allowed) {
    return (
      <div className="p-8 text-center max-w-md mx-auto">
        <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
          <svg className="w-10 h-10 mx-auto mb-3 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-lg font-bold text-white mb-1">Access Restricted</h2>
          <p role="alert" className="text-xs text-rose-300/80">
            Payroll review access is required.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-100 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
              Operations & Governance
            </span>
            <span className="text-slate-600">/</span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">
              Review & Approvals
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Payroll employee review
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
            Employee decisions are independent. Review does not authorize payment. Financial finalization remains disabled until statutory and monthly reconciliation prerequisites are complete.
          </p>
        </div>

        {/* View Mode Tabs (Review Queue vs Calculation Previews) */}
        <div className="flex items-center p-1 rounded-2xl bg-white/5 border border-white/10 shrink-0 self-start md:self-auto">
          <Link
            to="/hr/payroll/review"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Review Queue
          </Link>
          <Link
            to="/hr/payroll/previews"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all"
          >
            <span aria-hidden="true" className="font-mono">₹</span>
            Payroll Previews
          </Link>
        </div>
      </div>

      {deletedMessage&&<p role="status" className="text-emerald-700 dark:text-emerald-300">{deletedMessage}</p>}
      {/* Sheet Draft Editor Modal/Panel */}
      {runParam&&!activeRun&&(restoredRun.isError?<div role="alert">{errorMessage(restoredRun.error)} <Button onClick={()=>restoredRun.refetch()}>Retry payroll sheet</Button><Button onClick={()=>changeRun(null)}>Prepare a new sheet</Button></div>:<p role="status">Loading payroll sheet…</p>)}
      {(!runParam||activeRun)&&(!activeRun||canPrepareRun)&&
      <PayrollDraftEditor
        key={`${user.id}:${activeRun?.id || 'new'}`}
        user={user}
        run={activeRun}
        onRunChange={changeRun}
        onUpdated={refresh}
        onDeleted={()=>{changeRun(null);setDeletedMessage('Payroll sheet deleted. Audit history is preserved.');}}
        onReviewRow={id=>{setRowId(id);setReason('');setNote('');setAssignment('');setLockBlockers([]);action.reset();}}
      />
      }
      {activeRun&&!canPrepareRun&&<PayrollSheetTable key={activeRun.id} run={activeRun} user={user} onUpdated={refresh} onReviewRow={id=>{setRowId(id);setReason('');setNote('');setAssignment('');setLockBlockers([]);action.reset();}}/>}

      {/* Parent Sheet Progress Section */}
      {queue.data?.sheets && queue.data.sheets.length > 0 && (
        <section aria-label="Parent Sheets Progress" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Parent sheet progress
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {queue.data.sheets.map((s) => {
              const total = s.progress?.total || 1;
              const locked = s.progress?.locked || 0;
              const percent = Math.min(100, Math.round((locked / total) * 100));

              return (
                <div
                  key={s.id}
                  className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/40 space-y-4 hover:border-white/20 transition group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="amber">{s.group_code}</Badge>
                        <Badge variant={s.progress?.status === 'LOCKED' ? 'emerald' : 'sky'}>
                          {s.progress?.status || 'DRAFT'}
                        </Badge>
                      </div>
                      <h3 className="text-sm font-bold text-white">
                        {s.period_from} &ndash; {s.period_to}
                      </h3>
                    </div>

                    {(
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => changeRun(s)}
                        disabled={busy}
                        className="text-xs"
                      >
                        Open payroll sheet
                      </Button>
                    )}
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 font-mono">
                      <span>Lock Completion</span>
                      <span className="text-emerald-400">{percent}% ({locked}/{total})</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800/80 overflow-hidden border border-white/5">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  {/* Stat Metrics Chips */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1 text-center font-mono">
                    <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-[9px] uppercase font-bold text-emerald-400 block">Locked</span>
                      <span className="text-xs font-black text-emerald-300">{s.progress?.locked}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20">
                      <span className="text-[9px] uppercase font-bold text-sky-400 block">Accounts</span>
                      <span className="text-xs font-black text-sky-300">{s.progress?.accounts}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                      <span className="text-[9px] uppercase font-bold text-indigo-400 block">HO</span>
                      <span className="text-xs font-black text-indigo-300">{s.progress?.ho}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                      <span className="text-[9px] uppercase font-bold text-rose-400 block">Returned</span>
                      <span className="text-xs font-black text-rose-300">{s.progress?.returned}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-white/5 border border-white/10">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Draft</span>
                      <span className="text-xs font-black text-slate-200">{s.progress?.draft}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-white/5 border border-white/10">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Withdrawn</span>
                      <span className="text-xs font-black text-slate-200">{s.progress?.cancelled}</span>
                    </div>
                  </div>

                  {/* Contract textual audit representation preserved for test assertions */}
                  <p className="sr-only">
                    {s.group_code} / {s.period_from} &ndash; {s.period_to}: {s.progress.status} · Locked {s.progress.locked}/{s.progress.total} · Accounts {s.progress.accounts} · HO {s.progress.ho} · Returned {s.progress.returned} · Draft {s.progress.draft} · Withdrawn {s.progress.cancelled}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!activeRun && <>
      {/* Filter and Control Bar */}
      <div className="glass-panel p-4 rounded-2xl border border-white/10 bg-slate-900/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="w-full sm:w-72">
          <Select
            label="Employee status"
            value={status}
            options={[
              { value: '', label: 'All accessible employees' },
              ...states.map((s) => ({ value: s, label: s }))
            ]}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
              setSelected([]);
            }}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={refresh}
            disabled={queue.isFetching}
            className="flex items-center gap-2"
          >
            <svg
              className={`w-3.5 h-3.5 ${queue.isFetching ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Queue
          </Button>
        </div>
      </div>

      {/* Review Queue Table Container */}
      <section aria-label="Review Queue" className="glass-panel rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden shadow-xl">
        <div className="p-4 sm:p-5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/[0.01]">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Review Queue Records
              {queue.data?.total !== undefined && (
                <span className="text-xs font-mono font-normal text-slate-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                  {queue.data.total} employees
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select employees to trigger stage transitions or click Review to audit individual pay metrics.
            </p>
          </div>

          {selected.length > 0 && (
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>{selected.length} selected</span>
            </div>
          )}
        </div>

        {queue.isPending ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <div className="w-8 h-8 mx-auto border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p role="status" className="text-xs font-mono uppercase tracking-wider">
              Loading employee review queue…
            </p>
          </div>
        ) : queue.isError ? (
          <div className="p-8 text-center space-y-3" role="alert">
            <p className="text-rose-400 font-medium text-sm">{errorMessage(queue.error)}</p>
            <Button onClick={() => queue.refetch()} size="sm" variant="secondary">
              Retry queue
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-4 w-12 text-center">
                      <input
                        type="checkbox"
                        aria-label="Select all eligible rows"
                        checked={
                          queue.data.rows.length > 0 &&
                          queue.data.rows.filter((r) => (r.available_actions || []).length > 0).every((r) => selected.includes(r.id))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelected(
                              queue.data.rows
                                .filter((r) => (r.available_actions || []).length > 0)
                                .map((r) => r.id)
                            );
                          } else {
                            setSelected([]);
                          }
                        }}
                        className="rounded border-white/20 bg-slate-800 text-amber-500 focus:ring-amber-500/30"
                      />
                    </th>
                    <th className="py-3 px-4">Select employee</th>
                    <th className="py-3 px-4">Employee / period</th>
                    <th className="py-3 px-4">Review state</th>
                    <th className="py-3 px-4">Return reason</th>
                    <th className="py-3 px-4 text-right">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {queue.data.rows.map((r) => {
                    const isRowSelected = selected.includes(r.id);
                    const isCurrent = rowId === r.id;

                    return (
                      <tr
                        key={r.id}
                        className={`transition-colors group hover:bg-white/[0.03] ${
                          isCurrent
                            ? 'bg-amber-500/10'
                            : isRowSelected
                            ? 'bg-white/[0.02]'
                            : ''
                        }`}
                      >
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.employee_name}`}
                            checked={isRowSelected}
                            disabled={busy || !(r.available_actions || []).length}
                            onChange={(e) =>
                              setSelected((old) =>
                                e.target.checked ? [...old, r.id] : old.filter((id) => id !== r.id)
                              )
                            }
                            className="rounded border-white/20 bg-slate-800 text-amber-500 focus:ring-amber-500/30 disabled:opacity-30 cursor-pointer"
                          />
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-400">
                          <span className="font-semibold text-white">{r.employee_code}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white text-sm group-hover:text-amber-300 transition-colors">
                            {r.employee_name} / {r.employee_code}
                          </div>
                          <div className="text-xs text-slate-400 font-mono mt-0.5">
                            {r.period_from} &ndash; {r.period_to}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={getStatusBadgeVariant(r.status)}>
                              {r.status}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            Content {r.current_version}, review {r.review_version}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-300 max-w-xs truncate">
                          {r.last_return_reason ? (
                            <span className="text-rose-300 font-medium">{r.last_return_reason}</span>
                          ) : (
                            <span className="text-slate-500">&mdash;</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <Button
                            size="sm"
                            variant={isCurrent ? 'primary' : 'secondary'}
                            disabled={busy}
                            onClick={() => {
                              setRowId(r.id);
                              setReason('');
                              setNote('');
                              setAssignment('');
                              setLockBlockers([]);
                              action.reset();
                            }}
                            className="text-xs"
                          >
                            Review employee
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!queue.data.rows.length && (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <p className="text-sm font-medium">No employees in this review queue.</p>
                <p className="text-xs text-slate-500">
                  Try switching the employee status filter or select another parent payroll sheet.
                </p>
              </div>
            )}

            <div className="p-4 border-t border-white/5 flex justify-end">
              <Pagination
                currentPage={page}
                totalPages={Math.ceil(queue.data.total / 20) || 1}
                onPageChange={(p) => {
                  setPage(p);
                  setSelected([]);
                }}
              />
            </div>
          </>
        )}
      </section>

      {/* Bulk Action Controls */}
      <section className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/40 space-y-4 shadow-lg">
        <div className="border-b border-white/5 pb-2">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
            Reviewer Instructions & Reason
          </span>
          <h3 className="text-sm font-bold text-white mt-0.5">
            Audit Documentation & Correction Justification
          </h3>
        </div>

        <TextArea
          aria-label="Action / correction reason"
          label="Action / correction reason"
          placeholder="Required when calculating, correcting, returning or withdrawing draft rows..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          rows={3}
        />

        {!!picked.length && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-amber-300">
                {picked.length} employees selected. Each action reports its own result.
              </p>
              <button
                onClick={() => setSelected([])}
                className="text-xs text-slate-400 hover:text-white underline"
              >
                Clear selection
              </button>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {bulkActions.map((kind) => {
                const isBlocked = busy || (needsReason(kind) && !reason.trim());
                return (
                  <Button
                    key={kind}
                    disabled={isBlocked}
                    onClick={() => bulk.mutate(kind)}
                    variant={kind === 'approve_lock' ? 'primary' : kind === 'return' ? 'danger' : 'secondary'}
                    size="sm"
                  >
                    {labels[kind]} for selected employees
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-mono">
            <div className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span role="status">Applying employee actions…</span>
          </div>
        )}

        {(action.error || bulk.error) && (
          <div role="alert" className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-medium">
            {errorMessage(action.error || bulk.error)}
          </div>
        )}

        {!!results.length && (
          <div className="space-y-2 pt-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Action Results</span>
            <ul aria-label="Employee action results" className="space-y-1.5 font-mono text-xs">
              {results.map((r, i) => (
                <li
                  key={`${r.row_id}-${i}`}
                  className={`p-2.5 rounded-xl border flex items-center justify-between ${
                    r.success
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                  }`}
                >
                  <span>
                    {r.row_id}: {r.success ? 'Applied' : `Failed (${r.status})`}
                  </span>
                  <span>
                    {r.error?.message || r.result?.code || ''}
                    {r.result?.blockers?.map((b) => ` / ${b.code}`).join('')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!!lockBlockers.length && (
          <div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-1">
            <div className="font-bold uppercase tracking-wider flex items-center gap-2">
              <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Final lock blocked: {lockBlockers.map((b) => b.code).join(', ')}
            </div>
            <p className="text-[11px] text-rose-300/80">
              Prerequisites for final sign-off are not satisfied. Statutory profiles and monthly reconciliation must be reconciled.
            </p>
          </div>
        )}
      </section>

      </>}

      {/* Selected Individual Employee Review Panel */}
      {rowId && (
        <section aria-label="Individual Employee Audit" className="glass-panel p-6 rounded-3xl border border-amber-500/20 bg-slate-900/60 shadow-2xl space-y-6">
          {detail.isPending ? (
            <div className="p-12 text-center text-slate-400 space-y-3">
              <div className="w-8 h-8 mx-auto border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <p role="status" className="text-xs font-mono uppercase tracking-wider">
                Loading employee history…
              </p>
            </div>
          ) : detail.isError ? (
            <div role="alert" className="p-6 text-center space-y-3">
              <p className="text-rose-400 font-medium text-sm">{errorMessage(detail.error)}</p>
              <Button onClick={() => detail.refetch()} size="sm" variant="secondary">
                Retry employee
              </Button>
            </div>
          ) : (
            <>
              {/* Header Card */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">
                      Target Audit
                    </span>
                    <span className="text-slate-600">/</span>
                    <span className="text-xs font-mono text-amber-400 font-bold">
                      {detail.data.row.employee_name} ({detail.data.row.employee_code})
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-white">
                    Employee review: {detail.data.row.status}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Current authoritative salary diagnostic. Payment status: {detail.data.payment_status}.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant={getStatusBadgeVariant(detail.data.row.status)}>
                    {detail.data.row.status}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRowId('')}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Close audit
                  </Button>
                </div>
              </div>

              {/* Status & Warning Banners */}
              {detail.data.row.last_return_reason && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                  <span className="font-bold uppercase tracking-wider block mb-1">Return History</span>
                  <p>
                    Last return ({detail.data.row.last_return_stage}): {detail.data.row.last_return_reason}
                  </p>
                </div>
              )}

              {detail.data.employee_self && !detail.data.available_actions.length && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                  <p className="font-medium">
                    An independent reviewer is required for your employee salary.
                  </p>
                </div>
              )}

              {detail.data.source_error && (
                <div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
                  <div className="font-bold uppercase tracking-wider flex items-center gap-2">
                    <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Salary sources unavailable ({detail.data.source_error.code}): {detail.data.source_error.message}
                  </div>
                  <p className="text-[11px] text-rose-300/80">
                    Calculation and source-dependent approvals are unavailable. Authorized corrections, withdrawal and review history remain accessible.
                  </p>
                  <Button onClick={() => detail.refetch()} disabled={busy} size="sm" variant="secondary">
                    Retry salary sources
                  </Button>
                </div>
              )}

              {detail.data.source_stale && (
                <div role="alert" className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
                  Sources changed since the saved calculation. Return and recalculate before forwarding or final locking.
                </div>
              )}

              {/* Action Controls Toolbar */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    aria-label="Correction note"
                    label="Correction note"
                    placeholder="Specific rationale for this employee's correction..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={2000}
                  />

                  <Select
                    label="Evidenced assignment for correction"
                    value={assignment}
                    options={[
                      { value: '', label: 'Keep current assignment' },
                      ...(detail.data.assignment_candidates || []).map((a) => ({
                        value: a.id,
                        label: `${a.group_code} / ${a.effective_from} – ${a.effective_to || 'ongoing'}`
                      }))
                    ]}
                    onChange={(e) => setAssignment(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                  {detail.data.available_actions.map((kind) => {
                    const isBlocked = busy || (needsReason(kind) && !reason.trim());
                    return (
                      <Button
                        key={kind}
                        disabled={isBlocked}
                        onClick={() =>
                          action.mutate({
                            row: detail.data.row,
                            action: kind,
                            fp: detail.data.revisions.at(-1)?.source_fingerprint
                          })
                        }
                        variant={
                          kind === 'approve_lock'
                            ? 'primary'
                            : kind === 'forward'
                            ? 'primary'
                            : kind === 'return'
                            ? 'danger'
                            : kind === 'cancel'
                            ? 'ghost'
                            : 'secondary'
                        }
                      >
                        {labels[kind]}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Salary Preview Visual Diagnostics */}
              <div className="space-y-4">
                {detail.data.current_preview ? (
                  <SalaryPreview preview={detail.data.current_preview} />
                ) : (
                  <p className="text-xs text-slate-400 p-4 rounded-xl bg-white/5">
                    Current salary preview unavailable.
                  </p>
                )}
              </div>

              {/* Changes Since Saved Accordion */}
              {detail.data.changes_since_saved && (
                <details className="rounded-xl border border-white/10 bg-white/[0.01] p-3 text-xs group">
                  <summary className="font-bold text-slate-300 cursor-pointer hover:text-white flex items-center justify-between">
                    <span>Changes since saved calculation</span>
                    <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <pre className="text-xs whitespace-pre-wrap font-mono text-amber-300/90 pt-3 overflow-x-auto">
                    {JSON.stringify(detail.data.changes_since_saved, null, 2)}
                  </pre>
                </details>
              )}

              {/* Period Setup & Adjustments Sub-sections */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <PayrollPeriodSetup
                  key={detail.data.run.id}
                  run={detail.data.run}
                  cutoff={detail.data.period_cutoff}
                  user={user}
                />
                <EmployeeAdjustments
                  key={detail.data.row.employee_id}
                  employeeId={detail.data.row.employee_id}
                  rowId={detail.data.row.id}
                  employeeSelf={detail.data.employee_self}
                  user={user}
                />
              </div>

              {/* Revisions History Accordion */}
              <div className="space-y-3 pt-2">
                <h3 className="font-bold text-sm uppercase tracking-wider text-slate-400">
                  Submission and calculation revisions
                </h3>

                <div className="space-y-2">
                  {detail.data.revisions.map((v) => (
                    <details
                      key={v.revision}
                      className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-xs space-y-3 group"
                    >
                      <summary className="font-bold text-slate-200 cursor-pointer hover:text-white flex items-center justify-between">
                        <span>
                          Revision {v.revision} / content {v.content_version} &middot; {v.created_at} &middot; {v.reason}
                        </span>
                        <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                      </summary>

                      <div className="space-y-3 pt-2 border-t border-white/5">
                        <p className="text-slate-400">
                          Prepared by <strong className="text-slate-200">{v.created_by}</strong>. Correction note: <span className="text-amber-300">{v.content_note || '—'}</span>
                        </p>

                        {v.changes && (
                          <pre className="text-xs whitespace-pre-wrap font-mono text-slate-400 bg-black/30 p-3 rounded-xl overflow-x-auto border border-white/5">
                            {JSON.stringify(v.changes, null, 2)}
                          </pre>
                        )}

                        {v.calculation_snapshot && (
                          <SalaryPreview preview={v.calculation_snapshot} />
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </div>

              {/* Correction Content & Action History */}
              <details className="rounded-xl border border-white/10 bg-white/[0.01] p-3 text-xs group">
                <summary className="font-bold text-slate-300 cursor-pointer hover:text-white flex items-center justify-between">
                  <span>Correction content and reviewer action history</span>
                  <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <pre className="text-xs whitespace-pre-wrap font-mono text-slate-400 pt-3 overflow-x-auto">
                  {JSON.stringify({ content: detail.data.content_versions, actions: detail.data.actions }, null, 2)}
                </pre>
              </details>
            </>
          )}
        </section>
      )}
    </div>
  );
}
