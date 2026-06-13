import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import BackgroundShapes from '../../components/BackgroundShapes';
import { getProjects, createProject, updateProject, updateProjectStatus } from '../../api/projectsApi';

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_OPTIONS = ['Running', 'Closed', 'Complete Under Maintenance'];

const formatCurrency = (val) => {
  const num = parseFloat(val);
  if (isNaN(num)) return '₹0.00';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
};

const EMPTY_FORM = {
  work_order_no: '',
  estimate_no: '',
  work_order_value: '',
  site_details: '',
  state: '',
  district: '',
  zone: '',
  department: '',
  status: 'Running',
};

// ─── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const cfg = {
    Running: {
      dot: 'bg-emerald-400',
      pill: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
      label: 'Running',
    },
    Closed: {
      dot: 'bg-red-400',
      pill: 'bg-red-500/10 border-red-500/25 text-red-400',
      label: 'Closed',
    },
    'Complete Under Maintenance': {
      dot: 'bg-amber-400',
      pill: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
      label: 'Under Maintenance',
    },
  };
  const s = cfg[status] ?? cfg['Running'];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${s.pill}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} animate-pulse`} />
      {s.label}
    </span>
  );
};

// ─── Sidebar Nav ──────────────────────────────────────────────────────────────
const SideNav = () => (
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
      {[
        { to: '/dashboard', label: 'Command Center', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z', active: false },
        { to: '/admin', label: 'Access Whitelist', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', active: false },
        { to: '/admin/master-data', label: 'Master Data', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', active: true },
        { to: '/admin/sessions', label: 'Audit Trail Logs', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', active: false },
      ].map(({ to, label, icon, active }) => (
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

// ─── Project Form Modal ───────────────────────────────────────────────────────
const ProjectFormModal = ({ mode, initial, onClose, onSave }) => {
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(initial ?? EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const fields = [
    { name: 'work_order_no', label: 'Work Order No.', placeholder: 'e.g. WB_APD_101', disabled: isEdit },
    { name: 'estimate_no', label: 'Estimate No.', placeholder: 'e.g. APD_1' },
    { name: 'work_order_value', label: 'Work Order Value', placeholder: 'e.g. 2500000', type: 'number', min: '0', step: '0.01' },
    { name: 'site_details', label: 'Site Details', placeholder: 'Site location / description' },
    { name: 'state', label: 'State', placeholder: 'e.g. West Bengal' },
    { name: 'district', label: 'District', placeholder: 'e.g. Bankura' },
    { name: 'zone', label: 'Zone', placeholder: 'e.g. North' },
    { name: 'department', label: 'Department', placeholder: 'e.g. PWD' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 transition-all duration-300">
      <div className="glass-panel p-6 rounded-3xl max-w-xl w-full shadow-[0_25px_60px_rgba(0,0,0,0.6)] border border-white/10 relative overflow-hidden">
        {/* Ambient glow */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />

        <div className="flex justify-between items-center mb-6 relative z-10">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 font-mono">
              {isEdit ? 'Modify Record' : 'New Record'}
            </span>
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
              {isEdit ? 'Edit Project' : 'Create Project'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1"
          >
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

        <form onSubmit={handleSubmit} className="relative z-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map(({ name, label, placeholder, disabled, type, ...rest }) => (
              <div key={name} className={name === 'site_details' ? 'sm:col-span-2' : ''}>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  {label}
                  {(name === 'work_order_no' || name === 'work_order_value') && <span className="text-red-400 ml-1">*</span>}
                </label>
                <input
                  type={type || 'text'}
                  name={name}
                  value={form[name]}
                  onChange={handleChange}
                  placeholder={placeholder}
                  disabled={disabled || submitting}
                  required={name === 'work_order_no' || name === 'work_order_value'}
                  className={`w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold transition ${
                    disabled ? 'opacity-50 cursor-not-allowed text-slate-500' : 'text-slate-100'
                  }`}
                  {...rest}
                />
                {disabled && (
                  <p className="text-[9px] text-slate-500 mt-1 font-mono">
                    ⊘ Immutable after creation
                  </p>
                )}
              </div>
            ))}

            {/* Status – shown only on edit */}
            {isEdit && (
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Project Status
                </label>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                  disabled={submitting}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-300 text-sm font-semibold transition"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s} className="bg-slate-900 text-slate-100">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-3 justify-end mt-8">
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
              disabled={submitting}
              className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md hover:shadow-xl disabled:opacity-60 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-slate-800" />
                  Saving…
                </>
              ) : isEdit ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Status Quick-Change Modal ────────────────────────────────────────────────
const StatusModal = ({ project, onClose, onSave }) => {
  const [status, setStatus] = useState(project.status);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onSave(project.work_order_no, status);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update status.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="glass-panel p-6 rounded-3xl max-w-sm w-full shadow-[0_25px_60px_rgba(0,0,0,0.6)] border border-white/10">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100">Update Status</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-[10px] font-mono text-slate-500 mb-4 uppercase tracking-widest">
          {project.work_order_no}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="space-y-2 mb-6">
            {STATUS_OPTIONS.map((s) => (
              <label
                key={s}
                className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                  status === s
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  value={s}
                  checked={status === s}
                  onChange={() => setStatus(s)}
                  className="accent-amber-500"
                />
                <StatusBadge status={s} />
              </label>
            ))}
          </div>
          <div className="flex gap-3 justify-end">
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
              disabled={submitting || status === project.status}
              className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-slate-800" />
                  Updating…
                </>
              ) : 'Apply Status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────
const MasterData = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState(null); // null | { type: 'create'|'edit'|'status', project? }

  // ── Data fetching ──
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getProjects();
      setProjects(res.data?.projects ?? []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Auto-dismiss success banner
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // ── Handlers ──
  const handleCreate = async (form) => {
    await createProject(form);
    setSuccess(`Project ${form.work_order_no} created successfully.`);
    fetchProjects();
  };

  const handleEdit = async (form) => {
    const { work_order_no, status, ...editableFields } = form;
    // Send field edits first
    await updateProject(work_order_no, editableFields);
    // If status changed, also patch status
    if (status !== modal?.project?.status) {
      await updateProjectStatus(work_order_no, status);
    }
    setSuccess(`Project ${work_order_no} updated successfully.`);
    fetchProjects();
  };

  const handleStatusChange = async (workOrderNo, status) => {
    await updateProjectStatus(workOrderNo, status);
    setSuccess(`Status for ${workOrderNo} updated to "${status}".`);
    fetchProjects();
  };

  // ── Filtered list ──
  const filtered = projects.filter((p) => {
    const q = search.toLowerCase();
    return (
      !q ||
      p.work_order_no?.toLowerCase().includes(q) ||
      p.estimate_no?.toLowerCase().includes(q) ||
      p.state?.toLowerCase().includes(q) ||
      p.district?.toLowerCase().includes(q) ||
      p.department?.toLowerCase().includes(q)
    );
  });

  // ── Stat counts ──
  const counts = {
    total: projects.length,
    running: projects.filter((p) => p.status === 'Running').length,
    closed: projects.filter((p) => p.status === 'Closed').length,
    maintenance: projects.filter((p) => p.status === 'Complete Under Maintenance').length,
  };

  return (
    <div className="min-h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <SideNav />

      {/* Mobile header */}
      <header className="md:hidden glass-nav sticky top-0 z-50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-8 w-auto object-contain" />
          <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">Master Data</span>
        </div>
        <Link
          to="/dashboard"
          className="text-[10px] bg-slate-900 border border-white/10 text-slate-200 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg"
        >
          Dashboard
        </Link>
      </header>

      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-full mx-auto w-full relative z-10">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
              Project Management Module
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
              Master Data Sheet
            </h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              Manage all project records, status transitions, and field edits with a full audit trail.
            </p>
          </div>
          <button
            id="btn-create-project"
            onClick={() => setModal({ type: 'create' })}
            className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
          >
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Project
          </button>
        </div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Projects', value: counts.total, accent: 'from-indigo-500/20 to-indigo-500/5', border: 'border-indigo-500/20' },
            { label: 'Running', value: counts.running, accent: 'from-emerald-500/20 to-emerald-500/5', border: 'border-emerald-500/20' },
            { label: 'Closed', value: counts.closed, accent: 'from-red-500/20 to-red-500/5', border: 'border-red-500/20' },
            { label: 'Under Maintenance', value: counts.maintenance, accent: 'from-amber-500/20 to-amber-500/5', border: 'border-amber-500/20' },
          ].map(({ label, value, accent, border }) => (
            <div
              key={label}
              className={`glass-panel rounded-2xl p-5 border ${border} bg-gradient-to-br ${accent} relative overflow-hidden`}
            >
              <div className="absolute inset-0 opacity-30 bg-gradient-to-br ${accent} rounded-2xl" />
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest relative z-10">{label}</p>
              <p className="text-3xl font-black text-slate-100 mt-1.5 relative z-10 tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {/* ── Notifications ── */}
        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-6 flex items-center gap-2.5 animate-pulse-once">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        {/* ── Search ── */}
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              id="search-projects"
              type="text"
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 font-medium transition"
            />
          </div>
          <button
            onClick={fetchProjects}
            title="Refresh"
            className="p-2.5 rounded-xl glass-input hover:border-white/20 transition-all duration-200 text-slate-400 hover:text-slate-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* ── Table ── */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          {loading ? (
            <div className="flex items-center justify-center p-24">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center p-24 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
              {search ? 'No matching projects found.' : 'No projects found. Create one to get started.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-500">
                    {['Work Order No.', 'Estimate No.', 'Work Order Value', 'Site Details', 'State / District', 'Zone', 'Department', 'Status', 'Actions'].map((h) => (
                      <th key={h} className="py-4 px-5 font-extrabold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                  {filtered.map((project) => (
                    <tr
                      key={project.work_order_no}
                      className="hover:bg-white/[0.025] transition-colors duration-200 group"
                    >
                      <td className="py-4 px-5 font-mono font-semibold text-slate-100 whitespace-nowrap">
                        {project.work_order_no}
                      </td>
                      <td className="py-4 px-5 font-medium text-slate-300 whitespace-nowrap">
                        {project.estimate_no || <span className="text-slate-600 italic font-normal">—</span>}
                      </td>
                      <td className="py-4 px-5 font-semibold text-amber-500 whitespace-nowrap">
                        {formatCurrency(project.work_order_value)}
                      </td>
                      <td className="py-4 px-5 max-w-[180px] text-slate-400">
                        <span className="block truncate" title={project.site_details}>
                          {project.site_details || '—'}
                        </span>
                      </td>
                      <td className="py-4 px-5 whitespace-nowrap">
                        <span className="font-semibold text-slate-200">{project.state}</span>
                        {project.district && (
                          <span className="text-slate-500 font-normal"> / {project.district}</span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-slate-400 whitespace-nowrap">
                        {project.zone || '—'}
                      </td>
                      <td className="py-4 px-5 text-slate-400 whitespace-nowrap">
                        {project.department || '—'}
                      </td>
                      <td className="py-4 px-5 whitespace-nowrap">
                        <StatusBadge status={project.status} />
                      </td>
                      <td className="py-4 px-5 whitespace-nowrap">
                        <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
                          {/* Edit fields */}
                          <button
                            id={`btn-edit-${project.work_order_no}`}
                            onClick={() => setModal({ type: 'edit', project })}
                            title="Edit project"
                            className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition-all duration-200"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Status change */}
                          <button
                            id={`btn-status-${project.work_order_no}`}
                            onClick={() => setModal({ type: 'status', project })}
                            title="Update status"
                            className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all duration-200"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] text-[10px] text-slate-600 font-mono">
                Showing {filtered.length} of {projects.length} records
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Modals ── */}
      {modal?.type === 'create' && (
        <ProjectFormModal
          mode="create"
          initial={EMPTY_FORM}
          onClose={() => setModal(null)}
          onSave={handleCreate}
        />
      )}
      {modal?.type === 'edit' && (
        <ProjectFormModal
          mode="edit"
          initial={{ ...modal.project }}
          onClose={() => setModal(null)}
          onSave={handleEdit}
        />
      )}
      {modal?.type === 'status' && (
        <StatusModal
          project={modal.project}
          onClose={() => setModal(null)}
          onSave={handleStatusChange}
        />
      )}
    </div>
  );
};

export default MasterData;
