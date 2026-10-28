import React from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import {
  Button,
  Input,
  Select,
  Pagination,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  Badge,
} from '../../components/ui';
import { getPayrollFoundationContext } from '../../api/payrollReviewApi';
import { getSalaryRegister, exportSalaryReport, getDiagnosticPayslip } from '../../api/payrollReportsApi';
import { usePayrollRegisterUrlState } from '../../hooks/usePayrollRegisterUrlState';
import PayrollPayslip from '../../components/payroll/PayrollPayslip';

const statuses = [
  'DRAFT',
  'CALCULATED',
  'PENDING_ACCOUNTS_REVIEW',
  'PENDING_HO_APPROVAL',
  'RETURNED_TO_CREATOR',
  'CANCELLED_DRAFT',
  'LOCKED',
];

const getStatusBadgeVariant = (status) => {
  switch (status) {
    case 'DRAFT':
      return 'slate';
    case 'CALCULATED':
      return 'amber';
    case 'PENDING_ACCOUNTS_REVIEW':
      return 'blue';
    case 'PENDING_HO_APPROVAL':
      return 'purple';
    case 'RETURNED_TO_CREATOR':
      return 'red';
    case 'CANCELLED_DRAFT':
      return 'slate';
    case 'LOCKED':
      return 'emerald';
    default:
      return 'slate';
  }
};

const message = (e) => e?.response?.data?.message || e.message;
const amount = (v) => v ?? 'Unavailable';

function download(response, filename) {
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PayrollRegister() {
  const { user } = useAuth();
  const allowed = ['admin', 'accounts', 'ho', 'factory_manager'].includes(user?.role);

  const {
    filters,
    draft,
    setDraft,
    page,
    setPage,
    applyFilters,
    employee,
    openPayslip,
    closePayslip
  } = usePayrollRegisterUrlState();

  const context = useQuery({
    queryKey: ['payroll-report-context', user?.id, user?.role],
    enabled: allowed,
    queryFn: async () => (await getPayrollFoundationContext()).data.context,
  });

  const report = useQuery({
    queryKey: ['salary-register', user?.id, user?.role, filters, page],
    enabled: allowed,
    queryFn: async () => (await getSalaryRegister({ ...filters, page, limit: 20 })).data.register,
  });

  const payslip = useQuery({
    queryKey: ['payroll-diagnostic-payslip', user?.id, user?.role, employee],
    enabled: allowed && !!employee,
    queryFn: async () => (await getDiagnosticPayslip(employee)).data.payslip,
  });

  const exporter = useMutation({
    mutationFn: async ({ format, kind }) => {
      try {
        const response = await exportSalaryReport({ ...filters, format, report: kind });
        download(response, `payroll-${kind}-diagnostic.${format}`);
      } catch (error) {
        if (error.response?.data instanceof Blob) {
          try {
            error.message = JSON.parse(await error.response.data.text()).message;
          } catch {
            /* retain transport message */
          }
        }
        throw error;
      }
    },
  });

  const groups = context.data?.groups || [];
  const departments = [...new Set(groups.map((g) => g.department))];
  const counts = Object.fromEntries(
    statuses.map((s) => [
      s,
      (report.data?.summaries || [])
        .filter((r) => r.status === s)
        .reduce((sum, r) => sum + r.row_count, 0),
    ])
  );

  const update = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  if (!allowed) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div role="alert" className="glass-panel p-6 rounded-2xl border border-red-500/30 bg-red-950/20 text-red-300 flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
          <p className="text-sm font-semibold">Payroll reporting access is required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-16 text-slate-200">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/5 shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
              HR & Payroll
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">
              Salary Register
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
            Payroll salary register
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5 max-w-4xl leading-relaxed">
            Saved calculations remain diagnostic until an employee is Locked. Locked rows use immutable financial snapshots; payment and statutory settlement are separate. Overlapping drafts may duplicate entitlement. Date filters include whole overlapping rows without prorating amounts. Unresolved deductions and net salary remain unavailable.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <Link
            to="/hr/payroll/review"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 transition-all duration-200 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span>Preparation and employee review</span>
          </Link>
        </div>
      </div>

      {/* Preparation and Review Progress KPI Strip */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-white/[0.02] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <h2 className="text-xs uppercase font-extrabold tracking-widest text-slate-300">
              Preparation and review progress
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">
            Draft {counts.DRAFT} · Calculated {counts.CALCULATED} · Pending Accounts {counts.PENDING_ACCOUNTS_REVIEW} · Pending HO {counts.PENDING_HO_APPROVAL} · Returned {counts.RETURNED_TO_CREATOR} · Locked {counts.LOCKED} · Withdrawn {counts.CANCELLED_DRAFT}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {/* Draft */}
          <div className="glass-panel p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/10 transition-all flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Draft</span>
            <div className="mt-3">
              <span className="text-2xl font-black text-slate-200 font-mono tabular-nums">{counts.DRAFT}</span>
            </div>
          </div>

          {/* Calculated */}
          <div className="glass-panel p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/10 transition-all flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Calculated</span>
            <div className="mt-3">
              <span className="text-2xl font-black text-amber-400 font-mono tabular-nums">{counts.CALCULATED}</span>
            </div>
          </div>

          {/* Pending Accounts */}
          <div className="glass-panel p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/10 transition-all flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Pending Accounts</span>
            <div className="mt-3">
              <span className="text-2xl font-black text-blue-400 font-mono tabular-nums">{counts.PENDING_ACCOUNTS_REVIEW}</span>
            </div>
          </div>

          {/* Pending HO */}
          <div className="glass-panel p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/10 transition-all flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Pending HO</span>
            <div className="mt-3">
              <span className="text-2xl font-black text-purple-400 font-mono tabular-nums">{counts.PENDING_HO_APPROVAL}</span>
            </div>
          </div>

          {/* Returned */}
          <div className="glass-panel p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/10 transition-all flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">Returned</span>
            <div className="mt-3">
              <span className="text-2xl font-black text-rose-400 font-mono tabular-nums">{counts.RETURNED_TO_CREATOR}</span>
            </div>
          </div>

          {/* Locked */}
          <div className="glass-panel p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/10 transition-all flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Locked</span>
            <div className="mt-3">
              <span className="text-2xl font-black text-emerald-400 font-mono tabular-nums">{counts.LOCKED}</span>
            </div>
          </div>

          {/* Withdrawn */}
          <div className="glass-panel p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/10 transition-all flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Withdrawn</span>
            <div className="mt-3">
              <span className="text-2xl font-black text-slate-400 font-mono tabular-nums">{counts.CANCELLED_DRAFT}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Form and Export Card */}
      <div className="payroll-report-controls glass-panel p-6 rounded-2xl border border-white/10 bg-white/[0.02] space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/5 pb-4">
          <div>
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-300">
              Salary Register Filters & Exports
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Refine reports by department, payroll group, target date range, or review status.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={exporter.isPending || report.isPending || report.isError}
              onClick={() => exporter.mutate({ format: 'xlsx', kind: 'register' })}
              icon={
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
            >
              Export Excel salary register
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={exporter.isPending || report.isPending || report.isError}
              onClick={() => exporter.mutate({ format: 'xlsx', kind: 'departments' })}
              icon={
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
            >
              Export department report
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={exporter.isPending || report.isPending || report.isError}
              onClick={() => exporter.mutate({ format: 'html', kind: 'departments' })}
              icon={
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
              }
            >
              Download printable summary
            </Button>
          </div>
        </div>

        <form
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters(draft);
            exporter.reset();
          }}
        >
          <Input
            label="Employee name / code"
            placeholder="Search name or ID..."
            value={draft.search || ''}
            maxLength={120}
            onChange={(e) => update('search', e.target.value)}
          />
          <Select
            label="Department"
            value={draft.department || ''}
            options={[
              { value: '', label: 'All authorized departments' },
              ...departments.map((d) => ({ value: d, label: d })),
            ]}
            onChange={(e) => {
              update('department', e.target.value);
              update('group_code', '');
            }}
          />
          <Select
            label="Payroll group"
            value={draft.group_code || ''}
            options={[
              { value: '', label: 'All groups' },
              ...[
                ...new Set(
                  groups
                    .filter((g) => !draft.department || g.department === draft.department)
                    .map((g) => g.code)
                ),
              ].map((g) => ({ value: g, label: g })),
            ]}
            onChange={(e) => update('group_code', e.target.value)}
          />
          <Input
            type="date"
            label="Period from"
            value={draft.from || ''}
            onChange={(e) => update('from', e.target.value)}
          />
          <Input
            type="date"
            label="Period to"
            value={draft.to || ''}
            onChange={(e) => update('to', e.target.value)}
          />
          <Select
            label="Review status"
            value={draft.status || ''}
            options={[
              { value: '', label: 'All review states' },
              ...statuses.map((s) => ({ value: s, label: s })),
            ]}
            onChange={(e) => update('status', e.target.value)}
          />
          <div className="w-full">
            <Button type="submit" variant="primary" className="w-full justify-center shadow-lg shadow-amber-500/10">
              Apply report filters
            </Button>
          </div>
        </form>

        {context.isError && (
          <div role="alert" className="p-4 bg-red-950/30 border border-red-500/20 rounded-xl text-xs text-red-300 flex items-center justify-between">
            <span>{message(context.error)}</span>
            <Button variant="danger" size="xs" onClick={() => context.refetch()}>
              Retry report scopes
            </Button>
          </div>
        )}

        {exporter.isPending && (
          <div role="status" className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-xl text-xs text-sky-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            Preparing authorized export…
          </div>
        )}
        {exporter.isSuccess && (
          <div role="status" className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Diagnostic export downloaded.
          </div>
        )}
        {exporter.isError && (
          <div role="alert" className="p-4 bg-red-950/30 border border-red-500/20 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
            {message(exporter.error)}
          </div>
        )}
      </div>

      {/* Main Report Body */}
      {report.isPending ? (
        <div className="glass-panel p-12 rounded-2xl border border-white/10 bg-white/[0.02] text-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin mx-auto" />
          <p role="status" className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Loading salary register…
          </p>
        </div>
      ) : report.isError ? (
        <div role="alert" className="glass-panel p-6 rounded-2xl border border-red-500/30 bg-red-950/20 text-red-300 space-y-4">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
            <p className="text-sm font-semibold">{message(report.error)}</p>
          </div>
          <Button variant="danger" size="sm" onClick={() => report.refetch()}>
            Retry salary register
          </Button>
        </div>
      ) : (
        <>
          {/* Department totals by review state card */}
          <div className="glass-panel rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
            <div className="p-5 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400" />
                  <h2 className="text-xs uppercase font-extrabold tracking-widest text-slate-300">
                    Department totals by review state
                  </h2>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Totals cover every matching employee row, across all pages. Known subtotals may be incomplete. Compare each review state separately; draft totals are diagnostic.
                </p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow hover={false}>
                  <TableCell isHeader>Department</TableCell>
                  <TableCell isHeader>Review state</TableCell>
                  <TableCell isHeader>Rows</TableCell>
                  <TableCell isHeader align="right">Known gross subtotal</TableCell>
                  <TableCell isHeader align="right">Complete gross total</TableCell>
                  <TableCell isHeader align="right">Known LOP subtotal</TableCell>
                  <TableCell isHeader align="right">Complete net total</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.summaries.map((s) => (
                  <TableRow key={`${s.department}:${s.status}`}>
                    <TableCell className="font-semibold text-slate-200">{s.department}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(s.status)}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.row_count} <span className="text-slate-500">({s.gross_known_rows} with gross)</span>
                    </TableCell>
                    <TableCell align="right" className="font-mono tabular-nums text-slate-200">
                      {amount(s.known_gross_total)}
                    </TableCell>
                    <TableCell align="right" className="font-mono tabular-nums font-bold text-amber-400">
                      {amount(s.gross_total)}
                    </TableCell>
                    <TableCell align="right" className="font-mono tabular-nums text-rose-400">
                      {amount(s.known_lop_total)}
                    </TableCell>
                    <TableCell align="right" className="font-mono tabular-nums font-bold text-emerald-400">
                      {amount(s.net_total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Matching employee rows main card */}
          <div className="glass-panel rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden space-y-0">
            <div className="p-5 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <h2 className="text-xs uppercase font-extrabold tracking-widest text-slate-300">
                    Employee Salary Records
                  </h2>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {report.data.total} matching employee rows · Generated {report.data.generated_at} · Payment status: {report.data.payment_status}
                </span>
              </div>
              <Badge variant={report.data.payment_status === 'SETTLED' ? 'emerald' : 'amber'}>
                Payment: {report.data.payment_status}
              </Badge>
            </div>

            <Table>
              <TableHeader>
                <TableRow hover={false}>
                  <TableCell isHeader>Employee</TableCell>
                  <TableCell isHeader>Department / group</TableCell>
                  <TableCell isHeader>Period</TableCell>
                  <TableCell isHeader align="right">Known earnings</TableCell>
                  <TableCell isHeader align="right">LOP</TableCell>
                  <TableCell isHeader align="right">Gross after LOP</TableCell>
                  <TableCell isHeader align="center">EPF / ESI / PT</TableCell>
                  <TableCell isHeader align="right">Net salary</TableCell>
                  <TableCell isHeader>Review / payment</TableCell>
                  <TableCell isHeader>Evidence</TableCell>
                  <TableCell isHeader align="right">Employee detail</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-bold text-slate-100 block">{r.employee_name}</span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {r.employee_code} / {r.employee_category}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-slate-200 block">{r.department}</span>
                      <span className="text-[11px] text-amber-500/90 font-mono">{r.group_code}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-slate-300 block">
                        {r.period_from} – {r.period_to}
                      </span>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">{r.cycle}</span>
                    </TableCell>
                    <TableCell align="right" className="font-mono tabular-nums text-slate-300">
                      {amount(r.earnings_total)}
                    </TableCell>
                    <TableCell align="right" className="font-mono tabular-nums text-rose-400">
                      {amount(r.lop)}
                    </TableCell>
                    <TableCell align="right" className="font-mono tabular-nums font-semibold text-slate-100">
                      {amount(r.gross_after_lop)}
                    </TableCell>
                    <TableCell align="center" className="font-mono text-xs tabular-nums text-slate-400">
                      {amount(r.epf)} / {amount(r.esi)} / {amount(r.pt)}
                    </TableCell>
                    <TableCell align="right" className="font-mono tabular-nums font-bold text-emerald-400">
                      {amount(r.net_salary)}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant={getStatusBadgeVariant(r.status)}>
                          {r.status}
                        </Badge>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {r.status} / {r.payment_status}
                        </div>
                        {r.last_return_reason && (
                          <div className="text-[11px] text-rose-300 font-medium bg-rose-500/10 p-1.5 rounded-lg border border-rose-500/20 max-w-xs mt-1">
                            {r.last_return_reason}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300 block">
                          {r.evidence_status}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono block">
                          Revision {r.revision ?? 'none'} · {r.blockers.length} blockers
                        </span>
                      </div>
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex flex-col items-end gap-1.5">
                        <Link
                          className="text-xs text-amber-400 hover:text-amber-300 hover:underline font-semibold"
                          to={`/hr/payroll/review?row=${r.id}`}
                        >
                          Breakdown and revision history
                        </Link>
                        {r.evidence_status === 'IMMUTABLE_LOCKED' && ['accounts', 'ho', 'admin'].includes(user.role) && (
                          <Link
                            className="text-xs text-emerald-400 hover:text-emerald-300 hover:underline font-semibold"
                            to={`/hr/payroll/payslips/${r.id}`}
                          >
                            Official Locked payslip
                          </Link>
                        )}
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={r.evidence_status !== 'SAVED_DIAGNOSTIC'}
                          onClick={() => openPayslip(r.id)}
                        >
                          Diagnostic payslip
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {!report.data.rows.length && (
              <div className="p-12 text-center text-slate-400 text-xs uppercase font-extrabold tracking-widest border-t border-white/5">
                <p>No employee rows match these filters.</p>
              </div>
            )}

            <div className="p-4 border-t border-white/5 flex justify-end">
              <Pagination
                currentPage={page}
                totalPages={Math.ceil(report.data.total / 20)}
                onPageChange={setPage}
              />
            </div>
          </div>
        </>
      )}

      {/* Diagnostic Payslip Modal Preview */}
      {employee && createPortal(
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md p-4 sm:p-6 flex justify-center items-start payroll-print">
          <div className="glass-panel w-full max-w-5xl rounded-3xl border border-white/15 bg-slate-900/95 shadow-2xl p-6 sm:p-8 space-y-6 my-8">
            <div className="payroll-report-controls flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
                  Preview Document
                </span>
                <h2 className="text-xl font-bold text-slate-100 mt-0.5">
                  Diagnostic Employee Payslip
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => window.print()}
                  disabled={!payslip.data}
                >
                  Print diagnostic payslip
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={closePayslip}
                >
                  Close diagnostic payslip
                </Button>
              </div>
            </div>

            {payslip.isPending ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-8 h-8 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin mx-auto" />
                <p role="status" className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Loading diagnostic payslip…
                </p>
              </div>
            ) : payslip.isError ? (
              <div role="alert" className="p-4 bg-red-950/30 border border-red-500/20 rounded-xl text-xs text-red-300 flex items-center justify-between">
                <span>{message(payslip.error)}</span>
                <Button variant="danger" size="xs" onClick={() => payslip.refetch()}>
                  Retry diagnostic payslip
                </Button>
              </div>
            ) : (
              <PayrollPayslip payslip={payslip.data} />
            )}
          </div>
        </div>,
        document.body
      )}

      <style>{`
        @media print {
          /* The portal escapes the app shell's fixed height and scroll containers. */
          body:has(> .payroll-print) {
            background: white !important;
          }
          body:has(> .payroll-print) > :not(.payroll-print) {
            display: none !important;
          }
          .payroll-print {
            position: static;
            inset: auto;
            display: block;
            height: auto;
            max-height: none;
            overflow: visible;
            width: 100%;
            margin: 0;
            padding: 0;
            backdrop-filter: none !important;
            color: black;
            background: white !important;
          }
          .payroll-print > .glass-panel {
            margin: 0;
            padding: 0;
            max-width: none;
            border: 0;
            box-shadow: none;
          }
          .payroll-report-controls,
          .payroll-report-controls * {
            display: none !important;
          }
          .payroll-print details {
            display: none;
          }
          .payroll-print section {
            color: black;
          }
        }
      `}</style>
    </div>
  );
}
