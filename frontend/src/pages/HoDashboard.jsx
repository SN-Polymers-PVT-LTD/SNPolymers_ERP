import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../components/ThemeContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import BackgroundShapes from '../components/BackgroundShapes';
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

const RevisionHeatmap = ({ data }) => {
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
    <div className="chart-panel h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="chart-title">Estimate Revision Timeline Churn</h3>
          <p className="chart-subtitle">Monthly revision request metrics. Projects with &gt;3 revisions are flagged.</p>
        </div>
      </div>

      <div className="relative overflow-x-auto no-scrollbar">
        <svg width={W} height={H} className="mx-auto" style={{ minWidth: W }}>
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
  const [alertMsg, setAlertMsg] = useState(null);
  const [alertType, setAlertType] = useState('success'); // 'success' or 'error'
  const [exploreWo, setExploreWo] = useState('');
  const [activeView, setActiveView] = useState('all'); // 'all' | 'zo' | 'je' | 'wo'
  const [selectedZone, setSelectedZone] = useState(null); // Filter for telemetry table

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

  const kpis = kpiRes?.kpis || null;
  const healthDistribution = kpiRes?.healthDistribution || { Healthy: 0, Warning: 0, Critical: 0 };
  const zones = zoneRes?.data || [];
  const leakages = leakageRes?.data || [];

  const [zonePage, setZonePage] = useState(1);
  const ZONES_PER_PAGE = 5;
  const totalZonePages = Math.ceil(zones.length / ZONES_PER_PAGE);
  const paginatedZones = zones.slice((zonePage - 1) * ZONES_PER_PAGE, zonePage * ZONES_PER_PAGE);

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  const isPageLoading = kpiLoading || zoneLoading || leakageLoading;
  const isPageError = kpiErr || zoneErr || leakageErr;

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />

        <main className="flex-grow p-6 md:p-10 overflow-y-auto no-scrollbar max-w-7xl mx-auto w-full relative z-10">
          
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

          {/* ── Row 1: Risk Matrix (wide) + Fund Flow (narrow) ─────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Bubble Risk Matrix — takes 2/3 */}
            <div className="lg:col-span-2">
              <BubbleRiskMatrix data={chartRes?.bubbleMatrix || []} />
            </div>
            {/* Fund Flow Waterfall — takes 1/3 */}
            <div className="lg:col-span-1">
              <FundFlowWaterfall data={chartRes?.waterfallData || []} />
            </div>
          </div>

          {/* ── Row 2: Zonal Heatmap — full width compact table ───────────────── */}
          <div className="mb-4">
            <ZonalPerformanceHeatmap
              data={chartRes?.zonalHeatmap || []}
              onSelectZone={setSelectedZone}
              selectedZone={selectedZone}
            />
          </div>

          {/* ── Row 3: Runway Lines (left) + S-Curve (right) ──────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <PredictiveRunwayLines
              trendData={chartRes?.runwayTrend || []}
              runwayData={insightsRes?.runwayData || []}
            />
            <SCurveProgress data={chartRes?.sCurveData || []} />
          </div>

          {/* ── Row 4: Revision Heatmap (left) + Quick Stats Strip (right) ────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <RevisionHeatmap data={chartRes?.revisionHeatmap || []} />

            {/* Quick Stats: Summary telemetry counts */}
            <div className="chart-panel flex flex-col justify-between gap-3">
              <div>
                <h3 className="chart-title">Portfolio Pulse</h3>
                <p className="chart-subtitle">Live aggregate telemetry across all work orders</p>
              </div>
              <div className="grid grid-cols-2 gap-3 flex-1">
                {[
                  { label: 'Total WOs', value: projectsList.length, color: 'text-sky-400' },
                  { label: 'Healthy', value: projectsList.filter(p => p.health_status === 'Healthy').length, color: 'text-emerald-400' },
                  { label: 'Warning', value: projectsList.filter(p => p.health_status === 'Warning').length, color: 'text-amber-400' },
                  { label: 'Critical', value: projectsList.filter(p => p.health_status === 'Critical').length, color: 'text-rose-400' },
                  { label: 'Avg Progress', value: `${projectsList.length ? Math.round(projectsList.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / projectsList.length) : 0}%`, color: 'text-indigo-400' },
                  { label: 'Avg Health', value: `${projectsList.length ? Math.round(projectsList.reduce((a, p) => a + Number(p.health_score || 0), 0) / projectsList.length) : 0}`, color: 'text-violet-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-2xl border chart-stat-cell flex flex-col justify-center items-center py-4 px-3 gap-1">
                    <span className={`text-2xl font-black tabular-nums tracking-tight ${color}`}>{value}</span>
                    <span className="chart-subtitle text-center leading-tight">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Row 5: Full-width Telemetry Table ─────────────────────────────── */}
          <div className="mb-4">
            <WorkOrderTelemetryTable
              data={projectsList}
              selectedZone={selectedZone}
              onSelectZone={setSelectedZone}
            />
          </div>


          {isPageError ? (
            <div className="glass-panel p-8 rounded-3xl border border-rose-500/10 bg-rose-950/5 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-400 mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-base font-bold uppercase tracking-widest text-slate-200">Error Loading Analytics</h2>
              <p className="text-xs text-slate-500 mt-2 max-w-sm">We had trouble communicating with the backend. Please check the DB connection or click refresh.</p>
            </div>
          ) : isPageLoading ? (
            <div className="space-y-8">
              {/* Skeleton Loaders */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map(idx => (
                  <div key={idx} className="glass-panel p-6 rounded-3xl animate-pulse h-32 bg-white/[0.02]" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 glass-panel p-6 rounded-3xl animate-pulse h-96 bg-white/[0.02]" />
                <div className="glass-panel p-6 rounded-3xl animate-pulse h-96 bg-white/[0.02]" />
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              
              {/* KPI Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Active Projects KPI */}
                <div className="glass-panel p-6 rounded-3xl relative transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(245,158,11,0.02)] hover:z-50">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    Project Portfolio
                    <InfoTooltip content="Active projects relative to the total portfolio, categorized by health status." position="left" />
                  </span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-amber-500">
                    {kpis?.active_projects || 0} <span className="text-xs text-slate-500 font-bold">/ {kpis?.total_projects || 0} Active</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5 flex gap-2">
                    <span className="text-emerald-400">{healthDistribution.Healthy || 0} Healthy</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-rose-400">{healthDistribution.Critical || 0} Critical</span>
                  </div>
                </div>

                {/* Budget Utilization KPI */}
                <div className="glass-panel p-6 rounded-3xl relative transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(16,185,129,0.02)] hover:z-50">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    Budget Utilization
                    <InfoTooltip content="Percentage of total budget spent relative to total allocated budget." position="center" />
                  </span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-emerald-500">
                    {kpis?.budget_utilization_pct ? `${Number(kpis.budget_utilization_pct).toFixed(1)}%` : '0%'}
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5 truncate">
                    Spent {formatINR(kpis?.total_spent)} of {formatINR(kpis?.total_budget)}
                  </div>
                </div>

                {/* Warnings / Risks KPI */}
                <div className="glass-panel p-6 rounded-3xl relative transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(244,63,94,0.02)] hover:z-50">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    Critical Anomaly Risk
                    <InfoTooltip content="Number of projects currently marked as Critical risk or carrying warnings." position="center" />
                  </span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-rose-500 flex items-baseline gap-2">
                    {kpis?.projects_at_risk || 0}
                    <span className="text-xs text-slate-500 font-bold">at Risk</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5 flex gap-2">
                    <span className="text-amber-400">{kpis?.projects_at_warning || 0} warnings pending review</span>
                  </div>
                </div>

                {/* Radial Gauge / Portfolio Health */}
                <div className="glass-panel p-6 rounded-3xl relative transition-all duration-300 hover:border-white/10 flex items-center justify-between shadow-[0_0_15px_rgba(99,102,241,0.02)] hover:z-50">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      Portfolio Health
                      <InfoTooltip content="Weighted health average based on active projects' individual health score." position="right" />
                    </span>
                    <div className="text-3xl font-black mt-2 tracking-tight text-indigo-400">
                      {kpis?.average_project_health ? `${Math.round(kpis.average_project_health)}%` : '0%'}
                    </div>
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest font-black block mt-1">Average Score</span>
                  </div>

                  {/* SVG circular progress */}
                  <div className="relative w-16 h-16">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-white/5"
                        strokeWidth="3"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-indigo-500 transition-all duration-1000 ease-out"
                        strokeDasharray={`${kpis?.average_project_health || 0}, 100`}
                        strokeWidth="3"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-slate-300">
                      {kpis?.average_project_health ? `${Math.round(kpis.average_project_health)}` : '0'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Middle Section Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Zonal Benchmarking (2/3 width) */}
                {/* Column wrapper for Zonal Benchmarking & Twin Explorer (2/3 width) */}
                <div className="lg:col-span-2 space-y-8">
                  {/* Zonal Benchmarking */}
                  <div className="glass-panel p-6 rounded-3xl flex flex-col justify-between relative hover:z-50">
                    <div>
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                            Zonal Benchmarking
                            <InfoTooltip content="Aggregated performance, slack days, and health scores compared across all Zones." position="left" />
                          </h2>
                          <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-wider">Performance metrics aggregated by zone</p>
                        </div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Ranked by Health</span>
                      </div>

                      {zones.length === 0 ? (
                        <div className="text-slate-500 text-xs py-16 text-center uppercase tracking-widest">No active zones logged</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/5 pb-3">
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Rank</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Zone</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Active Projects</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Avg Slack Days</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Health Score</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {paginatedZones.map((row, idx) => {
                                const score = Number(row.average_health_score || 0);
                                const rating = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : 'Warning';
                                const rank = (zonePage - 1) * ZONES_PER_PAGE + idx + 1;

                                return (
                                  <tr key={idx} className="hover:bg-white/5 transition-colors">
                                    <td className="py-4 text-xs font-extrabold text-amber-500">#{rank}</td>
                                    <td className="py-4 text-xs font-bold text-slate-200">{row.zone}</td>
                                    <td className="py-4 text-xs font-bold text-slate-400 text-center">{row.running_projects || 0}</td>
                                    <td className={`py-4 text-xs font-bold text-center ${row.average_timeline_slack_days > 15 ? 'text-rose-400' : 'text-slate-400'}`}>
                                      {row.average_timeline_slack_days || 0}d
                                    </td>
                                    <td className="py-4 text-xs font-bold text-slate-200 text-center">{Math.round(score)}%</td>
                                    <td className="py-4 text-right">
                                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                                        rating === 'Excellent' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                        rating === 'Good' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                                        'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                      }`}>
                                        {rating}
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

                    {/* Pagination Controls */}
                    {totalZonePages > 1 && (
                      <div className="flex justify-between items-center bg-white/[0.01] border border-white/5 rounded-2xl p-4 mt-6">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                          Page {zonePage} of {totalZonePages} <span className="text-slate-600">({zones.length} zones total)</span>
                        </span>
                        
                        <div className="flex gap-2">
                          <button
                            onClick={() => setZonePage(prev => Math.max(1, prev - 1))}
                            disabled={zonePage === 1}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                              zonePage === 1 
                                ? 'border-transparent text-slate-600 cursor-not-allowed' 
                                : 'border-white/10 hover:bg-white/5 text-slate-300'
                            }`}
                          >
                            Prev
                          </button>
                          <button
                            onClick={() => setZonePage(prev => Math.min(totalZonePages, prev + 1))}
                            disabled={zonePage === totalZonePages}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                              zonePage === totalZonePages 
                                ? 'border-transparent text-slate-600 cursor-not-allowed' 
                                : 'border-white/10 hover:bg-white/5 text-slate-300'
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Digital Twin Simulation Explorer */}
                  <div className="glass-panel p-6 rounded-3xl flex flex-col justify-between relative hover:z-50">
                    <div>
                      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-1">
                        Digital Twin Explorer
                        <InfoTooltip content="Launch the interactive digital twin view of a project using its Work Order number." position="left" />
                      </h2>
                      <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-wider mb-6">
                        Retrieve live digital twin performance scores
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (exploreWo.trim()) {
                            navigate(`/projects/${exploreWo.trim()}/digital-twin`);
                          }
                        }}
                        className="flex gap-4 items-center"
                      >
                        <input
                          type="text"
                          placeholder="Enter Work Order No. (e.g. WO-01)"
                          value={exploreWo}
                          onChange={(e) => setExploreWo(e.target.value)}
                          className="bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500/50 flex-grow"
                        />
                        <button
                          type="submit"
                          disabled={!exploreWo.trim()}
                          className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                            exploreWo.trim()
                              ? 'bg-white hover:bg-white/90 text-slate-950'
                              : 'bg-white/5 border border-transparent text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          Launch Twin
                        </button>
                      </form>
                    </div>
                  </div>
                </div>

                {/* Budget Leakage Anomalies (1/3 width) */}
                <div className="glass-panel p-6 rounded-3xl flex flex-col h-fit relative hover:z-50">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      Budget Leakages
                      <InfoTooltip content="Projects flagging significant cost overruns or high revision counts." position="right" />
                    </h2>
                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">
                      Anomalies
                    </span>
                  </div>

                  {leakages.length === 0 ? (
                    <div className="text-slate-500 text-xs py-16 text-center uppercase tracking-widest flex-grow flex items-center justify-center">
                      No overruns detected
                    </div>
                  ) : (
                    <div className="space-y-4 overflow-y-auto no-scrollbar max-h-[380px]">
                      {leakages.map((item, idx) => {
                        const score = Number(item.anomaly_score || 0);
                        const severityColor = score >= 4 
                          ? 'border-rose-500/20 bg-rose-950/10 text-rose-400 hover:border-rose-500/40' 
                          : score >= 1
                          ? 'border-amber-500/20 bg-amber-950/10 text-amber-400 hover:border-amber-500/40'
                          : 'border-white/5 bg-slate-900/40 text-slate-400 hover:border-white/15';

                        const overrunPct = Math.max(0, Number(item.budget_variance_pct || 0) - 100);

                        return (
                          <div
                            key={idx}
                            onClick={() => navigate(`/projects/${item.work_order_no}/digital-twin`)}
                            className={`p-4 rounded-2xl border transition-all duration-300 cursor-pointer hover:scale-[1.02] flex flex-col gap-2 ${severityColor}`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="truncate pr-2">
                                <span className="text-[10px] font-black uppercase tracking-wider block truncate text-slate-300">
                                  {item.site_details || 'Site Project'}
                                </span>
                                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest block mt-0.5">
                                  {item.work_order_no}
                                </span>
                              </div>
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-black/30 shrink-0">
                                Score: {Math.round(score)}
                              </span>
                            </div>

                            {/* Mini horizontal bar representing anomaly score */}
                            <div className="space-y-1 mt-1">
                              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5 relative">
                                <div
                                  className={`h-full rounded-full transition-all duration-1000 ${
                                    score >= 6 ? 'bg-rose-500' : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${(score / 8) * 100}%` }}
                                />
                              </div>
                            </div>

                            <div className="flex justify-between items-center text-[10px] font-semibold pt-1.5 border-t border-white/5 mt-1">
                              <div>
                                <span className="text-slate-500">Overrun: </span>
                                <span className="font-extrabold text-rose-400">+{Number(overrunPct).toFixed(1)}%</span>
                              </div>
                              <div className="text-slate-500">
                                Revisions: <span className="text-slate-300 font-extrabold">{item.estimate_revisions_count || 0}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              </div>
              
            </div>
          )}

        </main>
      </div>
    </div>
  );
};

export default HoDashboard;
