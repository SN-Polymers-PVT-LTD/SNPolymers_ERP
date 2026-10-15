import React, { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Select, Pagination } from '../../components/ui';
import SalaryPreview from '../../components/payroll/SalaryPreview';
import { listPayrollRuns, getPayrollRun, previewPayrollRow } from '../../api/payrollPreviewApi';

const message = (e) => e?.response?.data?.message || e.message;

export default function PayrollPreviews() {
  const { user } = useAuth();
  const allowed = ['admin', 'accounts', 'ho', 'factory_manager'].includes(user?.role);
  const activeRow = useRef(null);

  const [page, setPage] = useState(1);
  const [run, setRun] = useState('');
  const [rowPage, setRowPage] = useState(1);
  const [shown, setShown] = useState(null);

  const runs = useQuery({
    queryKey: ['payroll-preview-runs', page],
    enabled: allowed,
    queryFn: async () => (await listPayrollRuns({ page, limit: 20 })).data.selection
  });

  const detail = useQuery({
    queryKey: ['payroll-preview-run', run, rowPage],
    enabled: allowed && !!run,
    queryFn: async () => (await getPayrollRun(run, { page: rowPage, limit: 20 })).data.draft
  });

  const preview = useMutation({
    mutationFn: ({ id, fingerprint }) => previewPayrollRow(id, fingerprint),
    onSuccess: (r) => {
      if (activeRow.current === r.data.preview.row_id) {
        setShown(r.data.preview);
      }
    },
    onError: () => setShown(null)
  });

  if (!allowed) {
    return (
      <div className="p-8 text-center max-w-md mx-auto">
        <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
          <svg className="w-10 h-10 mx-auto mb-3 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-lg font-bold text-white mb-1">Access Restricted</h2>
          <p role="alert" className="text-xs text-rose-300/80">
            Payroll preview access is required.
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
              Calculation Simulator
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Payroll salary previews
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
            Read-only estimates. Use Payroll Review for submissions and corrections. Financial locking, statutory posting and payment remain disabled. Unresolved deductions leave final net salary unavailable.
          </p>
        </div>

        {/* View Mode Tabs (Review Queue vs Calculation Previews) */}
        <div className="flex items-center p-1 rounded-2xl bg-white/5 border border-white/10 shrink-0 self-start md:self-auto">
          <a
            href="/hr/payroll/review"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Review Queue
          </a>
          <a
            href="/hr/payroll/previews"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
          >
            <span aria-hidden="true" className="font-mono">₹</span>
            Payroll Previews
          </a>
        </div>
      </div>

      {/* Draft Run Selector Card */}
      <section aria-label="Draft Run Selection" className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/40 space-y-4 shadow-lg">
        <div className="border-b border-white/5 pb-2">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
            Step 1: Select Active Draft Sheet
          </span>
          <h2 className="text-sm font-bold text-white mt-0.5">
            Target Payroll Sheet
          </h2>
        </div>

        {runs.isPending ? (
          <div className="p-8 text-center text-slate-400 space-y-2">
            <div className="w-6 h-6 mx-auto border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p role="status" className="text-xs font-mono">Loading payroll runs…</p>
          </div>
        ) : runs.isError ? (
          <div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
            <span>{message(runs.error)}</span>
            <Button size="sm" variant="secondary" onClick={() => runs.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Select
              label="Payroll run"
              value={run}
              options={[
                { value: '', label: 'Select a draft run' },
                ...runs.data.runs.map((r) => ({
                  value: r.id,
                  label: `${r.group_code} / ${r.department} / ${r.period_from} – ${r.period_to}`
                }))
              ]}
              onChange={(e) => {
                activeRow.current = null;
                setRun(e.target.value);
                setRowPage(1);
                setShown(null);
                preview.reset();
              }}
            />

            {!runs.data.runs.length && (
              <p className="text-xs text-slate-400 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                No accessible payroll draft runs.
              </p>
            )}

            {runs.data.total > 20 && (
              <div className="flex justify-end pt-2">
                <Pagination
                  currentPage={page}
                  totalPages={Math.ceil(runs.data.total / 20)}
                  onPageChange={setPage}
                />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Employee Rows Table for Selected Run */}
      {run && (
        <section aria-label="Employees In Sheet" className="glass-panel rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden shadow-xl space-y-4">
          <div className="p-4 sm:p-5 border-b border-white/5 bg-white/[0.01]">
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
              Step 2: Employee Line Item Simulation
            </span>
            <h2 className="text-sm font-bold text-white mt-0.5">
              Available Employees in Selected Run
            </h2>
          </div>

          {detail.isPending ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <div className="w-6 h-6 mx-auto border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <p role="status" className="text-xs font-mono">Loading employee rows…</p>
            </div>
          ) : detail.isError ? (
            <div role="alert" className="p-6 text-center space-y-3">
              <p className="text-rose-400 text-xs font-medium">{message(detail.error)}</p>
              <Button size="sm" variant="secondary" onClick={() => detail.refetch()}>
                Retry rows
              </Button>
            </div>
          ) : (
            <div className="p-4 sm:p-5 pt-0 space-y-4">
              <div className="overflow-x-auto rounded-xl border border-white/5">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-4">Employee reference</th>
                      <th className="py-3 px-4">Period</th>
                      <th className="py-3 px-4 text-right">Preview</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {detail.data.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-4 font-mono text-xs font-bold text-white">
                          {r.employee_id}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-300 font-mono">
                          {r.period_from} &ndash; {r.period_to}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            disabled={preview.isPending}
                            onClick={() => {
                              activeRow.current = r.id;
                              setShown(null);
                              preview.mutate({ id: r.id });
                            }}
                            className="text-xs"
                          >
                            Generate preview
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!detail.data.rows.length && (
                <p className="text-xs text-slate-400 text-center p-6">
                  No employees in this draft run.
                </p>
              )}

              {detail.data.total_rows > 20 && (
                <div className="flex justify-end pt-2">
                  <Pagination
                    currentPage={rowPage}
                    totalPages={Math.ceil(detail.data.total_rows / 20)}
                    onPageChange={setRowPage}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Progress & Error Alerts */}
      {preview.isPending && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-mono">
          <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p role="status">Resolving historical sources and calculating…</p>
        </div>
      )}

      {preview.error && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-medium">
          {message(preview.error)}
        </div>
      )}

      {/* Live Calculated Salary Diagnostic Display */}
      {shown && (
        <section aria-label="Generated Salary Diagnostic" className="glass-panel p-6 rounded-3xl border border-amber-500/20 bg-slate-900/60 shadow-2xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
                Authoritative On-The-Fly Calculation
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Salary Diagnostic Breakdown
              </h3>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShown(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Clear
            </Button>
          </div>

          <SalaryPreview preview={shown}>
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={preview.isPending}
                onClick={() =>
                  preview.mutate({
                    id: shown.row_id,
                    fingerprint: shown.source_fingerprint
                  })
                }
              >
                Check preview freshness
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={preview.isPending}
                onClick={() => {
                  setShown(null);
                  preview.mutate({ id: shown.row_id });
                }}
              >
                Generate fresh preview
              </Button>
            </div>
          </SalaryPreview>
        </section>
      )}
    </div>
  );
}
