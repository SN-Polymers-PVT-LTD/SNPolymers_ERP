import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '../../components/ui';
import { getFmAttendanceSummary } from '../../api/hrAttendanceApi';
import { CATEGORIES } from '../admin/employeeConstants';

const FACTORY_CATEGORIES = CATEGORIES.filter(c => !['HO Staff', 'Projects Department Employees'].includes(c));

const todayDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date());

function statusVariant(status) {
  if (status === 'Locked') return 'emerald';
  if (status === 'Returned for Correction') return 'red';
  if (status === 'Submitted') return 'blue';
  if (status === 'Draft') return 'amber';
  return 'slate';
}

function getActionText(status) {
  if (status === 'Locked') return 'View Locked →';
  if (status === 'Returned for Correction') return 'Correct Sheet →';
  if (status === 'Submitted') return 'View Submission →';
  if (status === 'Draft') return 'Continue Entry →';
  if (status === 'Loading' || status === 'Unavailable') return 'Open Roster →';
  return 'Start Roster →';
}

export default function FmDashboardView() {
  const today = todayDate();

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['fm-attendance-summary', today],
    queryFn: async () => (await getFmAttendanceSummary({ date: today })).data
  });

  const returnedSheets = data?.returned_sheets || [];
  const todaySheets = data?.today_sheets || [];

  return (
    <div className="space-y-8 pb-12">
      {/* High Priority Alert: Returned Sheets */}
      {returnedSheets.length > 0 && (
        <section aria-label="Returned Sheets Alert" className="glass-panel p-5 rounded-2xl border border-red-500/30 bg-red-500/10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-red-500/20">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <h2 className="text-sm font-bold uppercase tracking-wider text-red-300">
                Action Required: {returnedSheets.length} Sheet(s) Returned by Head Office
              </h2>
            </div>
            <Badge variant="red">Needs Correction</Badge>
          </div>

          <div className="space-y-3">
            {returnedSheets.map(sheet => (
              <div
                key={sheet.id}
                className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/40 border border-red-500/20"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-100">{sheet.employee_category}</span>
                    <span className="text-[10px] font-mono text-slate-400">Duty Date: {sheet.attendance_date}</span>
                  </div>
                  {sheet.return_remarks && (
                    <p className="text-xs text-red-200 font-medium">
                      HO Return Remarks: <span className="text-slate-300 font-normal">"{sheet.return_remarks}"</span>
                    </p>
                  )}
                </div>

                <Link
                  to={`/factory-attendance?category=${encodeURIComponent(sheet.employee_category)}&date=${sheet.attendance_date}`}
                  className="inline-flex items-center justify-center font-bold uppercase tracking-wider text-xs px-4 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white shadow-md transition whitespace-nowrap shrink-0"
                >
                  Correct & Resubmit →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Today's Roster Status Section */}
      <section aria-label="Today's Attendance Status" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
              Daily Factory Operations
            </span>
            <h2 className="text-xl font-extrabold text-slate-100 mt-0.5">
              Today's Attendance Rosters
            </h2>
            <p className="text-xs text-slate-400">
              Duty Date: <span className="font-mono text-amber-400">{today}</span> (Asia/Kolkata Business Date)
            </p>
          </div>

          <Button
            size="xs"
            variant="secondary"
            onClick={() => refetch()}
            disabled={isPending}
          >
            Refresh Status
          </Button>
        </div>

        {isPending ? (
          <div className="glass-panel p-8 rounded-2xl border border-white/10 text-center">
            <p role="status" className="text-xs text-slate-400">Loading today's roster statuses…</p>
          </div>
        ) : isError ? (
          <div className="glass-panel p-5 rounded-2xl border border-red-500/20 bg-red-500/10 text-xs text-red-400">
            <p role="alert">Unable to load attendance summary. You can still access rosters via the direct links below.</p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FACTORY_CATEGORIES.map(category => {
            const sheet = todaySheets.find(s => s.employee_category === category);
            const status = isPending ? 'Loading' : isError ? 'Unavailable' : sheet?.status || 'Not Created';
            const variant = statusVariant(status);
            const actionText = getActionText(status);

            return (
              <div
                key={category}
                className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 hover:border-white/20 transition flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-sm text-slate-100 leading-snug">{category}</h3>
                    <Badge variant={variant} showDot={false}>{status}</Badge>
                  </div>

                  <p className="text-xs text-slate-400">
                    {status === 'Loading' ? 'Loading attendance status…'
                      : status === 'Unavailable' ? 'Attendance status unavailable. Open the roster to check.'
                      : status === 'Not Created'
                      ? 'No attendance sheet initiated for today.'
                      : status === 'Draft'
                      ? `Draft in progress · Round ${sheet?.submission_count || 1}`
                      : status === 'Submitted'
                      ? 'Submitted to Head Office for review.'
                      : status === 'Returned for Correction'
                      ? 'Returned by HO — correction needed.'
                      : 'Locked & verified by Head Office.'}
                  </p>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    {sheet?.total_ot_hours !== undefined ? `OT: ${Number(sheet.total_ot_hours).toFixed(2)}h` : 'Today'}
                  </span>
                  <Link
                    to={`/factory-attendance?category=${encodeURIComponent(category)}&date=${today}`}
                    className={`inline-flex items-center justify-center font-bold uppercase tracking-wider text-xs px-3.5 py-1.5 rounded-xl transition ${
                      status === 'Returned for Correction'
                        ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30'
                        : status === 'Not Created'
                        ? 'bg-white/10 text-slate-200 hover:bg-white/20'
                        : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20'
                    }`}
                  >
                    {actionText}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Factory Masters & Policy Cards */}
      <section aria-label="Policy Master Controls" className="space-y-4">
        <div className="border-b border-white/5 pb-2">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
            Factory Policies & Benchmarks
          </span>
          <h2 className="text-lg font-bold text-slate-100 mt-0.5">
            Master Configuration Hub
          </h2>
          <p className="text-xs text-slate-400">
            Maintain daily wage rates, standard working shift benchmarks, and duty classifications.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: Daily Wage Master */}
          <Link
            to="/factory-masters?tab=wages"
            className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 hover:border-amber-500/30 hover:bg-slate-900/80 transition group flex flex-col justify-between space-y-3"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 font-mono">Wages & Rates</span>
                <span className="text-sm font-bold text-slate-400 group-hover:text-amber-400 group-hover:translate-x-1 transition-transform">→</span>
              </div>
              <h3 className="text-base font-bold text-slate-100 group-hover:text-amber-300 transition-colors">Daily Wage Master</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Benchmark daily wage benchmarks for SNP Casual Factory Labour and Local Daily-Wage Workers.
              </p>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500 pt-2 block border-t border-white/5">
              Open Wage Master →
            </span>
          </Link>

          {/* Card 2: Attendance & Pay Rules */}
          <Link
            to="/factory-masters?tab=rules"
            className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 hover:border-amber-500/30 hover:bg-slate-900/80 transition group flex flex-col justify-between space-y-3"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400 font-mono">Duty Rules</span>
                <span className="text-sm font-bold text-slate-400 group-hover:text-blue-400 group-hover:translate-x-1 transition-transform">→</span>
              </div>
              <h3 className="text-base font-bold text-slate-100 group-hover:text-blue-300 transition-colors">Attendance & Pay Rules</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Standard shift duty hours, overtime calculation methods, double duty multipliers, and stoppage policies.
              </p>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 pt-2 block border-t border-white/5">
              Open Pay Rules →
            </span>
          </Link>
        </div>
      </section>
    </div>
  );
}
