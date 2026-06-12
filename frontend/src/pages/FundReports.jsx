import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import { getReports, getDeletedReports, createReport, updateReport, deleteReport, restoreReport } from '../api/reportsApi';
import { getProjects } from '../api/projectsApi';

// ─── Constants ────────────────────────────────────────────────────────────────
const EMPTY_FORM = { work_order_no: '', amount: '', remarks: '' };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN')}` : '—';

const formatDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// ─── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const cfg = {
    Running: { dot: 'bg-emerald-400', pill: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400', label: 'Running' },
    Closed: { dot: 'bg-red-400', pill: 'bg-red-500/10 border-red-500/25 text-red-400', label: 'Closed' },
    'Complete Under Maintenance': { dot: 'bg-amber-400', pill: 'bg-amber-500/10 border-amber-500/25 text-amber-400', label: 'Under Maintenance' },
  };
  const s = cfg[status] ?? cfg['Running'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
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
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(initial ?? EMPTY_FORM);
  const [masterData, setMasterData] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  // Auto-fill when editing an existing report
  useEffect(() => {
    if (isEdit && initial?.work_order_no) {
      const proj = projects.find((p) => p.work_order_no === initial.work_order_no);
      if (proj) {
        setMasterData(proj);
        setIsClosed(proj.status === 'Closed');
      }
    }
  }, [isEdit, initial, projects]);

  // Debounced lookup for create mode
  const lookupProject = useCallback(
    (won) => {
      clearTimeout(debounceRef.current);
      if (!won.trim()) {
        setMasterData(null);
        setIsClosed(false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        const proj = projects.find(
          (p) => p.work_order_no.toLowerCase() === won.trim().toLowerCase()
        );
        if (proj) {
          setMasterData(proj);
          setIsClosed(proj.status === 'Closed');
        } else {
          setMasterData(null);
          setIsClosed(false);
        }
        setLookupLoading(false);
      }, 400);
      setLookupLoading(true);
    },
    [projects]
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (name === 'work_order_no' && !isEdit) {
      lookupProject(value);
    }
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="glass-panel p-6 rounded-3xl max-w-lg w-full shadow-[0_25px_60px_rgba(0,0,0,0.7)] border border-white/10 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-indigo-500/5 blur-3xl pointer-events-none" />

        <div className="flex justify-between items-center mb-5 relative z-10">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 font-mono">
              {isEdit ? 'Edit Record' : 'New Record'}
            </span>
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
              {isEdit ? 'Edit Fund Report' : 'Create Fund Report'}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative z-10 space-y-4">
          {/* Work Order No. */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Work Order No. <span className="text-red-400">*</span>
            </label>
            {isEdit ? (
              <div className="glass-input rounded-xl px-4 py-3 text-sm font-mono font-semibold text-slate-500 opacity-60 cursor-not-allowed">
                {form.work_order_no}
                <span className="ml-2 text-[9px] font-sans uppercase tracking-wider text-slate-600">
                  (linked — immutable)
                </span>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  name="work_order_no"
                  value={form.work_order_no}
                  onChange={handleChange}
                  placeholder="e.g. WB_APD_101"
                  list="won-list"
                  required
                  disabled={submitting}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition"
                />
                <datalist id="won-list">
                  {projects.map((p) => (
                    <option key={p.work_order_no} value={p.work_order_no} />
                  ))}
                </datalist>
                {lookupLoading && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin rounded-full h-3.5 w-3.5 border-t-2 border-b-2 border-amber-500" />
                )}
              </div>
            )}
          </div>

          {/* Project Preview / Mutability Warning */}
          {isClosed && <MutabilityWarning workOrderNo={form.work_order_no} />}
          {masterData && !isClosed && <ProjectPreview master={masterData} />}

          {/* Amount */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Amount (₹) <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              name="amount"
              value={form.amount}
              onChange={handleChange}
              placeholder="0.00"
              step="0.01"
              min="0"
              required
              disabled={submitting || isClosed}
              className={`w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition ${isClosed ? 'opacity-40 cursor-not-allowed' : ''}`}
            />
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Remarks
            </label>
            <textarea
              name="remarks"
              value={form.remarks}
              onChange={handleChange}
              placeholder="Optional notes or description…"
              rows={3}
              disabled={submitting || isClosed}
              className={`w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition resize-none ${isClosed ? 'opacity-40 cursor-not-allowed' : ''}`}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || isClosed}
              className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-slate-800" />
                  Saving…
                </>
              ) : isEdit ? 'Save Changes' : 'Create Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Sidebar Nav ──────────────────────────────────────────────────────────────
const SideNav = ({ isAdmin }) => {
  const navItems = [
    { to: '/dashboard', label: 'Command Center', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z' },
    { to: '/fund-reports', label: 'Fund Reports', icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z', active: true },
    ...(isAdmin ? [
      { to: '/admin', label: 'Access Whitelist', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
      { to: '/admin/master-data', label: 'Master Data', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
      { to: '/admin/sessions', label: 'Audit Trail', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    ] : []),
  ];

  return (
    <aside className="hidden md:flex flex-col w-64 glass-nav border-r border-white/5 p-6 relative z-20 shrink-0">
      <div className="flex items-center gap-3.5 mb-10">
        <Link to="/dashboard">
          <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-10 w-auto object-contain" />
        </Link>
        <div className="flex flex-col">
          <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">S.N. Polymers</span>
          <span className="text-[9px] text-amber-500 font-extrabold tracking-widest uppercase">ERP Console</span>
        </div>
      </div>
      <nav className="flex-grow space-y-2">
        {navItems.map(({ to, label, icon, active }) => (
          <Link
            key={to}
            to={to}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
              active
                ? 'bg-white/5 border border-white/10 text-slate-100'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5'
            }`}
          >
            <svg className={`w-4 h-4 ${active ? 'text-amber-500' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
            </svg>
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
};

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
const ConfirmModal = ({ message, onConfirm, onClose, danger = true }) => (
  <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
    <div className="glass-panel p-6 rounded-3xl max-w-sm w-full border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.7)]">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${danger ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
          <svg className={`w-5 h-5 ${danger ? 'text-red-400' : 'text-emerald-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {danger
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            }
          </svg>
        </div>
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-100">
          {danger ? 'Confirm Delete' : 'Confirm Restore'}
        </h2>
      </div>
      <p className="text-xs text-slate-400 mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-slate-200 font-bold text-xs uppercase tracking-wider transition">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md ${
            danger
              ? 'bg-red-500/90 hover:bg-red-500 text-white'
              : 'bg-emerald-500/90 hover:bg-emerald-500 text-slate-950'
          }`}
        >
          {danger ? 'Delete' : 'Restore'}
        </button>
      </div>
    </div>
  </div>
);

// ─── Main Page ────────────────────────────────────────────────────────────────
const FundReports = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [reports, setReports] = useState([]);
  const [deletedReports, setDeletedReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tab, setTab] = useState('active'); // 'active' | 'deleted'
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { type, report? }
  const [confirmModal, setConfirmModal] = useState(null); // { type, id, message }

  // ── Fetch ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rRes, pRes] = await Promise.all([getReports(), getProjects()]);
      setReports(rRes.data?.reports ?? []);
      setProjects(pRes.data?.projects ?? []);
      if (isAdmin) {
        const dRes = await getDeletedReports();
        setDeletedReports(dRes.data?.reports ?? []);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-dismiss success
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4500);
    return () => clearTimeout(t);
  }, [success]);

  // ── Handlers ──
  const handleCreate = async (form) => {
    await createReport(form);
    setSuccess('Fund report created successfully.');
    fetchAll();
  };

  const handleUpdate = async (form) => {
    await updateReport(modal.report.fund_report_id, { amount: form.amount, remarks: form.remarks });
    setSuccess('Fund report updated successfully.');
    fetchAll();
  };

  const handleDelete = async (id) => {
    setConfirmModal(null);
    try {
      await deleteReport(id);
      setSuccess('Report soft-deleted.');
      fetchAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete report.');
    }
  };

  const handleRestore = async (id) => {
    setConfirmModal(null);
    try {
      await restoreReport(id);
      setSuccess('Report restored successfully.');
      fetchAll();
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
    <div className="min-h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <SideNav isAdmin={isAdmin} />

      {/* Mobile Header */}
      <header className="md:hidden glass-nav sticky top-0 z-50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-8 w-auto object-contain" />
          <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">Fund Reports</span>
        </div>
        <Link to="/dashboard" className="text-[10px] bg-slate-900 border border-white/10 text-slate-200 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg">
          Dashboard
        </Link>
      </header>

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
          <button
            id="btn-create-report"
            onClick={() => setModal({ type: 'create' })}
            className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
          >
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Report
          </button>
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
        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-5 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {error}
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
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                id="search-reports"
                type="text"
                placeholder="Search reports…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="glass-input focus:ring-0 outline-none rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 font-medium transition w-52"
              />
            </div>
            <button
              onClick={fetchAll}
              title="Refresh"
              className="p-2.5 rounded-xl glass-input hover:border-white/20 transition-all duration-200 text-slate-400 hover:text-slate-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
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
    </div>
  );
};

export default FundReports;
