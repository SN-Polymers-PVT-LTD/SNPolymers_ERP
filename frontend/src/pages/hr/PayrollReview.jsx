import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Select, Pagination, Input, TextArea, Badge, Modal } from '../../components/ui';
import {payrollStatus} from '../../utils/payrollDisplay';
import PayrollDeliveryReceipt from '../../components/payroll/PayrollDeliveryReceipt';
import PayrollPendingConversion from '../../components/payroll/PayrollPendingConversion';
import PayrollBlockers from '../../components/payroll/PayrollBlockers';
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
import { usePayrollReviewUrlState } from '../../hooks/usePayrollReviewUrlState';

const labels = {
  calculate: 'Save calculation revision',
  correct: 'Save correction',
  submit: 'Submit to Accounts',
  forward: 'Verify and forward',
  return: 'Return for correction',
  approve_lock: 'Check final lock',
  cancel: 'Withdraw draft'
};

const states = [
  'DRAFT',
  'CALCULATED',
  'IN_ACCOUNTS_SHEET',
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

const showPayrollDetailsDiagnostics = false;

export default function PayrollReview() {
  const { user } = useAuth();
  const allowed = ['admin', 'accounts', 'ho', 'factory_manager'].includes(user?.role);
  const client = useQueryClient();

  const {
    page,
    setPage,
    status,
    setStatus,
    runId: runParam,
    setRunId,
    rowId,
    setRowId
  } = usePayrollReviewUrlState();

  const [selected, setSelected] = useState([]);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [assignment, setAssignment] = useState('');
  const [results, setResults] = useState([]);
  const [lockBlockers, setLockBlockers] = useState([]);
  const [deletedMessage,setDeletedMessage]=useState('');
  const [editingRun, setEditingRun] = useState(null);
  const restoredRun=useQuery({queryKey:['payroll-selected-run',user?.id,user?.role,runParam],enabled:allowed&&!!runParam&&editingRun?.id!==runParam,queryFn:async()=>(await getPayrollRun(runParam,{page:1,limit:1})).data.draft.run});
  const activeRun=runParam?(editingRun?.id===runParam?editingRun:restoredRun.data):null;
  const canPrepareRun=activeRun?.created_by===user?.id&&user?.role===(['SNP Factory','Fabric Factory'].includes(activeRun?.department)?'factory_manager':'accounts');
  const changeRun=run=>{
    setEditingRun(run);setSelected([]);
    setRunId(run ? run.id : '');
  };

  const queue = useQuery({
    queryKey: ['payroll-review-queue', user?.id, user?.role, page, status],
    enabled: allowed,
    queryFn: async () => (await getPayrollReviewQueue({ page, limit: 20, ...(status ? { status } : {}) })).data.queue
  });

  const reviewSectionRef = useRef(null);
  const [reviewOpenRequest, setReviewOpenRequest] = useState(0);
  useEffect(() => {
    if (!rowId) return;
    const section = reviewSectionRef.current;
    section?.focus({ preventScroll: true });
  }, [rowId, reviewOpenRequest]);

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
      setResults([{ row_id: r.data.result.row.id, name:queue.data?.rows.find(row=>row.id===r.data.result.row.id)?.employee_name||'Employee', success: true, status: 200,result:r.data.result }]);
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
      setResults(r.data.results.map(item=>({...item,name:queue.data.rows.find(row=>row.id===item.row_id)?.employee_name||'Employee'})));
      setSelected((prev) => prev.filter((id) => !r.data.results.some((res) => res.row_id === id && res.success)));
      refresh();
    }
  });

  const busy = action.isPending || bulk.isPending;
  const needsReason = (kind) => ['calculate', 'correct', 'return', 'cancel'].includes(kind);
  const picked = queue.data?.rows.filter((r) => selected.includes(r.id)) || [];
  const bulkActions = ['submit', 'return', 'cancel'].filter(
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

  const queueRow = rowId ? queue.data?.rows?.find((r) => r.id === rowId) : null;
  const empName = queueRow?.employee_name
    || detail.data?.source?.employee?.employee_name
    || detail.data?.current_preview?.employee?.employee_name
    || detail.data?.current_preview?.employee_name
    || detail.data?.row?.employee_name;
  const empCode = queueRow?.employee_code
    || detail.data?.source?.employee?.employee_code
    || detail.data?.current_preview?.employee?.employee_code
    || detail.data?.current_preview?.employee_code
    || detail.data?.row?.employee_code;
  const modalSubtitle = (empName && empCode)
    ? `${empName} · ${empCode}`
    : (empName || empCode)
      ? `${empName || empCode}`
      : detail.data?.run
        ? `${detail.data.run.group_code || 'Employee'}${detail.data.run.department ? ` · ${detail.data.run.department}` : ''}`
        : 'Employee payroll';

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
              Payroll preparation
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Payroll
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
            Generate payroll, check salary amounts and submit ready employees to Accounts. Accounts completes payment details and sends the sheet to HO.
          </p>
        </div>

        {/* View Mode Tabs (Payroll sheets vs Calculation Previews) */}
        <div className="flex items-center p-1 rounded-2xl bg-white/5 border border-white/10 shrink-0 self-start md:self-auto">
          <Link
            to="/hr/payroll/review"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Payroll sheets
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
      {['admin','accounts'].includes(user.role)&&!activeRun&&<PayrollPendingConversion user={user}/>}
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
        onReviewRow={id=>{setRowId(id);setReviewOpenRequest(value=>value+1);setReason('');setNote('');setAssignment('');setLockBlockers([]);action.reset();}}
      />
      }
      {activeRun&&!canPrepareRun&&<PayrollSheetTable key={activeRun.id} run={activeRun} user={user} onUpdated={refresh} onReviewRow={id=>{setRowId(id);setReviewOpenRequest(value=>value+1);setReason('');setNote('');setAssignment('');setLockBlockers([]);action.reset();}}/>}

      {/* Parent Sheet Progress Section */}
      {!activeRun && queue.data?.sheets && queue.data.sheets.length > 0 && (
        <section aria-label="Parent Sheets Progress" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Payroll sheets
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {queue.data.sheets.map((s) => {
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

                  {/* Stat Metrics Chips */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1 text-center font-mono">
                    <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-[9px] uppercase font-bold text-emerald-400 block">Approved</span>
                      <span className="text-xs font-black text-emerald-300">{s.progress?.locked}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20">
                      <span className="text-[9px] uppercase font-bold text-sky-400 block">With Accounts</span>
                      <span className="text-xs font-black text-sky-300">{s.progress?.accounts}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                      <span className="text-[9px] uppercase font-bold text-indigo-400 block">With HO</span>
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

      {/* Payroll sheets Table Container */}
      <section aria-label="Payroll sheets" className="glass-panel rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden shadow-xl">
        <div className="p-4 sm:p-5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/[0.01]">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Payroll sheets Records
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
                              {payrollStatus(r.status)}
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
                              setReviewOpenRequest(value=>value+1);
                              setReason('');
                              setNote('');
                              setAssignment('');
                              setLockBlockers([]);
                              action.reset();
                            }}
                            className="text-xs"
                          >
                            View details
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

        {!rowId && <TextArea
          aria-label="Action / correction reason"
          label="Action / correction reason"
          placeholder="Required when calculating, correcting, returning or withdrawing draft rows..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          rows={3}
        />}

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
                    {r.name}: {r.success ? 'Applied' : `Failed (${r.status})`}
                  </span>
                  <span>
                    {r.error?.message || r.result?.code || ''}
                    {r.result?.blockers?.map((b) => ` · ${b.code}`).join('')}{r.result?.accounts_sheet_id&&<PayrollDeliveryReceipt receipt={{sheet_id:r.result.accounts_sheet_id,sheet_number:r.result.accounts_sheet_number}} role={user.role}/>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!rowId && !!lockBlockers.length && (
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
        <Modal dialogRef={reviewSectionRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Employee payroll details" title="Payroll details" subtitle={modalSubtitle} size="lg" onClose={()=>{if(!busy)setRowId('');}} closeDisabled={busy} closeLabel="Close payroll details">
          <div className="space-y-5">
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
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-100/70 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-xs sm:text-sm">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Pay Period:</span>
                  <span className="font-mono font-bold bg-white dark:bg-white/5 px-2.5 py-0.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white">
                    {detail.data.row.period_from}
                  </span>
                  <span className="text-slate-400">to</span>
                  <span className="font-mono font-bold bg-white dark:bg-white/5 px-2.5 py-0.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white">
                    {detail.data.row.period_to}
                  </span>
                </div>
                <Badge variant={getStatusBadgeVariant(detail.data.row.status)}>{payrollStatus(detail.data.row.status)}</Badge>
              </div>
              <PayrollDeliveryReceipt receipt={detail.data.accounts_delivery} role={user.role}/>
              {!detail.data.accounts_delivery&&['PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL'].includes(detail.data.row.status)&&<p className="text-sm text-amber-700 dark:text-amber-300">This earlier submission needs to be moved to an Accounts salary sheet. Accounts or Admin can preview it under Earlier payroll submissions.</p>}
              {detail.data.current_preview && <>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[['Earnings after unpaid leave', detail.data.current_preview.gross_after_lop], ['Take-home pay', detail.data.current_preview.financial_readiness === true ? detail.data.current_preview.final_net_salary : null]].map(([label,value])=>(
                    <div key={label} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-4 shadow-sm">
                      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
                      <dd className="mt-1 text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                        {value == null ? <span className="text-sm font-normal text-slate-400 italic">Not available yet</span> : <span className="font-mono">₹{value}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
                {!!detail.data.current_preview.blockers?.length && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white">What needs attention</h3>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold border border-amber-500/25">
                        {detail.data.current_preview.blockers.length} {detail.data.current_preview.blockers.length === 1 ? 'check' : 'checks'}
                      </span>
                    </div>
                    <PayrollBlockers blockers={detail.data.current_preview.blockers}/>
                  </div>
                )}
              </>}
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
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs">
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
                  {detail.data.source_error.code!=='PAYROLL_SHEET_CANCELLED'&&<Button onClick={() => detail.refetch()} disabled={busy} size="sm" variant="secondary">
                    Retry salary sources
                  </Button>}
                </div>
              )}

              {detail.data.source_stale && (
                <div role="alert" className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs font-medium flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>Sources changed since the saved calculation. Return it to the preparer for recalculation before approval.</span>
                </div>
              )}

              {action.isSuccess && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-300">Payroll updated.</p>}
              {detail.data.available_actions.length>0&&<TextArea aria-label="Action / correction reason" label="Reason for changes" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} rows={2}/>}
              {action.isError && !lockBlockers.length && <p role="alert">{errorMessage(action.error)}</p>}
              {!!lockBlockers.length && <p role="alert">Final lock blocked: {lockBlockers.map(b=>b.code).join(', ')}</p>}
              {/* Action Controls Toolbar */}
              {detail.data.available_actions.length>0&&<div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                <details><summary className="cursor-pointer text-sm">Correct employee setup</summary><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
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

                </details>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                  {detail.data.available_actions.filter(kind=>!['forward','approve_lock'].includes(kind)).map((kind) => {
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
              </div>}

              <details className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-4 transition-colors duration-200 group">
                <summary className="cursor-pointer text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between select-none">
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Calculation, history and setup
                  </span>
                  <span className="text-xs text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                </summary>

                <div className="space-y-4 mt-4">
                  {/* Salary Preview Visual Diagnostics */}
                  <div className="space-y-4">
                    {detail.data.current_preview ? (
                      <SalaryPreview preview={detail.data.current_preview} inModal={true} showTechnicalDetails={showPayrollDetailsDiagnostics} />
                    ) : (
                      <p className="text-xs text-slate-400 p-4 rounded-xl bg-white/5">
                        Current salary preview unavailable.
                      </p>
                    )}
                  </div>

                  {/* Changes Since Saved Accordion */}
                  {showPayrollDetailsDiagnostics && detail.data.changes_since_saved && (
                    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          Changes since saved calculation
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold">
                          {Array.isArray(detail.data.changes_since_saved) ? `${detail.data.changes_since_saved.length} fields modified` : 'Modified'}
                        </span>
                      </div>

                      {Array.isArray(detail.data.changes_since_saved) && detail.data.changes_since_saved.length > 0 && (
                        <div className="overflow-x-auto rounded-xl border border-amber-500/15">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-amber-500/10 text-slate-700 dark:text-slate-300 font-bold uppercase text-[10px] tracking-wider">
                              <tr>
                                <th className="p-2.5">Field / Metric</th>
                                <th className="p-2.5">Previous Snapshot</th>
                                <th className="p-2.5">Current Source Value</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-500/10 bg-white/50 dark:bg-black/20">
                              {detail.data.changes_since_saved.map((change, idx) => (
                                <tr key={idx} className="hover:bg-amber-500/5">
                                  <td className="p-2.5 font-medium font-mono text-slate-800 dark:text-slate-200">
                                    {change.field || change.key || `Item ${idx + 1}`}
                                  </td>
                                  <td className="p-2.5 text-slate-500 dark:text-slate-400 line-through font-mono">
                                    {typeof change.before === 'object' ? JSON.stringify(change.before) : String(change.before ?? '—')}
                                  </td>
                                  <td className="p-2.5 text-amber-700 dark:text-amber-300 font-semibold font-mono">
                                    {typeof change.after === 'object' ? JSON.stringify(change.after) : String(change.after ?? '—')}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <details className="text-[11px] text-slate-500 group">
                        <summary className="cursor-pointer hover:text-slate-400 font-medium select-none">
                          Technical JSON diff
                        </summary>
                        <pre className="text-xs whitespace-pre-wrap font-mono text-amber-300/90 pt-2 p-3 rounded-xl bg-black/40 border border-white/5 overflow-x-auto mt-1">
                          {JSON.stringify(detail.data.changes_since_saved, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}

                  {/* Period Setup & Adjustments Sub-sections */}
                  <div className="space-y-4">
                    {!detail.data.accounts_delivery&&<PayrollPeriodSetup
                      key={detail.data.run.id}
                      run={detail.data.run}
                      cutoff={detail.data.period_cutoff}
                      user={user}
                    />}
                    <EmployeeAdjustments
                      key={detail.data.row.employee_id}
                      employeeId={detail.data.row.employee_id}
                      employeeSelf={detail.data.employee_self}
                      user={user}
                    />
                  </div>

                  {/* Revisions History Accordion */}
                  <div className="space-y-3 pt-2">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Submission and calculation revisions
                    </h3>

                    <div className="space-y-2">
                      {detail.data.revisions.map((v) => (
                        <details
                          key={v.revision}
                          className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-4 text-xs space-y-3 group"
                        >
                          <summary className="font-bold text-slate-800 dark:text-slate-200 cursor-pointer hover:text-indigo-600 dark:hover:text-white flex items-center justify-between select-none">
                            <span>
                              Revision {v.revision} / content {v.content_version} &middot; {v.created_at} &middot; {v.reason}
                            </span>
                            <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                          </summary>

                          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-white/5">
                            <p className="text-slate-600 dark:text-slate-400">
                              Prepared by <strong className="text-slate-800 dark:text-slate-200">{v.created_by}</strong>. Correction note: <span className="text-amber-600 dark:text-amber-300 font-medium">{v.content_note || '—'}</span>
                            </p>

                            {v.changes && (
                              <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-black/20 p-3 space-y-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                  Revision Changes
                                </span>
                                {Array.isArray(v.changes) ? (
                                  <div className="space-y-1.5">
                                    {v.changes.map((c, i) => (
                                      <div key={i} className="flex items-center gap-2 text-xs">
                                        <span className="font-mono text-slate-300 font-semibold">{c.field || c.key || `Field ${i + 1}`}:</span>
                                        <span className="text-slate-500 line-through">{String(c.before ?? '')}</span>
                                        <span className="text-emerald-400 font-medium">&rarr; {String(c.after ?? '')}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : typeof v.changes === 'object' ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                    {Object.entries(v.changes).map(([k, val]) => (
                                      <div key={k} className="p-2 rounded-lg bg-white/5 border border-white/5">
                                        <span className="text-[10px] text-slate-400 block font-mono">{k}</span>
                                        <span className="text-slate-200 font-medium font-mono">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                <details className="text-[10px] text-slate-500 group">
                                  <summary className="cursor-pointer hover:text-slate-400 select-none">Technical schema</summary>
                                  <pre className="text-xs whitespace-pre-wrap font-mono text-slate-400 bg-black/40 p-2.5 rounded-lg overflow-x-auto border border-white/5 mt-1">
                                    {JSON.stringify(v.changes, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            )}

                            {v.calculation_snapshot && (
                              <SalaryPreview preview={v.calculation_snapshot} inModal={true} isSnapshot={true} showTechnicalDetails={showPayrollDetailsDiagnostics} />
                            )}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>

                  {/* Correction Content & Action History */}
                  <details className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.01] p-4 text-xs group">
                    <summary className="font-bold text-slate-800 dark:text-slate-200 cursor-pointer hover:text-indigo-600 dark:hover:text-white flex items-center justify-between select-none">
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Correction content and reviewer action history
                      </span>
                      <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                    </summary>

                    <div className="mt-4 space-y-4 pt-3 border-t border-slate-200 dark:border-white/5">
                      {/* Content Versions Timeline */}
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                          Content Versions & Correction Notes
                        </span>
                        {detail.data.content_versions && detail.data.content_versions.length > 0 ? (
                          <div className="space-y-2">
                            {detail.data.content_versions.map((cv, idx) => (
                              <div key={idx} className="p-3 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5">
                                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono font-bold text-xs border border-indigo-500/20">
                                    v{cv.version}
                                  </span>
                                  <span className="text-slate-800 dark:text-slate-200 font-medium">
                                    {cv.note || 'No note recorded'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3">
                                  {cv.created_by && <span>By: <strong className="text-slate-700 dark:text-slate-300">{cv.created_by}</strong></span>}
                                  {cv.created_at && <span>{cv.created_at}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-slate-500 italic text-[11px]">No prior content revisions.</p>
                        )}
                      </div>

                      {/* Reviewer Action History Timeline */}
                      <div className="space-y-2 pt-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                          Reviewer Actions & Audit Decisions
                        </span>
                        {detail.data.actions && detail.data.actions.length > 0 ? (
                          <div className="space-y-2">
                            {detail.data.actions.map((act, idx) => (
                              <div key={idx} className="p-3 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                                      ['APPROVE', 'SUBMIT', 'LOCK', 'ACCEPT'].some(s => (act.action || '').toUpperCase().includes(s))
                                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                                        : ['RETURN', 'REJECT', 'CANCEL'].some(s => (act.action || '').toUpperCase().includes(s))
                                        ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
                                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                                    }`}>
                                      {act.action}
                                    </span>
                                    {act.stage && (
                                      <span className="text-[11px] text-slate-500 font-mono">Stage: {act.stage}</span>
                                    )}
                                  </div>
                                  {act.reason && (
                                    <p className="text-xs text-slate-700 dark:text-slate-300 italic pl-1 border-l-2 border-indigo-500/40">
                                      &ldquo;{act.reason}&rdquo;
                                    </p>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0 text-right">
                                  {act.performed_by && <div>By: <strong className="text-slate-700 dark:text-slate-300">{act.performed_by}</strong></div>}
                                  {act.created_at && <div>{act.created_at}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-slate-500 italic text-[11px]">No reviewer actions recorded yet.</p>
                        )}
                      </div>
                    </div>
                  </details>
                </div>
              </details>
            </>
          )}
          </div>
        </Modal>
      )}
    </div>
  );
}
