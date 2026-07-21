import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../components/ThemeContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import BackgroundShapes from '../components/BackgroundShapes';
import { useModalOverlay } from '../components/ModalContext';
import {
  getHoKpis,
  getHoZoneBenchmarking,
  getHoBudgetLeakage,
  refreshAnalyticsViews,
  getHoActionableInsights,
  getHoChartData,
  getProjectsHealth
} from '../api/analyticsApi';
import { exportProjectsToExcel } from '../utils/exportHelpers';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

// Returns theme-aware color tokens for SVG charts
const useChartColors = () => {
  const { isDark } = useTheme();
  return {
    // Grid/axis lines
    gridLine: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)',
    gridLineDash: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    axisLine: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)',
    // Text
    labelMuted: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.35)',
    labelFaint: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',
    labelNormal: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.55)',
    labelStrong: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.8)',
    // Divider
    todayLine: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',
    todayText: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)',
    // Quadrant labels
    quadrantNormal: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)',
    quadrantCritical: isDark ? 'rgba(239,68,68,0.4)' : 'rgba(185,28,28,0.5)',
    // Cell borders in heatmap
    cellBorder: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)',
    // High-churn label
    highChurnLabel: isDark ? '#ef4444' : '#b91c1c',
    normalLabel: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.55)',
    // Waterfall drop-off connector
    dropOffConnector: isDark ? 'rgba(239,68,68,0.25)' : 'rgba(185,28,28,0.3)',
    // Panel
    isDark,
  };
};

const InfoTooltip = ({ content, position = 'center' }) => {
  const positionClasses = {
    center: 'right-0 origin-top-right',
    left: 'right-0 origin-top-right',
    right: 'right-0 origin-top-right'
  };

  return (
    <div className="absolute top-4 right-4 group cursor-pointer z-40">
      <div className="transition-colors">
        <svg className="w-5 h-5 text-amber-400/80 group-hover:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className={`absolute top-full mt-2 w-64 p-3.5 rounded-xl tooltip-popover text-xs font-medium tracking-wide leading-relaxed opacity-0 scale-95 pointer-events-none transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 z-[100] ${positionClasses[position]}`}>
        {content}
      </div>
    </div>
  );
};

// ── Fullscreen chart zoom modal ──────────────────────────────────────────────
const ChartModal = ({ onClose, children }) => {
  const { isDark } = useTheme();
  const { openModal, closeModal } = useModalOverlay();

  React.useEffect(() => {
    openModal();
    return () => closeModal();
  }, [openModal, closeModal]);

  React.useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-6"
      style={{
        background: isDark ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(16px)'
      }}
      onClick={onClose}
    >
      {/* The chart-panel itself IS the modal card — no double wrapping */}
      <div
        className="relative w-full flex flex-col overflow-hidden"
        style={{ maxWidth: '1400px', height: '88vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Floating red X close button over the chart */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-50 p-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500 hover:text-white transition-all duration-300 shadow-lg group"
          title="Close (ESC)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Chart fills entire modal space */}
        <div className="flex-1 overflow-auto min-h-0 h-full">
          {children}
        </div>
      </div>
    </div>
  );
};

// ── Zoomable wrapper for any chart panel ─────────────────────────────────────
const ZoomCard = ({ children, onZoom, className = '' }) => (
  <div className={`relative group ${className}`}>
    {children}
    {/* Zoom trigger button - appears on hover */}
    <button
      onClick={onZoom}
      className="absolute top-3 left-3 z-30 opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-black uppercase tracking-widest transition-all duration-200 hover:bg-amber-500/20 hover:border-amber-500/40 cursor-zoom-in"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
      Zoom
    </button>
  </div>
);

// ── KPI Details Modal ───────────────────────────────────────────────────────
const KpiDetailsModal = ({ title, colorClass, projects, onClose, navigate }) => {
  const { isDark } = useTheme();

  React.useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4 md:p-8"
      style={{ background: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.4)', backdropFilter: 'blur(16px)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border ${
          isDark 
            ? 'bg-slate-950 border-white/10 text-slate-100 shadow-black/80' 
            : 'bg-white border-slate-200 text-slate-900 shadow-2xl shadow-slate-900/20'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={`flex items-center justify-between px-6 py-5 border-b shrink-0 ${
          isDark ? 'border-white/10 bg-slate-900' : 'border-slate-100 bg-white'
        }`}>
          <div className="flex items-center gap-3">
            <h2 className={`text-lg font-black uppercase tracking-widest ${
              colorClass || (isDark ? 'text-slate-100' : 'text-slate-900')
            }`}>{title}</h2>
            <span className={`px-3 py-1 rounded-full border text-[10px] font-extrabold ${
              isDark ? 'bg-white/10 border-white/15 text-slate-200' : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}>
              {projects.length} {projects.length === 1 ? 'Project' : 'Projects'}
            </span>
          </div>
          {/* Red X close button with red glow on hover */}
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-all duration-300 shadow-md hover:shadow-[0_0_15px_rgba(244,63,94,0.6)] cursor-pointer"
            title="Close (ESC)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body: Scrollable Table */}
        <div className={`p-6 overflow-y-auto no-scrollbar flex-1 ${isDark ? 'bg-slate-950' : 'bg-white'}`}>
          {projects.length === 0 ? (
            <div className={`text-center py-12 text-xs font-bold uppercase tracking-wider ${
              isDark ? 'text-slate-500' : 'text-slate-400'
            }`}>
              No projects matching this filter
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`border-b text-[9px] font-black uppercase tracking-widest ${
                    isDark ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'
                  }`}>
                    <th className="py-3 px-3">WO No</th>
                    <th className="py-3 px-3">Zone</th>
                    <th className="py-3 px-3">Department</th>
                    <th className="py-3 px-3 text-center">Value</th>
                    <th className="py-3 px-3 text-center">Progress</th>
                    <th className="py-3 px-3 text-center">Health</th>
                    <th className="py-3 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-white/5' : 'divide-slate-100'}`}>
                  {projects.map((p, idx) => {
                    const scoreBadge =
                      p.health_score >= 80
                        ? isDark ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/30' : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 font-extrabold'
                        : p.health_score >= 60
                        ? isDark ? 'bg-amber-950/80 text-amber-400 border-amber-500/30' : 'bg-amber-500/10 text-amber-800 border-amber-500/30 font-extrabold'
                        : isDark ? 'bg-rose-950/80 text-rose-400 border-rose-500/30' : 'bg-rose-500/10 text-rose-700 border-rose-500/30 font-extrabold';

                    const statusBadge =
                      p.health_status === 'Critical'
                        ? isDark ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-rose-50 text-rose-700 border-rose-200 font-black'
                        : p.health_status === 'Warning'
                        ? isDark ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-amber-50 text-amber-800 border-amber-200 font-black'
                        : isDark ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-emerald-50 text-emerald-800 border-emerald-200 font-black';

                    return (
                      <tr key={idx} className={`transition-colors group ${isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50/80'}`}>
                        <td
                          onClick={() => {
                            onClose();
                            navigate(`/projects/${p.work_order_no}/digital-twin`);
                          }}
                          className={`py-3.5 px-3 font-extrabold hover:underline cursor-pointer font-mono ${
                            isDark ? 'text-sky-400' : 'text-sky-600'
                          }`}
                        >
                          {p.work_order_no}
                        </td>
                        <td className={`py-3.5 px-3 font-extrabold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{p.zone || 'N/A'}</td>
                        <td className={`py-3.5 px-3 font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{p.department || 'N/A'}</td>
                        <td className={`py-3.5 px-3 text-center font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                          {formatINR(p.work_order_value)}
                        </td>
                        <td className={`py-3.5 px-3 text-center font-extrabold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                          {p.physical_progress || 0}%
                        </td>
                        <td className="py-3.5 px-3 text-center">
                          <span className={`px-2.5 py-0.5 rounded-lg text-[10px] border ${scoreBadge}`}>
                            {Math.round(p.health_score || 0)}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <span className={`px-2.5 py-0.5 rounded-lg text-[8px] uppercase tracking-wider border ${statusBadge}`}>
                            {p.health_status || 'Healthy'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const BubbleRiskMatrix = ({ data }) => {
  const [tooltip, setTooltip] = useState(null);
  const navigate = useNavigate();
  const c = useChartColors();
  const W = 600, H = 400, PAD = 60;

  const toX = (pct) => PAD + ((pct / 100) * (W - 2 * PAD));
  const toY = (pct) => (H - PAD) - ((pct / 100) * (H - 2 * PAD));

  return (
    <div className="chart-panel h-full">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="chart-title">Bubble Risk Matrix</h3>
          <p className="chart-subtitle">Budget vs Physical Progress vs reporting frequency</p>
        </div>
        <div className="flex gap-3 text-[8px] font-black uppercase tracking-wider chart-label">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Healthy</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Warning</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500"></span> Critical</span>
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Grid lines */}
          <line x1={toX(50)} y1={PAD} x2={toX(50)} y2={H - PAD} stroke={c.gridLineDash} strokeDasharray="4 4" />
          <line x1={PAD} y1={toY(50)} x2={W - PAD} y2={toY(50)} stroke={c.gridLineDash} strokeDasharray="4 4" />

          {/* Quadrant labels */}
          <text x={PAD + 10} y={PAD + 18} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">EFFICIENT</text>
          <text x={toX(50) + 10} y={PAD + 18} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">ON TRACK</text>
          <text x={PAD + 10} y={H - PAD - 10} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">DORMANT</text>
          <text x={toX(50) + 10} y={H - PAD - 10} fill={c.quadrantCritical} fontSize="8" fontWeight="bold" letterSpacing="1">CRITICAL OVERRUN</text>

          {/* X Axis */}
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={c.axisLine} strokeWidth="1" />
          <text x={W / 2} y={H - 12} textAnchor="middle" fill={c.labelNormal} fontSize="8" fontWeight="bold" letterSpacing="1">BUDGET UTILIZATION %</text>

          {/* Y Axis */}
          <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={c.axisLine} strokeWidth="1" />
          <text x={16} y={H / 2} textAnchor="middle" fill={c.labelNormal} fontSize="8" fontWeight="bold" letterSpacing="1" transform={`rotate(-90, 16, ${H / 2})`}>PHYSICAL PROGRESS %</text>

          {/* Axes ticks */}
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <text x={toX(v)} y={H - PAD + 14} textAnchor="middle" fill={c.labelMuted} fontSize="7">{v}%</text>
              <text x={PAD - 8} y={toY(v) + 3} textAnchor="end" fill={c.labelMuted} fontSize="7">{v}%</text>
            </g>
          ))}

          {/* Data circles */}
          {(data || []).map((d, i) => {
            const r = Math.min(20, 6 + Number(d.days_since_dpr || 0) / 4);
            const fill = d.health_status === 'Critical' ? '#ef4444' : d.health_status === 'Warning' ? '#f59e0b' : '#10b981';
            return (
              <circle
                key={i}
                cx={toX(d.budget_utilization_pct || 0)}
                cy={toY(d.physical_progress || 0)}
                r={r}
                fill={fill}
                fillOpacity={0.75}
                stroke={fill}
                strokeWidth={1.5}
                strokeOpacity={1}
                className="cursor-pointer transition-all duration-200 hover:fill-opacity-100"
                onMouseEnter={(e) => setTooltip({ ...d, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => navigate(`/projects/${d.work_order_no}/digital-twin`)}
              />
            );
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 chart-tooltip p-3 rounded-2xl text-[10px] pointer-events-none min-w-[180px] shadow-2xl"
            style={{ top: tooltip.y - 120, left: tooltip.x + 20 }}
          >
            <p className="font-extrabold truncate chart-tooltip-title">{tooltip.site_details || 'Site Project'}</p>
            <p className="chart-tooltip-mono text-[9px] mt-0.5">{tooltip.work_order_no}</p>
            <div className="mt-2 space-y-1 pt-1.5 chart-tooltip-divider">
              <p className="chart-tooltip-label">Budget Spent: <span className="text-amber-600 font-extrabold">{tooltip.budget_utilization_pct?.toFixed(1)}%</span></p>
              <p className="chart-tooltip-label">Physical Progress: <span className="text-emerald-600 font-extrabold">{tooltip.physical_progress}%</span></p>
              <p className="chart-tooltip-label">Last DPR Visit: <span className={tooltip.days_since_dpr > 7 ? 'text-rose-600 font-extrabold' : 'chart-tooltip-normal'}>{tooltip.days_since_dpr}d ago</span></p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const FundFlowWaterfall = ({ data }) => {
  const c = useChartColors();
  const W = 600, H = 300, PAD_LEFT = 180, PAD_RIGHT = 100, PAD_Y = 40;
  const barHeight = 24;
  const gap = 16;

  // Find max value for scaling
  const maxVal = Math.max(1, ...(data || []).map(d => Number(d.amount || 0)));
  const scale = (val) => (val / maxVal) * (W - PAD_LEFT - PAD_RIGHT);

  return (
    <div className="chart-panel h-full">
      <div>
        <h3 className="chart-title">Fund Flow Pipeline</h3>
        <p className="chart-subtitle">Capital flow drop-off from cost estimate to agency payment</p>
      </div>

      <div className="relative mt-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {(data || []).map((d, i) => {
            const barW = scale(d.amount);
            const y = PAD_Y + i * (barHeight + gap);
            const prevAmount = i > 0 ? Number(data[i - 1].amount || 0) : d.amount;
            const diff = prevAmount - d.amount;
            const isDropOff = diff > 0;

            return (
              <g key={i}>
                {/* Stage Label */}
                <text x={PAD_LEFT - 12} y={y + 16} textAnchor="end" fill={c.labelNormal} fontSize="8" fontWeight="bold" letterSpacing="0.5">
                  {d.stage.toUpperCase()}
                </text>

                {/* Flow Bar */}
                <rect
                  x={PAD_LEFT}
                  y={y}
                  width={Math.max(2, barW)}
                  height={barHeight}
                  rx={4}
                  fill={isDropOff && i > 0 ? 'url(#rose-gradient)' : 'url(#emerald-gradient)'}
                  className="transition-all duration-300 hover:fill-opacity-90"
                />

                {/* Amount Label */}
                <text x={PAD_LEFT + barW + 10} y={y + 16} fill={c.labelStrong} fontSize="8" fontWeight="bold" className="font-mono">
                  {formatINR(d.amount)}
                </text>

                {/* Drop-off Connection Line and Indicator */}
                {i > 0 && isDropOff && (
                  <g>
                    {/* Connector line */}
                    <path
                      d={`M ${PAD_LEFT + scale(prevAmount)} ${y - gap} L ${PAD_LEFT + scale(prevAmount)} ${y} L ${PAD_LEFT + barW} ${y}`}
                      fill="none"
                      stroke={c.dropOffConnector}
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    {/* Drop-off amount */}
                    <text x={PAD_LEFT + scale(prevAmount) + 6} y={y - 4} fill={c.isDark ? '#f43f5e' : '#be123c'} fontSize="7" fontWeight="black" className="font-mono">
                      -{formatINR(diff)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Gradients Definitions */}
          <defs>
            <linearGradient id="emerald-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#059669" stopOpacity={c.isDark ? '0.8' : '0.9'} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={c.isDark ? '0.8' : '0.9'} />
            </linearGradient>
            <linearGradient id="rose-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#dc2626" stopOpacity={c.isDark ? '0.8' : '0.9'} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={c.isDark ? '0.8' : '0.9'} />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
};

const ZonalPerformanceHeatmap = ({ data, onSelectZone, selectedZone }) => {
  const getScoreBg = (score) => {
    if (score >= 80) return 'badge-emerald';
    if (score >= 60) return 'badge-amber';
    return 'badge-rose';
  };

  const getUtilBg = (pct) => {
    if (pct <= 80) return 'badge-emerald';
    if (pct <= 100) return 'badge-amber';
    return 'badge-rose';
  };

  const getRiskBg = (count) => {
    if (count === 0) return 'badge-emerald';
    if (count <= 2) return 'badge-amber';
    return 'badge-rose';
  };

  return (
    <div className="chart-panel h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="chart-title">Zonal Performance Heatmap</h3>
          <p className="chart-subtitle">Cross-regional metric matrices. Click a row to filter work orders.</p>
        </div>
        {selectedZone && (
          <button
            onClick={() => onSelectZone(null)}
            className="chart-filter-btn"
          >
            Clear Filter
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="chart-table-header">
              <th className="py-2 text-[9px] font-bold uppercase tracking-widest">Zone</th>
              <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">Health Index</th>
              <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">Budget Util %</th>
              <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">Projects</th>
              <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">At-Risk</th>
              <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">Delayed</th>
            </tr>
          </thead>
          <tbody className="chart-table-body">
            {(data || []).map((row, idx) => {
              const isSelected = selectedZone === row.zone;
              return (
                <tr
                  key={idx}
                  onClick={() => onSelectZone(isSelected ? null : row.zone)}
                  className={`cursor-pointer transition-colors chart-table-row ${isSelected ? 'chart-table-row-selected' : ''}`}
                >
                  <td className="py-3.5 font-extrabold chart-text-primary">{row.zone}</td>
                  <td className="py-3.5 text-center">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold ${getScoreBg(row.health_score)}`}>
                      {row.health_score.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3.5 text-center">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold ${getUtilBg(row.budget_util)}`}>
                      {row.budget_util.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3.5 text-center font-bold chart-text-secondary">{row.total_projects}</td>
                  <td className="py-3.5 text-center">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold ${getRiskBg(row.projects_at_risk)}`}>
                      {row.projects_at_risk}
                    </span>
                  </td>
                  <td className="py-3.5 text-center">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold ${getRiskBg(row.delayed_projects)}`}>
                      {row.delayed_projects}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const PredictiveRunwayLines = ({ trendData, runwayData }) => {
  const c = useChartColors();
  const W = 600, H = 300, PAD = 50;

  // Flatten all history balances to find max balance for Y scaling
  const allTxs = (trendData || []).flatMap(t => t.history || []);
  const maxBalance = Math.max(10000, ...allTxs.map(h => Number(h.balance || 0)), ...(runwayData || []).map(r => Number(r.available_balance || 0)));

  const getPoints = (history, rData) => {
    if (!history || history.length === 0) return '';
    const points = history.map((h, idx) => {
      const x = PAD + (idx / 120) * (W - 2 * PAD);
      const y = (H - PAD) - ((h.balance || 0) / maxBalance) * (H - 2 * PAD);
      return `${x},${y}`;
    });
    if (rData) {
      const startBal = rData.available_balance || 0;
      const burn = rData.daily_burn || 0;
      for (let i = 1; i <= 60; i++) {
        const projBal = Math.max(0, startBal - burn * i);
        const x = PAD + ((history.length + i) / 120) * (W - 2 * PAD);
        const y = (H - PAD) - (projBal / maxBalance) * (H - 2 * PAD);
        points.push(`${x},${y}`);
      }
    }
    return points.join(' ');
  };

  const lineColors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

  return (
    <div className="chart-panel h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="chart-title">Cash Runway &amp; Projections</h3>
          <p className="chart-subtitle">60-day historical ledger vs 60-day predictive burn-rate projection</p>
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Y Axis Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
            const y = PAD + r * (H - 2 * PAD);
            return (
              <g key={i}>
                <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke={c.gridLine} />
                <text x={PAD - 8} y={y + 3} textAnchor="end" fill={c.labelMuted} fontSize="7" className="font-mono">
                  {formatINR(maxBalance * (1 - r))}
                </text>
              </g>
            );
          })}

          {/* Today vertical divider line */}
          <line x1={W / 2} y1={PAD} x2={W / 2} y2={H - PAD} stroke={c.todayLine} strokeDasharray="3 3" />
          <text x={W / 2} y={PAD - 8} textAnchor="middle" fill={c.todayText} fontSize="7" fontWeight="bold" letterSpacing="0.5">TODAY</text>

          {/* Timeline bounds */}
          <text x={PAD} y={H - PAD + 14} fill={c.labelMuted} fontSize="7">-60 DAYS</text>
          <text x={W - PAD} y={H - PAD + 14} textAnchor="end" fill={c.labelMuted} fontSize="7">+60 DAYS</text>

          {/* Trend lines */}
          {(trendData || []).map((t, idx) => {
            const rData = (runwayData || []).find(r => r.zo_user_id === t.zo_user_id);
            const pts = getPoints(t.history, rData);
            if (!pts) return null;
            const stroke = lineColors[idx % lineColors.length];

            return (
              <g key={idx}>
                <polyline
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2"
                  points={pts}
                  opacity={0.85}
                />
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="flex gap-4 flex-wrap mt-4 text-[9px] font-bold uppercase tracking-widest chart-label justify-center">
          {(trendData || []).map((t, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 rounded-full" style={{ backgroundColor: lineColors[idx % lineColors.length] }}></span>
              <span>{t.zo_user_id}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const SCurveProgress = ({ data }) => {
  const [selectedWo, setSelectedWo] = useState('all');
  const c = useChartColors();
  const W = 600, H = 300, PAD = 50;

  const activeWos = (data || []).map(d => d.work_order_no);
  const currentActuals = selectedWo === 'all'
    ? (data || []).flatMap(d => d.actuals || [])
    : (data || []).find(d => d.work_order_no === selectedWo)?.actuals || [];

  const getPoints = (pointsList) => {
    if (!pointsList || pointsList.length === 0) return '';
    const sorted = [...pointsList].sort((a, b) => new Date(a.date) - new Date(b.date));
    return sorted.map((p, idx) => {
      const x = PAD + (idx / Math.max(1, sorted.length - 1)) * (W - 2 * PAD);
      const y = (H - PAD) - (Number(p.progress || 0) / 100) * (H - 2 * PAD);
      return `${x},${y}`;
    }).join(' ');
  };

  const plannedPoints = `${PAD},${H - PAD} ${W - PAD},${PAD}`;

  return (
    <div className="chart-panel h-full">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <div>
          <h3 className="chart-title">S-Curve Performance Progress</h3>
          <p className="chart-subtitle">Planned linear trajectory vs actual DPR submissions</p>
        </div>
        <select
          value={selectedWo}
          onChange={(e) => setSelectedWo(e.target.value)}
          className="chart-select"
        >
          <option value="all">Average Portfolio</option>
          {activeWos.map(wo => (
            <option key={wo} value={wo}>{wo}</option>
          ))}
        </select>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Y Axis Grid lines */}
          {[0, 25, 50, 75, 100].map((v, i) => {
            const y = (H - PAD) - (v / 100) * (H - 2 * PAD);
            return (
              <g key={i}>
                <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke={c.gridLine} />
                <text x={PAD - 8} y={y + 3} textAnchor="end" fill={c.labelMuted} fontSize="7" className="font-mono">{v}%</text>
              </g>
            );
          })}

          {/* Time markers */}
          <text x={PAD} y={H - PAD + 14} fill={c.labelMuted} fontSize="7">START DATE</text>
          <text x={W - PAD} y={H - PAD + 14} textAnchor="end" fill={c.labelMuted} fontSize="7">COMPLETION</text>

          {/* Planned Line (Dashed Amber) */}
          <polyline
            fill="none"
            stroke={c.isDark ? '#f59e0b' : '#d97706'}
            strokeWidth="1.5"
            strokeDasharray="5 4"
            points={plannedPoints}
          />

          {/* Actual Line (Solid Emerald) */}
          {currentActuals.length > 0 && (
            <polyline
              fill="none"
              stroke={c.isDark ? '#10b981' : '#059669'}
              strokeWidth="2.5"
              points={getPoints(currentActuals)}
            />
          )}
        </svg>

        {/* Legend */}
        <div className="flex gap-6 mt-4 text-[9px] font-bold uppercase tracking-widest chart-label justify-center">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t-2 border-dashed" style={{ borderColor: c.isDark ? '#f59e0b' : '#d97706' }}></span>
            <span>Planned Target</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-sm" style={{ backgroundColor: c.isDark ? '#10b981' : '#059669' }}></span>
            <span>Actual Progress</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const RevisionHeatmap = ({ data, isModal = false }) => {
  const [tooltip, setTooltip] = useState(null);
  const c = useChartColors();
  const W = 600, PAD_LEFT = 120, PAD_RIGHT = 30, CELL_SIZE = 24, GAP = 4;

  const workOrders = Array.from(new Set((data || []).map(d => d.work_order_no)));
  const months = Array.from(new Set((data || []).map(d => d.month))).sort();

  const H = Math.max(120, workOrders.length * (CELL_SIZE + GAP) + 60);

  const getCellColor = (count) => {
    if (!count || count === 0) return c.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)';
    if (count === 1) return c.isDark ? 'rgba(245,158,11,0.22)' : 'rgba(217,119,6,0.25)';
    if (count === 2) return c.isDark ? 'rgba(245,158,11,0.55)' : 'rgba(217,119,6,0.6)';
    return c.isDark ? 'rgba(239,68,68,0.7)' : 'rgba(185,28,28,0.75)';
  };

  return (
    <div className="chart-panel h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="chart-title">Estimate Revision Timeline Churn</h3>
          <p className="chart-subtitle">Monthly revision request metrics. Projects with &gt;3 revisions are flagged.</p>
        </div>
      </div>

      <div className="relative overflow-y-auto no-scrollbar flex-1" style={isModal ? {} : { maxHeight: '340px' }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Render Months Header */}
          {months.map((m, idx) => {
            const x = PAD_LEFT + idx * (CELL_SIZE + GAP) + CELL_SIZE / 2;
            return (
              <text key={m} x={x} y={20} textAnchor="middle" fill={c.labelNormal} fontSize="7" fontWeight="bold">
                {m.split('-')[1] || m}
              </text>
            );
          })}

          {/* Render Rows */}
          {workOrders.map((wo, wIdx) => {
            const y = 40 + wIdx * (CELL_SIZE + GAP);
            const totalRevisions = (data || []).filter(d => d.work_order_no === wo).reduce((acc, curr) => acc + curr.revision_count, 0);
            const isHighChurn = totalRevisions > 3;

            return (
              <g key={wo}>
                {/* Work Order Label */}
                <text x={PAD_LEFT - 10} y={y + 16} textAnchor="end" fill={isHighChurn ? c.highChurnLabel : c.normalLabel} fontSize="8" fontWeight="bold" className="font-mono">
                  {wo} {isHighChurn && '⚠️'}
                </text>

                {/* Heatmap cells */}
                {months.map((m, mIdx) => {
                  const x = PAD_LEFT + mIdx * (CELL_SIZE + GAP);
                  const entry = (data || []).find(d => d.work_order_no === wo && d.month === m);
                  const count = entry ? entry.revision_count : 0;

                  return (
                    <rect
                      key={m}
                      x={x}
                      y={y}
                      width={CELL_SIZE}
                      height={CELL_SIZE}
                      rx={3}
                      fill={getCellColor(count)}
                      stroke={c.cellBorder}
                      strokeWidth={1}
                      className="cursor-pointer transition-colors"
                      onMouseEnter={(e) => count > 0 && setTooltip({ wo, month: m, count, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => count > 0 && setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 chart-tooltip px-3 py-2 rounded-2xl text-[9px] pointer-events-none shadow-2xl"
            style={{ top: tooltip.y - 60, left: tooltip.x + 20 }}
          >
            <p className="font-extrabold chart-tooltip-title font-mono">{tooltip.wo}</p>
            <p className="chart-tooltip-label mt-1">Revisions in {tooltip.month}: <span className="text-amber-600 font-bold">{tooltip.count}</span></p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Department Wise Estimate Donut Chart ──────────────────────────────────────
const DepartmentWiseEstimate = ({ data = [] }) => {
  const { isDark } = useTheme();

  const DEFAULT_COLORS = ['#2563EB', '#0D9488', '#7C3AED', '#F97316', '#64748B', '#E11D48', '#059669'];

  const items = React.useMemo(() => {
    if (!data || data.length === 0) {
      return [
        { department: 'Civil', amount: 44800000, percentage: 38, color: '#2563EB' },
        { department: 'Electrical', amount: 30700000, percentage: 26, color: '#0D9488' },
        { department: 'Mechanical', amount: 21200000, percentage: 18, color: '#7C3AED' },
        { department: 'Plumbing', amount: 11800000, percentage: 10, color: '#F97316' },
        { department: 'Others', amount: 9500000, percentage: 8, color: '#64748B' }
      ];
    }
    return data.map((item, idx) => ({
      ...item,
      color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
    }));
  }, [data]);

  const donutSlices = React.useMemo(() => {
    let cumulativeAngle = 0;
    const center = 100;
    const outerRadius = 85;
    const innerRadius = 45;

    return items.map((slice) => {
      const angle = (slice.percentage / 100) * 360;
      const startAngle = cumulativeAngle;
      const endAngle = cumulativeAngle + angle;
      cumulativeAngle += angle;

      const startRad = (startAngle - 90) * (Math.PI / 180);
      const endRad = (endAngle - 90) * (Math.PI / 180);

      const x1 = center + outerRadius * Math.cos(startRad);
      const y1 = center + outerRadius * Math.sin(startRad);
      const x2 = center + outerRadius * Math.cos(endRad);
      const y2 = center + outerRadius * Math.sin(endRad);

      const x3 = center + innerRadius * Math.cos(endRad);
      const y3 = center + innerRadius * Math.sin(endRad);
      const x4 = center + innerRadius * Math.cos(startRad);
      const y4 = center + innerRadius * Math.sin(startRad);

      const largeArc = angle > 180 ? 1 : 0;

      const pathData = [
        `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
        `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
        'Z'
      ].join(' ');

      const midRad = ((startAngle + endAngle) / 2 - 90) * (Math.PI / 180);
      const labelRadius = (outerRadius + innerRadius) / 2;
      const labelX = center + labelRadius * Math.cos(midRad);
      const labelY = center + labelRadius * Math.sin(midRad);

      return {
        ...slice,
        pathData,
        labelX,
        labelY,
        angle
      };
    });
  }, [items]);

  const formatAmount = (amt) => {
    if (!amt || isNaN(amt)) return '₹ 0';
    if (amt >= 10000000) return `₹ ${(amt / 10000000).toFixed(2)} Cr`;
    if (amt >= 100000) return `₹ ${(amt / 100000).toFixed(2)} L`;
    return `₹ ${Number(amt).toLocaleString('en-IN')}`;
  };

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-5">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h3 className="chart-title text-base sm:text-lg font-extrabold tracking-tight" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>
            Department Wise Estimate Amount
          </h3>
          <p className="chart-subtitle text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Breakdown of estimated costs across operational departments
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-around gap-6 my-auto py-2">
        {/* Donut Visual */}
        <div className="relative w-52 h-52 sm:w-60 sm:h-60 shrink-0">
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
            {donutSlices.map((slice, idx) => (
              <g key={idx} className="transition-all duration-300 hover:opacity-90 cursor-pointer group">
                <path
                  d={slice.pathData}
                  fill={slice.color}
                  stroke={isDark ? '#0f172a' : '#ffffff'}
                  strokeWidth="2.5"
                />
                {slice.percentage >= 6 && (
                  <text
                    x={slice.labelX}
                    y={slice.labelY + 4}
                    fill="#ffffff"
                    fontSize="11"
                    fontWeight="800"
                    textAnchor="middle"
                    className="pointer-events-none drop-shadow"
                  >
                    {Math.round(slice.percentage)}%
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>

        {/* Legend List */}
        <div className="flex flex-col gap-2.5 w-full md:w-auto min-w-[210px]">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between gap-4 text-xs font-semibold py-1 px-2.5 rounded-lg hover:bg-slate-500/10 transition-colors">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: item.color }} />
                <span className="chart-text-primary text-slate-800 dark:text-slate-200 font-bold text-xs sm:text-sm">
                  {item.department}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono">
                <span className="font-extrabold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                  {formatAmount(item.amount)}
                </span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold">
                  ({item.percentage}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Generic Interactive Donut Metric Card with Work Orders Hover Popover ─────
const MetricDonutCard = ({
  title,
  subtitle,
  centerLabel,
  centerValue,
  buckets = [],
  fallbackData
}) => {
  const { isDark } = useTheme();
  const [hoveredBucket, setHoveredBucket] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });

  const activeBuckets = React.useMemo(() => {
    if (buckets && buckets.length > 0 && buckets.some(b => b.count > 0)) {
      return buckets;
    }
    return fallbackData || [];
  }, [buckets, fallbackData]);

  const totalCount = React.useMemo(() => {
    return activeBuckets.reduce((acc, curr) => acc + (curr.count || 0), 0);
  }, [activeBuckets]);

  // Compute SVG Donut Slices
  const slices = React.useMemo(() => {
    let cumulativeAngle = 0;
    const center = 100;
    const outerRadius = 85;
    const innerRadius = 55;

    return activeBuckets.map((bucket) => {
      const pct = totalCount > 0 ? (bucket.count / totalCount) * 100 : bucket.percentage || 0;
      const angle = (pct / 100) * 360;
      const startAngle = cumulativeAngle;
      const endAngle = cumulativeAngle + angle;
      cumulativeAngle += angle;

      const startRad = (startAngle - 90) * (Math.PI / 180);
      const endRad = (endAngle - 90) * (Math.PI / 180);

      const x1 = center + outerRadius * Math.cos(startRad);
      const y1 = center + outerRadius * Math.sin(startRad);
      const x2 = center + outerRadius * Math.cos(endRad);
      const y2 = center + outerRadius * Math.sin(endRad);

      const x3 = center + innerRadius * Math.cos(endRad);
      const y3 = center + innerRadius * Math.sin(endRad);
      const x4 = center + innerRadius * Math.cos(startRad);
      const y4 = center + innerRadius * Math.sin(startRad);

      const largeArc = angle > 180 ? 1 : 0;

      const pathData = [
        `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
        `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
        'Z'
      ].join(' ');

      return {
        ...bucket,
        pct: Math.round(pct),
        pathData
      };
    });
  }, [activeBuckets, totalCount]);

  const handleMouseEnter = (e, bucket) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopoverPos({
      x: Math.min(window.innerWidth - 320, rect.left + rect.width / 2),
      y: rect.top
    });
    setHoveredBucket(bucket);
  };

  const handleMouseMove = (e) => {
    if (hoveredBucket) {
      setPopoverPos({
        x: Math.min(window.innerWidth - 340, e.clientX + 15),
        y: Math.min(window.innerHeight - 280, e.clientY + 15)
      });
    }
  };

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-5 relative" onMouseMove={handleMouseMove}>
      <div className="flex justify-between items-center mb-2">
        <div>
          <h3 className="chart-title text-base sm:text-lg font-extrabold tracking-tight" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>
            {title}
          </h3>
          {subtitle && (
            <p className="chart-subtitle text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-around gap-6 my-auto py-2">
        {/* Donut Graphic with Center Text */}
        <div className="relative w-52 h-52 sm:w-60 sm:h-60 shrink-0 flex items-center justify-center">
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
            {slices.map((slice, idx) => (
              <path
                key={idx}
                d={slice.pathData}
                fill={slice.color}
                stroke={isDark ? '#0f172a' : '#ffffff'}
                strokeWidth="3"
                className="transition-all duration-300 hover:opacity-80 cursor-pointer"
                style={{
                  transform: hoveredBucket?.label === slice.label ? 'scale(1.04)' : 'scale(1)',
                  transformOrigin: '100px 100px'
                }}
                onMouseEnter={(e) => handleMouseEnter(e, slice)}
                onMouseLeave={() => setHoveredBucket(null)}
              />
            ))}
          </svg>

          {/* Center Label inside donut */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {centerLabel}
            </span>
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
              {centerValue}
            </span>
          </div>
        </div>

        {/* Legend List */}
        <div className="flex flex-col gap-2.5 w-full md:w-auto min-w-[210px]">
          {slices.map((item, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between gap-4 text-xs font-semibold py-1.5 px-2.5 rounded-xl cursor-pointer transition-all ${
                hoveredBucket?.label === item.label
                  ? 'bg-amber-500/15 border border-amber-500/30 scale-[1.02]'
                  : 'hover:bg-slate-500/10 border border-transparent'
              }`}
              onMouseEnter={(e) => handleMouseEnter(e, item)}
              onMouseLeave={() => setHoveredBucket(null)}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: item.color }} />
                <span className="chart-text-primary text-slate-800 dark:text-slate-200 font-bold text-xs sm:text-sm">
                  {item.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono">
                <span className="font-extrabold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                  {item.count}
                </span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold">
                  ({item.pct}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Floating Hover Popover listing matching Work Orders */}
      {hoveredBucket && (
        <div
          className="fixed z-[600] rounded-2xl shadow-2xl p-3.5 min-w-[280px] max-w-[340px] pointer-events-none transition-all duration-150 backdrop-blur-md"
          style={{
            top: popoverPos.y - 10,
            left: popoverPos.x,
            backgroundColor: isDark ? 'rgba(30, 41, 59, 0.96)' : 'rgba(255, 255, 255, 0.96)',
            border: `1.5px solid ${hoveredBucket.color}`,
            boxShadow: `0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px ${hoveredBucket.color}40`
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/60 pb-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: hoveredBucket.color }} />
              <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                {hoveredBucket.label}
              </span>
            </div>
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {hoveredBucket.workOrders?.length || hoveredBucket.count || 0} Work Orders
            </span>
          </div>

          {hoveredBucket.workOrders && hoveredBucket.workOrders.length > 0 ? (
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {hoveredBucket.workOrders.slice(0, 15).map((wo, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/50"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-extrabold font-mono text-[11px] text-slate-900 dark:text-slate-100 truncate">
                      {wo.work_order_no}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {wo.site_details}
                    </p>
                  </div>
                  <span className="shrink-0 font-extrabold text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    {wo.value}
                  </span>
                </div>
              ))}
              {hoveredBucket.workOrders.length > 15 && (
                <p className="text-[10px] text-center font-bold text-slate-400 pt-1">
                  + {hoveredBucket.workOrders.length - 15} more work orders
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic text-center py-2">
              No active work orders in this metric
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ── Physical Work Progress Card Component ─────────────────────────────────────
const PhysicalWorkProgress = ({ data }) => {
  const fallbackData = [
    {
      label: '60% and above',
      color: '#16A34A',
      count: 65,
      percentage: 51,
      workOrders: [
        { work_order_no: 'WB_APD_101', site_details: 'Main Road Work-1', value: '85%' },
        { work_order_no: 'WB_BAN_102', site_details: 'Main Road Work-2', value: '78%' },
        { work_order_no: 'WB_BIR_103', site_details: 'Main Road Work-3', value: '64%' }
      ]
    },
    {
      label: '40% - 59%',
      color: '#EAB308',
      count: 35,
      percentage: 27,
      workOrders: [
        { work_order_no: 'SK_GAN_201', site_details: 'Main Road Work-5', value: '55%' },
        { work_order_no: 'OD_ANG_301', site_details: 'Pipe Line Work-2', value: '48%' }
      ]
    },
    {
      label: 'Below 40%',
      color: '#DC2626',
      count: 16,
      percentage: 12,
      workOrders: [
        { work_order_no: 'JH_CHA_402', site_details: 'River Embankment-1', value: '32%' },
        { work_order_no: 'BH_ARA_501', site_details: 'River Embankment-3', value: '18%' }
      ]
    },
    {
      label: 'Not Started',
      color: '#64748B',
      count: 12,
      percentage: 9,
      workOrders: [
        { work_order_no: 'JH_DEO_403', site_details: 'River Embankment-2', value: '0%' }
      ]
    }
  ];

  return (
    <MetricDonutCard
      title="Physical Work Progress"
      centerLabel="Avg. Progress"
      centerValue={data?.avgProgress || '81%'}
      buckets={data?.buckets}
      fallbackData={fallbackData}
    />
  );
};

// ── JE Visit Frequency Card Component ─────────────────────────────────────────
const JeVisitFrequency = ({ data }) => {
  const fallbackData = [
    {
      label: '≤ 7 Days',
      color: '#0D9488',
      count: 46,
      percentage: 36,
      workOrders: [
        { work_order_no: 'WB_APD_101', site_details: 'Main Road Work-1', value: '2d ago' },
        { work_order_no: 'SK_GAN_201', site_details: 'Main Road Work-5', value: '5d ago' }
      ]
    },
    {
      label: '8 – 15 Days',
      color: '#0284C7',
      count: 52,
      percentage: 41,
      workOrders: [
        { work_order_no: 'WB_BAN_102', site_details: 'Main Road Work-2', value: '10d ago' },
        { work_order_no: 'OD_ANG_301', site_details: 'Pipe Line Work-2', value: '14d ago' }
      ]
    },
    {
      label: '> 15 Days',
      color: '#EF4444',
      count: 20,
      percentage: 16,
      workOrders: [
        { work_order_no: 'JH_CHA_402', site_details: 'River Embankment-1', value: '22d ago' },
        { work_order_no: 'BH_ARA_501', site_details: 'River Embankment-3', value: '28d ago' }
      ]
    },
    {
      label: 'No Visit',
      color: '#64748B',
      count: 10,
      percentage: 7,
      workOrders: [
        { work_order_no: 'JH_DEO_403', site_details: 'River Embankment-2', value: 'No Visit' }
      ]
    }
  ];

  return (
    <MetricDonutCard
      title="JE Visit Frequency"
      centerLabel="Avg. Visit"
      centerValue={data?.avgVisit || '14 Days'}
      buckets={data?.buckets}
      fallbackData={fallbackData}
    />
  );
};

// ── Key Financial Indicators Component ───────────────────────────────────────
const KeyFinancialIndicators = ({ data }) => {
  const { isDark } = useTheme();

  const formatFinancialAmount = (amt) => {
    if (!amt || isNaN(amt)) return '₹ 0';
    if (amt >= 10000000) {
      const inCr = amt / 10000000;
      const str = inCr.toFixed(3);
      const trimmed = str.endsWith('0') ? inCr.toFixed(2) : str;
      return `₹ ${trimmed} Cr`;
    }
    if (amt >= 100000) return `₹ ${(amt / 100000).toFixed(2)} L`;
    return `₹ ${Number(amt).toLocaleString('en-IN')}`;
  };

  const items = [
    {
      label: 'EMD Amount',
      value: data?.emdAmount ?? 3200000,
      bgColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    },
    {
      label: 'Security Deposit',
      value: data?.securityDeposit ?? 4200000,
      bgColor: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      )
    },
    {
      label: 'IT TDS',
      value: data?.itTds ?? 8400000,
      bgColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" />
        </svg>
      )
    },
    {
      label: 'SGST',
      value: data?.sgst ?? 3680000,
      bgColor: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
        </svg>
      )
    },
    {
      label: 'CGST',
      value: data?.cgst ?? 3680000,
      bgColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 11h10M7 15h10M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
        </svg>
      )
    },
    {
      label: 'Not Utilized',
      value: data?.notUtilized ?? 900000,
      bgColor: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      )
    }
  ];

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-5">
      <div className="flex justify-between items-center mb-3">
        <div>
          <h3 className="chart-title text-base sm:text-lg font-extrabold tracking-tight" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>
            Key Financial Indicators
          </h3>
          <p className="chart-subtitle text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Summary of statutory withholdings and unutilized funds
          </p>
        </div>
      </div>

      <div className="flex flex-col justify-between my-auto gap-2">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-slate-500/10 transition-colors border border-slate-200/50 dark:border-slate-800/60"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full border shadow-xs ${item.bgColor}`}>
                {item.icon}
              </div>
              <span className="font-bold text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                {item.label}
              </span>
            </div>
            <span className="font-extrabold text-xs sm:text-sm font-mono text-slate-900 dark:text-slate-100">
              {formatFinancialAmount(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Executive 9-KPI Strip Component ──────────────────────────────────────────
const ExecutiveKpiStrip = ({ data }) => {
  const { isDark } = useTheme();

  const formatCr = (amt) => {
    if (!amt || isNaN(amt)) return '₹ 0';
    if (amt >= 10000000) return `₹ ${(amt / 10000000).toFixed(2)} Cr`;
    if (amt >= 100000) return `₹ ${(amt / 100000).toFixed(2)} L`;
    return `₹ ${Number(amt).toLocaleString('en-IN')}`;
  };

  const kpis = [
    {
      id: 'work_orders',
      title: 'Total Work Orders',
      titleColor: 'text-[#1E3A8A] dark:text-[#60A5FA]',
      value: data?.totalWorkOrders?.total ?? 128,
      isCurrency: false,
      subtext: `Running: ${data?.totalWorkOrders?.running ?? 84} | Completed: ${data?.totalWorkOrders?.completed ?? 32}\nPending: ${data?.totalWorkOrders?.pending ?? 12}`,
      bgClass: 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/80 dark:border-blue-800/40',
      iconBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      )
    },
    {
      id: 'wo_value',
      title: 'Total WO Value',
      titleColor: 'text-[#15803D] dark:text-[#4ADE80]',
      value: formatCr(data?.totalWOValue ?? 125000000),
      isCurrency: true,
      subtext: null,
      bgClass: 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/40',
      iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      icon: (
        <span className="font-extrabold text-sm">₹</span>
      )
    },
    {
      id: 'estimate',
      title: 'Total Estimate Amount',
      titleColor: 'text-[#6D28D9] dark:text-[#C084FC]',
      value: formatCr(data?.totalEstimateAmount?.amount ?? 118000000),
      isCurrency: true,
      subtext: `${data?.totalEstimateAmount?.pctOfWOValue ?? 94.4}% of WO Value`,
      bgClass: 'bg-purple-50/60 dark:bg-purple-950/20 border-purple-200/80 dark:border-purple-800/40',
      iconBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    },
    {
      id: 'requisition',
      title: 'Total Requisition (ZO → HO)',
      titleColor: 'text-[#C2410C] dark:text-[#FB923C]',
      value: formatCr(data?.totalRequisition?.amount ?? 102500000),
      isCurrency: true,
      subtext: `${data?.totalRequisition?.pctOfEstimate ?? 86.9}% of Estimate`,
      bgClass: 'bg-orange-50/60 dark:bg-orange-950/20 border-orange-200/80 dark:border-orange-800/40',
      iconBg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 01-2-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    },
    {
      id: 'approved',
      title: 'Total Approved (HO → ZO)',
      titleColor: 'text-[#B45309] dark:text-[#FBBF24]',
      value: formatCr(data?.totalApproved?.amount ?? 99000000),
      isCurrency: true,
      subtext: `${data?.totalApproved?.pctOfRequisition ?? 96.6}% of Requisition`,
      bgClass: 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-800/40',
      iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h47M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      id: 'zo_balance',
      title: 'ZO Available Balance',
      titleColor: 'text-[#1D4ED8] dark:text-[#60A5FA]',
      value: formatCr(data?.zoAvailableBalance ?? 11200000),
      isCurrency: true,
      subtext: null,
      bgClass: 'bg-sky-50/60 dark:bg-sky-950/20 border-sky-200/80 dark:border-sky-800/40',
      iconBg: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      )
    },
    {
      id: 'refund',
      title: 'Total Refund Amount',
      titleColor: 'text-[#0F766E] dark:text-[#2DD4BF]',
      value: formatCr(data?.totalRefundAmount ?? 1800000),
      isCurrency: true,
      subtext: null,
      bgClass: 'bg-teal-50/60 dark:bg-teal-950/20 border-teal-200/80 dark:border-teal-800/40',
      iconBg: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
        </svg>
      )
    },
    {
      id: 'gross_bill',
      title: 'Gross Bill Amount',
      titleColor: 'text-[#BE123C] dark:text-[#FB7185]',
      value: formatCr(data?.grossBillAmount?.amount ?? 86500000),
      isCurrency: true,
      subtext: `${data?.grossBillAmount?.pctOfEstimate ?? 73.3}% of Estimate`,
      bgClass: 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200/80 dark:border-rose-800/40',
      iconBg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      id: 'agency_payment',
      title: 'Agency Payment',
      titleColor: 'text-[#4338CA] dark:text-[#818CF8]',
      value: formatCr(data?.agencyPayment?.amount ?? 82000000),
      isCurrency: true,
      subtext: `${data?.agencyPayment?.pctOfGrossBill ?? 94.8}% of Gross Bill`,
      bgClass: 'bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-200/80 dark:border-indigo-800/40',
      iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-3 mb-6">
      {kpis.map((kpi) => (
        <div
          key={kpi.id}
          className={`p-3 rounded-2xl border flex flex-col justify-between transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 ${kpi.bgClass}`}
        >
          <p className={`text-[11px] font-extrabold tracking-tight truncate mb-2 ${kpi.titleColor}`}>
            {kpi.title}
          </p>

          <div className="flex items-center gap-2 my-auto">
            <div className={`p-1.5 rounded-xl shrink-0 flex items-center justify-center ${kpi.iconBg}`}>
              {kpi.icon}
            </div>
            <span className="text-sm sm:text-base font-black tracking-tight text-slate-900 dark:text-slate-100 font-mono truncate">
              {kpi.value}
            </span>
          </div>

          {kpi.subtext ? (
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-2 whitespace-pre-line truncate">
              {kpi.subtext}
            </p>
          ) : (
            <div className="h-4 mt-2" />
          )}
        </div>
      ))}
    </div>
  );
};

const WorkOrderTelemetryTable = ({ data, selectedZone, onSelectZone }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [sortField, setSortField] = useState('health_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const rowsPerPage = 20;

  // Filter list
  const filtered = data.filter(p => {
    const matchesSearch = (p.work_order_no || '').toLowerCase().includes(search.toLowerCase()) ||
                          (p.site_details || '').toLowerCase().includes(search.toLowerCase());
    const matchesZone = !selectedZone || p.zone === selectedZone;
    const matchesDept = !deptFilter || p.department === deptFilter;
    return matchesSearch && matchesZone && matchesDept;
  });

  // Unique departments for filtering
  const depts = Array.from(new Set(data.map(p => p.department).filter(Boolean)));

  // Sort list
  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortField] ?? 0;
    const bVal = b[sortField] ?? 0;
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  // Paginate list
  const totalPages = Math.ceil(sorted.length / rowsPerPage);
  const paginated = sorted.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
    setPage(1);
  };

  const handleExport = () => {
    if (sorted.length === 0) return;
    exportProjectsToExcel(sorted);
  };

  return (
    <div className="relative w-full glass-panel p-6 rounded-3xl border border-white/5 bg-slate-900/10 mb-8 text-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Work Order Telemetry</h3>
          <p className="text-[9px] text-slate-500 uppercase font-black tracking-wider mt-1">High-density project tracking and performance telemetry</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={sorted.length === 0}
            className="px-3.5 py-2 rounded-xl bg-emerald-500 text-black text-[9px] font-black uppercase tracking-widest hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Export Excel
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <input
          type="text"
          placeholder="Search work order or site..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-white/20 transition"
        />
        <select
          value={deptFilter}
          onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}
          className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-[10px] text-slate-300 focus:outline-none focus:border-white/20 transition"
        >
          <option value="">All Departments</option>
          {depts.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Zone:</span>
          {selectedZone ? (
            <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold uppercase tracking-wider flex items-center gap-1.5">
              {selectedZone}
              <button onClick={() => onSelectZone(null)} className="hover:text-white font-extrabold">&times;</button>
            </span>
          ) : (
            <span className="text-slate-400 font-bold italic">All Zones</span>
          )}
        </div>
      </div>

      {/* Grid Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 pb-2 text-slate-500 select-none">
              <th onClick={() => handleSort('work_order_no')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest">WO No {sortField === 'work_order_no' && (sortAsc ? '▲' : '▼')}</th>
              <th className="py-2.5 text-[9px] font-bold uppercase tracking-widest">Zone</th>
              <th className="py-2.5 text-[9px] font-bold uppercase tracking-widest">Dept</th>
              <th onClick={() => handleSort('work_order_value')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center">Value {sortField === 'work_order_value' && (sortAsc ? '▲' : '▼')}</th>
              <th onClick={() => handleSort('approved_requisitions_amount')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center">Spent {sortField === 'approved_requisitions_amount' && (sortAsc ? '▲' : '▼')}</th>
              <th onClick={() => handleSort('physical_progress')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center">Progress {sortField === 'physical_progress' && (sortAsc ? '▲' : '▼')}</th>
              <th onClick={() => handleSort('health_score')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center">Health {sortField === 'health_score' && (sortAsc ? '▲' : '▼')}</th>
              <th className="py-2.5 text-right text-[9px] font-bold uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paginated.map((row, idx) => {
              const scoreBg = row.health_score >= 80 ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-500/20' :
                              row.health_score >= 60 ? 'bg-amber-900/20 text-amber-400 border border-amber-500/20' :
                              'bg-rose-900/20 text-rose-400 border border-rose-500/20';

              return (
                <tr key={idx} className="hover:bg-white/5 transition-colors">
                  <td onClick={() => navigate(`/projects/${row.work_order_no}/digital-twin`)} className="py-3.5 font-extrabold text-sky-400 hover:underline cursor-pointer font-mono">{row.work_order_no}</td>
                  <td className="py-3.5 text-slate-300 font-bold uppercase">{row.zone || 'N/A'}</td>
                  <td className="py-3.5 text-slate-400">{row.department}</td>
                  <td className="py-3.5 text-center font-mono text-slate-300">{formatINR(row.work_order_value)}</td>
                  <td className="py-3.5 text-center font-mono text-emerald-400">{formatINR(row.approved_requisitions_amount)}</td>
                  <td className="py-3.5 text-center">
                    <span className="font-extrabold text-slate-200">{row.physical_progress}%</span>
                  </td>
                  <td className="py-3.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${scoreBg}`}>{Math.round(row.health_score)}</span>
                  </td>
                  <td className="py-3.5 text-right">
                    <span className={`px-2.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                      row.health_status === 'Critical' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                      row.health_status === 'Warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                      'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>{row.health_status || 'Healthy'}</span>
                  </td>
                </tr>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan="8" className="py-8 text-center text-slate-500 font-bold uppercase tracking-widest">No work orders match current filters</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/5 select-none">
          <span className="text-[10px] text-slate-500 font-bold uppercase">Page {page} of {totalPages} ({sorted.length} records)</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-bold uppercase tracking-wider text-slate-300 transition"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-bold uppercase tracking-wider text-slate-300 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


const HoDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const [alertMsg, setAlertMsg] = useState(null);
  const [alertType, setAlertType] = useState('success'); // 'success' or 'error'
  const [activeView, setActiveView] = useState('all'); // 'all' | 'zo' | 'je' | 'wo'
  const [selectedZone, setSelectedZone] = useState(null); // Filter for telemetry table
  const [zoomedChart, setZoomedChart] = useState(null); // null | 'bubble' | 'fundflow' | 'zonal' | 'runway' | 'scurve' | 'revision'
  const [kpiDetailModal, setKpiDetailModal] = useState(null); // null | { title, filterType, projects: [] }

  // Fetch actionable insights (runways, stalled)
  const { data: insightsRes } = useQuery({
    queryKey: ['hoInsights'],
    queryFn: async () => {
      const res = await getHoActionableInsights();
      return res.data;
    }
  });

  // Fetch executive chart data
  const { data: chartRes } = useQuery({
    queryKey: ['hoChartData', activeView],
    queryFn: async () => {
      const res = await getHoChartData({ view: activeView });
      return res.data;
    }
  });

  const insights = insightsRes || {};
  const stalledProjects = insights.stalledProjects || [];
  const lowRunwayZones = (insights.runwayData || []).filter(z => z.runway_days !== null && z.runway_days < 21);


  const { data: projectsRes } = useQuery({
    queryKey: ['projectsHealthList'],
    queryFn: async () => {
      const res = await getProjectsHealth();
      return res.data;
    }
  });
  const projectsList = projectsRes?.data || [];


  // 1. Fetch HO KPIs
  const { data: kpiRes, isLoading: kpiLoading, isError: kpiErr } = useQuery({
    queryKey: ['hoKpis'],
    queryFn: async () => {
      const res = await getHoKpis();
      return res.data;
    }
  });

  // 2. Fetch Zonal Benchmarking
  const { data: zoneRes, isLoading: zoneLoading, isError: zoneErr } = useQuery({
    queryKey: ['hoZoneBenchmarking'],
    queryFn: async () => {
      const res = await getHoZoneBenchmarking();
      return res.data;
    }
  });

  // 3. Fetch Budget Leakages
  const { data: leakageRes, isLoading: leakageLoading, isError: leakageErr } = useQuery({
    queryKey: ['hoBudgetLeakage'],
    queryFn: async () => {
      const res = await getHoBudgetLeakage();
      return res.data;
    }
  });

  // 4. Mutation to trigger manual DB materialized view refresh
  const refreshMutation = useMutation({
    mutationFn: refreshAnalyticsViews,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hoKpis'] });
      queryClient.invalidateQueries({ queryKey: ['hoZoneBenchmarking'] });
      queryClient.invalidateQueries({ queryKey: ['hoBudgetLeakage'] });
      showToast('Database views refreshed successfully!', 'success');
    },
    onError: (err) => {
      console.error(err);
      showToast(err.response?.data?.message || 'Failed to refresh views.', 'error');
    }
  });

  const showToast = (msg, type) => {
    setAlertMsg(msg);
    setAlertType(type);
    setTimeout(() => {
      setAlertMsg(null);
    }, 4000);
  };

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  return (
    <>
          {/* Toast Notification */}
          {alertMsg && (
            <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-2xl shadow-xl backdrop-blur-md flex items-center gap-3 border transition-all duration-300 ${
              alertType === 'success' 
                ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-400' 
                : 'bg-rose-950/80 border-rose-500/30 text-rose-400'
            }`}>
              <span className="text-sm font-bold tracking-wide">{alertMsg}</span>
              <button onClick={() => setAlertMsg(null)} className="text-slate-400 hover:text-white">&times;</button>
            </div>
          )}

          {/* Header Row */}
          <div className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/5">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Executive HQ Panel</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Portfolio Performance Analytics</h1>
              <p className="text-xs text-slate-400 mt-1.5">Consolidated portfolio KPIs, zonal performance benchmarking, and cost leakage anomalies.</p>
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshMutation.isPending}
              className={`px-5 py-2.5 rounded-xl border border-white/10 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all duration-300 ${
                refreshMutation.isPending 
                  ? 'bg-white/5 text-slate-400 cursor-not-allowed' 
                  : 'bg-white hover:bg-white/90 text-slate-950'
              }`}
            >
              <svg className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
              </svg>
              {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Views'}
            </button>
          </div>

          {/* View Toggle Pill Tabs */}
          <div className="flex gap-2 mb-8 flex-wrap">
            {[
              { id: 'all', label: 'ALL — Portfolio' },
              { id: 'zo',  label: 'ZO Wise' },
              { id: 'je',  label: 'JE Wise' },
              { id: 'wo',  label: 'Work Order Wise' }
            ].map(tab => (
              <button
                key={tab.id}
                id={`view-toggle-${tab.id}`}
                onClick={() => setActiveView(tab.id)}
                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-300 ${
                  activeView === tab.id
                    ? 'bg-amber-500 border-amber-500 text-black'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Actionable Insights Strip */}
          {(stalledProjects.length > 0 || lowRunwayZones.length > 0) && (
            <div className="mb-8 flex gap-3 overflow-x-auto no-scrollbar pb-2">
              {lowRunwayZones.map((z, idx) => (
                <div key={idx} className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-rose-500/30 bg-rose-950/20 text-rose-400 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                  <span className="animate-pulse">🔴</span>
                  {z.zone || z.zo_user_id} — Balance depletes in {z.runway_days} days
                </div>
              ))}
              {stalledProjects.slice(0, 5).map((p, idx) => (
                <div
                  key={idx}
                  onClick={() => navigate(`/projects/${p.work_order_no}/digital-twin`)}
                  className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-amber-500/30 bg-amber-950/20 text-amber-400 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer hover:border-amber-500/50 transition-colors"
                >
                  <span>⚠️</span>
                  {p.work_order_no} — No DPR for {p.days_since_last_progress_report}d ({p.physical_progress}% done)
                </div>
              ))}
            </div>
          )}

          {/* Executive 9-KPI Strip */}
          <ExecutiveKpiStrip data={chartRes?.executiveSummaryKpis} />

          {/* ── Row 1: Physical Work Progress (1/3) + Department Wise Estimate (1/3) + Key Financial Indicators (1/3) ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <ZoomCard className="col-span-1" onZoom={() => setZoomedChart('physical_progress')}>
              <div style={{ minHeight: '480px' }} className="h-full">
                <PhysicalWorkProgress data={chartRes?.physicalProgressMetrics} />
              </div>
            </ZoomCard>
            <ZoomCard className="col-span-1" onZoom={() => setZoomedChart('department')}>
              <div style={{ minHeight: '480px' }} className="h-full">
                <DepartmentWiseEstimate data={chartRes?.departmentWiseEstimate || []} />
              </div>
            </ZoomCard>
            <ZoomCard className="col-span-1" onZoom={() => setZoomedChart('key_financials')}>
              <div style={{ minHeight: '480px' }} className="h-full">
                <KeyFinancialIndicators data={chartRes?.keyFinancialIndicators} />
              </div>
            </ZoomCard>
          </div>

          {/* ── Row 2: Fund Flow Waterfall (1/2) + Bubble Risk Matrix (1/2) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('fundflow')}>
              <div style={{ minHeight: '480px' }} className="h-full">
                <FundFlowWaterfall data={chartRes?.waterfallData || []} />
              </div>
            </ZoomCard>
            <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('bubble')}>
              <div style={{ minHeight: '480px' }} className="h-full">
                <BubbleRiskMatrix data={chartRes?.bubbleMatrix || []} />
              </div>
            </ZoomCard>
          </div>

          {/* ── Row 3: Zonal Performance Heatmap (full-width) ─────────────── */}
          <ZoomCard className="mb-6" onZoom={() => setZoomedChart('zonal')}>
            <ZonalPerformanceHeatmap
              data={chartRes?.zonalHeatmap || []}
              onSelectZone={setSelectedZone}
              selectedZone={selectedZone}
            />
          </ZoomCard>

          {/* ── Row 3: Runway (1/3) + S-Curve (1/3) + Revision Heatmap (1/3) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('runway')}>
              <div style={{ minHeight: '420px' }} className="h-full">
                <PredictiveRunwayLines
                  trendData={chartRes?.runwayTrend || []}
                  runwayData={insightsRes?.runwayData || []}
                />
              </div>
            </ZoomCard>
            <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('scurve')}>
              <div style={{ minHeight: '420px' }} className="h-full">
                <SCurveProgress data={chartRes?.sCurveData || []} />
              </div>
            </ZoomCard>
            <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('revision')}>
              <div style={{ minHeight: '420px' }} className="h-full">
                <RevisionHeatmap data={chartRes?.revisionHeatmap || []} />
              </div>
            </ZoomCard>
          </div>

          {/* ── Row 4: Quick Executive Summary KPI Strip (6 premium tiles) ──── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            {[
              {
                label: 'Active Projects',
                value: projectsList.length,
                subtext: 'Total ongoing',
                color: 'text-sky-400',
                border: 'border-sky-500/20 hover:border-sky-500/40',
                glow: 'shadow-sky-500/5',
                bgIcon: 'bg-sky-500/10 text-sky-400',
                filterFn: null, // All projects
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                )
              },
              {
                label: 'Healthy',
                value: projectsList.filter(p => p.health_status === 'Healthy').length,
                subtext: 'On track',
                color: 'text-emerald-400',
                border: 'border-emerald-500/20 hover:border-emerald-500/40',
                glow: 'shadow-emerald-500/5',
                bgIcon: 'bg-emerald-500/10 text-emerald-400',
                filterFn: p => p.health_status === 'Healthy',
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )
              },
              {
                label: 'Warning',
                value: projectsList.filter(p => p.health_status === 'Warning').length,
                subtext: 'Needs review',
                color: 'text-amber-400',
                border: 'border-amber-500/20 hover:border-amber-500/40',
                glow: 'shadow-amber-500/5',
                bgIcon: 'bg-amber-500/10 text-amber-400',
                filterFn: p => p.health_status === 'Warning',
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )
              },
              {
                label: 'Critical',
                value: projectsList.filter(p => p.health_status === 'Critical').length,
                subtext: 'Action required',
                color: 'text-rose-400',
                border: 'border-rose-500/20 hover:border-rose-500/40',
                glow: 'shadow-rose-500/5',
                bgIcon: 'bg-rose-500/10 text-rose-400',
                filterFn: p => p.health_status === 'Critical',
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )
              },
              {
                label: 'Avg Progress',
                value: `${projectsList.length ? Math.round(projectsList.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / projectsList.length) : 0}%`,
                subtext: 'Portfolio progress',
                color: 'text-indigo-400',
                border: 'border-indigo-500/20 hover:border-indigo-500/40',
                glow: 'shadow-indigo-500/5',
                bgIcon: 'bg-indigo-500/10 text-indigo-400',
                filterFn: null, // Shows all projects sorted by progress
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                )
              },
              {
                label: 'Avg Health',
                value: `${projectsList.length ? Math.round(projectsList.reduce((a, p) => a + Number(p.health_score || 0), 0) / projectsList.length) : 0}`,
                subtext: 'Health score',
                color: 'text-violet-400',
                border: 'border-violet-500/20 hover:border-violet-500/40',
                glow: 'shadow-violet-500/5',
                bgIcon: 'bg-violet-500/10 text-violet-400',
                filterFn: null, // Shows all projects sorted by health
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                )
              },
            ].map(({ id, label, value, subtext, color, border, glow, bgIcon, icon, filterFn }) => (
              <div
                key={label}
                onClick={() => {
                  const filtered = filterFn ? projectsList.filter(filterFn) : projectsList;
                  setKpiDetailModal({
                    title: label,
                    color,
                    projects: filtered
                  });
                }}
                className={`relative overflow-hidden rounded-2xl border p-4 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${border} ${glow} ${
                  isDark ? 'bg-slate-900/40 text-slate-100' : 'bg-white/80 border-slate-200 shadow-sm text-slate-900'
                } flex flex-col justify-between group cursor-pointer`}
              >
                {/* Background subtle grid pattern overlay - theme aware */}
                <div className={`absolute inset-0 pointer-events-none ${
                  isDark 
                    ? 'opacity-5 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:8px_8px]' 
                    : 'opacity-10 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:8px_8px]'
                }`} />

                <div className="flex items-center justify-between mb-3 relative z-10">
                  <div className={`p-2 rounded-xl ${bgIcon} transition-transform duration-300 group-hover:scale-110`}>
                    {icon}
                  </div>
                  <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${
                    isDark ? 'text-slate-500 group-hover:text-slate-300' : 'text-slate-500 group-hover:text-slate-700'
                  }`}>
                    {subtext}
                  </span>
                </div>

                <div className="relative z-10 mt-1">
                  <div className={`text-3xl font-black tabular-nums tracking-tight ${color} group-hover:brightness-125 transition-all`}>
                    {value}
                  </div>
                  <div className={`text-[10px] font-black uppercase tracking-widest mt-1 flex items-center justify-between ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    <span>{label}</span>
                    <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity font-bold">View →</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Row 5: Full-width Work Order Telemetry Table ──────────────── */}
          <div className="mb-6">
            <WorkOrderTelemetryTable
              data={projectsList}
              selectedZone={selectedZone}
              onSelectZone={setSelectedZone}
            />
          </div>

          {/* ── Fullscreen Chart Zoom Modal ───────────────────────────────── */}
          {zoomedChart === 'physical_progress' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <PhysicalWorkProgress data={chartRes?.physicalProgressMetrics} />
            </ChartModal>
          )}
          {zoomedChart === 'je_visit' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <JeVisitFrequency data={chartRes?.jeVisitFrequencyMetrics} />
            </ChartModal>
          )}
          {zoomedChart === 'department' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <DepartmentWiseEstimate data={chartRes?.departmentWiseEstimate || []} />
            </ChartModal>
          )}
          {zoomedChart === 'key_financials' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <KeyFinancialIndicators data={chartRes?.keyFinancialIndicators} />
            </ChartModal>
          )}
          {zoomedChart === 'bubble' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <BubbleRiskMatrix data={chartRes?.bubbleMatrix || []} />
            </ChartModal>
          )}
          {zoomedChart === 'fundflow' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <FundFlowWaterfall data={chartRes?.waterfallData || []} />
            </ChartModal>
          )}
          {zoomedChart === 'zonal' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <ZonalPerformanceHeatmap data={chartRes?.zonalHeatmap || []} onSelectZone={setSelectedZone} selectedZone={selectedZone} />
            </ChartModal>
          )}
          {zoomedChart === 'runway' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <PredictiveRunwayLines trendData={chartRes?.runwayTrend || []} runwayData={insightsRes?.runwayData || []} />
            </ChartModal>
          )}
          {zoomedChart === 'scurve' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <SCurveProgress data={chartRes?.sCurveData || []} />
            </ChartModal>
          )}
          {zoomedChart === 'revision' && (
            <ChartModal onClose={() => setZoomedChart(null)}>
              <RevisionHeatmap data={chartRes?.revisionHeatmap || []} isModal={true} />
            </ChartModal>
          )}

          {/* ── KPI Details Modal ─────────────────────────────────────────── */}
          {kpiDetailModal && (
            <KpiDetailsModal
              title={kpiDetailModal.title}
              colorClass={kpiDetailModal.color}
              projects={kpiDetailModal.projects}
              onClose={() => setKpiDetailModal(null)}
              navigate={navigate}
            />
          )}

    </>
  );
};

export default HoDashboard;
