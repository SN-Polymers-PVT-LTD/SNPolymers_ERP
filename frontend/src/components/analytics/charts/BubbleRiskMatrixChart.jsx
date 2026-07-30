import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChartColors } from '../utils/chartColors';
import { ChartInfoTooltip } from '../ui/ChartInfoTooltip';
import { toX, toY, calcBubbleRadius } from '../utils/scatterGeometry';

export const BubbleRiskMatrixChart = ({ bubbleMatrixData = [], projects = [] }) => {
  const [tooltip, setTooltip] = useState(null);
  const navigate = useNavigate();
  const c = useChartColors();

  const W = 600;
  const H = 380;
  const PAD = 58;

  const bubbles = useMemo(() => {
    if (bubbleMatrixData && Array.isArray(bubbleMatrixData) && bubbleMatrixData.length > 0) {
      return bubbleMatrixData.map((b) => ({
        work_order_no: b.work_order_no,
        site_details: b.site_details || 'Site Project',
        budget_utilization_pct: Number(b.budget_utilization_pct || 0),
        physical_progress: Number(b.physical_progress || 0),
        days_since_dpr: Number(b.days_since_dpr || 0),
        health_status: b.health_status || 'Healthy',
      }));
    }

    if (projects && Array.isArray(projects) && projects.length > 0) {
      return projects.map((p) => {
        const woVal = Number(p.work_order_value || 0);
        const reqVal = Number(p.approved_requisitions_amount || p.approved_amount || 0);
        const budgetUtil = woVal > 0 ? (reqVal / woVal) * 100 : 0;
        return {
          work_order_no: p.work_order_no,
          site_details: p.site_details || 'Site Project',
          budget_utilization_pct: budgetUtil,
          physical_progress: Number(p.physical_progress || 0),
          days_since_dpr: Number(p.days_since_last_progress_report || 0),
          health_status: p.health_status || 'Healthy',
        };
      });
    }

    return [];
  }, [bubbleMatrixData, projects]);

  return (
    <div className="chart-panel h-full flex flex-col justify-between">
      <div className="flex justify-between items-center mb-3 shrink-0 flex-wrap gap-2">
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
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Healthy
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Warning
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Critical
          </span>
        </div>
      </div>

      <div className="relative flex-1 flex items-center justify-center min-h-0">
        {bubbles.length === 0 ? (
          <div className="text-xs text-slate-500 font-bold uppercase tracking-wider py-12">
            No project data available
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full max-h-[60vh]" preserveAspectRatio="xMidYMid meet">
            {/* Quadrant 50% Grid Lines */}
            <line x1={toX(50, W, PAD)} y1={PAD} x2={toX(50, W, PAD)} y2={H - PAD} stroke={c.gridLineDash} strokeDasharray="4 4" />
            <line x1={PAD} y1={toY(50, H, PAD)} x2={W - PAD} y2={toY(50, H, PAD)} stroke={c.gridLineDash} strokeDasharray="4 4" />

            {/* Quadrant Labels */}
            <text x={PAD + 10} y={PAD + 18} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">
              EFFICIENT
            </text>
            <text x={toX(50, W, PAD) + 10} y={PAD + 18} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">
              ON TRACK
            </text>
            <text x={PAD + 10} y={H - PAD - 10} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">
              DORMANT
            </text>
            <text x={toX(50, W, PAD) + 10} y={H - PAD - 10} fill={c.quadrantCritical} fontSize="8" fontWeight="bold" letterSpacing="1">
              CRITICAL OVERRUN
            </text>

            {/* X Axis Line & Label */}
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={c.axisLine} strokeWidth="1" />
            <text x={W / 2} y={H - 12} textAnchor="middle" fill={c.labelNormal} fontSize="8" fontWeight="bold" letterSpacing="1">
              BUDGET UTILIZATION %
            </text>

            {/* Y Axis Line & Label */}
            <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={c.axisLine} strokeWidth="1" />
            <text x={16} y={H / 2} textAnchor="middle" fill={c.labelNormal} fontSize="8" fontWeight="bold" letterSpacing="1" transform={`rotate(-90, 16, ${H / 2})`}>
              PHYSICAL PROGRESS %
            </text>

            {/* X Axis Ticks (0% to 140%) */}
            {[0, 35, 70, 105, 140].map((v) => (
              <text key={`x-${v}`} x={toX(v, W, PAD)} y={H - PAD + 14} textAnchor="middle" fill={c.labelMuted} fontSize="7" className="font-mono">
                {v}%
              </text>
            ))}

            {/* Y Axis Ticks (0% to 100%) */}
            {[0, 25, 50, 75, 100].map((v) => (
              <text key={`y-${v}`} x={PAD - 8} y={toY(v, H, PAD) + 3} textAnchor="end" fill={c.labelMuted} fontSize="7" className="font-mono">
                {v}%
              </text>
            ))}

            {/* Data Bubbles */}
            {bubbles.map((d, i) => {
              const r = calcBubbleRadius(d.days_since_dpr);
              const fill = d.health_status === 'Critical' ? '#ef4444' : d.health_status === 'Warning' ? '#f59e0b' : '#10b981';
              return (
                <circle
                  key={i}
                  cx={toX(d.budget_utilization_pct, W, PAD)}
                  cy={toY(d.physical_progress, H, PAD)}
                  r={r}
                  fill={fill}
                  fillOpacity={0.75}
                  stroke={fill}
                  strokeWidth={1.5}
                  strokeOpacity={1}
                  className="cursor-pointer transition-all duration-200 hover:fill-opacity-100"
                  onMouseEnter={(e) => setTooltip({ ...d, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null))}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => navigate(`/projects/${d.work_order_no}/digital-twin`)}
                />
              );
            })}
          </svg>
        )}

        {/* Floating Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 chart-tooltip p-3 rounded-2xl text-[10px] pointer-events-none min-w-[180px] shadow-2xl"
            style={{ top: tooltip.y - 120, left: tooltip.x + 20 }}
          >
            <p className="font-extrabold truncate chart-tooltip-title">{tooltip.site_details || 'Site Project'}</p>
            <p className="chart-tooltip-mono text-[9px] mt-0.5">{tooltip.work_order_no}</p>
            <div className="mt-2 space-y-1 pt-1.5 chart-tooltip-divider">
              <p className="chart-tooltip-label">
                Budget Spent: <span className="text-amber-600 font-extrabold">{(Number(tooltip.budget_utilization_pct) || 0).toFixed(1)}%</span>
              </p>
              <p className="chart-tooltip-label">
                Physical Progress: <span className="text-emerald-600 font-extrabold">{tooltip.physical_progress}%</span>
              </p>
              <p className="chart-tooltip-label">
                Last DPR Visit:{' '}
                <span className={tooltip.days_since_dpr > 7 ? 'text-rose-600 font-extrabold' : 'chart-tooltip-normal'}>
                  {tooltip.days_since_dpr}d ago
                </span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BubbleRiskMatrixChart;
