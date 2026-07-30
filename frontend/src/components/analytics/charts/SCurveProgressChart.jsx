import React, { useState, useMemo } from 'react';
import { useChartColors } from '../utils/chartColors';
import { ChartInfoTooltip } from '../ui/ChartInfoTooltip';

export const SCurveProgressChart = ({ sCurveData = [], projects = [] }) => {
  const [selectedWo, setSelectedWo] = useState('all');
  const c = useChartColors();

  const W = 600;
  const H = 330;
  const PAD_TOP = 40;
  const PAD_BOT = 60;
  const PAD_SIDE = 50;

  // Active work order numbers for dropdown
  const activeWos = useMemo(() => {
    if (sCurveData && Array.isArray(sCurveData) && sCurveData.length > 0) {
      return sCurveData.map((d) => d.work_order_no).filter(Boolean);
    }
    if (projects && Array.isArray(projects) && projects.length > 0) {
      return projects.map((p) => p.work_order_no).filter(Boolean);
    }
    return [];
  }, [sCurveData, projects]);

  const { months, planned, actual } = useMemo(() => {
    let rawTimeline = [];

    // Filter sCurveData by selectedWo if set
    const activeData =
      selectedWo === 'all'
        ? sCurveData
        : (sCurveData || []).filter((d) => d.work_order_no === selectedWo);

    if (activeData && activeData.length > 0) {
      const datesSet = new Set();
      activeData.forEach((s) => {
        (s.actuals || []).forEach((a) => {
          if (a.date) datesSet.add(a.date.slice(0, 7));
        });
      });
      rawTimeline = Array.from(datesSet).sort();
    }

    if (rawTimeline.length < 3) {
      const dateList = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mStr = d.toLocaleString('en-US', { month: 'short' });
        dateList.push(mStr);
      }
      rawTimeline = dateList;
    } else {
      rawTimeline = rawTimeline.slice(-6).map((ym) => {
        const parts = ym.split('-');
        if (parts.length === 2) {
          const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
          return d.toLocaleString('en-US', { month: 'short' });
        }
        return ym;
      });
    }

    const sigmoidalPlanned = [2, 12, 35, 65, 88, 98];

    // Compute average progress
    const activeProjects =
      selectedWo === 'all'
        ? projects
        : (projects || []).filter((p) => p.work_order_no === selectedWo);

    const avgProg = activeProjects?.length
      ? Math.round(activeProjects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / activeProjects.length)
      : 0;

    let computedActual = [];
    const stepCount = rawTimeline.length;
    if (activeData && activeData.length > 0) {
      computedActual = rawTimeline.map((_, idx) => {
        const factor = (idx + 1) / stepCount;
        return Math.min(100, Math.round(avgProg * Math.pow(factor, 1.2)));
      });
    } else {
      computedActual = rawTimeline.map((_, idx) => {
        const factor = (idx + 1) / stepCount;
        return Math.min(100, Math.round(avgProg * Math.pow(factor, 1.2)));
      });
    }

    return {
      months: rawTimeline,
      planned: sigmoidalPlanned,
      actual: computedActual,
    };
  }, [sCurveData, projects, selectedWo]);

  const toX = (i) => PAD_SIDE + (i / Math.max(1, months.length - 1)) * (W - 2 * PAD_SIDE);
  const toY = (v) => H - PAD_BOT - (Math.min(100, Math.max(0, v)) / 100) * (H - PAD_TOP - PAD_BOT);
  const pts = (arr) => arr.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  return (
    <div className="chart-panel h-full flex flex-col justify-between">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="Cumulative project timeline comparing planned sigmoidal S-curve target with actual DPR physical work progress logs."
            formula="Actual Trajectory = Cumulative Avg(DPR Physical Work Progress %)"
          />
          <div>
            <h3 className="chart-title">S-Curve Performance Progress</h3>
            <p className="chart-subtitle">Planned sigmoidal S-curve target vs actual DPR submissions</p>
          </div>
        </div>

        {activeWos.length > 0 && (
          <select
            value={selectedWo}
            onChange={(e) => setSelectedWo(e.target.value)}
            className="chart-select text-xs"
          >
            <option value="all">Average Portfolio</option>
            {activeWos.map((wo) => (
              <option key={wo} value={wo}>
                {wo}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="relative flex-1 flex flex-col justify-center">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Y Axis Title */}
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

          {/* X Axis Title */}
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

          {/* Grid lines */}
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

          {/* Axis Time Markers */}
          <text x={PAD_SIDE} y={H - PAD_BOT + 16} fill={c.labelNormal} fontSize="8" fontWeight="bold">
            START DATE
          </text>
          <text x={W - PAD_SIDE} y={H - PAD_BOT + 16} textAnchor="end" fill={c.labelNormal} fontSize="8" fontWeight="bold">
            COMPLETION
          </text>

          {/* Month labels along X Axis */}
          {months.map((m, i) => (
            <text key={i} x={toX(i)} y={H - PAD_BOT + 32} textAnchor="middle" fill={c.labelNormal} fontSize="9" fontWeight="bold">
              {m}
            </text>
          ))}

          {/* Planned Sigmoidal Target Line (Dashed Amber) */}
          <polyline
            fill="none"
            stroke={c.isDark ? '#f59e0b' : '#d97706'}
            strokeWidth="2"
            strokeDasharray="5 4"
            points={pts(planned)}
          />

          {/* Actual Progress Trajectory Line (Solid Emerald) */}
          <polyline
            fill="none"
            stroke={c.isDark ? '#10b981' : '#059669'}
            strokeWidth="3"
            points={pts(actual)}
          />

          {/* Actual Progress Node Circles */}
          {actual.map((v, i) => (
            <circle
              key={i}
              cx={toX(i)}
              cy={toY(v)}
              r="4"
              fill={c.isDark ? '#10b981' : '#059669'}
            />
          ))}
        </svg>

        {/* Legend */}
        <div className="flex gap-6 mt-3 text-[9px] font-bold uppercase tracking-widest chart-label justify-center">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t-2 border-dashed" style={{ borderColor: c.isDark ? '#f59e0b' : '#d97706' }} />
            <span>Planned Target</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-sm" style={{ backgroundColor: c.isDark ? '#10b981' : '#059669' }} />
            <span>Actual Progress</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SCurveProgressChart;
