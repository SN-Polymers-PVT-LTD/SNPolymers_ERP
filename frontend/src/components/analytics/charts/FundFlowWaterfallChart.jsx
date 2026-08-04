import React, { useMemo } from 'react';
import { useChartColors } from '../utils/chartColors';
import { ChartInfoTooltip } from '../ui/ChartInfoTooltip';
import { fmtCr } from '../utils/formatters';

const STAGE_METADATA_MAP = {
  'final approved estimate': { gradId: 'ff-emerald',  color1: '#059669', color2: '#10b981', diffLabel: 'Unallocated Buffer' },
  'ho allocated (gross)':    { gradId: 'ff-sky',      color1: '#0284c7', color2: '#3b82f6', diffLabel: 'Excess Fund Return' },
  'excess returned to ho':   { gradId: 'ff-emerald',  color1: '#059669', color2: '#10b981', diffLabel: 'Effective HO Allocation' },
  'ho allocated (net)':      { gradId: 'ff-amber',    color1: '#d97706', color2: '#f59e0b', diffLabel: 'Unapproved Requisitions' },
  'ho allocated':            { gradId: 'ff-sky',      color1: '#0284c7', color2: '#3b82f6', diffLabel: 'ZO Retained Balance' },
  'requisitions approved':  { gradId: 'ff-indigo',   color1: '#6366f1', color2: '#8b5cf6', diffLabel: 'In-Flight Site WIP' },
  'gross billed':           { gradId: 'ff-blue',     color1: '#2563eb', color2: '#60a5fa', diffLabel: 'Unbilled Work' },
  'agency paid':            { gradId: 'ff-teal',     color1: '#0d9488', color2: '#14b8a6', diffLabel: 'Pending Settlement' }
};

function buildFallbackRows(projects) {
  const p = projects || [];
  const est = p.reduce((a, pr) => a + Number(pr.approved_estimate_amount || (pr.estimate_status === 'Final Approved' ? pr.estimate_amount : 0)), 0);
  const grossAllocated = p.reduce((a, pr) => a + Number(pr.approved_ho_amount || pr.ho_allocated_amount || pr.approve_ho_amount || pr.approved_amount || 0), 0);
  const excessReturned = p.reduce((a, pr) => a + Number(pr.excess_refunded_amount || pr.total_refunded || 0), 0);
  const netAllocated = Math.max(0, grossAllocated - excessReturned);
  const reqApproved = p.reduce((a, pr) => a + Number(pr.approved_requisitions_amount || pr.requisition_amount || 0), 0);
  const billed = p.reduce((a, pr) => a + Number(pr.gross_billed || 0), 0);
  const paid = p.reduce((a, pr) => a + Number(pr.agency_payment ?? pr.agency_paid ?? 0), 0);

  return {
    rows: [
      { stage: 'Final Approved Estimate', amount: est },
      { stage: 'HO Allocated (Gross)',    amount: grossAllocated },
      { stage: 'Excess Returned to HO',   amount: excessReturned, isRefund: true },
      { stage: 'HO Allocated (Net)',      amount: netAllocated },
      { stage: 'Requisitions Approved',   amount: reqApproved },
      { stage: 'Gross Billed',            amount: billed },
      { stage: 'Agency Paid',             amount: paid },
    ]
  };
}

export const FundFlowWaterfallChart = ({ data = [], projects = [], isModal = false }) => {
  const c = useChartColors();
  const W = 800, H = 400, PAD_LEFT = 190, PAD_RIGHT = 220, PAD_Y = 28;
  const barH = 20, gap = 22;

  const { rows } = useMemo(() => {
    if (data && Array.isArray(data) && data.length > 0) {
      return { rows: data };
    }
    const fallback = buildFallbackRows(projects);
    return {
      rows: fallback.rows
    };
  }, [data, projects]);

  const maxVal = Math.max(1, ...rows.map(d => Number(d.amount || 0)));
  const scale = (v) => (v / maxVal) * (W - PAD_LEFT - PAD_RIGHT);

  return (
    <div className={isModal ? "w-full h-full flex flex-col justify-between p-2 sm:p-4" : "chart-panel h-full flex flex-col justify-between"}>
      {!isModal && (
        <div className="flex justify-between items-start mb-2 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="chart-title">Fund Flow Pipeline</h3>
            </div>
            <p className="chart-subtitle">Capital Realization &amp; Allocation Lifecycle Pipeline</p>
          </div>
          <ChartInfoTooltip
            description="Capital realization pipeline tracking fund allocation from sanctioned cost estimate to HO disbursement, excess ZO fund returns, site requisitions, billing, and vendor settlement."
            formula="Uncommitted Capital = Previous Stage Amount - Current Stage Amount"
          />
        </div>
      )}
      <div className="relative mt-1 flex-1 flex flex-col justify-center min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full flex-1 min-h-[280px] drop-shadow-md" preserveAspectRatio="xMidYMid meet">
          <defs>
            {Object.entries(STAGE_METADATA_MAP).map(([_k, m]) => (
              <linearGradient key={m.gradId} id={m.gradId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={m.color1} stopOpacity={c.isDark ? '0.85' : '0.95'} />
                <stop offset="100%" stopColor={m.color2} stopOpacity={c.isDark ? '0.85' : '0.95'} />
              </linearGradient>
            ))}
          </defs>
          {rows.map((d, i) => {
            const bW = scale(d.amount);
            const y = PAD_Y + i * (barH + gap);
            const prev = i > 0 ? Number(rows[i - 1].amount || 0) : d.amount;
            const diff = prev - d.amount;
            const key = (d.stage || '').toLowerCase().trim();
            const meta = STAGE_METADATA_MAP[key] || { gradId: 'ff-emerald', color1: '#059669', color2: '#10b981', diffLabel: 'Stage Delta' };
            const prevKey = i > 0 ? (rows[i - 1].stage || '').toLowerCase().trim() : key;
            const prevMeta = STAGE_METADATA_MAP[prevKey] || meta;

            const labelColor = d.isRefund ? '#34d399' : c.labelNormal;
            const valueColor = d.isRefund ? '#34d399' : c.labelStrong;
            const connectorY = y - Math.min(10, gap / 2);

            return (
              <g key={i}>
                <text x={PAD_LEFT - 14} y={y + 14} textAnchor="end" fill={labelColor} fontSize="9" fontWeight="bold" letterSpacing="0.5">
                  {d.isRefund ? `↩ ${d.stage.toUpperCase()}` : d.stage.toUpperCase()}
                </text>

                <rect
                  x={PAD_LEFT}
                  y={y}
                  width={Math.max(2, bW)}
                  height={barH}
                  rx={5}
                  fill={`url(#${meta.gradId})`}
                  className="transition-all duration-300 hover:fill-opacity-90"
                />

                <text x={PAD_LEFT + bW + 10} y={y + 14} fill={valueColor} fontSize="9" fontWeight="extrabold" className="font-mono">
                  {fmtCr(d.amount)}
                </text>

                {i > 0 && diff > 0 && !d.isRefund && (
                  <g>
                    <path
                      d={`M ${PAD_LEFT + scale(prev)} ${connectorY - 6} L ${PAD_LEFT + scale(prev)} ${connectorY} L ${PAD_LEFT + bW} ${connectorY}`}
                      fill="none"
                      stroke={c.isDark ? '#475569' : '#94a3b8'}
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={PAD_LEFT + scale(prev) + 8}
                      y={connectorY - 8}
                      fill={c.isDark ? '#cbd5e1' : '#475569'}
                      fontSize="8"
                      fontWeight="bold"
                      className="font-mono"
                    >
                      {prevMeta.diffLabel}: {fmtCr(diff)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default FundFlowWaterfallChart;
