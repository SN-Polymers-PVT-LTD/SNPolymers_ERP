import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import { Button, Input, TextArea, Badge, Modal } from '../components/ui';
import { getReports, getDeletedReports, createReport, updateReport, deleteReport, restoreReport } from '../api/reportsApi';
import { getProjects } from '../api/projectsApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// ─── Constants ────────────────────────────────────────────────────────────────
const EMPTY_FORM = { work_order_no: '', amount: '', remarks: '' };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN')}` : '—';

const formatDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// ─── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const cfg = {
    Running: { variant: 'emerald', label: 'Running' },
    Closed: { variant: 'red', label: 'Closed' },
    'Complete Under Maintenance': { variant: 'amber', label: 'Under Maintenance' },
  };
  const s = cfg[status] ?? { variant: 'emerald', label: status };
  return (
    <Badge variant={s.variant} showDot={true}>
      {s.label}
    </Badge>
  );
};

// ─── Mutability Warning Banner ────────────────────────────────────────────────
const MutabilityWarning = ({ workOrderNo }) => (
  <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-950/25 border border-red-500/30 text-xs text-red-300">
    <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
    <div>
      <span className="font-extrabold text-red-300 uppercase tracking-wider">Project Closed — Immutable</span>
      <p className="mt-1 font-medium text-red-400/80">
        <span className="font-mono font-bold">{workOrderNo}</span> has status <strong>Closed</strong>.
        All linked fund reports are locked. No new reports can be created, edited, or deleted.
      </p>
    </div>
  </div>
);

// ─── Project Auto-Fill Preview ────────────────────────────────────────────────
const ProjectPreview = ({ master }) => {
  if (!master) return null;
  const rows = [
    { label: 'Estimate No.', value: master.estimate_no },
    { label: 'Site Details', value: master.site_details },
    { label: 'State', value: master.state },
    { label: 'District', value: master.district },
    { label: 'Zone', value: master.zone },
    { label: 'Department', value: master.department },
  ];
  return (
    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4">
      <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-3">
        ⟵ Auto-filled from Master Data
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {rows.map(({ label, value }) => (
          <div key={label}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
            <p className="text-xs font-semibold text-slate-300 mt-0.5 truncate">{value || '—'}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-indigo-500/10">
        <StatusBadge status={master.status} />
      </div>
    </div>
  );
};

// ─── Report Form Modal ────────────────────────────────────────────────────────
const ReportFormModal = ({ mode, initial, projects, onClose, onSave }) => {
  const [form, setForm] = useState(initial ?? EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const masterData = projects.find(
    (p) => p.work_order_no.toLowerCase() === form.work_order_no.trim().toLowerCase()
  );
  const isClosed = masterData?.status === 'Closed';

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isClosed) return;
    setError('');
    setSubmitting(true);
    try {
      await onSave({ ...form, amount: parseFloat(form.amount) });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit Fund Report' : 'Submit Fund Report'}
      size="md"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {!isClosed && (
            <Button
              type="submit"
              variant="primary"
              form="report-form"
              loading={submitting}
            >
              {mode === 'edit' ? 'Save Changes' : 'Submit Report'}
            </Button>
          )}
        </div>
      }
    >
      <form id="report-form" onSubmit={handleSubmit} className="space-y-6 text-left">
        {error && (
          <div className="p-4 bg-red-950/25 border border-red-500/30 rounded-2xl text-xs text-red-300 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        {isClosed && <MutabilityWarning workOrderNo={form.work_order_no} />}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Input
            label="Work Order Number"
            name="work_order_no"
            value={form.work_order_no}
            onChange={handleChange}
            placeholder="e.g. WO-2026-001"
            required
            disabled={mode === 'edit' || submitting}
            size="sm"
          />
          <Input
            label="Disbursed Amount (INR)"
            name="amount"
            type="number"
            value={form.amount}
            onChange={handleChange}
            placeholder="0.00"
            required
            disabled={isClosed || submitting}
            size="sm"
          />
        </div>

        <ProjectPreview master={masterData} />

        <TextArea
          label="Payment Remarks / Reference"
          name="remarks"
          value={form.remarks}
          onChange={handleChange}
          placeholder="e.g., RTGS/NEFT Ref No, Date, Vendor Details..."
          required
          disabled={isClosed || submitting}
          rows={3}
          size="sm"
        />
      </form>
    </Modal>
  );
};

// ─── Confirm Modal ───────────────────────────────────────────────────────────
const ConfirmModal = ({ show, onClose, onConfirm, danger }) => {
  if (!show) return null;
  const title = danger ? 'Soft-Delete Report' : 'Restore Report';
  const message = danger
    ? 'Are you sure you want to soft-delete this fund report? Admins can restore it later.'
    : 'Are you sure you want to restore this soft-deleted fund report?';

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <Button variant="secondary" onClick={onClose} size="sm">
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'success'}
            onClick={onConfirm}
            size="sm"
          >
            {danger ? 'Delete' : 'Restore'}
          </Button>
        </div>
      }
    >
      <p className="text-xs text-slate-400 text-left mb-4">{message}</p>
    </Modal>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────
const FundReports = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tab, setTab] = useState('active'); // 'active' | 'deleted'
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { type, report? }
  const [confirmModal, setConfirmModal] = useState(null); // { type, id, message }

  // Fetch active reports using React Query
  const { data: reportsData, isLoading: loadingReports, error: reportsError } = useQuery({
    queryKey: ['fundReports', 'active'],
    queryFn: async () => {
      const res = await getReports();
      return res.data?.reports ?? [];
    }
  });

  // Fetch deleted reports using React Query
  const { data: deletedReportsData } = useQuery({
    queryKey: ['fundReports', 'deleted'],
    queryFn: async () => {
      const res = await getDeletedReports();
      return res.data?.reports ?? [];
    },
    enabled: isAdmin
  });

  // Fetch projects using React Query
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await getProjects();
      return res.data?.projects ?? [];
    }
  });

  const reports = reportsData || [];
  const deletedReports = deletedReportsData || [];
  const projects = projectsData || [];
  const loading = loadingReports;
  const displayError = error || reportsError?.response?.data?.message || reportsError?.message;

  // Auto-dismiss success
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4500);
    return () => clearTimeout(t);
  }, [success]);

  // ── Handlers ──
  const handleCreate = async (form) => {
    try {
      await createReport(form);
      setSuccess('Fund report created successfully.');
      queryClient.invalidateQueries({ queryKey: ['fundReports'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create report.');
    }
  };

  const handleUpdate = async (form) => {
    try {
      await updateReport(modal.report.fund_report_id, { amount: form.amount, remarks: form.remarks });
      setSuccess('Fund report updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['fundReports'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update report.');
    }
  };

  const handleDelete = async (id) => {
    setConfirmModal(null);
    try {
      await deleteReport(id);
      setSuccess('Report soft-deleted.');
      queryClient.invalidateQueries({ queryKey: ['fundReports'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete report.');
    }
  };

  const handleRestore = async (id) => {
    setConfirmModal(null);
    try {
      await restoreReport(id);
      setSuccess('Report restored successfully.');
      queryClient.invalidateQueries({ queryKey: ['fundReports'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to restore report.');
    }
  };

  // ── Filtered lists ──
  const activeFiltered = reports.filter((r) => {
    const q = search.toLowerCase();
    return (
      !q ||
      r.work_order_no?.toLowerCase().includes(q) ||
      r.projects_master?.state?.toLowerCase().includes(q) ||
      r.projects_master?.district?.toLowerCase().includes(q) ||
      r.remarks?.toLowerCase().includes(q)
    );
  });

  const deletedFiltered = deletedReports.filter((r) => {
    const q = search.toLowerCase();
    return !q || r.work_order_no?.toLowerCase().includes(q);
  });

  // ── Stat cards ──
  const totalAmount = reports.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const runningCount = reports.filter((r) => r.projects_master?.status === 'Running').length;
  const closedCount = reports.filter((r) => r.projects_master?.status === 'Closed').length;

  return (
    <>
      <main className="flex-grow p-6 md:p-10 overflow-y-auto w-full relative z-10">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
              Government Division · Finance
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Fund Reports</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              Manage disbursement records linked to project work orders. Auto-fills site data from Master Data.
            </p>
          </div>
          <Button
            id="btn-create-report"
            onClick={() => setModal({ type: 'create' })}
            variant="primary"
            icon={
              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            }
          >
            New Report
          </Button>
        </div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Reports', value: reports.length, accent: 'from-indigo-500/20 to-indigo-500/5', border: 'border-indigo-500/20', mono: false },
            { label: 'Total Disbursed', value: formatCurrency(totalAmount), accent: 'from-emerald-500/20 to-emerald-500/5', border: 'border-emerald-500/20', small: true },
            { label: 'Running Projects', value: runningCount, accent: 'from-emerald-500/10 to-emerald-500/5', border: 'border-emerald-500/15' },
            { label: 'Closed Projects', value: closedCount, accent: 'from-red-500/20 to-red-500/5', border: 'border-red-500/20' },
          ].map(({ label, value, accent, border, small }) => (
            <div key={label} className={`glass-panel rounded-2xl p-5 border ${border} bg-gradient-to-br ${accent}`}>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
              <p className={`font-black text-slate-100 mt-1.5 tabular-nums ${small ? 'text-xl' : 'text-3xl'}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* ── Notifications ── */}
        {displayError && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-5 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {displayError}
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-5 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        {/* ── Tabs + Search ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-1 glass-panel p-1 rounded-xl border border-white/5">
            {(['active', ...(isAdmin ? ['deleted'] : [])]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                  tab === t
                    ? 'bg-white/10 text-slate-100 border border-white/10'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t === 'active' ? `Active (${reports.length})` : `Deleted (${deletedReports.length})`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Input
              id="search-reports"
              type="text"
              placeholder="Search reports…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              size="sm"
              iconLeft={
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              containerClassName="w-52"
            />
            <Button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['fundReports'] })}
              title="Refresh"
              variant="glass"
              size="sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </Button>
          </div>
        </div>

        {/* ── Active Reports Table ── */}
        {tab === 'active' && (
          <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
            {loading ? (
              <div className="flex items-center justify-center p-24">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
              </div>
            ) : activeFiltered.length === 0 ? (
              <div className="text-center p-24 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                {search ? 'No matching reports.' : 'No active fund reports. Create one to get started.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-500">
                      {['Work Order', 'State / District', 'Dept.', 'Amount', 'Remarks', 'Project Status', 'Created', 'Actions'].map((h) => (
                        <th key={h} className="py-4 px-5 font-extrabold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                    {activeFiltered.map((report) => {
                      const pm = report.projects_master ?? {};
                      const closed = pm.status === 'Closed';
                      return (
                        <tr key={report.fund_report_id} className="hover:bg-white/[0.025] transition-colors duration-200 group">
                          <td className="py-4 px-5 font-mono font-semibold text-slate-100 whitespace-nowrap">
                            {report.work_order_no}
                          </td>
                          <td className="py-4 px-5 whitespace-nowrap">
                            <span className="font-semibold text-slate-200">{pm.state}</span>
                            {pm.district && <span className="text-slate-500"> / {pm.district}</span>}
                          </td>
                          <td className="py-4 px-5 text-slate-400 whitespace-nowrap">{pm.department || '—'}</td>
                          <td className="py-4 px-5 font-mono font-bold text-emerald-400 whitespace-nowrap">
                            {formatCurrency(report.amount)}
                          </td>
                          <td className="py-4 px-5 max-w-[160px]">
                            <span className="block truncate text-slate-400" title={report.remarks}>{report.remarks || '—'}</span>
                          </td>
                          <td className="py-4 px-5 whitespace-nowrap">
                            <StatusBadge status={pm.status} />
                          </td>
                          <td className="py-4 px-5 text-[11px] text-slate-500 whitespace-nowrap">{formatDate(report.created_at)}</td>
                          <td className="py-4 px-5 whitespace-nowrap">
                            <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
                              {/* Edit — hidden if closed */}
                              {!closed && (
                                <button
                                  id={`btn-edit-report-${report.fund_report_id}`}
                                  onClick={() => setModal({ type: 'edit', report })}
                                  title="Edit"
                                  className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition-all"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                              )}
                              {/* Lock icon for closed */}
                              {closed && (
                                <span title="Immutable — project is Closed" className="p-1.5 rounded-lg bg-red-500/5 border border-red-500/15 text-red-500/50">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                  </svg>
                                </span>
                              )}
                              {/* Delete (admin only, blocked if closed) */}
                              {isAdmin && !closed && (
                                <button
                                  id={`btn-delete-report-${report.fund_report_id}`}
                                  onClick={() =>
                                    setConfirmModal({
                                      type: 'delete',
                                      id: report.fund_report_id,
                                      message: `Soft-delete report for ${report.work_order_no}? It can be restored later.`,
                                    })
                                  }
                                  title="Delete"
                                  className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] text-[10px] text-slate-600 font-mono">
                  Showing {activeFiltered.length} of {reports.length} active records
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Deleted Reports Table (Admin) ── */}
        {tab === 'deleted' && isAdmin && (
          <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
            {loading ? (
              <div className="flex items-center justify-center p-24">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
              </div>
            ) : deletedFiltered.length === 0 ? (
              <div className="text-center p-24 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                No deleted reports.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-500">
                      {['Work Order', 'Amount', 'Remarks', 'Deleted By', 'Deleted At', 'Restore'].map((h) => (
                        <th key={h} className="py-4 px-5 font-extrabold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-slate-400">
                    {deletedFiltered.map((r) => (
                      <tr key={r.fund_report_id} className="hover:bg-white/[0.02] transition-colors duration-200">
                        <td className="py-4 px-5 font-mono font-semibold text-slate-300">{r.work_order_no}</td>
                        <td className="py-4 px-5 font-mono font-bold text-slate-400">{formatCurrency(r.amount)}</td>
                        <td className="py-4 px-5 max-w-[140px]">
                          <span className="block truncate" title={r.remarks}>{r.remarks || '—'}</span>
                        </td>
                        <td className="py-4 px-5 font-mono text-[11px]">{r.deleted_by || '—'}</td>
                        <td className="py-4 px-5 text-[11px]">{formatDate(r.deleted_at)}</td>
                        <td className="py-4 px-5">
                          <button
                            id={`btn-restore-${r.fund_report_id}`}
                            onClick={() =>
                              setConfirmModal({
                                type: 'restore',
                                id: r.fund_report_id,
                                message: `Restore this report for ${r.work_order_no}? It will appear in the active list again.`,
                              })
                            }
                            className="px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all"
                          >
                            Restore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] text-[10px] text-slate-600 font-mono">
                  {deletedFiltered.length} deleted record{deletedFiltered.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Report Form Modals ── */}
      {modal?.type === 'create' && (
        <ReportFormModal
          mode="create"
          initial={EMPTY_FORM}
          projects={projects}
          onClose={() => setModal(null)}
          onSave={handleCreate}
        />
      )}
      {modal?.type === 'edit' && (
        <ReportFormModal
          mode="edit"
          initial={{
            work_order_no: modal.report.work_order_no,
            amount: modal.report.amount,
            remarks: modal.report.remarks || '',
          }}
          projects={projects}
          onClose={() => setModal(null)}
          onSave={handleUpdate}
        />
      )}

      {/* ── Confirm Modal ── */}
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          danger={confirmModal.type === 'delete'}
          onClose={() => setConfirmModal(null)}
          onConfirm={() =>
            confirmModal.type === 'delete'
              ? handleDelete(confirmModal.id)
              : handleRestore(confirmModal.id)
          }
        />
      )}
    </>
  );
};

export default FundReports;
