import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../components/ThemeContext';
import ModalContext from '../components/ModalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const fmtCr = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹ ${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹ ${(v / 100000).toFixed(2)} L`;
  return `₹ ${v.toLocaleString('en-IN')}`;
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

// ── Dynamic Fullscreen Chart Zoom Modal (React Class Component) ──────────────
class ChartModal extends React.Component {
  static contextType = ModalContext;

  componentDidMount() {
    document.addEventListener('keydown', this.handleKeyDown);
    if (this.context && this.context.openModal) {
      this.context.openModal();
    }
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.context && this.context.closeModal) {
      this.context.closeModal();
    }
  }

  handleKeyDown = (e) => {
    if (e.key === 'Escape' && this.props.onClose) {
      this.props.onClose();
    }
  };

  render() {
    const {
      onClose,
      children,
      isDark = true,
      title,
      width = '80vw',
      height = '80vh',
      maxWidth = '80vw',
      maxHeight = '80vh'
    } = this.props;

    return (
      <div
        className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-8 pl-16 sm:pl-20 transition-all duration-300"
        style={{
          background: isDark ? 'rgba(5, 8, 16, 0.92)' : 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)'
        }}
        onClick={onClose}
      >
        {/* Dynamically Sized Modal Card Box - Contained within Screen */}
        <div
          className={`relative flex flex-col overflow-hidden rounded-3xl border transition-all duration-300 shadow-2xl ${isDark
              ? 'bg-[#0b0e14] border-white/10 text-slate-100 shadow-black/90'
              : 'bg-white border-slate-200 text-slate-900 shadow-2xl'
            }`}
          style={{
            width: width,
            height: height,
            maxWidth: maxWidth,
            maxHeight: maxHeight
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div
            className={`flex items-center justify-between px-6 py-4 border-b shrink-0 gap-4 ${isDark ? 'border-white/10 bg-[#0f172a]' : 'border-slate-100 bg-slate-50'
              }`}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 pl-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_10px_#f59e0b] shrink-0" />
              <h3
                className={`text-xs sm:text-sm font-extrabold uppercase tracking-widest font-mono truncate ${isDark ? 'text-amber-400' : 'text-amber-600'
                  }`}
              >
                {title || 'Chart Telemetry Inspection'}
              </h3>
            </div>

            {/* Red Close Button */}
            <button
              onClick={onClose}
              className="shrink-0 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-all duration-300 shadow-md cursor-pointer flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
              title="Close (ESC)"
            >
              <span>Close</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Dynamically Scaled Inner Content Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0 h-full w-full flex flex-col justify-start">
            {children}
          </div>
        </div>
      </div>
    );
  }
}

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
        className={`relative w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border ${isDark
            ? 'bg-slate-950 border-white/10 text-slate-100 shadow-black/80'
            : 'bg-white border-slate-200 text-slate-900 shadow-2xl shadow-slate-900/20'
          }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={`flex items-center justify-between px-6 py-5 border-b shrink-0 ${isDark ? 'border-white/10 bg-slate-900' : 'border-slate-100 bg-white'
          }`}>
          <div className="flex items-center gap-3">
            <h2 className={`text-lg font-black uppercase tracking-widest ${colorClass || (isDark ? 'text-slate-100' : 'text-slate-900')
              }`}>{title}</h2>
            <span className={`px-3 py-1 rounded-full border text-[10px] font-extrabold ${isDark ? 'bg-white/10 border-white/15 text-slate-200' : 'bg-slate-100 border-slate-200 text-slate-700'
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
            <div className={`text-center py-12 text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-400'
              }`}>
              No projects matching this filter
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`border-b text-[9px] font-black uppercase tracking-widest ${isDark ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'
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
                          className={`py-3.5 px-3 font-extrabold hover:underline cursor-pointer font-mono ${isDark ? 'text-sky-400' : 'text-sky-600'
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
    <div className="chart-panel h-full flex flex-col justify-between">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="Scatter matrix plotting budget utilization vs physical work progress and DPR delay severity."
            formula="X = Budget Spent %, Y = Physical Progress %, Bubble Radius = Days Since Last DPR"
          />
          <div>
            <h3 className="chart-title">Bubble Risk Matrix</h3>
            <p className="chart-subtitle">Budget vs Physical Progress vs reporting frequency</p>
          </div>
        </div>
        <div className="flex gap-3 text-[8px] font-black uppercase tracking-wider chart-label">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Healthy</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Warning</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500"></span> Critical</span>
        </div>
      </div>

      <div className="relative flex-1 flex items-center justify-center min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full max-h-[60vh]" preserveAspectRatio="xMidYMid meet">
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
  const [page, setPage] = useState(1);
  const rowsPerPage = 5;

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

  const rows = data || [];
  const totalPages = Math.ceil(rows.length / rowsPerPage) || 1;
  const paginatedRows = rows.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  return (
    <div className="chart-panel h-full flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <ChartInfoTooltip
              description="Comparative performance matrix benchmarking Zonal Offices across operational KPIs."
              formula="Zonal Health Score = Avg(100 - Days Since DPR × 2 - Budget Overrun %)"
            />
            <div>
              <h3 className="chart-title">Zonal Performance Heatmap</h3>
              <p className="chart-subtitle">Cross-regional metric matrices. Click a row to filter work orders.</p>
            </div>
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
              {paginatedRows.map((row, idx) => {
                const isSelected = selectedZone === row.zone;
                return (
                  <tr
                    key={idx}
                    onClick={() => onSelectZone(isSelected ? null : row.zone)}
                    className={`cursor-pointer transition-colors chart-table-row ${isSelected ? 'chart-table-row-selected' : ''}`}
                  >
                    <td className="py-3 font-extrabold chart-text-primary">{row.zone}</td>
                    <td className="py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold ${getScoreBg(row.health_score)}`}>
                        {row.health_score.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold ${getUtilBg(row.budget_util)}`}>
                        {row.budget_util.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 text-center font-bold chart-text-secondary">{row.total_projects}</td>
                    <td className="py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold ${getRiskBg(row.projects_at_risk)}`}>
                        {row.projects_at_risk}
                      </span>
                    </td>
                    <td className="py-3 text-center">
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

      {/* 5-Row Pagination Bar */}
      {rows.length > 5 && (
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-white/5 text-[10px] font-mono shrink-0">
          <span className="text-slate-400 font-bold">
            Showing {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, rows.length)} of {rows.length} zones
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >
              Prev
            </button>
            <span className="px-2 font-black text-amber-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
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
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="Historical 12-month liquid cash balance runway for Zonal Offices."
            formula="Running Balance = Initial Balance + Allocations - Requisition Disbursals"
          />
          <div>
            <h3 className="chart-title">Cash Runway &amp; Projections</h3>
            <p className="chart-subtitle">60-day historical ledger vs 60-day predictive burn-rate projection</p>
          </div>
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
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="Cumulative project timeline comparing planned linear progress trajectory with actual DPR progress logs."
            formula="Actual Trajectory = Cumulative Avg(DPR Physical Work Progress %)"
          />
          <div>
            <h3 className="chart-title">S-Curve Performance Progress</h3>
            <p className="chart-subtitle">Planned linear trajectory vs actual DPR submissions</p>
          </div>
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

/* ─── Investment vs Recovery Realization Plot ─────────────────────── */
const InvestmentRecoveryPlot = ({ projects, isModal = false }) => {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState('summary');
  const [woPage, setWoPage] = useState(1);
  const [searchWo, setSearchWo] = useState('');
  const pageSize = 4;

  const metrics = React.useMemo(() => {
    const pList = projects || [];
    const totalProjects = pList.length || 1;
    const woValue = pList.reduce((a, p) => a + Number(p.work_order_value || 0), 0);
    const investment = pList.reduce((a, p) => a + Number(p.approved_requisitions_amount || p.requisition_amount || p.approved_amount || 0), 0) || Math.round(woValue * 0.4);
    const billReceived = pList.reduce((a, p) => a + Number(p.agency_paid || p.gross_billed || 0), 0) || Math.round(investment * 0.25);

    const pendingRecovery = Math.max(0, investment - billReceived);
    const remainingWOValue = Math.max(0, woValue - investment);

    const investmentPct = woValue > 0 ? ((investment / woValue) * 100).toFixed(1) : '0.0';
    const billRecoveryPct = woValue > 0 ? ((billReceived / woValue) * 100).toFixed(1) : '0.0';
    const recoveryAgainstInvestPct = investment > 0 ? ((billReceived / investment) * 100).toFixed(1) : '0.0';

    const getProgressBand = (prog, status) => {
      const p = Number(prog || 0);
      if (p > 100 || status === 'Critical') return { label: '>100% Over Budget', color: '#EF4444', bg: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
      if (p === 100) return { label: '100% Completed', color: '#16A34A', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
      if (p >= 81) return { label: `${p}% Excellent`, color: '#10B981', bg: 'bg-teal-500/15 text-teal-400 border-teal-500/30' };
      if (p >= 61) return { label: `${p}% Very Good`, color: '#15803D', bg: 'bg-emerald-600/15 text-emerald-300 border-emerald-600/30' };
      if (p >= 41) return { label: `${p}% Good`, color: '#22C55E', bg: 'bg-green-500/15 text-green-400 border-green-500/30' };
      if (p >= 21) return { label: `${p}% Fair`, color: '#EAB308', bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
      if (p >= 1) return { label: `${p}% Initial`, color: '#3B82F6', bg: 'bg-sky-500/15 text-sky-400 border-sky-500/30' };
      return { label: '0% Not Started', color: '#64748B', bg: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
    };

    const rawBands = [
      { label: '0% Not Started', color: '#64748B', count: pList.filter(p => !p.physical_progress || p.physical_progress === 0).length },
      { label: '1–20% Initial Stage', color: '#3B82F6', count: pList.filter(p => p.physical_progress > 0 && p.physical_progress <= 20).length },
      { label: '21–40% Fair', color: '#EAB308', count: pList.filter(p => p.physical_progress > 20 && p.physical_progress <= 40).length },
      { label: '41–60% Good', color: '#22C55E', count: pList.filter(p => p.physical_progress > 40 && p.physical_progress <= 60).length },
      { label: '61–80% Very Good', color: '#15803D', count: pList.filter(p => p.physical_progress > 60 && p.physical_progress <= 80).length },
      { label: '81–99% Excellent', color: '#10B981', count: pList.filter(p => p.physical_progress > 80 && p.physical_progress < 100).length },
      { label: '100% Completed', color: '#16A34A', count: pList.filter(p => p.physical_progress === 100).length },
      { label: '>100% Over Budget', color: '#EF4444', count: pList.filter(p => p.physical_progress > 100 || p.health_status === 'Critical').length },
    ];

    const bands = rawBands.map(b => ({
      ...b,
      pct: ((b.count / totalProjects) * 100).toFixed(1),
    }));

    const woItems = pList.map(p => {
      const wVal = Number(p.work_order_value || 0);
      const inv = Number(p.approved_requisitions_amount || p.requisition_amount || p.approved_amount || 0) || Math.round(wVal * 0.4);
      const rec = Number(p.agency_paid || p.gross_billed || 0) || Math.round(inv * 0.25);
      const pend = Math.max(0, inv - rec);
      const rem = Math.max(0, wVal - inv);
      const band = getProgressBand(p.physical_progress, p.health_status);
      return {
        work_order_no: p.work_order_no,
        site_details: p.site_details,
        department: p.department,
        woValue: wVal,
        investment: inv,
        billReceived: rec,
        pendingRecovery: pend,
        remainingWOValue: rem,
        band,
        physical_progress: p.physical_progress || 0,
      };
    });

    return {
      totalProjects,
      woValue,
      investment,
      billReceived,
      pendingRecovery,
      remainingWOValue,
      investmentPct,
      billRecoveryPct,
      recoveryAgainstInvestPct,
      bands,
      woItems,
    };
  }, [projects]);

  const filteredWos = React.useMemo(() => {
    const q = searchWo.toLowerCase().trim();
    if (!q) return metrics.woItems;
    return metrics.woItems.filter(item =>
      (item.work_order_no || '').toLowerCase().includes(q) ||
      (item.site_details || '').toLowerCase().includes(q) ||
      (item.department || '').toLowerCase().includes(q)
    );
  }, [metrics.woItems, searchWo]);

  const totalWoPages = Math.ceil(filteredWos.length / pageSize) || 1;
  const pagedWos = React.useMemo(() => {
    const start = (woPage - 1) * pageSize;
    return filteredWos.slice(start, start + pageSize);
  }, [filteredWos, woPage, pageSize]);

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-3.5 sm:p-5 relative overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <ChartInfoTooltip
            description="Capital investment vs bill recovery realization across work order progress bands."
            formula="Pending Recovery = Requisition Investment - Contractor Bill Payments Received"
          />
          <div className="min-w-0">
            <h3 className="chart-title text-sm sm:text-base font-extrabold tracking-tight truncate" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>
              Investment &amp; Bill Recovery Realization
            </h3>
            <p className="chart-subtitle text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {viewMode === 'summary' ? 'Realization Ratios, Dual Scale Breakdown & Progress Distribution' : 'Work Order Wise Realization Breakdown'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('summary')}
            className={`px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition ${viewMode === 'summary' ? 'bg-amber-500 text-black shadow-md' : 'text-slate-400 hover:text-white'}`}
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => setViewMode('work_order')}
            className={`px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition ${viewMode === 'work_order' ? 'bg-amber-500 text-black shadow-md' : 'text-slate-400 hover:text-white'}`}
          >
            WO Wise ({metrics.woItems.length})
          </button>
        </div>
      </div>

      {viewMode === 'summary' ? (
        <>
          {/* Top Formula KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 my-2">
            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between ${isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-amber-400 truncate">Total Investment %</p>
                <span className="shrink-0 text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 whitespace-nowrap">Inv / WO</span>
              </div>
              <p className="text-base sm:text-lg font-black font-mono text-amber-400 mt-1">{metrics.investmentPct}%</p>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">Inv: <strong className="text-slate-200">{fmtCr(metrics.investment)}</strong></span>
                <span className="text-slate-500 truncate">of {fmtCr(metrics.woValue)}</span>
              </p>
            </div>

            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between ${isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 truncate">Bill Recovery %</p>
                <span className="shrink-0 text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 whitespace-nowrap">Rec / WO</span>
              </div>
              <p className="text-base sm:text-lg font-black font-mono text-emerald-400 mt-1">{metrics.billRecoveryPct}%</p>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">Rec: <strong className="text-slate-200">{fmtCr(metrics.billReceived)}</strong></span>
                <span className="text-slate-500 truncate">of {fmtCr(metrics.woValue)}</span>
              </p>
            </div>

            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between ${isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-sky-400 truncate">Recovery vs Invest</p>
                <span className="shrink-0 text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 whitespace-nowrap">Rec / Inv</span>
              </div>
              <p className="text-base sm:text-lg font-black font-mono text-sky-400 mt-1">{metrics.recoveryAgainstInvestPct}%</p>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">Pending: <strong className="text-rose-400">{fmtCr(metrics.pendingRecovery)}</strong></span>
                <span className="text-slate-500 truncate">of {fmtCr(metrics.investment)}</span>
              </p>
            </div>
          </div>

          {/* Dual Realization Progress Bars */}
          <div className="my-2 space-y-2 p-2.5 rounded-xl border border-white/5 bg-slate-950/40">
            {/* Bar 1: Investment vs Remaining WO Value */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[8.5px] font-bold uppercase text-slate-400 mb-1 font-mono">
                <span className="truncate">1. Capital Investment Realization</span>
                <span className="shrink-0 text-slate-300">WO Value: {fmtCr(metrics.woValue)}</span>
              </div>
              <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-800">
                <div
                  style={{ width: `${Math.max(1, Math.min(100, Number(metrics.investmentPct)))}%` }}
                  className="bg-amber-500 h-full transition-all duration-500"
                  title={`Investment: ${fmtCr(metrics.investment)} (${metrics.investmentPct}%)`}
                />
                <div
                  style={{ width: `${Math.max(0, 100 - Number(metrics.investmentPct))}%` }}
                  className="bg-sky-500/30 h-full transition-all duration-500"
                  title={`Remaining WO Value: ${fmtCr(metrics.remainingWOValue)}`}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mt-1 text-[8px] font-mono text-slate-400">
                <span className="flex items-center gap-1 truncate"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" /> Total Inv: {fmtCr(metrics.investment)} ({metrics.investmentPct}%)</span>
                <span className="flex items-center gap-1 truncate"><span className="w-1.5 h-1.5 rounded-full bg-sky-500/30 shrink-0" /> Remaining: {fmtCr(metrics.remainingWOValue)}</span>
              </div>
            </div>

            {/* Bar 2: Recovery Realization against Total Investment */}
            <div className="border-t border-white/5 pt-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[8.5px] font-bold uppercase text-slate-400 mb-1 font-mono">
                <span className="truncate">2. Recovery Realization (Investment Pool)</span>
                <span className="shrink-0 text-slate-300">Pool: {fmtCr(metrics.investment)}</span>
              </div>
              <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-800">
                <div
                  style={{ width: `${Math.max(1, Math.min(100, Number(metrics.recoveryAgainstInvestPct)))}%` }}
                  className="bg-emerald-500 h-full transition-all duration-500"
                  title={`Govt Received: ${fmtCr(metrics.billReceived)} (${metrics.recoveryAgainstInvestPct}%)`}
                />
                <div
                  style={{ width: `${Math.max(0, 100 - Number(metrics.recoveryAgainstInvestPct))}%` }}
                  className="bg-rose-500/80 h-full transition-all duration-500"
                  title={`Pending Bill Recovery: ${fmtCr(metrics.pendingRecovery)}`}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mt-1 text-[8px] font-mono text-slate-400">
                <span className="flex items-center gap-1 truncate"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /> Received: {fmtCr(metrics.billReceived)} ({metrics.recoveryAgainstInvestPct}%)</span>
                <span className="flex items-center gap-1 truncate"><span className="w-1.5 h-1.5 rounded-full bg-rose-500/80 shrink-0" /> Pending: {fmtCr(metrics.pendingRecovery)}</span>
              </div>
            </div>
          </div>

          {/* Visual Progress Stage Color Bands with Stacked Bar & Distribution Badges */}
          <div className="mt-2 pt-2 border-t border-white/5">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-1">
              <p className="text-[8.5px] sm:text-[9px] font-black uppercase tracking-wider text-slate-400 truncate">Progress Stage Color Bands Distribution</p>
              <span className="text-[8px] font-mono text-slate-500 font-bold shrink-0">{metrics.totalProjects} Total WOs</span>
            </div>

            {/* Multi-segment distribution bar */}
            <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-800 mb-2">
              {metrics.bands.map((b, idx) => Number(b.pct) > 0 && (
                <div
                  key={idx}
                  style={{ width: `${b.pct}%`, backgroundColor: b.color }}
                  className="h-full transition-all duration-300"
                  title={`${b.label}: ${b.count} WOs (${b.pct}%)`}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[8.5px]">
              {metrics.bands.map((b, idx) => (
                <div key={idx} className="flex items-center justify-between p-1.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition min-w-0">
                  <div className="flex items-center gap-1 truncate min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: b.color }} />
                    <span className="font-bold text-slate-300 truncate text-[8.5px]">{b.label}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 font-mono ml-1">
                    <span className="font-black text-amber-400 text-[9px]">{b.count}</span>
                    <span className="text-[7.5px] text-slate-500">({b.pct}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* Work Order Wise View Mode */
        <div className="flex flex-col flex-1 min-h-0 justify-between">
          <div className="mb-2">
            <input
              type="text"
              placeholder="Search work order or site..."
              value={searchWo}
              onChange={(e) => { setSearchWo(e.target.value); setWoPage(1); }}
              className={`w-full border rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500/50 ${isDark ? 'bg-slate-950 border-white/10 text-slate-200 placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
            />
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[260px] pr-1">
            {pagedWos.map((item, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-xl border transition-all ${isDark ? 'bg-slate-900/60 border-white/10 hover:border-white/20' : 'bg-white border-slate-200 shadow-sm'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <span
                      onClick={() => navigate && navigate(`/projects/${item.work_order_no}/digital-twin`)}
                      className="font-extrabold font-mono text-xs text-sky-400 hover:underline cursor-pointer truncate block"
                    >
                      {item.work_order_no}
                    </span>
                    <p className="text-[10px] text-slate-400 truncate">{item.site_details || item.department}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border uppercase tracking-wider shrink-0 ${item.band.bg}`}>
                    {item.band.label}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1 mt-2 text-[9px] font-mono border-t border-white/5 pt-1.5">
                  <div>
                    <span className="text-slate-500 block text-[8px]">WO Value</span>
                    <span className="font-bold text-slate-200">{fmtCr(item.woValue)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[8px]">Investment</span>
                    <span className="font-bold text-amber-400">{fmtCr(item.investment)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[8px]">Received</span>
                    <span className="font-bold text-emerald-400">{fmtCr(item.billReceived)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[8px]">Pending</span>
                    <span className="font-bold text-rose-400">{fmtCr(item.pendingRecovery)}</span>
                  </div>
                </div>
              </div>
            ))}
            {pagedWos.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-500 italic">No work orders match current search</div>
            )}
          </div>

          {totalWoPages > 1 && (
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-white/5 text-[10px] font-mono select-none">
              <span className="text-slate-400 font-bold">Pg {woPage} of {totalWoPages} ({filteredWos.length} WOs)</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setWoPage(p => Math.max(1, p - 1))}
                  disabled={woPage === 1}
                  className="px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30 text-slate-300 font-bold uppercase cursor-pointer"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setWoPage(p => Math.min(totalWoPages, p + 1))}
                  disabled={woPage === totalWoPages}
                  className="px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30 text-slate-300 font-bold uppercase cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Chart Info Tooltip Component (Portal Architecture for Zero Clipping) ────
const ChartInfoTooltip = ({ description, formula }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef(null);
  const { isDark } = useTheme();

  const updatePosition = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popW = 280;
    const popH = 140;

    let left = rect.right - popW;
    if (left < 16) left = 16;
    if (left + popW > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - popW - 16);
    }

    let top = rect.bottom + 8;
    if (top + popH > window.innerHeight - 16) {
      top = Math.max(16, rect.top - popH - 8);
    }

    setPos({ x: left, y: top });
  };

  const handleOpen = () => {
    updatePosition();
    setShow(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={handleOpen}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => {
          e.stopPropagation();
          updatePosition();
          setShow(!show);
        }}
        className="w-5 h-5 rounded-full bg-amber-500/15 hover:bg-amber-500/35 border border-amber-500/50 flex items-center justify-center text-[11px] font-black text-amber-400 hover:text-amber-300 transition-all cursor-pointer shadow-md shadow-amber-500/10 hover:scale-110 shrink-0"
        title="Click or hover for chart details & formula"
      >
        i
      </button>

      {show && ReactDOM.createPortal(
        <div
          className="fixed z-[999999] p-3.5 rounded-2xl shadow-2xl min-w-[260px] max-w-[300px] text-xs backdrop-blur-xl pointer-events-none transition-all duration-150 border"
          style={{
            top: pos.y,
            left: pos.x,
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)',
            borderColor: isDark ? 'rgba(245, 158, 11, 0.5)' : 'rgba(245, 158, 11, 0.4)',
            boxShadow: '0 20px 40px -5px rgba(0,0,0,0.7), 0 8px 16px -6px rgba(245,158,11,0.2)'
          }}
        >
          <div className="flex items-center gap-1.5 mb-2 border-b border-white/10 pb-1.5 text-amber-400 font-extrabold uppercase text-[10px] tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Metric Info &amp; Formula
          </div>
          <p className="text-[11px] text-slate-200 dark:text-slate-200 leading-snug font-medium mb-2.5">
            {description}
          </p>
          <div className="bg-slate-950/90 p-2.5 rounded-xl border border-white/10 font-mono text-[10px] text-emerald-400 font-semibold leading-relaxed">
            <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5 font-sans">Formula:</span>
            {formula}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// ── Department Wise Estimate Component ───────────────────────────────────────
const DepartmentWiseEstimate = ({ data }) => {
  const { isDark } = useTheme();
  const [hoveredDept, setHoveredDept] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });

  const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F97316', '#64748B', '#EF4444', '#14B8A6', '#EC4899', '#F59E0B'];

  const items = React.useMemo(() => {
    const raw = (data && data.length > 0) ? data : [];
    return raw.map((item, idx) => ({
      ...item,
      color: item.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
    }));
  }, [data]);

  const totalAmount = React.useMemo(() => {
    return items.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  }, [items]);

  const donutSlices = React.useMemo(() => {
    let currentCumulativeAngle = 0;
    const center = 100;
    const outerRadius = 85;
    const innerRadius = 55;
    return items.map((slice) => {
      const pct = totalAmount > 0 ? ((Number(slice.amount) || 0) / totalAmount) * 100 : slice.percentage || 0;
      const angle = (pct / 100) * 360;
      const startAngle = currentCumulativeAngle;
      const endAngle = currentCumulativeAngle + angle;
      // eslint-disable-next-line react-hooks/immutability
      currentCumulativeAngle += angle;

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
        ...slice,
        pct: pct.toFixed(1),
        pathData
      };
    });
  }, [items, totalAmount]);

  const formatAmount = (amt) => {
    if (!amt || isNaN(amt)) return '₹ 0';
    if (amt >= 10000000) return `₹ ${(amt / 10000000).toFixed(2)} Cr`;
    if (amt >= 100000) return `₹ ${(amt / 100000).toFixed(2)} L`;
    return `₹ ${Number(amt).toLocaleString('en-IN')}`;
  };

  const handleMouseEnter = (e, item) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const popoverHeight = 100;
    const popoverWidth = 240;

    let yPos = rect.top - popoverHeight - 10;
    if (yPos < 20) {
      yPos = Math.min(window.innerHeight - popoverHeight - 20, rect.bottom + 10);
    }
    let xPos = Math.min(window.innerWidth - popoverWidth - 20, Math.max(20, rect.left - 20));

    setPopoverPos({ x: xPos, y: yPos });
    setHoveredDept(item);
  };

  const handleMouseMove = (e) => {
    if (hoveredDept) {
      const popoverHeight = 100;
      const popoverWidth = 240;

      let yPos = e.clientY - popoverHeight - 15;
      if (yPos < 20) {
        yPos = Math.min(window.innerHeight - popoverHeight - 20, e.clientY + 20);
      }
      let xPos = Math.min(window.innerWidth - popoverWidth - 20, Math.max(20, e.clientX - 50));

      setPopoverPos({ x: xPos, y: yPos });
    }
  };

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-4 sm:p-5 relative" onMouseMove={handleMouseMove}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="chart-title text-base sm:text-lg font-extrabold tracking-tight" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>
            Department Wise Estimate Amount
          </h3>
          <p className="chart-subtitle text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Breakdown of estimated costs across operational departments
          </p>
        </div>
        <ChartInfoTooltip
          description="Distribution of estimated project expenditure allocated across operational departments."
          formula="Dept Share % = (Sum of Approved Estimates in Dept / Total Portfolio Estimate) × 100"
        />
      </div>

      <div className="flex flex-col items-center justify-center gap-4 my-auto py-2">
        {/* Donut Graphic */}
        <div className="relative w-44 h-44 sm:w-48 sm:h-48 shrink-0 mx-auto">
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
            {donutSlices.map((slice, idx) => (
              <g
                key={idx}
                className="transition-all duration-300 hover:opacity-90 cursor-pointer group"
                onMouseEnter={(e) => handleMouseEnter(e, slice)}
                onMouseLeave={() => setHoveredDept(null)}
              >
                <path
                  d={slice.pathData}
                  fill={slice.color}
                  stroke={isDark ? '#0f172a' : '#ffffff'}
                  strokeWidth="2.5"
                  style={{
                    transform: hoveredDept?.department === slice.department ? 'scale(1.04)' : 'scale(1)',
                    transformOrigin: '100px 100px'
                  }}
                />
              </g>
            ))}
          </svg>
        </div>

        {/* 2-Column Grid Legend Index (Clean & Compact) */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full pt-2 border-t border-white/5">
          {items.map((item, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2.5 rounded-xl cursor-pointer transition-all ${hoveredDept?.department === item.department
                  ? 'bg-amber-500/15 border border-amber-500/30 scale-[1.02]'
                  : 'hover:bg-slate-500/10 border border-transparent'
                }`}
              onMouseEnter={(e) => handleMouseEnter(e, item)}
              onMouseLeave={() => setHoveredDept(null)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: item.color }} />
                <span className="chart-text-primary text-slate-800 dark:text-slate-200 font-bold text-xs truncate" title={item.department}>
                  {item.department}
                </span>
              </div>
              <span className="text-slate-400 font-mono text-[10px] font-bold shrink-0">
                {item.percentage}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Dynamic Hover Popover rendered via React Portal to prevent going behind background panels */}
      {hoveredDept && ReactDOM.createPortal(
        <div
          className="fixed z-[99999] rounded-2xl shadow-2xl p-3.5 min-w-[220px] pointer-events-none transition-all duration-150 backdrop-blur-md"
          style={{
            top: popoverPos.y,
            left: popoverPos.x,
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)',
            border: `1.5px solid ${hoveredDept.color}`,
            boxShadow: `0 20px 35px -5px rgba(0, 0, 0, 0.7), 0 8px 16px -6px ${hoveredDept.color}60`
          }}
        >
          <div className="flex items-center gap-2 mb-1.5 border-b border-slate-200 dark:border-slate-700/60 pb-1.5">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: hoveredDept.color }} />
            <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              {hoveredDept.department}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-3 mt-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Estimated Amount:
            </span>
            <span className="font-black text-sm font-mono text-amber-400">
              {formatAmount(hoveredDept.amount)}
            </span>
          </div>
          {hoveredDept.count !== undefined && (
            <div className="flex items-baseline justify-between gap-3 mt-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Total Work Orders:
              </span>
              <span className="font-bold text-xs font-mono text-sky-400">
                {hoveredDept.count} {hoveredDept.count === 1 ? 'Work Order' : 'Work Orders'}
              </span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 mt-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Share of Estimate:
            </span>
            <span className="font-bold text-xs font-mono text-slate-200">
              {hoveredDept.percentage}%
            </span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ── Generic Interactive Donut Metric Card with Work Orders Hover Popover ─────
const MetricDonutCard = ({
  title,
  subtitle,
  description,
  formula,
  centerLabel,
  centerValue,
  buckets = [],
  fallbackData,
  isModal = false
}) => {
  const { isDark } = useTheme();
  const [hoveredBucket, setHoveredBucket] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });

  const activeBuckets = React.useMemo(() => {
    if (buckets && buckets.length > 0) {
      return buckets;
    }
    return [];
  }, [buckets]);

  const totalCount = React.useMemo(() => {
    return activeBuckets.reduce((acc, curr) => acc + (curr.count || 0), 0);
  }, [activeBuckets]);

  // Compute SVG Donut Slices
  const slices = React.useMemo(() => {
    let currentCumulativeAngle = 0;
    const center = 100;
    const outerRadius = 85;
    const innerRadius = 55;

    return activeBuckets.map((bucket) => {
      const pct = totalCount > 0 ? (bucket.count / totalCount) * 100 : bucket.percentage || 0;
      const angle = (pct / 100) * 360;
      const startAngle = currentCumulativeAngle;
      const endAngle = currentCumulativeAngle + angle;
      // eslint-disable-next-line react-hooks/immutability
      currentCumulativeAngle += angle;

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
    const popoverHeight = 280;
    const popoverWidth = 320;

    // Always keep popover inside visible screen viewport
    let yPos = rect.top - popoverHeight - 10;
    if (yPos < 20) {
      yPos = Math.min(window.innerHeight - popoverHeight - 20, rect.bottom + 10);
    }

    let xPos = Math.min(window.innerWidth - popoverWidth - 20, Math.max(20, rect.left - 50));

    setPopoverPos({ x: xPos, y: yPos });
    setHoveredBucket(bucket);
  };

  const handleMouseMove = (e) => {
    if (hoveredBucket) {
      const popoverHeight = 280;
      const popoverWidth = 320;

      // Hover popover appears above the cursor when in bottom half of screen
      let yPos = e.clientY - popoverHeight - 15;
      if (yPos < 20) {
        yPos = Math.min(window.innerHeight - popoverHeight - 20, e.clientY + 20);
      }

      let xPos = Math.min(window.innerWidth - popoverWidth - 20, Math.max(20, e.clientX - 100));

      setPopoverPos({ x: xPos, y: yPos });
    }
  };

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-5 relative" onMouseMove={handleMouseMove}>
      <div className="flex justify-between items-start mb-2">
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
        {description && formula && (
          <ChartInfoTooltip description={description} formula={formula} />
        )}
      </div>

      <div className="flex flex-col md:flex-row items-center justify-around gap-6 my-auto py-2 flex-1">
        {/* Donut Graphic with Center Text - Proportioned dynamically */}
        <div className={`relative shrink-0 flex items-center justify-center ${isModal ? 'w-56 h-56 sm:w-72 sm:h-72' : 'w-40 h-40 sm:w-44 sm:h-44'
          }`}>
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
                  transform: hoveredBucket?.label === slice.label ? 'scale(1.05)' : 'scale(1)',
                  transformOrigin: '100px 100px'
                }}
                onMouseEnter={(e) => handleMouseEnter(e, slice)}
                onMouseLeave={() => setHoveredBucket(null)}
              />
            ))}
          </svg>

          {/* Center Label inside donut */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center p-4">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {centerLabel}
            </span>
            <span className={`${isModal ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'} font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5`}>
              {centerValue}
            </span>
          </div>
        </div>

        {/* Legend List */}
        <div className={`flex flex-col gap-2 w-full md:w-auto ${isModal ? 'min-w-[240px]' : 'min-w-[180px]'}`}>
          {slices.map((item, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between gap-3 text-xs font-semibold py-1.5 px-2.5 rounded-xl cursor-pointer transition-all ${hoveredBucket?.label === item.label
                  ? 'bg-amber-500/15 border border-amber-500/30 scale-[1.02]'
                  : 'hover:bg-slate-500/10 border border-transparent'
                }`}
              onMouseEnter={(e) => handleMouseEnter(e, item)}
              onMouseLeave={() => setHoveredBucket(null)}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: item.color }} />
                <span className="chart-text-primary text-slate-800 dark:text-slate-200 font-bold text-xs whitespace-nowrap">
                  {item.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono shrink-0 whitespace-nowrap">
                <span className="font-extrabold text-slate-900 dark:text-slate-100 text-xs">
                  {item.count}
                </span>
                <span className="text-slate-500 dark:text-slate-400 text-[10px] font-bold">
                  ({item.pct}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Floating Hover Popover listing matching Work Orders (Portal) */}
      {hoveredBucket && ReactDOM.createPortal(
        <div
          className="fixed z-[99999] rounded-2xl shadow-2xl p-4 min-w-[300px] max-w-[360px] pointer-events-none transition-all duration-150 backdrop-blur-md"
          style={{
            top: popoverPos.y,
            left: popoverPos.x,
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)',
            border: `1.5px solid ${hoveredBucket.color}`,
            boxShadow: `0 20px 35px -5px rgba(0, 0, 0, 0.7), 0 8px 16px -6px ${hoveredBucket.color}60`
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/60 pb-2.5 mb-2.5">
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
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1 text-xs">
              {hoveredBucket.workOrders.slice(0, 20).map((wo, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/50"
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
              {hoveredBucket.workOrders.length > 20 && (
                <p className="text-[10px] text-center font-bold text-slate-400 pt-1">
                  + {hoveredBucket.workOrders.length - 20} more work orders
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic text-center py-2">
              No active work orders in this metric
            </p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

// ── Physical Work Progress Card Component ─────────────────────────────────────
const PhysicalWorkProgress = ({ data, isModal = false }) => {
  return (
    <MetricDonutCard
      title="Physical Work Progress"
      centerLabel="Avg. Progress"
      centerValue={data?.avgProgress !== undefined ? `${data.avgProgress}%` : '0%'}
      buckets={data?.buckets || []}
      isModal={isModal}
    />
  );
};

// ── JE Visit Frequency Card Component ─────────────────────────────────────────
const JeVisitFrequency = ({ data }) => {
  return (
    <MetricDonutCard
      title="JE Visit Frequency"
      centerLabel="Avg. Visit"
      centerValue={data?.avgVisit !== undefined ? `${data.avgVisit} Days` : '0 Days'}
      buckets={data?.buckets || []}
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
      value: data?.emdAmount ?? 0,
      bgColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    },
    {
      label: 'Security Deposit',
      value: data?.securityDeposit ?? 0,
      bgColor: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      )
    },
    {
      label: 'IT TDS',
      value: data?.itTds ?? 0,
      bgColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" />
        </svg>
      )
    },
    {
      label: 'SGST',
      value: data?.sgst ?? 0,
      bgColor: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
        </svg>
      )
    },
    {
      label: 'CGST',
      value: data?.cgst ?? 0,
      bgColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 11h10M7 15h10M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
        </svg>
      )
    }
  ];

  // Compute max amount for bar scaling
  const maxAmount = Math.max(1, ...items.map(i => i.value));

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="chart-title" style={{ color: isDark ? '#e2e8f4' : '#1E3A8A' }}>
            Key Financial Indicators
          </h3>
          <p className="chart-subtitle">
            Summary of statutory withholdings
          </p>
        </div>
        <ChartInfoTooltip
          description="Summary of statutory withholdings and security deposits retained across projects."
          formula="Withholdings = EMD + Security Deposit (10%) + IT TDS (2%) + SGST (1%) + CGST (1%)"
        />
      </div>

      <div className="flex flex-col justify-between my-auto gap-3">
        {items.map((item, idx) => {
          const barWidth = (item.value / maxAmount) * 100;
          // extract border color from bgColor class for the bar
          const barGradientMap = {
            0: '#10b981', 1: '#0ea5e9', 2: '#f59e0b', 3: '#f43f5e', 4: '#a78bfa', 5: '#14b8a6'
          };
          const barColor = barGradientMap[idx] || '#f0a843';
          return (
            <div
              key={idx}
              className="group"
            >
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-1.5 rounded-lg border shadow-xs shrink-0 ${item.bgColor}`}>
                    {item.icon}
                  </div>
                  <span className="font-bold text-xs text-slate-700 dark:text-slate-200 truncate">
                    {item.label}
                  </span>
                </div>
                <span className="font-extrabold text-xs font-mono text-slate-900 dark:text-slate-100 shrink-0 whitespace-nowrap">
                  {formatFinancialAmount(item.value)}
                </span>
              </div>
              {/* Gradient progress bar with glowing endpoint dot */}
              <div className="relative h-1 bg-white/[0.055] rounded-full overflow-visible">
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
                  style={{ width: `${barWidth}%`, background: `linear-gradient(90deg, ${barColor}99 0%, ${barColor} 100%)` }}
                />
                {/* Glowing endpoint dot */}
                <span
                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-all duration-700"
                  style={{
                    left: `calc(${barWidth}% - 4px)`,
                    background: barColor,
                    boxShadow: `0 0 6px 2px ${barColor}80`
                  }}
                />
              </div>
            </div>
          );
        })}
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

  const woVal = data?.dueBill?.woValue ?? data?.totalWOValue ?? 0;
  const grossBillAmt = data?.dueBill?.grossBillAmount ?? data?.grossBillAmount?.amount ?? 0;
  const dueBillAmt = data?.dueBill?.amount ?? Math.max(0, woVal - grossBillAmt);

  const kpis = [
    {
      id: 'work_orders',
      title: 'TOTAL WORK ORDERS',
      description: 'Total active and completed work orders in portfolio.',
      formula: 'Count(projects)',
      titleColor: '#60a5fa',
      topGlow: 'linear-gradient(90deg, #3b82f6 0%, rgba(59,130,246,0) 80%)',
      value: data?.totalWorkOrders?.total ?? 0,
      isCurrency: false,
      subtext: `Running: ${data?.totalWorkOrders?.running ?? 0} | Completed: ${data?.totalWorkOrders?.completed ?? 0}\nPending: ${data?.totalWorkOrders?.pending ?? 0}`,
    },
    {
      id: 'wo_value',
      title: 'TOTAL WO VALUE',
      description: 'Consolidated monetary value of all awarded work orders.',
      formula: 'Sum(work_order_value)',
      titleColor: '#34d399',
      topGlow: 'linear-gradient(90deg, #10b981 0%, rgba(16,185,129,0) 80%)',
      value: formatCr(data?.totalWOValue ?? 0),
      isCurrency: true,
      subtext: null,
    },
    {
      id: 'estimate',
      title: 'TOTAL ESTIMATE AMOUNT',
      description: 'Aggregated cost estimate value of final approved sheets.',
      formula: 'Sum(estimate_amount where status = \'Final Approved\')',
      titleColor: '#c084fc',
      topGlow: 'linear-gradient(90deg, #a855f7 0%, rgba(168,85,247,0) 80%)',
      value: formatCr(data?.totalEstimateAmount?.amount ?? 0),
      isCurrency: true,
      subtext: `${data?.totalEstimateAmount?.pctOfWOValue ?? 0}% of WO Value`,
    },
    {
      id: 'requisition',
      title: 'TOTAL REQUISITION (ZO → HO)',
      description: 'Total site fund requisitions requested from Zonal Offices.',
      formula: 'Sum(approved_amount where status = \'Approved\')',
      titleColor: '#fb923c',
      topGlow: 'linear-gradient(90deg, #f97316 0%, rgba(249,115,22,0) 80%)',
      value: formatCr(data?.totalRequisition?.amount ?? 0),
      isCurrency: true,
      subtext: `${data?.totalRequisition?.pctOfEstimate ?? 0}% of Estimate`,
    },
    {
      id: 'approved',
      title: 'TOTAL APPROVED (HO → ZO)',
      description: 'Total funds authorized and allocated from Head Office to Zones.',
      formula: 'Sum(approve_ho_amount where status = \'Approved\')',
      titleColor: '#fbbf24',
      topGlow: 'linear-gradient(90deg, #f59e0b 0%, rgba(245,158,11,0) 80%)',
      value: formatCr(data?.totalApproved?.amount ?? 0),
      isCurrency: true,
      subtext: `${data?.totalApproved?.pctOfRequisition ?? 0}% of Requisition`,
    },
    {
      id: 'zo_balance',
      title: 'ZO AVAILABLE BALANCE',
      description: 'Liquid fund balance currently available across all Zonal Office ledgers.',
      formula: 'Sum(available_balance)',
      titleColor: '#38bdf8',
      topGlow: 'linear-gradient(90deg, #0284c7 0%, rgba(2,132,199,0) 80%)',
      value: formatCr(data?.zoAvailableBalance ?? 0),
      isCurrency: true,
      subtext: null,
    },
    {
      id: 'refund',
      title: 'TOTAL REFUND AMOUNT',
      description: 'Unspent excess funds returned from Zonal Offices to Head Office.',
      formula: 'Sum(transaction_type = \'RETURN\')',
      titleColor: '#2dd4bf',
      topGlow: 'linear-gradient(90deg, #14b8a6 0%, rgba(20,184,166,0) 80%)',
      value: formatCr(data?.totalRefundAmount ?? 0),
      isCurrency: true,
      subtext: null,
    },
    {
      id: 'gross_bill',
      title: 'GROSS BILL AMOUNT',
      description: 'Gross contractor billings submitted across all work orders.',
      formula: 'Sum(gross_bill)',
      titleColor: '#f87171',
      topGlow: 'linear-gradient(90deg, #ef4444 0%, rgba(239,68,68,0) 80%)',
      value: formatCr(data?.grossBillAmount?.amount ?? 0),
      isCurrency: true,
      subtext: `${data?.grossBillAmount?.pctOfEstimate ?? 0}% of Estimate`,
    },
    {
      id: 'agency_payment',
      title: 'AGENCY PAYMENT',
      description: 'Net payments disbursed to contractors after statutory withholdings.',
      formula: 'Sum(agency_payment)',
      titleColor: '#818cf8',
      topGlow: 'linear-gradient(90deg, #6366f1 0%, rgba(99,102,241,0) 80%)',
      value: formatCr(data?.agencyPayment?.amount ?? 0),
      isCurrency: true,
      subtext: `${data?.agencyPayment?.pctOfGrossBill ?? 0}% of Gross Bill`,
    },
    {
      id: 'due_bill',
      title: 'DUE BILL AMOUNT',
      description: 'Pending unbilled work order value exposure remaining in portfolio.',
      formula: 'Total WO Value - Gross Bill Amount',
      titleColor: '#ec4899',
      topGlow: 'linear-gradient(90deg, #db2777 0%, rgba(219,39,119,0) 80%)',
      value: formatCr(dueBillAmt),
      isCurrency: true,
      subtext: `${data?.dueBill?.pctOfWOValue ?? (woVal > 0 ? ((dueBillAmt / woVal) * 100).toFixed(1) : 0)}% of WO Value`,
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-3 mb-6">
      {kpis.map((kpi) => (
        <div
          key={kpi.id}
          className={`relative p-3.5 rounded-2xl border flex flex-col justify-between transition-all duration-300 hover:-translate-y-0.5 overflow-hidden ${isDark
              ? 'bg-[#101520]/90 border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:border-white/20'
              : 'bg-white border-slate-200 shadow-sm hover:shadow-md'
            }`}
          style={{ minHeight: '135px' }}
        >
          {/* Colored Top Glow Accent Line */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{ background: kpi.topGlow }}
          />

          {/* Title with Top-Left Info Icon */}
          <div className="flex items-center gap-1.5 mb-1">
            <ChartInfoTooltip description={kpi.description} formula={kpi.formula} />
            <p
              className="text-[9.5px] font-black tracking-wider uppercase leading-snug"
              style={{ color: kpi.titleColor }}
            >
              {kpi.title}
            </p>
          </div>

          {/* Main Value */}
          <div className="my-auto py-1">
            <span className={`text-base xl:text-lg font-bold font-mono tracking-tight ${isDark ? 'text-slate-100' : 'text-slate-900'
              }`}>
              {kpi.value}
            </span>
          </div>

          {/* Subtext */}
          {kpi.subtext ? (
            <p className={`text-[9.5px] font-medium leading-tight whitespace-pre-line ${isDark ? 'text-slate-400/80' : 'text-slate-600'
              }`}>
              {kpi.subtext}
            </p>
          ) : (
            <div className="h-3" />
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
  const rowsPerPage = 5;

  // Filter list
  const filtered = data.filter(p => {
    const q = search.toLowerCase().trim();
    const matchesSearch = !q ||
      (p.work_order_no || '').toLowerCase().includes(q) ||
      (p.site_details || '').toLowerCase().includes(q) ||
      (p.department || '').toLowerCase().includes(q) ||
      (p.zone || '').toLowerCase().includes(q) ||
      (p.district || '').toLowerCase().includes(q);
    const matchesZone = !selectedZone || (p.zone || '').toLowerCase().trim() === selectedZone.toLowerCase().trim();
    const matchesDept = !deptFilter || (p.department || '').toLowerCase().trim() === deptFilter.toLowerCase().trim();
    return matchesSearch && matchesZone && matchesDept;
  });

  // Unique departments & zones for filtering
  const depts = Array.from(new Set(data.map(p => p.department).filter(Boolean))).sort();
  const zones = Array.from(new Set(data.map(p => p.zone).filter(Boolean))).sort();

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
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="High-density project tracking telemetry table with real-time health score metrics."
            formula="Health Score = 100 - (Days Since DPR × 2) - (Budget Overrun %)"
          />
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Work Order Telemetry</h3>
            <p className="text-[9px] text-slate-500 uppercase font-black tracking-wider mt-1">High-density project tracking and performance telemetry</p>
          </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6 items-center">
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
        <select
          value={selectedZone || ''}
          onChange={(e) => { onSelectZone(e.target.value || null); setPage(1); }}
          className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-[10px] text-slate-300 focus:outline-none focus:border-white/20 transition"
        >
          <option value="">All Zones</option>
          {zones.map(z => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <div className="flex items-center justify-between sm:justify-end gap-2">
          {(search || deptFilter || selectedZone) && (
            <button
              onClick={() => {
                setSearch('');
                setDeptFilter('');
                onSelectZone(null);
                setPage(1);
              }}
              className="px-3 py-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-bold uppercase tracking-wider hover:bg-rose-500/20 transition"
            >
              Reset Filters
            </button>
          )}
          <span className="text-[10px] text-slate-500 font-bold font-mono">
            {filtered.length} / {data.length} WOs
          </span>
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
                    <span className={`px-2.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${row.health_status === 'Critical' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
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
    queryKey: ['hoChartData', activeView, projectStatusFilter, startDate, endDate],
    queryFn: async () => {
      const res = await getHoChartData({
        view: activeView,
        project_status: projectStatusFilter,
        start_date: startDate || undefined,
        end_date: endDate || undefined
      });
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
  useQuery({
    queryKey: ['hoKpis'],
    queryFn: async () => {
      const res = await getHoKpis();
      return res.data;
    }
  });

  // 2. Fetch Zonal Benchmarking
  useQuery({
    queryKey: ['hoZoneBenchmarking'],
    queryFn: async () => {
      const res = await getHoZoneBenchmarking();
      return res.data;
    }
  });

  // 3. Fetch Budget Leakages
  useQuery({
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
        <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-2xl shadow-xl backdrop-blur-md flex items-center gap-3 border transition-all duration-300 ${alertType === 'success'
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
          <div className="flex items-center gap-2.5 mb-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: '#f0a843',
                boxShadow: '0 0 8px #f0a843, 0 0 18px rgba(240,168,67,0.35)',
                animation: 'pulse 2.5s ease-in-out infinite'
              }}
            />
            <span className="font-mono text-[10px] uppercase tracking-[3px] text-amber-500">Executive Analytics</span>
          </div>
          <h1
            className="text-3xl font-extrabold tracking-tight mt-1 text-slate-900 dark:text-slate-100"
            style={{
              color: 'var(--title-color, inherit)',
              letterSpacing: '-0.04em'
            }}
          >
            Portfolio Performance Analytics
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">Consolidated portfolio KPIs, zonal performance benchmarking, and cost leakage anomalies.</p>
        </div>

        <div className="flex flex-col items-end gap-2.5">
          <button
            onClick={handleRefresh}
            disabled={refreshMutation.isPending}
            className={`px-5 py-2.5 rounded-xl border border-transparent text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all duration-300 ${refreshMutation.isPending
                ? 'bg-white/5 border-white/10 text-slate-400 cursor-not-allowed'
                : 'bg-white hover:bg-white/90 text-slate-950 shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)] hover:-translate-y-0.5'
              }`}
          >
            <svg className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
            </svg>
            {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Views'}
          </button>
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
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border cursor-pointer ${projectStatusFilter === status.id
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
                className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition-all border cursor-pointer ${datePreset === p.id
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

      {/* Actionable Insights Strip — continuously moving marquee ticker with theme-aware fade edges */}
      {(stalledProjects.length > 0 || lowRunwayZones.length > 0) && (
        <div className="relative mb-8 overflow-hidden">
          {/* Theme-aware fade masks (prevents dark blackish overlay in light mode) */}
          <div
            className={`pointer-events-none absolute left-0 top-0 bottom-0 w-16 z-10 transition-colors ${isDark
                ? 'bg-gradient-to-r from-[#0b0e14] to-transparent'
                : 'bg-gradient-to-r from-slate-50 to-transparent'
              }`}
          />
          <div
            className={`pointer-events-none absolute right-0 top-0 bottom-0 w-16 z-10 transition-colors ${isDark
                ? 'bg-gradient-to-l from-[#0b0e14] to-transparent'
                : 'bg-gradient-to-l from-slate-50 to-transparent'
              }`}
          />

          {/* Continuous Moving Ticker Track (pauses on hover) */}
          <div className="flex overflow-hidden">
            <div className="animate-marquee gap-3 py-1 px-4">
              {/* Ticker items batch 1 */}
              {lowRunwayZones.map((z, idx) => (
                <div
                  key={`z1-${idx}`}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${isDark
                      ? 'border-rose-500/30 bg-rose-950/20 text-rose-400'
                      : 'border-rose-300 bg-rose-50 text-rose-700 shadow-sm'
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  {z.zone || z.zo_user_id} — Balance depletes in {z.runway_days} days
                </div>
              ))}
              {stalledProjects.slice(0, 5).map((p, idx) => (
                <div
                  key={`p1-${idx}`}
                  onClick={() => navigate(`/projects/${p.work_order_no}/digital-twin`)}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors ${isDark
                      ? 'border-amber-500/30 bg-amber-950/20 text-amber-400 hover:border-amber-500/50'
                      : 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm hover:border-amber-400'
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  {p.work_order_no} — No DPR for {p.days_since_last_progress_report}d ({p.physical_progress}% done)
                </div>
              ))}

              {/* Duplicate items for seamless continuous looping marquee */}
              {lowRunwayZones.map((z, idx) => (
                <div
                  key={`z2-${idx}`}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${isDark
                      ? 'border-rose-500/30 bg-rose-950/20 text-rose-400'
                      : 'border-rose-300 bg-rose-50 text-rose-700 shadow-sm'
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  {z.zone || z.zo_user_id} — Balance depletes in {z.runway_days} days
                </div>
              ))}
              {stalledProjects.slice(0, 5).map((p, idx) => (
                <div
                  key={`p2-${idx}`}
                  onClick={() => navigate(`/projects/${p.work_order_no}/digital-twin`)}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors ${isDark
                      ? 'border-amber-500/30 bg-amber-950/20 text-amber-400 hover:border-amber-500/50'
                      : 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm hover:border-amber-400'
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  {p.work_order_no} — No DPR for {p.days_since_last_progress_report}d ({p.physical_progress}% done)
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Executive 9-KPI Strip */}
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Executive KPIs</span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      <ExecutiveKpiStrip data={chartRes?.executiveSummaryKpis} />

      {/* ── Section: Performance Overview ── */}
      <div className="flex items-center gap-3 mb-3 mt-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Performance Overview</span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      {/* ── Row 1: Physical Work Progress + Department Wise Estimate + Key Financial Indicators ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('physical_progress')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <PhysicalWorkProgress data={chartRes?.physicalProgressMetrics} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('department')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <DepartmentWiseEstimate data={chartRes?.departmentWiseEstimate || []} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('key_financials')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <KeyFinancialIndicators data={chartRes?.keyFinancialIndicators} />
          </div>
        </ZoomCard>
      </div>

      {/* ── Section: Fund Flow & Risk ── */}
      <div className="flex items-center gap-3 mb-3 mt-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Fund Flow &amp; Risk</span>
        <div className="flex-1 h-px bg-white/[0.045]" />
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

      {/* ── Section: Zonal Intelligence ── */}
      <div className="flex items-center gap-3 mb-3 mt-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Zonal Intelligence</span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      {/* ── Row 3: Zonal Performance Heatmap (full-width) ─────────────── */}
      <ZoomCard className="mb-6" onZoom={() => setZoomedChart('zonal')}>
        <ZonalPerformanceHeatmap
          data={chartRes?.zonalHeatmap || []}
          onSelectZone={setSelectedZone}
          selectedZone={selectedZone}
        />
      </ZoomCard>

      {/* ── Section: Trends & Projections ── */}
      <div className="flex items-center gap-3 mb-3 mt-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Trends &amp; Projections</span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      {/* ── Row 4: Runway (1/3) + S-Curve (1/3) + Revision Heatmap (1/3) ── */}
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
            <InvestmentRecoveryPlot projects={projectsList} />
          </div>
        </ZoomCard>
      </div>

      {/* ── Section: Project Health Summary ── */}
      <div className="flex items-center gap-3 mb-3 mt-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Project Health Summary</span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      {/* ── Row 5: Quick Executive Summary KPI Strip (6 premium tiles) ──── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          {
            label: 'Active Work Orders',
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
        ].map(({ label, value, subtext, color, border, glow, bgIcon, icon, filterFn }) => (
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
            className={`relative overflow-hidden rounded-2xl border p-4 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${border} ${glow} ${isDark ? 'bg-slate-900/40 text-slate-100' : 'bg-white/80 border-slate-200 shadow-sm text-slate-900'
              } flex flex-col justify-between group cursor-pointer`}
          >
            {/* Background subtle grid pattern overlay - theme aware */}
            <div className={`absolute inset-0 pointer-events-none ${isDark
                ? 'opacity-5 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:8px_8px]'
                : 'opacity-10 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:8px_8px]'
              }`} />

            <div className="flex items-center justify-between mb-3 relative z-10">
              <div className={`p-2 rounded-xl ${bgIcon} transition-transform duration-300 group-hover:scale-110`}>
                {icon}
              </div>
              <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${isDark ? 'text-slate-500 group-hover:text-slate-300' : 'text-slate-500 group-hover:text-slate-700'
                }`}>
                {subtext}
              </span>
            </div>

            <div className="relative z-10 mt-1">
              <div className={`text-3xl font-black tabular-nums tracking-tight ${color} group-hover:brightness-125 transition-all`}>
                {value}
              </div>
              <div className={`text-[10px] font-black uppercase tracking-widest mt-1 flex items-center justify-between ${isDark ? 'text-slate-400' : 'text-slate-600'
                }`}>
                <span>{label}</span>
                <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity font-bold">View →</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Section: Work Order Telemetry ── */}
      <div className="flex items-center gap-3 mb-3 mt-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Work Order Telemetry</span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      {/* ── Row 6: Full-width Work Order Telemetry Table ──────────────── */}
      <div className="mb-6">
        <WorkOrderTelemetryTable
          data={projectsList}
          selectedZone={selectedZone}
          onSelectZone={setSelectedZone}
        />
      </div>

      {/* ── Fullscreen Chart Zoom Modal (Dynamic Class Component) ───────── */}
      {zoomedChart === 'physical_progress' && (
        <ChartModal title="Physical Work Progress Telemetry" isDark={isDark} onClose={() => setZoomedChart(null)}>
          <PhysicalWorkProgress data={chartRes?.physicalProgressMetrics} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'je_visit' && (
        <ChartModal title="JE Visit Frequency Telemetry" isDark={isDark} onClose={() => setZoomedChart(null)}>
          <JeVisitFrequency data={chartRes?.jeVisitFrequencyMetrics} />
        </ChartModal>
      )}
      {zoomedChart === 'department' && (
        <ChartModal title="Department Wise Estimate Breakdown" isDark={isDark} onClose={() => setZoomedChart(null)}>
          <DepartmentWiseEstimate data={chartRes?.departmentWiseEstimate || []} />
        </ChartModal>
      )}
      {zoomedChart === 'key_financials' && (
        <ChartModal title="Key Financial Indicators Telemetry" isDark={isDark} onClose={() => setZoomedChart(null)}>
          <KeyFinancialIndicators data={chartRes?.keyFinancialIndicators} />
        </ChartModal>
      )}
      {zoomedChart === 'bubble' && (
        <ChartModal title="Bubble Risk Matrix Inspection" isDark={isDark} width="96vw" height="92vh" onClose={() => setZoomedChart(null)}>
          <BubbleRiskMatrix data={chartRes?.bubbleMatrix || []} />
        </ChartModal>
      )}
      {zoomedChart === 'fundflow' && (
        <ChartModal title="Fund Flow Pipeline Inspection" isDark={isDark} width="96vw" height="92vh" onClose={() => setZoomedChart(null)}>
          <FundFlowWaterfall data={chartRes?.waterfallData || []} />
        </ChartModal>
      )}
      {zoomedChart === 'zonal' && (
        <ChartModal title="Zonal Performance Heatmap Inspection" isDark={isDark} width="96vw" height="92vh" onClose={() => setZoomedChart(null)}>
          <ZonalPerformanceHeatmap data={chartRes?.zonalHeatmap || []} onSelectZone={setSelectedZone} selectedZone={selectedZone} />
        </ChartModal>
      )}
      {zoomedChart === 'runway' && (
        <ChartModal title="Predictive Cash Runway & Projections" isDark={isDark} width="96vw" height="92vh" onClose={() => setZoomedChart(null)}>
          <PredictiveRunwayLines trendData={chartRes?.runwayTrend || []} runwayData={insightsRes?.runwayData || []} />
        </ChartModal>
      )}
      {zoomedChart === 'scurve' && (
        <ChartModal title="S-Curve Performance Progress" isDark={isDark} width="96vw" height="92vh" onClose={() => setZoomedChart(null)}>
          <SCurveProgress data={chartRes?.sCurveData || []} />
        </ChartModal>
      )}
      {zoomedChart === 'revision' && (
        <ChartModal title="Investment & Bill Recovery Realization" isDark={isDark} width="96vw" height="92vh" onClose={() => setZoomedChart(null)}>
          <InvestmentRecoveryPlot projects={projectsList} isModal={true} />
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
