import React, { useState, useMemo } from 'react';
import { useChartColors } from '../utils/chartColors';
import { ChartInfoTooltip } from '../ui/ChartInfoTooltip';
import { computeSCurveSeries } from '../utils/scurveSeries';

export const SCurveProgressChart = ({ sCurveData = [], projects = [], isModal = false }) => {
  const [selectedWo, setSelectedWo] = useState('all');
  const c = useChartColors();

  const W = 600;
  const H = 330;
  const PAD_TOP = 40;
  const PAD_BOT = 60;
  const PAD_SIDE = 50;

  const activeWos = useMemo(() => {
    const set = new Set();
    (projects || []).forEach((p) => {
      if (p.work_order_no) set.add(p.work_order_no);
    });
    (sCurveData || []).forEach((d) => {
      if (d.work_order_no) set.add(d.work_order_no);
    });
    return Array.from(set).sort();
  }, [sCurveData, projects]);

  const {
    months,
    planned,
    actual,
    isProjectedTrend,
    isDefaultPlannedCurve,
    partialScheduleCoverage,
    datedProjectCount,
    totalProjectCount
  } = useMemo(
    () => computeSCurveSeries(sCurveData, projects, selectedWo),
    [sCurveData, projects, selectedWo]
  );

  const toX = (i) => PAD_SIDE + (i / Math.max(1, months.length - 1)) * (W - 2 * PAD_SIDE);
  const toY = (v) => H - PAD_BOT - (Math.min(100, Math.max(0, v)) / 100) * (H - PAD_TOP - PAD_BOT);
  const pts = (arr) => arr.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  const actualStroke = c.isDark ? '#10b981' : '#059669';

  return (
    <div className={isModal ? "w-full h-full flex flex-col justify-between p-2 sm:p-4" : "chart-panel h-full flex flex-col justify-between"}>
      {!isModal && (
        <div className="flex justify-between items-center mb-4 flex-wrap gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <ChartInfoTooltip
              description="Cumulative project timeline comparing planned sigmoidal S-curve target with actual DPR physical work progress logs."
              formula="Actual Trajectory = Latest reported DPR progress per month (portfolio average when viewing all work orders)"
            />
            <div>
              <h3 className="chart-title">S-Curve Performance Progress</h3>
              <p className="chart-subtitle">
                {isDefaultPlannedCurve
                  ? 'Planned sigmoidal target vs actual DPR submissions'
                  : 'Planned target derived from contracted project schedule'}
              </p>
            </div>
          </div>

          {activeWos.length > 0 && (
            <select
              value={selectedWo}
              onChange={(e) => setSelectedWo(e.target.value)}
              className="chart-select text-xs"
            >
              <option value="all">All Work Orders (Portfolio Avg)</option>
              {activeWos.map((wo) => (
                <option key={wo} value={wo}>
                  {wo}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {isModal && activeWos.length > 0 && (
        <div className="flex justify-end items-center mb-3 shrink-0">
          <select
            value={selectedWo}
            onChange={(e) => setSelectedWo(e.target.value)}
            className="chart-select text-xs"
          >
            <option value="all">All Work Orders (Portfolio Avg)</option>
            {activeWos.map((wo) => (
              <option key={wo} value={wo}>
                {wo}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="relative flex-1 flex flex-col justify-center min-h-0 w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full drop-shadow-md" preserveAspectRatio="xMidYMid meet">
          <text
            x={14}
            y={H / 2 - 10}
            textAnchor="middle"
            fill={c.labelNormal}
            fontSize="8"
            fontWeight="bold"
            letterSpacing="1"
            transform={`rotate(-90, 14, ${H / 2 - 10})`}
          >
            PHYSICAL PROGRESS %
          </text>

          <text
            x={W / 2}
            y={H - 6}
            textAnchor="middle"
            fill={c.labelNormal}
            fontSize="8"
            fontWeight="bold"
            letterSpacing="1"
          >
            MONTH TIMELINE / PROJECT DURATION
          </text>

          {[0, 25, 50, 75, 100].map((v, i) => {
            const y = toY(v);
            return (
              <g key={i}>
                <line x1={PAD_SIDE} y1={y} x2={W - PAD_SIDE} y2={y} stroke={c.gridLine} />
                <text x={PAD_SIDE - 8} y={y + 3} textAnchor="end" fill={c.labelNormal} fontSize="8" fontWeight="bold" className="font-mono">
                  {v}%
                </text>
              </g>
            );
          })}

          <text x={PAD_SIDE} y={H - PAD_BOT + 16} fill={c.labelNormal} fontSize="8" fontWeight="bold">
            {months.length > 1 ? months[0] : 'START'}
          </text>
          <text x={W - PAD_SIDE} y={H - PAD_BOT + 16} textAnchor="end" fill={c.labelNormal} fontSize="8" fontWeight="bold">
            {months.length > 1 ? months[months.length - 1] : 'CURRENT'}
          </text>

          {months.map((m, i) => (
            <text key={i} x={toX(i)} y={H - PAD_BOT + 32} textAnchor="middle" fill={c.labelNormal} fontSize="9" fontWeight="bold">
              {m}
            </text>
          ))}

          <polyline
            fill="none"
            stroke={c.isDark ? '#f59e0b' : '#d97706'}
            strokeWidth="2"
            strokeDasharray="5 4"
            points={pts(planned)}
          />

          <polyline
            fill="none"
            stroke={actualStroke}
            strokeWidth="3"
            strokeDasharray={isProjectedTrend ? '6 4' : 'none'}
            points={pts(actual)}
          />

          {actual.map((v, i) => (
            <circle
              key={i}
              cx={toX(i)}
              cy={toY(v)}
              r="4"
              fill={actualStroke}
              fillOpacity={isProjectedTrend ? 0.65 : 1}
            />
          ))}
        </svg>


          {!isProjectedTrend && actual.every(v => v === 0) && (
          <div className="absolute inset-x-0 top-10 flex justify-center pointer-events-none z-10">
            <div className="px-4 py-2 rounded-2xl bg-amber-500/15 border border-amber-500/35 text-amber-400 font-extrabold text-xs shadow-lg backdrop-blur-md flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Awaiting Initial Site DPR Logging · 0% Physical Progress Recorded</span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 mt-3 shrink-0">
          <div className="flex gap-6 text-[9px] font-bold uppercase tracking-widest chart-label justify-center">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t-2 border-dashed" style={{ borderColor: c.isDark ? '#f59e0b' : '#d97706' }} />
              <span>{isDefaultPlannedCurve ? 'Default Planned Target' : 'Contract Planned Target'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-3 h-1 rounded-sm ${isProjectedTrend ? 'border border-dashed' : ''}`}
                style={{ backgroundColor: isProjectedTrend ? 'transparent' : actualStroke, borderColor: actualStroke }}
              />
              <span>{isProjectedTrend ? 'Projected Trend' : 'Reported Progress'}</span>
            </div>
          </div>

          {(isProjectedTrend || isDefaultPlannedCurve || partialScheduleCoverage) && (
            <div className="flex flex-col gap-1 px-2">
              {isProjectedTrend && (
                <p className="text-[9px] font-bold text-amber-500 text-center">
                  Projected actual trend — limited reporting history
                </p>
              )}
              {isDefaultPlannedCurve && (
                <p className="text-[9px] font-bold text-amber-500 text-center">
                  Planned target uses default curve — project dates not set
                </p>
              )}
              {partialScheduleCoverage && !isDefaultPlannedCurve && (
                <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 text-center">
                  Planned target based on {datedProjectCount} of {totalProjectCount} work orders with schedule dates
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SCurveProgressChart;
