import React, { useState, useMemo, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../components/ThemeContext';
import { useAuth } from '../components/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProjectsHealth,
  getHoActionableInsights,
  getHoChartData,
  getJeLeaderboard,
  refreshAnalyticsViews,
} from '../api/analyticsApi';
import { getZonalBalances } from '../api/zoBalancesApi';
import { getEligibleZOs } from '../api/userMappingsApi';
import { fmtCr } from '../components/analytics/utils/formatters';
import { ChartInfoTooltip } from '../components/analytics/ui/ChartInfoTooltip';
import { ChartModal } from '../components/analytics/ui/ChartModal';
import { ZoomCard } from '../components/analytics/ui/ZoomCard';
import { KpiDetailsModal } from '../components/analytics/ui/KpiDetailsModal';
import { InvestmentRecoveryPlot } from '../components/analytics/charts/InvestmentRecoveryPlot';
import { FundFlowWaterfallChart } from '../components/analytics/charts/FundFlowWaterfallChart';
import { DepartmentWiseEstimateChart } from '../components/analytics/charts/DepartmentWiseEstimateChart';
import { ExecutiveKpiStrip } from '../components/analytics/ui/ExecutiveKpiStrip';
import { SCurveProgressChart } from '../components/analytics/charts/SCurveProgressChart';
import { BubbleRiskMatrixChart } from '../components/analytics/charts/BubbleRiskMatrixChart';
import { WorkOrderTelemetryTable, PaginatedZoSelector } from '../components/analytics/charts/WorkOrderTelemetryTable';

/* ─── Section Divider ─────────────────────────────────────────────── */
const SectionLabel = ({ children }) => (
  <div className="flex items-center gap-3 mb-3 mt-2">
    <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">{children}</span>
    <div className="flex-1 h-px bg-white/[0.045]" />
  </div>
);

/* ─── donut path helper ───────────────────────────────────────────── */
const buildDonutSlices = (items, totalCount, getCount) => {
  let acc = 0;
  const cx = 100, OR = 85, IR = 55;
  return items.map(item => {
    const count = getCount(item);
    const pct = totalCount > 0 ? (count / totalCount) * 100 : 0;
    const angle = (pct / 100) * 360;
    if (angle < 0.01) return { ...item, pct: 0, pathData: null };

    const startAngle = acc;
    const endAngle = acc + angle;
    acc += angle;

    // Handle 100% full circle donut slice (where start and end points overlap)
    if (angle >= 359.9) {
      const fullCirclePathData = `M ${cx} ${cx - OR} A ${OR} ${OR} 0 1 1 ${cx - 0.01} ${cx - OR} L ${cx - 0.01} ${cx - IR} A ${IR} ${IR} 0 1 0 ${cx} ${cx - IR} Z`;
      return { ...item, pct: Math.round(pct), pathData: fullCirclePathData };
    }

    const sr = (startAngle - 90) * (Math.PI / 180);
    const er = (endAngle - 90) * (Math.PI / 180);
    const x1 = cx + OR * Math.cos(sr), y1 = cx + OR * Math.sin(sr);
    const x2 = cx + OR * Math.cos(er), y2 = cx + OR * Math.sin(er);
    const x3 = cx + IR * Math.cos(er), y3 = cx + IR * Math.sin(er);
    const x4 = cx + IR * Math.cos(sr), y4 = cx + IR * Math.sin(sr);
    const largeArc = angle > 180 ? 1 : 0;
    const pathData = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${OR} ${OR} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${IR} ${IR} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
    return { ...item, pct: Math.round(pct), pathData };
  });
};

/* ─── Physical Work Progress (Donut) ─────────────────────────────── */
const PhysicalWorkProgress = ({ projects, isModal = false }) => {
  const { isDark } = useTheme();
  const [hoveredBucket, setHoveredBucket] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });

  const buckets = useMemo(() => {
    const p = projects || [];
    const a = p.filter(pr => Number(pr.physical_progress || 0) >= 60);
    const b = p.filter(pr => { const v = Number(pr.physical_progress || 0); return v >= 40 && v < 60; });
    const c = p.filter(pr => { const v = Number(pr.physical_progress || 0); return v > 0 && v < 40; });
    const d = p.filter(pr => !pr.physical_progress || pr.physical_progress === 0);
    return [
      { label: '≥ 60%', color: '#16A34A', count: a.length, workOrders: a.map(pr => ({ work_order_no: pr.work_order_no, site_details: pr.site_details, value: `${pr.physical_progress}%` })) },
      { label: '40–59%', color: '#EAB308', count: b.length, workOrders: b.map(pr => ({ work_order_no: pr.work_order_no, site_details: pr.site_details, value: `${pr.physical_progress}%` })) },
      { label: '< 40%', color: '#DC2626', count: c.length, workOrders: c.map(pr => ({ work_order_no: pr.work_order_no, site_details: pr.site_details, value: `${pr.physical_progress}%` })) },
      { label: 'Not Started', color: '#64748B', count: d.length, workOrders: d.map(pr => ({ work_order_no: pr.work_order_no, site_details: pr.site_details, value: '0%' })) },
    ];
  }, [projects]);

  const totalCount = useMemo(() => buckets.reduce((a, b) => a + b.count, 0), [buckets]);
  const slices = useMemo(() => buildDonutSlices(buckets, totalCount, b => b.count), [buckets, totalCount]);

  const avgProg = projects?.length
    ? Math.round(projects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / projects.length)
    : 0;

  const handleMouseEnter = (e, bucket) => {
    const ph = 280, pw = 320;
    let y = e.clientY - ph - 15; if (y < 20) y = Math.min(window.innerHeight - ph - 20, e.clientY + 20);
    let x = Math.min(window.innerWidth - pw - 20, Math.max(20, e.clientX - 100));
    setPopoverPos({ x, y }); setHoveredBucket(bucket);
  };
  const handleMouseMove = (e) => {
    if (hoveredBucket) {
      const ph = 280, pw = 320;
      let y = e.clientY - ph - 15; if (y < 20) y = Math.min(window.innerHeight - ph - 20, e.clientY + 20);
      let x = Math.min(window.innerWidth - pw - 20, Math.max(20, e.clientX - 100));
      setPopoverPos({ x, y });
    }
  };

  return (
    <div className={isModal ? "w-full h-full flex flex-col justify-between p-2 sm:p-4 relative" : "chart-panel h-full flex flex-col justify-between p-5 relative"} onMouseMove={handleMouseMove}>
      {!isModal && (
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <ChartInfoTooltip
              description="Work order distribution categorized by physical work completion bands."
              formula="Physical Progress % = (Latest DPR Work Completed / Total WO Scope) × 100"
            />
            <div>
              <h3 className="chart-title text-base sm:text-lg font-extrabold tracking-tight" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>Physical Work Progress</h3>
              <p className="chart-subtitle text-xs text-slate-500 dark:text-slate-400 mt-0.5">Distribution of work orders by completion band</p>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col md:flex-row items-center justify-around gap-6 my-auto py-2 flex-1">
        <div className={`relative shrink-0 flex items-center justify-center ${isModal ? 'w-56 h-56 sm:w-72 sm:h-72' : 'w-40 h-40 sm:w-44 sm:h-44'}`}>
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
            {slices.map((slice, idx) => slice.pathData && (
              <path
                key={idx}
                d={slice.pathData}
                fill={slice.color}
                stroke={isDark ? '#0f172a' : '#ffffff'}
                strokeWidth="3"
                className="transition-all duration-300 hover:opacity-80 cursor-pointer"
                style={{ transform: hoveredBucket?.label === slice.label ? 'scale(1.05)' : 'scale(1)', transformOrigin: '100px 100px' }}
                onMouseEnter={(e) => handleMouseEnter(e, slice)}
                onMouseLeave={() => setHoveredBucket(null)}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center p-4">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Avg. Progress</span>
            <span className={`${isModal ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'} font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5`}>{avgProg}%</span>
          </div>
        </div>
        <div className={`flex flex-col gap-2 w-full md:w-auto ${isModal ? 'min-w-[240px]' : 'min-w-[180px]'}`}>
          {slices.map((item, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between gap-3 text-xs font-semibold py-1.5 px-2.5 rounded-xl cursor-pointer transition-all ${hoveredBucket?.label === item.label ? 'bg-amber-500/15 border border-amber-500/30 scale-[1.02]' : 'hover:bg-slate-500/10 border border-transparent'}`}
              onMouseEnter={(e) => handleMouseEnter(e, item)}
              onMouseLeave={() => setHoveredBucket(null)}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: item.color }} />
                <span className="chart-text-primary text-slate-800 dark:text-slate-200 font-bold text-xs whitespace-nowrap">{item.label}</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono shrink-0 whitespace-nowrap">
                <span className="font-extrabold text-slate-900 dark:text-slate-100 text-xs">{item.count}</span>
                <span className="text-slate-500 dark:text-slate-400 text-[10px] font-bold">({item.pct}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {hoveredBucket && ReactDOM.createPortal(
        <div
          className="fixed z-[99999] rounded-2xl shadow-2xl p-4 min-w-[300px] max-w-[360px] pointer-events-none transition-all duration-150 backdrop-blur-md"
          style={{ top: popoverPos.y, left: popoverPos.x, backgroundColor: isDark ? 'rgba(15,23,42,0.98)' : 'rgba(255,255,255,0.98)', border: `1.5px solid ${hoveredBucket.color}`, boxShadow: `0 20px 35px -5px rgba(0,0,0,0.7), 0 8px 16px -6px ${hoveredBucket.color}60` }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/60 pb-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: hoveredBucket.color }} />
              <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wider">{hoveredBucket.label}</span>
            </div>
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {hoveredBucket.workOrders?.length || hoveredBucket.count || 0} Work Orders
            </span>
          </div>
          {hoveredBucket.workOrders && hoveredBucket.workOrders.length > 0 ? (
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1 text-xs">
              {hoveredBucket.workOrders.slice(0, 20).map((wo, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/50">
                  <div className="min-w-0 pr-2">
                    <p className="font-extrabold font-mono text-[11px] text-slate-900 dark:text-slate-100 truncate">{wo.work_order_no}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{wo.site_details}</p>
                  </div>
                  <span className="shrink-0 font-extrabold text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">{wo.value}</span>
                </div>
              ))}
              {hoveredBucket.workOrders.length > 20 && <p className="text-[10px] text-center font-bold text-slate-400 pt-1">+{hoveredBucket.workOrders.length - 20} more</p>}
            </div>
          ) : <p className="text-xs text-slate-500 italic text-center py-2">No active work orders in this band</p>}
        </div>,
        document.body
      )}
    </div>
  );
};

/* ─── Key Financial Indicators ────────────────────────────────────── */
const KeyFinancialIndicators = ({ projects, data, isModal = false }) => {
  const { isDark } = useTheme();

  const emd = useMemo(() => {
    if (data?.emdAmount !== undefined && data?.emdAmount !== null && data.emdAmount > 0) return Number(data.emdAmount);
    return (projects || []).reduce((a, p) => a + Number(p.earnest_money_deposit || 0), 0);
  }, [projects, data]);

  const sd = useMemo(() => {
    if (data?.securityDeposit !== undefined && data?.securityDeposit !== null && data.securityDeposit > 0) return Number(data.securityDeposit);
    return (projects || []).reduce((a, p) => a + Number(p.security_deposit_amount || p.security_deposit || 0), 0);
  }, [projects, data]);

  const itTds = useMemo(() => {
    if (data?.itTds !== undefined && data?.itTds !== null && data.itTds > 0) return Number(data.itTds);
    return (projects || []).reduce((a, p) => a + Number(p.it_tds || 0), 0);
  }, [projects, data]);

  const sgst = useMemo(() => {
    if (data?.sgst !== undefined && data?.sgst !== null && data.sgst > 0) return Number(data.sgst);
    return (projects || []).reduce((a, p) => a + Number(p.sgst || 0), 0);
  }, [projects, data]);

  const cgst = useMemo(() => {
    if (data?.cgst !== undefined && data?.cgst !== null && data.cgst > 0) return Number(data.cgst);
    return (projects || []).reduce((a, p) => a + Number(p.cgst || 0), 0);
  }, [projects, data]);

  const items = useMemo(() => [
    { label: 'EMD Amount',        value: emd, color: '#10b981', bgColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg> },
    { label: 'Security Deposit',  value: sd, color: '#0ea5e9', bgColor: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg> },
    { label: 'IT TDS',            value: itTds, color: '#f59e0b', bgColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg> },
    { label: 'SGST',              value: sgst, color: '#f43f5e', bgColor: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg> },
    { label: 'CGST',              value: cgst, color: '#a78bfa', bgColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 11h10M7 15h10M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /></svg> },
  ], [emd, sd, itTds, sgst, cgst]);

  const maxAmount = Math.max(1, ...items.map(i => {
    const v = Number(i.value);
    return Number.isFinite(v) ? v : 0;
  }));

  return (
    <div className={isModal ? "w-full h-full flex flex-col justify-between p-2 sm:p-4" : "chart-panel h-full flex flex-col justify-between p-5"}>
      {!isModal && (
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <ChartInfoTooltip
              description="Summary of statutory withholdings and security deposits retained across zonal projects."
              formula="Withholdings = EMD + Security Deposit (10%) + IT TDS (2%) + SGST (1%) + CGST (1%)"
            />
            <div>
              <h3 className="chart-title" style={{ color: isDark ? '#e2e8f4' : '#1E3A8A' }}>Key Financial Indicators</h3>
              <p className="chart-subtitle">Summary of statutory withholdings</p>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col justify-between my-auto gap-3">
        {items.map((item, idx) => {
          const rawVal = Number(item.value);
          const safeVal = Number.isFinite(rawVal) ? rawVal : 0;
          const barWidth = maxAmount > 0 ? Math.min(100, Math.max(0, (safeVal / maxAmount) * 100)) : 0;
          return (
            <div key={idx} className="group">
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-1.5 rounded-lg border shadow-xs shrink-0 ${item.bgColor}`}>{item.icon}</div>
                  <span className="font-bold text-xs text-slate-700 dark:text-slate-200 truncate">{item.label}</span>
                </div>
                <span className="font-extrabold text-xs font-mono text-slate-900 dark:text-slate-100 shrink-0 whitespace-nowrap">{fmtCr(item.value)}</span>
              </div>
              <div className="relative h-1 bg-white/[0.055] rounded-full overflow-visible">
                <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-700" style={{ width: `${barWidth}%`, background: `linear-gradient(90deg, ${item.color}99 0%, ${item.color} 100%)` }} />
                <span className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-all duration-700" style={{ left: `calc(${barWidth}% - 4px)`, background: item.color, boxShadow: `0 0 6px 2px ${item.color}80` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── JE Leaderboard (paginated) ─────────────────────────────────── */

/* ─── JE Leaderboard (paginated) ─────────────────────────────────── */
const JeLeaderboard = ({ projects, selectedZoName, leaderboardData = [] }) => {
  const [page, setPage] = useState(1);
  const rowsPerPage = 5;

  const jes = useMemo(() => {
    if (Array.isArray(leaderboardData)) {
      return leaderboardData.map(j => ({
        name: j.display_name || j.mobile_number,
        projects: j.total_reports > 0 ? Math.max(1, Math.ceil(j.total_reports / 5)) : 1,
        reports: Number(j.total_reports || 0),
        streak: Number(j.daily_streak || 0),
        score: Number(j.score || 0)
      }));
    }

    const map = {};
    (projects || []).forEach(p => {
      const name = p.assigned_je || p.je_user_id || p.assigned_to;
      if (name) {
        if (!map[name]) {
          map[name] = { name, projects: 0, reports: 0, streak: Number(p.daily_streak || 0) };
        }
        map[name].projects += 1;
        map[name].reports += Number(p.total_dpr_count || 1);
      }
    });
    return Object.values(map);
  }, [projects, leaderboardData]);

  const ranked = useMemo(() => {
    if (Array.isArray(leaderboardData)) {
      return jes;
    }
    return [...jes].sort((a, b) => (b.reports * 2 + b.streak * 5 + b.projects) - (a.reports * 2 + a.streak * 5 + a.projects));
  }, [jes, leaderboardData]);

  const totalPages = Math.ceil(ranked.length / rowsPerPage) || 1;
  const paged = ranked.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  return (
    <div className="chart-panel h-full flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="chart-title">JE Leaderboard</h3>
            <p className="chart-subtitle">Junior Engineers under {selectedZoName || 'selected ZO'} ranked by performance</p>
          </div>
          {totalPages > 1 && (
            <span className="text-[10px] font-bold text-slate-400 font-mono">Pg {page}/{totalPages}</span>
          )}
        </div>
        <div className="overflow-x-auto">
          {ranked.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 font-bold uppercase tracking-wider">No JEs found for selected ZO</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="chart-table-header">
                  <th className="py-2 text-[9px] font-bold uppercase tracking-widest">Rank</th>
                  <th className="py-2 text-[9px] font-bold uppercase tracking-widest">JE Name</th>
                  <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">Projects</th>
                  <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">DPRs</th>
                  <th className="py-2 text-right text-[9px] font-bold uppercase tracking-widest">Streak</th>
                </tr>
              </thead>
              <tbody className="chart-table-body">
                {paged.map((je, i) => {
                  const rank = (page - 1) * rowsPerPage + i + 1;
                  return (
                    <tr key={i} className="chart-table-row transition-colors">
                      <td className="py-3">
                        <span className={`w-6 h-6 rounded-full font-extrabold text-[10px] inline-flex items-center justify-center ${rank === 1 ? 'bg-amber-500 text-white' : rank === 2 ? 'bg-slate-400 dark:bg-slate-600 text-white' : rank === 3 ? 'bg-amber-700 text-white' : 'bg-white/10 text-slate-300'}`}>{rank}</span>
                      </td>
                      <td className="py-3 font-bold chart-text-primary">{je.name}</td>
                      <td className="py-3 text-center font-bold chart-text-secondary">{je.projects}</td>
                      <td className="py-3 text-center font-bold chart-text-secondary">{je.reports}</td>
                      <td className="py-3 text-right font-mono font-bold text-emerald-400">🔥 {je.streak}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {ranked.length > rowsPerPage && (
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-white/5 text-[10px] font-mono shrink-0">
          <span className="text-slate-400 font-bold">
            Showing {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, ranked.length)} of {ranked.length} JEs
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >Prev</button>
            <span className="px-2 font-black text-amber-400">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Zonal Control & Credit Overview Component (homedashboard.html ZO view) ─── */
// eslint-disable-next-line no-unused-vars
const ZoHomedashboardOverview = ({ selectedZoName, projects, balancesRes, isDark }) => {
  const navigate = useNavigate();

  // Find active ZO balance
  const activeBal = useMemo(() => {
    const list = balancesRes?.balances || (balancesRes?.balance ? [balancesRes.balance] : []);
    if (!list.length) return { available_balance: 0, assigned_credit_limit: 0 };
    if (!selectedZoName) return list[0] || { available_balance: 0, assigned_credit_limit: 0 };
    const match = list.find(b => {
      const name = (b.zo_name || b.zo_user_id || '').toLowerCase();
      return name.includes(selectedZoName.toLowerCase());
    });
    return match || list[0];
  }, [balancesRes, selectedZoName]);

  const availBal = activeBal.available_balance ?? 0;
  const limitBal = activeBal.assigned_credit_limit ?? activeBal.allocated_amount ?? 0;

  // Calculate JE productivity list from projects fallback
  const jeStats = useMemo(() => {
    const map = new Map();
    (projects || []).forEach(p => {
      const jeName = p.je_name || p.assigned_je || p.assigned_to || 'Unassigned JE';
      if (!map.has(jeName)) {
        map.set(jeName, { name: jeName, count: 0, totalProgress: 0, streak: Number(p.daily_streak || p.je_daily_streak || 0) });
      }
      const item = map.get(jeName);
      item.count += 1;
      item.totalProgress += Number(p.physical_progress || 0);
      if (p.daily_streak || p.je_daily_streak) {
        item.streak = Math.max(item.streak, Number(p.daily_streak || p.je_daily_streak || 0));
      }
    });

    return Array.from(map.values()).map(je => {
      const avg = je.count > 0 ? Math.round(je.totalProgress / je.count) : 0;
      let status = 'Active';
      let streak = je.streak || 0;
      if (avg >= 70) status = 'Excellent';
      else if (avg < 40) status = 'Warning';
      return { ...je, avg, status, streak };
    }).sort((a, b) => b.count - a.count);
  }, [projects]);

  return (
    <div className={`p-6 rounded-3xl border mb-8 transition-all ${isDark ? 'bg-[#0f141f]/80 border-white/10 text-slate-100 shadow-2xl' : 'bg-white border-slate-200 text-slate-900 shadow-xl'}`}>
      
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-5 border-b border-white/10 mb-6">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500 font-mono">
            {selectedZoName || 'Zonal Office Session'}
          </span>
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight mt-0.5">
            Zonal Credit Limit Ledger
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Available credit, assigned projects, and junior engineer productivity for your zone.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => navigate('/fund-requests')}
            className="px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500 hover:text-slate-950 text-amber-400 font-extrabold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <span>💸 Fund Request</span>
            <span className="text-amber-300">→</span>
          </button>
          <button
            onClick={() => navigate('/zonal-balances')}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 font-extrabold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5"
          >
            <span>📊 Zonal Ledger</span>
            <span className="text-slate-400">→</span>
          </button>
        </div>
      </div>

      {/* KPI Row (Available Credit Balance, Total Limit, Mapped Projects) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-emerald-950/20 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200'}`}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Available Credit Balance</span>
          <div className="text-2xl font-black text-emerald-400 mt-1">{fmtCr(availBal)}</div>
          <span className="text-[10px] text-emerald-500/80 font-mono mt-1 block">Ready for requisition payout</span>
        </div>
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-900/60 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Total Assigned Limit</span>
          <div className="text-2xl font-black text-slate-100 mt-1">{fmtCr(limitBal)}</div>
          <span className="text-[10px] text-slate-400 font-mono mt-1 block">Sanctioned Zonal Credit Cap</span>
        </div>
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-amber-950/20 border-amber-500/20' : 'bg-amber-50 border-amber-200'}`}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Mapped Active Projects</span>
          <div className="text-2xl font-black text-amber-400 mt-1">{projects.length} WO Sites</div>
          <span className="text-[10px] text-amber-500/80 font-mono mt-1 block">Active sites under monitoring</span>
        </div>
      </div>

      {/* Grid Content: JE Productivity & Workload (Left) + Zonal Controls & Fund Feed (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: JE Productivity & Workload Distribution */}
        <div className="lg:col-span-7 space-y-6">
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDark ? 'bg-slate-900/40 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200">
                Junior Engineer Productivity <span className="text-slate-500 font-normal">· {jeStats.length} JEs</span>
              </span>
              <button onClick={() => navigate('/analytics/leaderboard')} className="text-[10px] font-bold uppercase tracking-wider text-amber-400 hover:underline">
                Full Leaderboard →
              </button>
            </div>
            
            {jeStats.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 italic">No JEs currently mapped to this zone</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[9px] font-black uppercase text-slate-400">
                      <th className="pb-2">JE Name</th>
                      <th className="pb-2 text-center">Assigned Sites</th>
                      <th className="pb-2 text-center">Daily Streak</th>
                      <th className="pb-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {jeStats.slice(0, 5).map((je, idx) => (
                      <tr key={idx} className="hover:bg-white/5 transition">
                        <td className="py-2.5 font-bold text-slate-200">{je.name}</td>
                        <td className="py-2.5 text-center font-mono text-slate-300">{je.count}</td>
                        <td className="py-2.5 text-center font-mono text-amber-400">🔥 {je.streak} days</td>
                        <td className="py-2.5 text-right">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                            je.status === 'Excellent' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            je.status === 'Active' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                            'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {je.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Workload Distribution Progress Bars */}
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDark ? 'bg-slate-900/40 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-4">
              Zonal Workload Distribution
            </span>
            <div className="space-y-3">
              {jeStats.slice(0, 4).map((je, idx) => {
                const pct = Math.min(100, Math.round((je.count / (projects.length || 1)) * 100));
                return (
                  <div key={idx}>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-slate-300">{je.name}</span>
                      <span className="text-slate-500 font-mono">{je.count} mapped work orders ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 border border-white/5 overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Zonal Controls & Ledger */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Quick Zonal Controls Panel */}
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDark ? 'bg-slate-900/40 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-4">
              Zonal Quick Controls
            </span>
            <div className="space-y-2.5">
              <button
                onClick={() => navigate('/fund-requests')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-amber-500/40 hover:bg-amber-500/10 text-left transition group cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-amber-400">Initiate Zonal Fund Request</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Current balance: {fmtCr(availBal)}</div>
                </div>
                <span className="text-amber-400 font-bold text-sm">→</span>
              </button>

              <button
                onClick={() => navigate('/zonal-balances')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-sky-500/40 hover:bg-sky-500/10 text-left transition group cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-sky-400">Inspect Zonal Ledger</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Full transaction history &amp; credit cap</div>
                </div>
                <span className="text-sky-400 font-bold text-sm">→</span>
              </button>

              <button
                onClick={() => navigate('/daily-progress')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-emerald-500/40 hover:bg-emerald-500/10 text-left transition group cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-emerald-400">Audit Site Progress Logs</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">DPR visits &amp; site photos feedback</div>
                </div>
                <span className="text-emerald-400 font-bold text-sm">→</span>
              </button>
            </div>
          </div>

          {/* Recent Zonal Activity Timeline */}
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDark ? 'bg-slate-900/40 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-3">
              Zonal Site Timeline
            </span>
            <div className="space-y-3 text-xs">
              <div className="flex gap-3 items-start">
                <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <div>
                  <div className="text-slate-200 font-bold">DPR Progress Update Submitted</div>
                  <div className="text-[10px] text-slate-500 font-mono">Mapped JE logged site progress (WO Active)</div>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                <div>
                  <div className="text-slate-200 font-bold">Zonal Requisition Processed</div>
                  <div className="text-[10px] text-slate-500 font-mono">Disbursement recorded in credit balance</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

/* ─── Main ZoDashboard ────────────────────────────────────────────── */
const ZoDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const { user } = useAuth();

  const isZoRole = user?.role === 'zo';
  const myZoId = user?.mobile_number || user?.zo_user_id || user?.assigned_zone || user?.zo_name || user?.display_name || user?.name || user?.id;

  const [alertMsg, setAlertMsg] = useState(null);
  const [alertType, setAlertType] = useState('success');
  const [_activeTab, _setActiveTab] = useState('overview'); // reserved for future tab navigation
  const [activeView, _setActiveView] = useState('all');
  const [selectedZo, setSelectedZo] = useState(null);
  const [zoomedChart, setZoomedChart] = useState(null);
  const [kpiDetailModal, setKpiDetailModal] = useState(null);

  // Strict Project Status & Date Range Filters
  const [projectStatusFilter, setProjectStatusFilter] = useState('all'); // 'all' | 'Running' | 'Closed' | 'Complete Under Maintenance'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [datePreset, setDatePreset] = useState('all'); // 'all' | 'month' | 'quarter' | 'half' | 'custom'

  const handleDatePreset = (preset) => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      setStartDate(firstDay);
      setEndDate(today);
    } else if (preset === 'quarter') {
      const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      setStartDate(threeMonthsAgo);
      setEndDate(today);
    } else if (preset === 'half') {
      const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      setStartDate(sixMonthsAgo);
      setEndDate(today);
    }
  };

  /* ── Data Queries ── */
  const { data: insightsRes } = useQuery({
    queryKey: ['zoInsights'],
    queryFn: async () => { const res = await getHoActionableInsights(); return res.data; },
    staleTime: 5 * 60 * 1000
  });

  const { data: chartRes } = useQuery({
    queryKey: ['zoChartData', activeView, selectedZo, projectStatusFilter, startDate, endDate],
    queryFn: async () => {
      const res = await getHoChartData({
        view: activeView,
        zone: selectedZo || undefined,
        project_status: projectStatusFilter,
        start_date: startDate || undefined,
        end_date: endDate || undefined
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000
  });

  const { data: leaderboardRes } = useQuery({
    queryKey: ['jeLeaderboard', selectedZo],
    queryFn: async () => {
      const res = await getJeLeaderboard({ timeframe: 'weekly', zone: selectedZo || undefined });
      return res.data;
    },
    staleTime: 5 * 60 * 1000
  });

  const { data: projectsRes } = useQuery({
    queryKey: ['projectsHealthList'],
    queryFn: async () => { const res = await getProjectsHealth(); return res.data; },
    staleTime: 5 * 60 * 1000
  });

  const { data: balancesRes } = useQuery({
    queryKey: ['zoBalancesList'],
    queryFn: async () => { const res = await getZonalBalances(); return res.data; },
    staleTime: 30000
  });

  const { data: eligibleZosRes } = useQuery({
    queryKey: ['eligibleZosList'],
    queryFn: async () => { const res = await getEligibleZOs(); return res.data; },
    staleTime: 60000
  });

  const projectsList = projectsRes?.data || [];

  /* ── Derived ZO Display Names & List for Dropdown Filter ── */
  const availableZos = useMemo(() => {
    const map = new Map();

    // 1. From eligible ZOs API
    const eligible = eligibleZosRes?.data || eligibleZosRes?.zos || [];
    eligible.forEach(z => {
      const id = z.mobile_number || z.zo_user_id || z.id;
      const name = z.display_name || z.name || z.zo_name || id;
      if (id) map.set(id, name);
    });

    // 2. From zoBalances API
    const balList = balancesRes?.balances || (balancesRes?.balance ? [balancesRes.balance] : []);
    balList.forEach(b => {
      const id = b.zo_user_id || b.zo_name;
      const name = b.zo_name || map.get(id) || b.zo_user_id || id;
      if (id) map.set(id, name);
    });

    // 3. From projectsHealthList
    (projectsList || []).forEach(p => {
      const id = p.zo_user_id || p.zo_name || p.zone;
      const name = p.zo_name || p.zo_user_name || map.get(id) || p.zo_user_id || p.zone;
      if (id && !map.has(id)) map.set(id, name);
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eligibleZosRes, balancesRes, projectsList]);

  /* ── Auto-lock ZO for ZO role ── */
  useEffect(() => {
    if (isZoRole && user) {
      const assignedZone = (user?.assigned_zone || '').toLowerCase();
      const mobNumber = (user?.mobile_number || '').toLowerCase();
      if (availableZos.length > 0) {
        const match = availableZos.find(z => 
          z.id.toLowerCase() === (myZoId || '').toLowerCase() || 
          z.name.toLowerCase() === (myZoId || '').toLowerCase() ||
          (assignedZone && z.name.toLowerCase().includes(assignedZone)) ||
          (mobNumber && z.id.toLowerCase() === mobNumber)
        );
        if (match) {
          if (selectedZo !== match.id) setSelectedZo(match.id);
        } else if (myZoId && selectedZo !== myZoId) {
          setSelectedZo(myZoId);
        }
      } else if (myZoId && selectedZo !== myZoId) {
        setSelectedZo(myZoId);
      }
    }
  }, [isZoRole, myZoId, availableZos, selectedZo, user]);

  const zoNameMap = useMemo(() => {
    const m = {};
    availableZos.forEach(z => { m[z.id] = z.name; });
    return m;
  }, [availableZos]);

  const getZoDisplayName = (zoIdOrName) => {
    if (!zoIdOrName) return 'Unassigned ZO';
    if (zoNameMap[zoIdOrName]) return zoNameMap[zoIdOrName];
    if (typeof zoIdOrName === 'string' && /^[0-9a-fA-F]{8,}$/.test(zoIdOrName)) {
      const match = availableZos.find(z => z.id.toLowerCase() === zoIdOrName.toLowerCase());
      if (match) return match.name;
      return 'Zonal Officer';
    }
    if (typeof zoIdOrName === 'string' && zoIdOrName.startsWith('+91')) {
      return `ZO (${zoIdOrName.slice(0, 10)})`;
    }
    return zoIdOrName;
  };

  const selectedZoName = useMemo(() => {
    if (!selectedZo) return null;
    return getZoDisplayName(selectedZo);
  }, [selectedZo, zoNameMap]);

  const refreshMutation = useMutation({
    mutationFn: refreshAnalyticsViews,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectsHealthList'] });
      queryClient.invalidateQueries({ queryKey: ['zoChartData'] });
      queryClient.invalidateQueries({ queryKey: ['zoInsights'] });
      queryClient.invalidateQueries({ queryKey: ['zoBalancesList'] });
      queryClient.invalidateQueries({ queryKey: ['eligibleZosList'] });
      showToast('Database views refreshed successfully!', 'success');
    },
    onError: (err) => showToast(err.response?.data?.message || 'Failed to refresh views.', 'error'),
  });

  const showToast = (msg, type) => {
    setAlertMsg(msg); setAlertType(type);
    setTimeout(() => setAlertMsg(null), 4000);
  };

  const insights = insightsRes || {};
  const stalledProjects = insights.stalledProjects || [];
  const lowRunwayZones = (insights.runwayData || []).filter(z => z.runway_days !== null && z.runway_days < 21);

  /* ── Strictly Filter Projects by Selected ZO Name & Project Status ── */
  const filteredProjects = useMemo(() => {
    let list = chartRes?.projectsList || projectsList;
    if (selectedZo) {
      list = list.filter(p => {
        const pZo = (p.zo_user_id || p.zo_name || p.zone || '').toLowerCase().trim();
        const sel = selectedZo.toLowerCase().trim();
        const selName = (zoNameMap[selectedZo] || '').toLowerCase().trim();
        return pZo === sel || pZo === selName;
      });
    }
    if (projectStatusFilter && projectStatusFilter !== 'all') {
      const normStatus = projectStatusFilter.toLowerCase().trim();
      list = list.filter(p => (p.status || '').toLowerCase().trim() === normStatus);
    }
    return list;
  }, [chartRes?.projectsList, projectsList, selectedZo, projectStatusFilter, zoNameMap]);

  /* ── Filter Ticker by Selected ZO Name & Status ── */
  const filteredStalledProjects = useMemo(() => {
    let list = stalledProjects;
    if (selectedZo) {
      list = list.filter(p => {
        const pZo = (p.zo_user_id || p.zo_name || p.zone || '').toLowerCase().trim();
        const sel = selectedZo.toLowerCase().trim();
        const selName = (zoNameMap[selectedZo] || '').toLowerCase().trim();
        return pZo === sel || pZo === selName;
      });
    }
    if (projectStatusFilter && projectStatusFilter !== 'all') {
      const normStatus = projectStatusFilter.toLowerCase().trim();
      list = list.filter(p => (p.status || '').toLowerCase().trim() === normStatus);
    }
    return list;
  }, [stalledProjects, selectedZo, projectStatusFilter, zoNameMap]);

  const filteredLowRunwayZones = useMemo(() => {
    const valid = lowRunwayZones.filter(z => {
      const id = z.zo_user_id || z.zo_name || z.zone;
      if (!id) return false;
      if (typeof id === 'string' && /^[0-9a-fA-F]{8,}$/.test(id) && !zoNameMap[id]) {
        return false;
      }
      return true;
    });

    if (!selectedZo) return valid;

    return valid.filter(z => {
      const zZo = (z.zo_user_id || z.zo_name || z.zone || '').toLowerCase().trim();
      const sel = selectedZo.toLowerCase().trim();
      const selName = (zoNameMap[selectedZo] || '').toLowerCase().trim();
      return zZo === sel || zZo === selName;
    });
  }, [lowRunwayZones, selectedZo, zoNameMap]);

  return (
    <>
      {/* Toast */}
      {alertMsg && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-2xl shadow-xl backdrop-blur-md flex items-center gap-3 border transition-all duration-300 ${alertType === 'success' ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-400' : 'bg-rose-950/80 border-rose-500/30 text-rose-400'}`}>
          <span className="text-sm font-bold tracking-wide">{alertMsg}</span>
          <button onClick={() => setAlertMsg(null)} className="text-slate-400 hover:text-white">&times;</button>
        </div>
      )}

      {/* Header Bar */}
      <div className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ background: '#f0a843', boxShadow: '0 0 8px #f0a843, 0 0 18px rgba(240,168,67,0.35)', animation: 'pulse 2.5s ease-in-out infinite' }} />
            <span className="font-mono text-[10px] uppercase tracking-[3px] text-amber-500">Zonal Office Analytics</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mt-1 text-slate-900 dark:text-slate-100" style={{ letterSpacing: '-0.04em' }}>
            Zonal Control Room {selectedZoName ? `— ${selectedZoName}` : ''}
          </h1>
          <div className="flex items-center gap-2 mt-1.5">
            {selectedZo ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-black uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Active Filter — ZO Name: {selectedZoName} ({filteredProjects.length} Projects)
                {!isZoRole && (
                  <button onClick={() => setSelectedZo(null)} className="ml-1.5 hover:text-white text-amber-300 font-black cursor-pointer" title="Clear ZO Name Filter">&times;</button>
                )}
              </span>
            ) : (
              <p className="text-xs text-slate-400 leading-relaxed">Consolidated Zonal Office (ZO) KPIs, JE leaderboard, risk matrix, and cost realization analytics.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold text-slate-300 dark:text-slate-300 bg-white/5 px-2.5 py-1 rounded-xl border border-white/10 flex items-center gap-1.5 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Data Source: Live Zonal Database Sync
            </span>
            <ChartInfoTooltip
              description="Zonal analytics metrics are derived in real-time from live system entries across Work Orders, Approved Estimates, ZO Fund Requisitions, Bank Disbursals, DPR Logs, and Contractor Bills."
              formula="Source = Live SQL aggregation across zonal_projects, estimate_sheets, requisitions & agency_bills"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Custom Paginated ZO Name Filter Component */}
            {isZoRole ? (
              <div className="flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 rounded-2xl px-4 py-2.5 text-xs font-black uppercase tracking-wider text-amber-400 shadow-sm backdrop-blur-md">
                <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span className="text-[10px] text-slate-400 font-bold uppercase">Zone (Locked):</span>
                <span className="text-slate-100 font-extrabold max-w-[200px] truncate">{selectedZoName || myZoId || 'Assigned Zone'}</span>
              </div>
            ) : (
              <PaginatedZoSelector
                availableZos={availableZos}
                selectedZo={selectedZo}
                onSelectZo={setSelectedZo}
                getZoDisplayName={getZoDisplayName}
              />
            )}

            {/* Refresh Views Button */}
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className={`px-5 py-2.5 rounded-2xl border border-transparent text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all duration-300 ${refreshMutation.isPending ? 'bg-white/5 border-white/10 text-slate-400 cursor-not-allowed' : 'bg-white hover:bg-white/90 text-slate-950 shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 cursor-pointer'}`}
            >
              <svg className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
              </svg>
              {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Views'}
            </button>
          </div>
        </div>
      </div>

      {/* Project Status & Date Range Filter Toolbar */}
      <div className="glass-panel p-4 rounded-2xl mb-8 flex flex-col xl:flex-row gap-4 items-center justify-between border border-white/10 shadow-lg">
        {/* Project Status Filter Tabs */}
        <div className="flex items-center gap-2 flex-wrap w-full xl:w-auto">
          <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 mr-1">Project Status:</span>
          {[
            { id: 'all', label: 'All Projects' },
            { id: 'Running', label: 'Running' },
            { id: 'Closed', label: 'Closed' },
            { id: 'Complete Under Maintenance', label: 'Under Maintenance' }
          ].map(status => (
            <button
              key={status.id}
              onClick={() => setProjectStatusFilter(status.id)}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border cursor-pointer ${
                projectStatusFilter === status.id
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/20'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {status.label}
            </button>
          ))}
        </div>

        {/* Date Range Controls */}
        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-start xl:justify-end">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">Preset:</span>
            {[
              { id: 'all', label: 'All Time' },
              { id: 'month', label: 'This Month' },
              { id: 'quarter', label: '3 Months' },
              { id: 'half', label: '6 Months' }
            ].map(p => (
              <button
                key={p.id}
                onClick={() => handleDatePreset(p.id)}
                className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition-all border cursor-pointer ${
                  datePreset === p.id
                    ? 'bg-white text-slate-950 border-white'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 border-l border-white/10 pl-3">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDatePreset('custom');
                }}
                className="bg-slate-950/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDatePreset('custom');
                }}
                className="bg-slate-950/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-amber-500/50"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Risk Ticker */}
      {(filteredStalledProjects.length > 0 || filteredLowRunwayZones.length > 0) && (
        <div className="relative mb-8 overflow-hidden">
          <div className={`pointer-events-none absolute left-0 top-0 bottom-0 w-16 z-10 transition-colors ${isDark ? 'bg-gradient-to-r from-[#0b0e14] to-transparent' : 'bg-gradient-to-r from-slate-50 to-transparent'}`} />
          <div className={`pointer-events-none absolute right-0 top-0 bottom-0 w-16 z-10 transition-colors ${isDark ? 'bg-gradient-to-l from-[#0b0e14] to-transparent' : 'bg-gradient-to-l from-slate-50 to-transparent'}`} />
          <div className="flex overflow-hidden">
            <div className="animate-marquee gap-3 py-1 px-4">
              {filteredLowRunwayZones.map((z, idx) => (
                <div key={`z1-${idx}`} className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${isDark ? 'border-rose-500/30 bg-rose-950/20 text-rose-400' : 'border-rose-300 bg-rose-50 text-rose-700 shadow-sm'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  {getZoDisplayName(z.zo_name || z.zo_user_id || z.zone)} — Balance depletes in {z.runway_days} days
                </div>
              ))}
              {filteredStalledProjects.slice(0, 5).map((p, idx) => (
                <div key={`p1-${idx}`} onClick={() => navigate(`/projects/${p.work_order_no}/digital-twin`)}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors ${isDark ? 'border-amber-500/30 bg-amber-950/20 text-amber-400 hover:border-amber-500/50' : 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm hover:border-amber-400'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  {p.work_order_no} — No DPR for {p.days_since_last_progress_report}d ({p.physical_progress}% done)
                </div>
              ))}
              {/* duplicate for seamless loop */}
              {filteredLowRunwayZones.map((z, idx) => (
                <div key={`z2-${idx}`} className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${isDark ? 'border-rose-500/30 bg-rose-950/20 text-rose-400' : 'border-rose-300 bg-rose-50 text-rose-700 shadow-sm'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  {getZoDisplayName(z.zo_name || z.zo_user_id || z.zone)} — Balance depletes in {z.runway_days} days
                </div>
              ))}
              {filteredStalledProjects.slice(0, 5).map((p, idx) => (
                <div key={`p2-${idx}`} onClick={() => navigate(`/projects/${p.work_order_no}/digital-twin`)}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors ${isDark ? 'border-amber-500/30 bg-amber-950/20 text-amber-400 hover:border-amber-500/50' : 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm hover:border-amber-400'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  {p.work_order_no} — No DPR for {p.days_since_last_progress_report}d ({p.physical_progress}% done)
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Executive 10-KPI Strip (Filtered by Selected ZO Name) */}
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">
          Zonal Office KPIs {selectedZoName ? `— ${selectedZoName}` : '(All ZO Names)'}
        </span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      <ExecutiveKpiStrip data={chartRes?.executiveSummaryKpis} projects={filteredProjects} />

      {/* ── Section: Performance Overview ── */}
      <SectionLabel>Performance Overview {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('physical_progress')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <PhysicalWorkProgress projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('department')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <DepartmentWiseEstimateChart items={chartRes?.departmentWiseEstimate} projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('key_financials')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <KeyFinancialIndicators projects={filteredProjects} data={chartRes?.keyFinancialIndicators} />
          </div>
        </ZoomCard>
      </div>

      {/* ── Section: Fund Flow & Risk ── */}
      <SectionLabel>Fund Flow &amp; Risk {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('fundflow')}>
          <div style={{ minHeight: '480px' }} className="h-full">
            <FundFlowWaterfallChart data={chartRes?.waterfallData} projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('bubble')}>
          <div style={{ minHeight: '480px' }} className="h-full">
            <BubbleRiskMatrixChart bubbleMatrixData={chartRes?.bubbleMatrix} projects={filteredProjects} />
          </div>
        </ZoomCard>
      </div>

      {/* ── Section: Trends & Projections ── */}
      <SectionLabel>Trends &amp; Projections {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 items-start">
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('scurve')}>
          <SCurveProgressChart sCurveData={chartRes?.sCurveData} projects={filteredProjects} />
        </ZoomCard>
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('jeleaderboard')}>
          <JeLeaderboard projects={filteredProjects} selectedZoName={selectedZoName} leaderboardData={leaderboardRes?.leaderboard} />
        </ZoomCard>
      </div>

      {/* ── Section: Financial Realization Pipeline ── */}
      <SectionLabel>Financial Realization &amp; Bill Recovery {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <ZoomCard className="mb-6" onZoom={() => setZoomedChart('revision')}>
        <InvestmentRecoveryPlot projects={filteredProjects} showBillRecoveryKpi={true} />
      </ZoomCard>

      {/* ── Section: Project Health Summary ── */}
      <SectionLabel>Project Health Summary {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          { label: 'Active Projects', value: filteredProjects.length, subtext: 'Total ongoing', color: 'text-sky-400', border: 'border-sky-500/20 hover:border-sky-500/40', glow: 'shadow-sky-500/5', bgIcon: 'bg-sky-500/10 text-sky-400', filterFn: null,
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg> },
          { label: 'Healthy', value: filteredProjects.filter(p => p.health_status === 'Healthy').length, subtext: 'On track', color: 'text-emerald-400', border: 'border-emerald-500/20 hover:border-emerald-500/40', glow: 'shadow-emerald-500/5', bgIcon: 'bg-emerald-500/10 text-emerald-400', filterFn: p => p.health_status === 'Healthy',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
          { label: 'Warning', value: filteredProjects.filter(p => p.health_status === 'Warning').length, subtext: 'Needs review', color: 'text-amber-400', border: 'border-amber-500/20 hover:border-amber-500/40', glow: 'shadow-amber-500/5', bgIcon: 'bg-amber-500/10 text-amber-400', filterFn: p => p.health_status === 'Warning',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> },
          { label: 'Critical', value: filteredProjects.filter(p => p.health_status === 'Critical').length, subtext: 'Action required', color: 'text-rose-400', border: 'border-rose-500/20 hover:border-rose-500/40', glow: 'shadow-rose-500/5', bgIcon: 'bg-rose-500/10 text-rose-400', filterFn: p => p.health_status === 'Critical',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> },
          { label: 'Avg Progress', value: `${filteredProjects.length ? Math.round(filteredProjects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / filteredProjects.length) : 0}%`, subtext: 'Portfolio progress', color: 'text-indigo-400', border: 'border-indigo-500/20 hover:border-indigo-500/40', glow: 'shadow-indigo-500/5', bgIcon: 'bg-indigo-500/10 text-indigo-400', filterFn: null,
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg> },
          { label: 'Avg Health', value: `${filteredProjects.length ? Math.round(filteredProjects.reduce((a, p) => a + Number(p.health_score || 0), 0) / filteredProjects.length) : 0}`, subtext: 'Health score', color: 'text-violet-400', border: 'border-violet-500/20 hover:border-violet-500/40', glow: 'shadow-violet-500/5', bgIcon: 'bg-violet-500/10 text-violet-400', filterFn: null,
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
        ].map(({ label, value, subtext, color, border, glow, bgIcon, icon, filterFn }) => (
          <div
            key={label}
            onClick={() => {
              const filtered = filterFn ? filteredProjects.filter(filterFn) : filteredProjects;
              setKpiDetailModal({ title: `${label} ${selectedZoName ? `(${selectedZoName})` : ''}`, color, projects: filtered });
            }}
            className={`relative overflow-hidden rounded-2xl border p-4 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${border} ${glow} ${isDark ? 'bg-slate-900/40 text-slate-100' : 'bg-white/80 border-slate-200 shadow-sm text-slate-900'} flex flex-col justify-between group cursor-pointer`}
          >
            <div className={`absolute inset-0 pointer-events-none ${isDark ? 'opacity-5 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:8px_8px]' : 'opacity-10 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:8px_8px]'}`} />
            <div className="flex items-center justify-between mb-3 relative z-10">
              <div className={`p-2 rounded-xl ${bgIcon} transition-transform duration-300 group-hover:scale-110`}>{icon}</div>
              <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${isDark ? 'text-slate-500 group-hover:text-slate-300' : 'text-slate-500 group-hover:text-slate-700'}`}>{subtext}</span>
            </div>
            <div className="relative z-10 mt-1">
              <div className={`text-3xl font-black tabular-nums tracking-tight ${color} group-hover:brightness-125 transition-all`}>{value}</div>
              <div className={`text-[10px] font-black uppercase tracking-widest mt-1 flex items-center justify-between ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                <span>{label}</span>
                <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity font-bold">View →</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Section: Work Order Telemetry ── */}
      <SectionLabel>Work Order Telemetry {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="mb-6">
        <WorkOrderTelemetryTable
          data={filteredProjects}
          availableZos={availableZos}
          selectedZo={selectedZo}
          onSelectZo={setSelectedZo}
          getZoDisplayName={getZoDisplayName}
        />
      </div>

      {/* ── Zoom Modals ── */}
      {zoomedChart === 'physical_progress' && (
        <ChartModal title={`Physical Work Progress — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} onClose={() => setZoomedChart(null)}>
          <PhysicalWorkProgress projects={filteredProjects} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'department' && (
        <ChartModal title={`Department Wise Work Order Value Breakdown — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} onClose={() => setZoomedChart(null)}>
          <DepartmentWiseEstimateChart items={chartRes?.departmentWiseEstimate} projects={filteredProjects} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'key_financials' && (
        <ChartModal title={`Key Financial Indicators — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} onClose={() => setZoomedChart(null)}>
          <KeyFinancialIndicators projects={filteredProjects} data={chartRes?.keyFinancialIndicators} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'bubble' && (
        <ChartModal title={`Bubble Risk Matrix Inspection — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} width="96vw" height="92vh" maxWidth="96vw" maxHeight="92vh" onClose={() => setZoomedChart(null)}>
          <BubbleRiskMatrixChart bubbleMatrixData={chartRes?.bubbleMatrix} projects={filteredProjects} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'fundflow' && (
        <ChartModal title={`Fund Flow Pipeline Inspection — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} width="96vw" height="92vh" maxWidth="96vw" maxHeight="92vh" onClose={() => setZoomedChart(null)}>
          <FundFlowWaterfallChart data={chartRes?.waterfallData} projects={filteredProjects} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'scurve' && (
        <ChartModal title={`S-Curve Performance Progress — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} width="96vw" height="92vh" maxWidth="96vw" maxHeight="92vh" onClose={() => setZoomedChart(null)}>
          <SCurveProgressChart sCurveData={chartRes?.sCurveData} projects={filteredProjects} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'revision' && (
        <ChartModal
          title={`Investment & Bill Recovery Realization — ${selectedZoName || 'All ZO Names'}`}
          description="Capital investment vs bill recovery realization across work order progress bands."
          formula="Pending Recovery = Requisition Investment - Contractor Bill Payments Received"
          isDark={isDark}
          width="96vw"
          height="92vh"
          maxWidth="96vw"
          maxHeight="92vh"
          onClose={() => setZoomedChart(null)}
        >
          <InvestmentRecoveryPlot projects={filteredProjects} isModal={true} showBillRecoveryKpi={true} />
        </ChartModal>
      )}
      {zoomedChart === 'jeleaderboard' && (
        <ChartModal title={`JE Leaderboard — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} width="80vw" height="80vh" maxWidth="80vw" maxHeight="80vh" onClose={() => setZoomedChart(null)}>
          <JeLeaderboard projects={filteredProjects} selectedZoName={selectedZoName} leaderboardData={leaderboardRes?.leaderboard} />
        </ChartModal>
      )}

      {/* ── KPI Detail Modal ── */}
      {kpiDetailModal && (
        <KpiDetailsModal
          title={kpiDetailModal.title}
          colorClass={kpiDetailModal.color}
          projects={kpiDetailModal.projects}
          getZoDisplayName={getZoDisplayName}
          onClose={() => setKpiDetailModal(null)}
        />
      )}
    </>
  );
};

export default ZoDashboard;
