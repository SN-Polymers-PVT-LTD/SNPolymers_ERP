import StatutoryScopeManager from '../../components/payroll/StatutoryScopeManager';
import { newStatutoryConfiguration, statutoryDraftInput, statutoryComponents } from '../../components/payroll/statutoryPresets';
import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input, Select, Modal, Pagination, Badge } from '../../components/ui';
import {
  listPayrollMasters,
  savePayrollMaster,
  previewPayrollPublication,
  publishPayrollMaster,
  resolvePayrollMaster
} from '../../api/payrollMastersApi';
import { usePayrollMastersUrlState } from '../../hooks/usePayrollMastersUrlState';
import { PolicyFields, StatutoryFields, Choice } from './PayrollMasterFields';

const unresolved = () => ({ method: 'UNRESOLVED', precision: null, stage: 'UNRESOLVED' });
const defaults = kind => kind === 'policies' ? {
  group_code: null,
  effective_from: '',
  effective_to: null,
  reason: '',
  monthly_entitlement_method: 'CONTRACTUAL_MONTHLY_GROSS',
  lop_method: 'FIXED_DIVISOR',
  lop_fixed_divisor: '30',
  partial_month_proration_method: 'UNRESOLVED',
  partial_month_fixed_divisor: null,
  split_period_allocation_method: 'UNRESOLVED',
  full_month_unpaid_treatment: 'UNRESOLVED',
  leave_weekly_off_method: 'UNRESOLVED',
  monetary_rounding_method: 'UNRESOLVED',
  sandwich_enabled: false,
  work_calendar_reference: null,
  rounding: { lop: unresolved(), proration: unresolved(), allocation: unresolved() }
} : {
  scheme: 'EPF',
  jurisdiction: '',
  establishment: '',
  effective_from: '',
  effective_to: null,
  reason: '',
  slabs: [],
  configuration: newStatutoryConfiguration()
};

const message = e => e?.response?.data?.issues?.map(i => `${i.path?.join('.') || 'Configuration'}: ${i.message}`).join(' • ') || e?.response?.data?.message || e.message;
const json = value => JSON.stringify(value, null, 2);

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const y = parts[0];
    const m = parseInt(parts[1], 10) - 1;
    const d = parts[2];
    if (m >= 0 && m < 12) {
      return `${d} ${months[m]} ${y}`;
    }
  }
  return dateStr;
}

function formatTimestamp(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return isoStr;
  }
}

function getRuleSummary(r, kind) {
  if (kind === 'policies') {
    const lop = r.lop_method === 'FIXED_DIVISOR' ? `Fixed ${r.lop_fixed_divisor || '30'} LOP` : 'Actual Days LOP';
    const proration = r.partial_month_proration_method ? r.partial_month_proration_method.replaceAll('_', ' ') : 'Standard';
    return { title: lop, subtitle: `Proration: ${proration}` };
  }
  const cfg = r.data?.configuration || r.configuration || {};
  const scheme = r.scheme;
  if (scheme === 'PT') {
    const slabs = r.data?.slabs || r.slabs || [];
    return {
      title: `${slabs.length || 12} Tax Slabs`,
      subtitle: 'Monthly Gross Salary Basis'
    };
  }
  if (scheme === 'EPF') {
    const emp = cfg.employee_rate ?? '12';
    const co = cfg.employer_rate ?? '12';
    const cap = cfg.wage_ceiling ? `Wage Cap: ₹${Number(cfg.wage_ceiling).toLocaleString('en-IN')}` : 'No Wage Cap';
    return {
      title: `Employee ${emp}% · Employer ${co}%`,
      subtitle: cap
    };
  }
  if (scheme === 'ESI') {
    const emp = cfg.employee_rate ?? '0.75';
    const co = cfg.employer_rate ?? '3.25';
    const limit = cfg.eligibility_ceiling ? `Eligibility Limit: ₹${Number(cfg.eligibility_ceiling).toLocaleString('en-IN')}` : 'Threshold: ₹21,000';
    return {
      title: `Employee ${emp}% · Employer ${co}%`,
      subtitle: limit
    };
  }
  return { title: r.verification_status || 'Standard Setup', subtitle: '' };
}

function AuditEventTimeline({ events = [], formatTimestamp, json }) {
  const [openSnapshots, setOpenSnapshots] = useState({});

  const toggleSnapshot = (id) => {
    setOpenSnapshots(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (!events.length) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 rounded-2xl bg-white/[0.02] border border-white/5 italic">
        No audit events recorded for this revision.
      </div>
    );
  }

  return (
    <div className="relative pl-6 space-y-4 my-2 border-l-2 border-white/10">
      {events.map((event) => {
        const action = event.action || 'EVENT';
        const isPublish = action.includes('PUBLISH');
        const isCreate = action.includes('CREATE');
        const badgeVariant = isPublish ? 'emerald' : isCreate ? 'indigo' : 'amber';
        const isOpen = !!openSnapshots[event.id];

        return (
          <div key={event.id} className="relative group">
            {/* Timeline Dot */}
            <div
              className={`absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-slate-900 ${
                isPublish
                  ? 'bg-emerald-400 ring-2 ring-emerald-500/20'
                  : isCreate
                  ? 'bg-indigo-400 ring-2 ring-indigo-500/20'
                  : 'bg-amber-400 ring-2 ring-amber-500/20'
              }`}
            />

            {/* Event Card */}
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={badgeVariant} showDot={false}>
                    {action.replaceAll('_', ' ')}
                  </Badge>
                  <span className="text-[11px] font-mono text-slate-400">
                    Event #{event.id}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium">
                  {formatTimestamp(event.occurred_at || event.timestamp)}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Actor:</span>
                  <span className="font-mono bg-white/5 px-2 py-0.5 rounded text-slate-300">
                    {event.actor_id ? `User …${event.actor_id.slice(-8)}` : 'System Actor'}
                  </span>
                </div>
                {(event.after_snapshot || event.before_snapshot) && (
                  <button
                    type="button"
                    onClick={() => toggleSnapshot(event.id)}
                    className="text-amber-400 hover:text-amber-300 transition text-[11px] font-medium underline underline-offset-2"
                  >
                    {isOpen ? 'Hide snapshot data' : 'View snapshot data'}
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="mt-2 p-3 rounded-xl bg-slate-950/80 border border-white/5 overflow-x-auto">
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">
                    {json(event.after_snapshot || event.before_snapshot || event)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PayrollMasters({ kind = 'policies' }) {
  const { user } = useAuth();
  const client = useQueryClient();

  const {
    page,
    setPage,
    modal,
    revisionId,
    openHistory,
    openEdit,
    openCreate,
    openPreview,
    closeModal
  } = usePayrollMastersUrlState();

  const [editor, setEditor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [localSelected, setLocalSelected] = useState(null);
  const [approval, setApproval] = useState('');
  const [ack, setAck] = useState(false);
  const [success, setSuccess] = useState('');
  const [lookup, setLookup] = useState({ date: '', group_code: 'HO_STAFF', scheme: 'EPF', jurisdiction: '', establishment: '' });

  const canWrite = kind === 'statutory' ? user?.role === 'accounts' : user?.role === 'admin';
  const query = useQuery({
    queryKey: ['payroll-masters', kind, page],
    enabled: canWrite,
    queryFn: async () => (await listPayrollMasters(kind, { page, limit: 20 })).data.result
  });

  const selected = useMemo(() => {
    if (modal !== 'history') return null;
    return query.data?.revisions?.find(r => r.id === revisionId) || (localSelected?.id === revisionId ? localSelected : null);
  }, [modal, revisionId, query.data?.revisions, localSelected]);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['payroll-masters'] });
    client.invalidateQueries({ queryKey: ['payroll-master-resolve'] });
  };

  const save = useMutation({
    mutationFn: body => savePayrollMaster(kind, { ...body, data: kind === 'statutory' ? statutoryDraftInput(body.data) : { ...body.data, effective_to: body.data.effective_to || null } }),
    onSuccess: () => {
      setEditor(null);
      closeModal();
      refresh();
      setSuccess('Draft saved. Publication is required before diagnostic calculations use it.');
    }
  });

  const inspect = useMutation({
    mutationFn: input => previewPayrollPublication(kind, typeof input === 'string' ? input : input.id, typeof input === 'string' ? false : input.initialSetup),
    onSuccess: r => {
      setPreview(r.data.result);
      setApproval('');
      setAck(false);
    }
  });

  const publish = useMutation({
    mutationFn: () => publishPayrollMaster(kind, preview.revision.id, {
      expected_version: preview.revision.version,
      preview_token: preview.preview_token,
      approval_reference: approval,
      ...(preview.initial_setup ? { initial_setup: true } : {})
    }),
    onSuccess: () => {
      setPreview(null);
      closeModal();
      refresh();
      setSuccess('Revision published. Historical rule values are preserved; financial workflows remain disabled.');
    }
  });

  const { mutate: inspectRevision, isPending: inspectionPending, isError: inspectionFailed } = inspect;

  // Re-hydrate deep links for edit / create / preview
  useEffect(() => {
    if (modal === 'create' && !editor) {
      setEditor({ id: null, expected_version: 0, data: defaults(kind) });
    } else if (modal === 'edit' && revisionId && !editor && query.data?.revisions) {
      const target = query.data.revisions.find(r => r.id === revisionId);
      if (target) {
        setEditor({ id: target.id, expected_version: target.version, data: structuredClone(target.data) });
      }
    } else if (modal === 'preview' && revisionId && !preview && !inspectionPending && !inspectionFailed) {
      inspectRevision(revisionId);
    } else if (!modal && (editor || preview)) {
      setEditor(null);
      setPreview(null);
    }
  }, [modal, revisionId, editor, preview, query.data?.revisions, kind, inspectRevision, inspectionPending, inspectionFailed]);

  const resolve = useMutation({
    mutationFn: () => resolvePayrollMaster(kind, kind === 'policies'
      ? { date: lookup.date, group_code: lookup.group_code }
      : { date: lookup.date, scheme: lookup.scheme, jurisdiction: lookup.jurisdiction, establishment: lookup.establishment })
  });

  const updateDraft = data => {
    setEditor({ ...editor, data });
  };

  const title = kind === 'policies' ? 'Payroll Policy Master' : 'Statutory Deduction Master';

  if (!canWrite) {
    return (
      <div className="p-6">
        <p role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300">
          {kind === 'statutory' ? 'Deduction setup is maintained by Accounts only.' : 'Current Admin access is required.'}
        </p>
      </div>
    );
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const activePolicy = useMemo(() => {
    if (kind !== 'policies' || !query.data?.revisions) return null;
    return query.data.revisions.find(r => r.status === 'PUBLISHED' && r.effective_from <= today && (!r.effective_to || r.effective_to >= today))
      || query.data.revisions.find(r => r.status === 'PUBLISHED')
      || null;
  }, [kind, query.data?.revisions, today]);

  return (
    <div className="space-y-8 text-slate-200 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header Section */}
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Admin / Payroll Management</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">{title}</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              {kind === 'policies'
                ? 'Manage LOP, prorations, monetary roundings, and canonical attendance calendars.'
                : 'Configure statutory deduction masters, contribution ceilings, slabs, and evidence-verified scopes.'}
            </p>
          </div>
          <Button
            variant="amber"
            onClick={() => {
              save.reset();
              setEditor({ id: null, expected_version: 0, data: defaults(kind) });
              setSuccess('');
              openCreate();
            }}
          >
            Create draft
          </Button>
        </div>

        {/* In-Page Navigation Tabs */}
        <nav className="flex gap-6 border-b border-white/5 my-3">
          {user?.role === 'admin' && (
            <Link
              to="/admin/payroll/policies"
              className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
                kind === 'policies' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Payroll Policy Master
            </Link>
          )}
          <Link
            to={user?.role === 'admin' ? '/admin/employee-management?tab=pay-structure' : '/admin/employee-management?tab=payroll-setup'}
            className="pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-all duration-200"
          >
            {user?.role === 'admin' ? 'Employee Pay Structures' : 'Employee Payroll Setup'}
          </Link>
          {user?.role === 'accounts' && (
            <Link
              to="/admin/payroll/statutory"
              className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
                kind === 'statutory' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Statutory Deduction Master
            </Link>
          )}
        </nav>
      </header>

      {/* Top Stats Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel p-4.5 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-slate-900/50 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block">Total Revisions</span>
            <span className="text-2xl font-black text-slate-100 font-mono mt-0.5 block">{query.data?.total ?? '—'}</span>
            <span className="text-[10px] text-slate-500 font-medium">Recorded versions</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        </div>

        <div className="glass-panel p-4.5 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] to-slate-900/50 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block">Draft Revisions</span>
            <span className="text-2xl font-black text-amber-400 font-mono mt-0.5 block">
              {query.data?.revisions ? query.data.revisions.filter(r => r.status === 'DRAFT').length : '—'}
            </span>
            <span className="text-[10px] text-amber-500/70 font-medium">Pending publication</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
        </div>

        <div className="glass-panel p-4.5 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] to-slate-900/50 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 block">Published Revisions</span>
            <span className="text-2xl font-black text-emerald-300 font-mono mt-0.5 block">
              {query.data?.revisions ? query.data.revisions.filter(r => r.status === 'PUBLISHED').length : '—'}
            </span>
            <span className="text-[10px] text-emerald-400/70 font-medium">Active in calculations</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Active Production Policy Spotlight */}
      {activePolicy && (
        <div className="glass-panel p-5 rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/[0.06] via-emerald-500/[0.02] to-slate-950/60 shadow-lg relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Active Production Policy
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {activePolicy.revision_number ? `Rev #${activePolicy.revision_number}` : `Version ${activePolicy.version}`} · {activePolicy.group_code ? `Group ${activePolicy.group_code}` : 'Global Default Policy'}
                </span>
              </div>
              <h3 className="text-lg font-black text-slate-100 flex items-center gap-2">
                <span>{activePolicy.lop_method === 'FIXED_DIVISOR' ? `Fixed ${activePolicy.lop_fixed_divisor || '30'} Days LOP` : 'Actual Calendar Days LOP'}</span>
                <span className="text-slate-500 font-normal text-xs">·</span>
                <span className="text-xs font-mono font-medium text-emerald-400">
                  {formatDisplayDate(activePolicy.effective_from)} → {activePolicy.effective_to ? formatDisplayDate(activePolicy.effective_to) : 'Ongoing'}
                </span>
              </h3>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 font-medium">
                <span className="flex items-center gap-1">
                  <span className="text-slate-500">Proration:</span>
                  <span className="text-slate-200">{activePolicy.partial_month_proration_method?.replaceAll('_', ' ') || 'Standard'}</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1">
                  <span className="text-slate-500">Rounding:</span>
                  <span className="text-slate-200">{activePolicy.rounding?.lop?.method?.replaceAll('_', ' ') || 'Half Up'} ({activePolicy.rounding?.lop?.precision ?? 2} dec)</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1">
                  <span className="text-slate-500">Basis:</span>
                  <span className="text-slate-200">Contractual Monthly Gross</span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setLocalSelected(activePolicy); openHistory(activePolicy.id); }}
              >
                Inspect rules & audit
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Policy & Diagnostic Notice Card */}
      <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs space-y-1 flex items-start gap-3">
        <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="space-y-1">
          <p className="text-amber-300 font-medium leading-relaxed">
            {kind === 'policies'
              ? 'Fixed 30 is the currently approved permanent LOP business method. A draft or this label is not a published database revision. Select approved joining/leaving, split-run and no-payable-entitlement rules explicitly.'
              : 'Rates are not seeded. Accounts confirms configured rules with recorded setup evidence. Employer contributions remain separate from employee deductions.'}
          </p>
          <p className="text-slate-400 leading-relaxed">
            Published masters feed salary diagnostics. Financial locking, withholding and payment remain disabled. Casual/Local wages continue to use their factory masters.
          </p>
        </div>
      </div>

      {kind==='statutory' && <StatutoryScopeManager/>}

      {/* Status & Error Feedback */}
      {success && (
        <div role="status" className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          {success}
        </div>
      )}
      {[save.error, inspect.error, publish.error].filter(Boolean).map((e, i) => (
        <div key={i} role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {message(e)}
        </div>
      ))}

      {/* Revisions Workspace */}
      {query.isPending ? (
        <p role="status" className="text-xs text-slate-400 py-6 text-center">Loading revisions…</p>
      ) : query.isError ? (
        <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center justify-between">
          <span>{message(query.error)}</span>
          <Button size="sm" variant="secondary" onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {!query.data.revisions.length && (
            <div className="glass-panel p-8 rounded-3xl border border-white/5 text-center text-xs text-slate-500 uppercase tracking-widest font-extrabold">
              No master revisions. Create an evidenced draft; nothing is published automatically.
            </div>
          )}

          {['DRAFT', 'PUBLISHED'].map(status => {
            const revs = query.data.revisions.filter(r => r.status === status);
            return (
              <section key={status} className="glass-panel p-6 rounded-3xl border border-white/5 space-y-4 shadow-xl">
                <div className="flex items-center gap-2 text-amber-500">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <h2 className="font-bold text-xs uppercase tracking-widest text-slate-200">
                    {status === 'DRAFT' ? 'Draft revisions' : 'Published revision history'}
                  </h2>
                </div>

                <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/[0.02] border-b border-white/10 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Scope & Scheme</th>
                          <th className="px-4 py-3">Configured Rules & Rates</th>
                          <th className="px-4 py-3">Status & Version</th>
                          <th className="px-4 py-3">Effective Period</th>
                          <th className="px-4 py-3">Sign-off / Publication</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {revs.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-slate-500 italic">
                              No {status.toLowerCase()} revisions recorded.
                            </td>
                          </tr>
                        ) : (
                          revs.map(r => (
                            <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                              {/* Scope & Scheme */}
                              <td className="px-4 py-3.5">
                                {kind === 'policies' ? (
                                  <div>
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <Badge variant="indigo">{r.group_code || 'Global'}</Badge>
                                      <span className="font-semibold text-slate-100 text-xs">
                                        {r.group_code ? `Group ${r.group_code}` : 'Global Default Policy'}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-slate-400">Monthly salaried policy</span>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <Badge variant={r.scheme === 'PT' ? 'amber' : r.scheme === 'EPF' ? 'indigo' : 'emerald'}>
                                        {r.scheme}
                                      </Badge>
                                      <span className="font-semibold text-slate-100 text-xs">
                                        {r.establishment || 'All Establishments'}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 font-medium">
                                      {r.jurisdiction ? `${r.jurisdiction} State` : 'All Jurisdictions'}
                                    </div>
                                  </div>
                                )}
                              </td>

                              {/* Configured Rules & Rates */}
                              <td className="px-4 py-3.5">
                                {(() => {
                                  const summary = getRuleSummary(r, kind);
                                  return (
                                    <div>
                                      <div className="text-xs font-semibold text-slate-100">
                                        {summary.title}
                                      </div>
                                      <div className="text-[11px] text-slate-400 mt-0.5 font-medium">
                                        {summary.subtitle}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>

                              {/* Status & Version */}
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-2">
                                  <Badge variant={r.status === 'PUBLISHED' ? 'emerald' : 'amber'}>{r.status}</Badge>
                                  <span className="text-xs font-semibold text-slate-300">
                                    {r.revision_number ? `Rev #${r.revision_number}` : `Draft v${r.version}`}
                                  </span>
                                </div>
                                {r.status === 'PUBLISHED' && (
                                  <div className="mt-1">
                                    {r.effective_from > today ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                        Future Scheduled
                                      </span>
                                    ) : r.effective_to && r.effective_to < today ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                        Historical
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        Current Active
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* Effective Period */}
                              <td className="px-4 py-3.5">
                                <div className="text-xs font-medium text-slate-200">
                                  {formatDisplayDate(r.effective_from)} <span className="text-slate-500 mx-1">→</span> {r.effective_to ? formatDisplayDate(r.effective_to) : 'Ongoing'}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5 font-medium">
                                  {r.effective_to ? 'Fixed-term revision' : 'Open-ended policy'}
                                </div>
                              </td>

                              {/* Sign-off / Publication */}
                              <td className="px-4 py-3.5">
                                {r.status === 'PUBLISHED' ? (
                                  <div>
                                    <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                                      <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      Accounts Confirmed
                                    </div>
                                    {r.published_at && (
                                      <div className="text-[11px] text-slate-400 mt-0.5 font-medium">
                                        {formatTimestamp(r.published_at)}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                      Unpublished Draft
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[180px]" title={r.reason}>
                                      {r.reason ? `Reason: ${r.reason}` : 'Pending review & publish'}
                                    </div>
                                  </div>
                                )}
                              </td>

                              {/* Actions */}
                              <td className="px-4 py-3.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <Button size="sm" variant="secondary" onClick={() => { setLocalSelected(r); openHistory(r.id); }}>History / details</Button>
                                  {r.status === 'DRAFT' && (
                                    <>
                                      <Button size="sm" onClick={() => { save.reset(); setEditor({ id: r.id, expected_version: r.version, data: structuredClone(r.data) }); openEdit(r.id); }}>Edit draft</Button>
                                      <Button size="sm" variant="amber" loading={inspect.isPending} onClick={() => { publish.reset(); inspect.mutate(r.id); openPreview(r.id); }}>Review publication</Button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            );
          })}

          <Pagination currentPage={page} totalPages={Math.max(1, Math.ceil(query.data.total / 20))} onPageChange={setPage} />
        </div>
      )}

      {/* Historical Revision Resolver Container */}
      <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-4 shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h2 className="font-bold text-xs uppercase tracking-widest text-slate-200">Resolve published historical revision</h2>
        </div>

        <form className="space-y-4" onSubmit={e => { e.preventDefault(); resolve.mutate(); }}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input label="Resolution date" type="date" required value={lookup.date} onChange={e => setLookup({ ...lookup, date: e.target.value })} />
            {kind === 'policies' ? (
              <Select label="Resolution group" value={lookup.group_code} options={(query.data?.groups || []).map(g => ({ value: g.code, label: g.code }))} onChange={e => setLookup({ ...lookup, group_code: e.target.value })} />
            ) : (
              <>
                <Choice label="Resolution scheme" value={lookup.scheme} values={['EPF', 'ESI', 'PT']} onChange={scheme => setLookup({ ...lookup, scheme })} />
                <Input label="Resolution jurisdiction" required value={lookup.jurisdiction} onChange={e => setLookup({ ...lookup, jurisdiction: e.target.value })} />
                <Input label="Resolution establishment" required value={lookup.establishment} onChange={e => setLookup({ ...lookup, establishment: e.target.value })} />
              </>
            )}
          </div>
          <Button type="submit" variant="primary" loading={resolve.isPending}>Resolve revision</Button>
        </form>

        {resolve.error && <p role="alert" className="text-red-400 text-xs">{message(resolve.error)}</p>}
        {resolve.data && (() => {
          const res = resolve.data.data?.result;
          return (
            <div className="mt-4 p-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.03] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-bold text-slate-100">
                    Resolved Revision: {res?.revision_number ? `Rev #${res.revision_number}` : res?.id ? `ID ${res.id.slice(0, 8)}…` : 'Matched'}
                  </span>
                  <Badge variant="emerald">{res?.status || 'PUBLISHED'}</Badge>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Effective: {res?.effective_from} → {res?.effective_to || 'Ongoing'}
                </span>
              </div>

              {kind === 'policies' && res && (
                <div className="grid sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">LOP Rule</span>
                    <span className="font-semibold text-slate-200">
                      {res.lop_method === 'FIXED_DIVISOR' ? `Fixed Divisor (${res.lop_fixed_divisor || '30'} days)` : 'Actual Calendar Days'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Proration</span>
                    <span className="font-semibold text-slate-200">
                      {res.partial_month_proration_method?.replaceAll('_', ' ') || 'Standard'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Rounding</span>
                    <span className="font-semibold text-slate-200">
                      {res.rounding?.lop?.method?.replaceAll('_', ' ') || 'Half Up'}
                    </span>
                  </div>
                </div>
              )}

              <details className="group pt-1">
                <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 font-medium">
                  Inspect raw resolved payload
                </summary>
                <div className="mt-2 p-3 rounded-xl border border-white/5 bg-slate-950/80 overflow-x-auto">
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">{json(res)}</pre>
                </div>
              </details>
            </div>
          );
        })()}
      </div>

      {/* Edit Draft Revision Modal */}
      {editor && (
        <Modal title="Edit draft revision" size="xl" onClose={() => { if (!save.isPending) { setEditor(null); closeModal(); } }} closeDisabled={save.isPending}>
          <form onSubmit={e => { e.preventDefault(); save.mutate(editor); }} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Effective from" type="date" required value={editor.data.effective_from} onChange={e => updateDraft({ ...editor.data, effective_from: e.target.value })} />
              <Input label="Effective to" type="date" helperText="Leave blank for ongoing, until replaced by a later published revision." value={editor.data.effective_to || ''} onChange={e => updateDraft({ ...editor.data, effective_to: e.target.value || null })} />
              {kind === 'policies' ? (
                <PolicyFields data={editor.data} setData={updateDraft} groups={query.data?.groups || []} />
              ) : (
                <StatutoryFields data={editor.data} setData={updateDraft} />
              )}
              <Input label="Change reason" required maxLength={2000} value={editor.data.reason} onChange={e => setEditor({ ...editor, data: { ...editor.data, reason: e.target.value } })} />
            </div>
            {save.error && <p role="alert" className="text-red-400 text-xs">{message(save.error)}</p>}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
              <Button type="submit" variant="amber" loading={save.isPending} disabled={kind === 'statutory' && (editor.data.configuration.included_components.length === 0 || editor.data.configuration.included_components.some(name => !statutoryComponents.includes(name)))}>Save draft</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirm Master Publication Modal */}
      {preview && (
        <Modal title="Confirm master publication" size="lg" onClose={() => { if (!publish.isPending) { setPreview(null); closeModal(); } }} closeDisabled={publish.isPending}>
          <div className="space-y-4 text-xs">
            {/* Executive Summary Card */}
            {(() => {
              const rev = preview.revision || {};
              const cfg = rev.configuration || {};
              return (
                <div className="grid sm:grid-cols-3 gap-3 p-4 rounded-xl bg-slate-950/40 border border-white/5">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Scheme & Scope</span>
                    <div className="font-bold text-slate-100 flex items-center gap-1.5">
                      <Badge variant="amber">{rev.scheme || rev.group_code || 'Policy'}</Badge>
                      <span className="text-xs truncate">{rev.establishment || rev.jurisdiction || 'Global'}</span>
                    </div>
                    {rev.jurisdiction && <div className="text-[11px] text-slate-400 mt-0.5">{rev.jurisdiction} State</div>}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Effective Period</span>
                    <div className="font-mono text-xs text-slate-200">{rev.effective_from} to {rev.effective_to || 'Ongoing'}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{preview.affected_draft_rows || 0} draft rows affected</div>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Rates / Terms</span>
                    {kind === 'statutory' ? (
                      rev.scheme === 'PT' ? (
                        <div className="text-xs text-slate-200 font-medium">{rev.slabs?.length || 0} state tax slabs configured</div>
                      ) : (
                        <div className="text-xs font-mono text-slate-200 space-y-0.5">
                          <div>
                            <span>Emp: <strong className="text-amber-400">{cfg.employee_rate ?? '—'}%</strong></span>
                            <span className="mx-1.5">·</span>
                            <span>Co: <strong className="text-emerald-400">{cfg.employer_rate ?? '—'}%</strong></span>
                          </div>
                          {cfg.wage_ceiling && <div className="text-[11px] text-slate-400">Wage Cap: ₹{cfg.wage_ceiling}</div>}
                          {cfg.eligibility_ceiling && <div className="text-[11px] text-slate-400">Limit: ₹{cfg.eligibility_ceiling}</div>}
                        </div>
                      )
                    ) : (
                      <div className="text-xs text-slate-200 font-medium">
                        {rev.lop_method} (Divisor: {rev.lop_fixed_divisor || '30'})
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Initial Setup Checkbox Option */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-1.5">
              <label className="flex items-center gap-2.5 cursor-pointer font-medium text-slate-200">
                <input
                  type="checkbox"
                  checked={!!preview.initial_setup}
                  disabled={inspect.isPending || publish.isPending}
                  onChange={e => { setAck(false); inspect.mutate({ id: preview.revision.id, initialSetup: e.target.checked }); }}
                  className="rounded border-amber-500/40 text-amber-500 focus:ring-amber-500 h-4 w-4 shrink-0"
                />
                <span className="text-xs font-bold text-amber-300">Initial payroll setup for a past or current month</span>
              </label>
              <p className="text-[11px] text-slate-400 font-normal pl-6 leading-relaxed">
                Only for the first published rule in this scope. Existing published rules and overlapping locked payroll block initialization. Enter the reason and supporting approval reference below.
              </p>
            </div>

            {/* Validation & Conflict Status */}
            {preview.conflicts?.length > 0 ? (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-xs text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0"></span>
                  <span>Effective-date conflict</span>
                </div>
                <ul className="list-disc list-inside text-xs space-y-0.5 text-red-300">
                  {preview.conflicts.map((c, i) => (
                    <li key={i}>
                      {typeof c === 'string'
                        ? `Overlaps with published revision ${c.slice(0, 8)}…`
                        : c?.code === 'FUTURE_MONTH_START_REQUIRED'
                        ? 'Effective date must be the 1st of a future month.'
                        : c?.code === 'VERIFICATION_DATE_IN_FUTURE'
                        ? 'Verification date cannot be in the future.'
                        : c?.code === 'INITIAL_SETUP_ALREADY_PUBLISHED' ? 'This scope already has a published rule. Use a future-month revision.'
                        : c?.code === 'INITIAL_SETUP_LOCKED_PAYROLL' ? 'Locked payroll overlaps these dates. Initial setup cannot change that period.'
                        : c?.code === 'INITIAL_MONTH_START_REQUIRED' ? 'Initial setup must start on the first day of a past or current month.'
                        : c?.code || c?.message || JSON.stringify(c)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : preview.blockers?.length > 0 ? (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-xs text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span>
                  <span>Publication blockers</span>
                </div>
                <ul className="list-disc list-inside text-xs space-y-0.5 text-amber-300">
                  {preview.blockers.map((b, i) => (
                    <li key={i}>{b.field ? `${b.field.replaceAll('_', ' ')}: ` : ''}{b.code ? b.code.replaceAll('_', ' ') : JSON.stringify(b)}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                <span>All checks passed. Ready for publication.</span>
              </div>
            )}

            {/* Approval Input & Confirmation Checkbox */}
            <div className="pt-3 border-t border-white/5 space-y-3">
              <Input label="Supporting approval reference" required value={approval} onChange={e => setApproval(e.target.value)} helperText="Enter document or board approval reference." />
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 font-medium">
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="rounded border-slate-700 text-amber-500 focus:ring-amber-500" />
                <span>I reviewed the rules, scope, dates and impact. Previously locked payroll will not change.</span>
              </label>
            </div>

            {publish.error && <p role="alert" className="text-red-400 text-xs">{message(publish.error)}</p>}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
              <Button disabled={inspect.isPending || !preview.publishable || !approval.trim() || !ack} loading={publish.isPending} variant="amber" onClick={() => publish.mutate()}>
                Publish revision
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Revision History & Details Modal */}
      {selected && (
        <Modal title="Revision history and audit" size="xl" onClose={() => { setLocalSelected(null); closeModal(); }}>
          <div className="space-y-4 text-xs">
            <div className="grid sm:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-950/40 border border-white/5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Scope</span>
                <span className="font-semibold text-slate-200">
                  {selected.group_code || (kind === 'policies' ? 'All Staff (Global)' : `${selected.scheme} · ${selected.establishment} (${selected.jurisdiction})`)}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Status & Dates</span>
                <span className="font-mono text-slate-200">{selected.status} · {selected.effective_from} to {selected.effective_to || 'Ongoing'}</span>
              </div>
            </div>
            <details className="group rounded-xl border border-white/5 bg-slate-900/40 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-400 group-open:text-slate-200">View complete revision payload</summary>
              <pre className="mt-2 text-xs font-mono text-slate-300 whitespace-pre-wrap">{json(selected)}</pre>
            </details>
            <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-200 pt-2">Audit events</h3>
            <div className="p-4 rounded-xl border border-white/5 bg-slate-950/60 overflow-x-auto">
              <pre className="text-xs font-mono text-slate-400 whitespace-pre-wrap">
                {json((query.data?.events || []).filter(e => e.policy_revision_id === selected.id || e.statutory_revision_id === selected.id))}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
