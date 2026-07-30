import React, { useState, useMemo, useRef } from 'react';
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
import { formatINR, fmtCr } from '../components/analytics/utils/formatters';
import { useChartColors } from '../components/analytics/utils/chartColors';
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
import { WorkOrderTelemetryTable } from '../components/analytics/charts/WorkOrderTelemetryTable';

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
    const todayMs = Date.now();
    const msPerDay = 86400000;
    const historicalHalf = (W / 2) - PAD;
    const futureHalf = (W - PAD) - (W / 2);
    const pts = [];

    if (history && history.length > 0) {
      const sortedHistory = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));

      sortedHistory.forEach((h) => {
        const dTime = new Date(h.date).getTime();
        const daysAgo = Math.min(60, Math.max(0, (todayMs - dTime) / msPerDay));
        const x = (W / 2) - (daysAgo / 60) * historicalHalf;
        const y = (H - PAD) - (Math.max(0, Number(h.balance || 0)) / maxBalance) * (H - 2 * PAD);
        pts.push(`${x},${y}`);
      });
    }

    const currentBal = rData ? Number(rData.available_balance || 0) : (history?.length ? Number(history[history.length - 1].balance || 0) : 0);
    const todayY = (H - PAD) - (Math.max(0, currentBal) / maxBalance) * (H - 2 * PAD);

    if (pts.length === 0) {
      pts.push(`${PAD},${todayY}`);
    }
    pts.push(`${W / 2},${todayY}`);

    const burn = rData ? Number(rData.daily_burn || 0) : 0;
    for (let i = 1; i <= 60; i += 2) {
      const projBal = Math.max(0, currentBal - burn * i);
      const x = (W / 2) + (i / 60) * futureHalf;
      const y = (H - PAD) - (projBal / maxBalance) * (H - 2 * PAD);
      pts.push(`${x},${y}`);
    }

    return pts.join(' ');
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
              <span>{t.zo_name || t.zo_user_id}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Generic Interactive Donut Metric Card with Work Orders Hover Popover ─────

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

      if (angle >= 359.9) {
        const fullCirclePathData = `M ${center} ${center - outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 ${center - 0.01} ${center - outerRadius} L ${center - 0.01} ${center - innerRadius} A ${innerRadius} ${innerRadius} 0 1 0 ${center} ${center - innerRadius} Z`;
        return {
          ...bucket,
          pct: Math.round(pct),
          pathData: fullCirclePathData
        };
      }

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
              {typeof centerValue === 'string' ? centerValue.replace(/%%+/g, '%') : centerValue}
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
  const rawAvg = data?.avgProgress !== undefined && data?.avgProgress !== null ? String(data.avgProgress).replace(/%+$/g, '') : '0';
  const centerVal = `${rawAvg}%`;

  return (
    <MetricDonutCard
      title="Physical Work Progress"
      subtitle="Distribution of work orders by completion band"
      description="Work order distribution categorized by physical work completion bands."
      formula="Physical Progress % = (Latest DPR Work Completed / Total WO Scope) × 100"
      centerLabel="Avg. Progress"
      centerValue={centerVal}
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
      subtitle="Distribution of sites by DPR reporting lag"
      description="Categorization of project sites based on recent Junior Engineer DPR site inspection frequency."
      formula="Inspection Gap = Current Date - Date of Last Approved DPR"
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
    },
    staleTime: 5 * 60 * 1000
  });

  // Fetch executive chart data
  const { data: chartRes } = useQuery({
    queryKey: ['hoChartData', activeView, projectStatusFilter, startDate, endDate, selectedZone],
    queryFn: async () => {
      const res = await getHoChartData({
        view: activeView,
        zone: selectedZone || undefined,
        project_status: projectStatusFilter,
        start_date: startDate || undefined,
        end_date: endDate || undefined
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000
  });

  const insights = insightsRes || {};
  const stalledProjects = insights.stalledProjects || [];
  const lowRunwayZones = (insights.runwayData || []).filter(z => z.runway_days !== null && z.runway_days < 21);


  const { data: projectsRes } = useQuery({
    queryKey: ['projectsHealthList'],
    queryFn: async () => {
      const res = await getProjectsHealth();
      return res.data;
    },
    staleTime: 5 * 60 * 1000
  });
  const projectsList = projectsRes?.data || [];

  /* ── Filtered Projects & Stalled Ticker ── */
  const filteredProjects = useMemo(() => {
    let list = chartRes?.projectsList || projectsList;
    if (selectedZone) {
      list = list.filter(p => {
        const pZone = (p.zone || p.area_code || p.zo_user_id || '').toLowerCase().trim();
        const sel = selectedZone.toLowerCase().trim();
        return pZone === sel;
      });
    }
    if (projectStatusFilter && projectStatusFilter !== 'all') {
      list = list.filter(p => (p.status || '').toLowerCase().trim() === projectStatusFilter.toLowerCase().trim());
    }
    return list;
  }, [chartRes?.projectsList, projectsList, selectedZone, projectStatusFilter]);

  const filteredStalledProjects = useMemo(() => {
    let list = stalledProjects;
    if (selectedZone) {
      list = list.filter(p => {
        const pZone = (p.zone || p.area_code || p.zo_user_id || '').toLowerCase().trim();
        const sel = selectedZone.toLowerCase().trim();
        return pZone === sel;
      });
    }
    if (projectStatusFilter && projectStatusFilter !== 'all') {
      list = list.filter(p => (p.status || '').toLowerCase().trim() === projectStatusFilter.toLowerCase().trim());
    }
    return list;
  }, [stalledProjects, selectedZone, projectStatusFilter]);


  // 1. Fetch HO KPIs
  useQuery({
    queryKey: ['hoKpis'],
    queryFn: async () => {
      const res = await getHoKpis();
      return res.data;
    },
    staleTime: 5 * 60 * 1000
  });

  // 2. Fetch Zonal Benchmarking
  useQuery({
    queryKey: ['hoZoneBenchmarking'],
    queryFn: async () => {
      const res = await getHoZoneBenchmarking();
      return res.data;
    },
    staleTime: 5 * 60 * 1000
  });

  // 3. Fetch Budget Leakages
  useQuery({
    queryKey: ['hoBudgetLeakage'],
    queryFn: async () => {
      const res = await getHoBudgetLeakage();
      return res.data;
    },
    staleTime: 5 * 60 * 1000
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
          <ChartInfoTooltip
            description="Analytics metrics are derived in real-time from live system entries across Work Orders, Approved Estimates, ZO Fund Requisitions, Bank Disbursals, DPR Logs, and Contractor Bills."
            formula="Source = Live SQL aggregation across work_orders, estimate_sheets, requisitions & agency_bills tables"
          />
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
                  {z.zo_name || z.zone || z.zo_user_id} — Balance depletes in {z.runway_days} days
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
                  {z.zo_name || z.zone || z.zo_user_id} — Balance depletes in {z.runway_days} days
                </div>
              ))}
              {filteredStalledProjects.slice(0, 5).map((p, idx) => (
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
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Executive KPIs</span>
          <div className="hidden md:block h-px w-24 bg-white/[0.045]" />
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
          <ChartInfoTooltip
            description="All Executive KPI metrics are calculated in real-time by aggregating live database records across Work Orders, Final Approved Estimates, ZO Fund Requisitions, Disbursals, DPR Progress Submissions, and Agency Bills."
            formula="Source = Live SQL aggregation across work_orders, estimate_sheets, requisitions & agency_bills"
          />
        </div>
      </div>
      <ExecutiveKpiStrip data={chartRes?.executiveSummaryKpis} projects={filteredProjects} />

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
            <DepartmentWiseEstimateChart items={chartRes?.departmentWiseEstimate} projects={filteredProjects} />
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
            <FundFlowWaterfallChart data={chartRes?.waterfallData} projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('bubble')}>
          <div style={{ minHeight: '480px' }} className="h-full">
            <BubbleRiskMatrixChart bubbleMatrixData={chartRes?.bubbleMatrix} projects={filteredProjects} />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 items-start">
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('runway')}>
          <PredictiveRunwayLines
            trendData={chartRes?.runwayTrend || []}
            runwayData={insightsRes?.runwayData || []}
          />
        </ZoomCard>
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('scurve')}>
          <SCurveProgressChart sCurveData={chartRes?.sCurveData} projects={filteredProjects} />
        </ZoomCard>
      </div>

      {/* ── Section: Financial Realization Pipeline ── */}
      <div className="flex items-center gap-3 mb-3 mt-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">Financial Realization &amp; Bill Recovery</span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      <ZoomCard className="mb-6" onZoom={() => setZoomedChart('revision')}>
        <InvestmentRecoveryPlot
          projects={filteredProjects}
          agencyPaymentAmount={chartRes?.executiveSummaryKpis?.agencyPayment?.amount}
        />
      </ZoomCard>

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
            value: filteredProjects.length,
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
            value: filteredProjects.filter(p => p.health_status === 'Healthy').length,
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
            value: filteredProjects.filter(p => p.health_status === 'Warning').length,
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
            value: filteredProjects.filter(p => p.health_status === 'Critical').length,
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
            value: `${filteredProjects.length ? Math.round(filteredProjects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / filteredProjects.length) : 0}%`,
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
            value: `${filteredProjects.length ? Math.round(filteredProjects.reduce((a, p) => a + Number(p.health_score || 0), 0) / filteredProjects.length) : 0}`,
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
              const filtered = filterFn ? filteredProjects.filter(filterFn) : filteredProjects;
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
          data={filteredProjects}
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
        <ChartModal title="Department Wise Work Order Value Breakdown" isDark={isDark} onClose={() => setZoomedChart(null)}>
          <DepartmentWiseEstimateChart items={chartRes?.departmentWiseEstimate} projects={filteredProjects} />
        </ChartModal>
      )}
      {zoomedChart === 'key_financials' && (
        <ChartModal title="Key Financial Indicators Telemetry" isDark={isDark} onClose={() => setZoomedChart(null)}>
          <KeyFinancialIndicators data={chartRes?.keyFinancialIndicators} />
        </ChartModal>
      )}
      {zoomedChart === 'bubble' && (
        <ChartModal title="Bubble Risk Matrix Inspection" isDark={isDark} width="96vw" height="92vh" onClose={() => setZoomedChart(null)}>
          <BubbleRiskMatrixChart bubbleMatrixData={chartRes?.bubbleMatrix} projects={filteredProjects} />
        </ChartModal>
      )}
      {zoomedChart === 'fundflow' && (
        <ChartModal title="Fund Flow Pipeline Inspection" isDark={isDark} width="96vw" height="92vh" onClose={() => setZoomedChart(null)}>
          <FundFlowWaterfallChart data={chartRes?.waterfallData} projects={filteredProjects} />
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
          <SCurveProgressChart sCurveData={chartRes?.sCurveData} projects={filteredProjects} />
        </ChartModal>
      )}
      {zoomedChart === 'revision' && (
        <ChartModal
          title="Investment & Bill Recovery Realization"
          description="Capital investment vs bill recovery realization across work order progress bands."
          formula="Pending Recovery = Requisition Investment - Contractor Bill Payments Received"
          isDark={isDark}
          width="96vw"
          height="92vh"
          onClose={() => setZoomedChart(null)}
        >
          <InvestmentRecoveryPlot
            projects={filteredProjects}
            agencyPaymentAmount={chartRes?.executiveSummaryKpis?.agencyPayment?.amount}
            isModal={true}
          />
        </ChartModal>
      )}

      {/* ── KPI Details Modal ─────────────────────────────────────────── */}
      {kpiDetailModal && (
        <KpiDetailsModal
          title={kpiDetailModal.title}
          colorClass={kpiDetailModal.color}
          projects={kpiDetailModal.projects}
          onClose={() => setKpiDetailModal(null)}
        />
      )}

    </>
  );
};

export default HoDashboard;