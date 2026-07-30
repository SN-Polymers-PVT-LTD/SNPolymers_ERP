import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../ThemeContext';
import Pagination from '../../ui/Pagination';
import { ChartInfoTooltip } from '../ui/ChartInfoTooltip';
import { fmtCr } from '../utils/formatters';

export const InvestmentRecoveryPlot = ({
  projects = [],
  agencyPaymentAmount = 0,
  isModal = false,
  showBillRecoveryKpi = false
}) => {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState('summary');
  const [woPage, setWoPage] = useState(1);
  const [searchWo, setSearchWo] = useState('');
  const pageSize = 4;

  const metrics = useMemo(() => {
    const pList = projects || [];
    const totalProjectsCount = pList.length;
    const woValue = pList.reduce((a, p) => a + Number(p.work_order_value || 0), 0);
    const investment = pList.reduce(
      (a, p) => a + Number(p.approved_requisitions_amount || p.requisition_amount || p.approved_amount || 0),
      0
    );
    const grossBilled = pList.reduce((a, p) => a + Number(p.gross_billed || 0), 0);
    const billReceived = pList.reduce((a, p) => a + Number(p.agency_payment ?? p.agency_paid ?? 0), 0);

    const pendingRecovery = Math.max(0, investment - billReceived);
    const surplusRecovery = Math.max(0, billReceived - investment);
    const remainingWOValue = Math.max(0, woValue - investment);
    const deductions = Math.max(0, grossBilled - billReceived);

    const investmentPct = woValue > 0 ? ((investment / woValue) * 100).toFixed(1) : '0.0';
    const disbursementPct = woValue > 0 ? ((billReceived / woValue) * 100).toFixed(1) : '0.0';
    const recoveryAgainstInvestPct = investment > 0 ? ((billReceived / investment) * 100).toFixed(1) : '0.0';
    const recoveryBarPct = Math.min(100, Number(recoveryAgainstInvestPct));
    const rawDeductionRate = grossBilled > 0 ? (deductions / grossBilled) * 100 : 0;
    const deductionRate = Math.min(100, Math.max(0, rawDeductionRate)).toFixed(1);

    const getProgressBand = (prog, status) => {
      const p = Number(prog || 0);
      if (p > 100 || status === 'Critical')
        return { label: '>100% Over Budget', color: '#EF4444', bg: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
      if (p === 100)
        return { label: '100% Completed', color: '#16A34A', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
      if (p >= 81)
        return { label: `${p}% Excellent`, color: '#10B981', bg: 'bg-teal-500/15 text-teal-400 border-teal-500/30' };
      if (p >= 61)
        return { label: `${p}% Very Good`, color: '#15803D', bg: 'bg-emerald-600/15 text-emerald-300 border-emerald-600/30' };
      if (p >= 41)
        return { label: `${p}% Good`, color: '#22C55E', bg: 'bg-green-500/15 text-green-400 border-green-500/30' };
      if (p >= 21)
        return { label: `${p}% Fair`, color: '#EAB308', bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
      if (p >= 1)
        return { label: `${p}% Initial`, color: '#3B82F6', bg: 'bg-sky-500/15 text-sky-400 border-sky-500/30' };
      return { label: '0% Not Started', color: '#64748B', bg: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
    };

    const rawBands = [
      { label: '0% Not Started', color: '#64748B', count: pList.filter((p) => !p.physical_progress || p.physical_progress === 0).length },
      { label: '1–20% Initial Stage', color: '#3B82F6', count: pList.filter((p) => p.physical_progress > 0 && p.physical_progress <= 20).length },
      { label: '21–40% Fair', color: '#EAB308', count: pList.filter((p) => p.physical_progress > 20 && p.physical_progress <= 40).length },
      { label: '41–60% Good', color: '#22C55E', count: pList.filter((p) => p.physical_progress > 40 && p.physical_progress <= 60).length },
      { label: '61–80% Very Good', color: '#15803D', count: pList.filter((p) => p.physical_progress > 60 && p.physical_progress <= 80).length },
      { label: '81–99% Excellent', color: '#10B981', count: pList.filter((p) => p.physical_progress > 80 && p.physical_progress < 100).length },
      { label: '100% Completed', color: '#16A34A', count: pList.filter((p) => p.physical_progress === 100).length },
      { label: '>100% Over Budget', color: '#EF4444', count: pList.filter((p) => p.physical_progress > 100 || p.health_status === 'Critical').length },
    ];

    const bands = rawBands.map((b) => ({
      ...b,
      pct: totalProjectsCount > 0 ? ((b.count / totalProjectsCount) * 100).toFixed(1) : '0.0',
    }));

    const woItems = pList.map((p) => {
      const wVal = Number(p.work_order_value || 0);
      const inv = Number(p.approved_requisitions_amount || p.requisition_amount || p.approved_amount || 0);
      const rec = Number(p.agency_payment ?? p.agency_paid ?? 0);
      const pend = Math.max(0, inv - rec);
      const surplus = Math.max(0, rec - inv);
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
        surplusRecovery: surplus,
        remainingWOValue: rem,
        band,
        physical_progress: p.physical_progress || 0,
      };
    });

    return {
      totalProjects: totalProjectsCount,
      woValue,
      investment,
      grossBilled,
      billReceived,
      deductions,
      deductionRate,
      pendingRecovery,
      surplusRecovery,
      remainingWOValue,
      investmentPct,
      disbursementPct,
      recoveryAgainstInvestPct,
      recoveryBarPct,
      bands,
      woItems,
    };
  }, [projects, agencyPaymentAmount]);

  const filteredWos = useMemo(() => {
    const q = searchWo.toLowerCase().trim();
    if (!q) return metrics.woItems;
    return metrics.woItems.filter(
      (item) =>
        (item.work_order_no || '').toLowerCase().includes(q) ||
        (item.site_details || '').toLowerCase().includes(q) ||
        (item.department || '').toLowerCase().includes(q)
    );
  }, [metrics.woItems, searchWo]);

  const totalWoPages = Math.ceil(filteredWos.length / pageSize) || 1;
  const pagedWos = useMemo(() => {
    const start = (woPage - 1) * pageSize;
    return filteredWos.slice(start, start + pageSize);
  }, [filteredWos, woPage, pageSize]);

  return (
    <div className={isModal ? "w-full h-full flex flex-col justify-between p-2 sm:p-4 relative overflow-hidden" : "chart-panel h-full flex flex-col justify-between p-3.5 sm:p-5 relative overflow-hidden"}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3
            className="chart-title text-sm sm:text-base font-extrabold tracking-tight truncate"
            style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}
          >
            Investment &amp; Bill Recovery Realization
          </h3>
          <p className="chart-subtitle text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {viewMode === 'summary'
              ? 'Realization Ratios, Dual Scale Breakdown & Progress Distribution'
              : 'Work Order Wise Realization Breakdown'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setViewMode('summary')}
              className={`px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition ${
                viewMode === 'summary' ? 'bg-amber-500 text-black shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Summary
            </button>
            <button
              type="button"
              onClick={() => setViewMode('work_order')}
              className={`px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition ${
                viewMode === 'work_order' ? 'bg-amber-500 text-black shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              WO Wise ({metrics.woItems.length})
            </button>
          </div>

          <ChartInfoTooltip
            description="Capital investment vs bill recovery realization across work order progress bands."
            formula="Pending Recovery = Requisition Investment - Contractor Bill Payments Received"
          />
        </div>
      </div>

      {viewMode === 'summary' ? (
        <>
          {/* Top Formula KPI Cards */}
          <div
            className={`grid gap-2 my-2 ${
              showBillRecoveryKpi ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'
            }`}
          >
            <div
              className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between relative ${
                isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-amber-400 truncate">
                  Total Investment %
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 whitespace-nowrap">
                    Inv / WO
                  </span>
                  <ChartInfoTooltip
                    description="Percentage of total portfolio Work Order value that has been requested and approved for project execution."
                    formula="Total Investment % = (Approved Requisitions / Total WO Value) × 100"
                  />
                </div>
              </div>
              <p className="text-base sm:text-lg font-black font-mono text-amber-400 mt-1">{metrics.investmentPct}%</p>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">
                  Inv: <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{fmtCr(metrics.investment)}</strong>
                </span>
                <span className="text-slate-500 truncate">of {fmtCr(metrics.woValue)}</span>
              </p>
            </div>

            {showBillRecoveryKpi && (
              <div
                className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between relative ${
                  isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-1 min-w-0">
                  <p className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 truncate">
                    Bill Recovery %
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 whitespace-nowrap">
                      Rec / WO
                    </span>
                    <ChartInfoTooltip
                      description="Percentage of total portfolio Work Order value recovered through paid contractor bills."
                      formula="Bill Recovery % = (Agency Payments Realized / Total WO Value) × 100"
                    />
                  </div>
                </div>
                <p className="text-base sm:text-lg font-black font-mono text-emerald-400 mt-1">
                  {metrics.disbursementPct}%
                </p>
                <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                  <span className="truncate">
                    Rec: <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{fmtCr(metrics.billReceived)}</strong>
                  </span>
                  <span className="text-slate-500 truncate">of {fmtCr(metrics.woValue)}</span>
                </p>
              </div>
            )}

            <div
              className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between relative ${
                isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-teal-400 truncate">
                  Payment Disbursement %
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20 whitespace-nowrap">
                    Paid / WO
                  </span>
                  <ChartInfoTooltip
                    description="Percentage of total portfolio Work Order value that has actually been disbursed to agencies as net payment. Represents actual fund outflow rate against contracted value."
                    formula="Payment Disbursement % = (Net Agency Payments / Total WO Value) × 100"
                  />
                </div>
              </div>
              <p className="text-base sm:text-lg font-black font-mono text-teal-400 mt-1">{metrics.disbursementPct}%</p>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">
                  Paid: <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{fmtCr(metrics.billReceived)}</strong>
                </span>
                <span className="text-slate-500 truncate">of {fmtCr(metrics.woValue)}</span>
              </p>
            </div>

            <div
              className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between relative ${
                metrics.surplusRecovery > 0
                  ? isDark
                    ? 'bg-emerald-950/30 border-emerald-500/30'
                    : 'bg-emerald-50 border-emerald-300'
                  : isDark
                  ? 'bg-slate-900/80 border-white/10'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p
                  className={`text-[9px] font-extrabold uppercase tracking-wider truncate ${
                    metrics.surplusRecovery > 0 ? 'text-emerald-400' : 'text-sky-400'
                  }`}
                >
                  Agency Realization vs Investment
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <span
                    className={`text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                      metrics.surplusRecovery > 0
                        ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                        : 'bg-sky-500/10 text-sky-300 border border-sky-500/20'
                    }`}
                  >
                    Realized / Inv
                  </span>
                  <ChartInfoTooltip
                    description={
                      metrics.surplusRecovery > 0
                        ? 'Ratio of net agency payments received from client departments against approved site requisition investment. Shows revenue realization relative to invested capital.'
                        : 'Ratio of net agency payments received against approved requisition investment.'
                    }
                    formula="Realization vs Investment % = (Net Agency Payments / Approved Requisitions) × 100"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <p
                  className={`text-base sm:text-lg font-black font-mono ${
                    metrics.surplusRecovery > 0 ? 'text-emerald-400' : 'text-sky-400'
                  }`}
                >
                  {metrics.recoveryAgainstInvestPct}%
                </p>
                {metrics.surplusRecovery > 0 && (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
                    ✓ Surplus Realized
                  </span>
                )}
              </div>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">
                  Realized:{' '}
                  <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{fmtCr(metrics.billReceived)}</strong>
                  {metrics.surplusRecovery > 0 ? (
                    <span className="text-emerald-400 font-bold"> (+{fmtCr(metrics.surplusRecovery)} surplus)</span>
                  ) : (
                    <span className="text-rose-400 font-bold"> (Pend: {fmtCr(metrics.pendingRecovery)})</span>
                  )}
                </span>
                <span className="text-slate-500 truncate">of Inv: {fmtCr(metrics.investment)}</span>
              </p>
            </div>
          </div>

          {/* Gross Bill → Deductions → Net Paid Pipeline */}
          {metrics.grossBilled > 0 && (
            <div
              className={`my-2 p-2.5 rounded-xl border transition-all ${
                isDark ? 'border-white/5 bg-slate-950/40' : 'border-slate-200 bg-white/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p
                  className={`text-[8.5px] font-black uppercase tracking-wider font-mono ${
                    isDark ? 'text-slate-400' : 'text-slate-700'
                  }`}
                >
                  Gross Bill → Deductions → Net Paid Pipeline
                </p>
                <ChartInfoTooltip
                  description="Shows how gross billed amount reduces to net agency payment after statutory deductions (TDS, Security Deposit, GST, EMD etc.)."
                  formula="Deductions = Gross Bill Amount − Net Agency Payment"
                />
              </div>
              <div className="flex items-center gap-2 text-[8px] font-mono flex-wrap">
                <div
                  className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg border min-w-[80px] ${
                    isDark ? 'bg-sky-500/10 border-sky-500/20 text-sky-200' : 'bg-sky-50 border-sky-200 text-sky-900'
                  }`}
                >
                  <span className={`font-bold uppercase tracking-wider text-[7px] ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
                    Gross Billed
                  </span>
                  <span className={`font-black text-[11px] ${isDark ? 'text-sky-200' : 'text-sky-950'}`}>
                    {fmtCr(metrics.grossBilled)}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-rose-500 font-black text-[10px]">−</span>
                  <span className="text-rose-500 font-bold text-[7px] uppercase tracking-wider">{metrics.deductionRate}%</span>
                </div>
                <div
                  className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg border min-w-[80px] ${
                    isDark ? 'bg-rose-500/10 border-rose-500/20 text-rose-200' : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <span className={`font-bold uppercase tracking-wider text-[7px] ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>
                    Deductions
                  </span>
                  <span className={`font-black text-[11px] ${isDark ? 'text-rose-200' : 'text-rose-950'}`}>
                    {fmtCr(metrics.deductions)}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-emerald-500 font-black text-[10px]">→</span>
                </div>
                <div
                  className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg border min-w-[80px] ${
                    isDark
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <span className={`font-bold uppercase tracking-wider text-[7px] ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                    Net Agency Paid
                  </span>
                  <span className={`font-black text-[11px] ${isDark ? 'text-emerald-200' : 'text-emerald-950'}`}>
                    {fmtCr(metrics.billReceived)}
                  </span>
                </div>
                <div className="flex-1 min-w-[80px]">
                  <div className={`h-2 w-full rounded-full overflow-hidden flex ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                    <div
                      style={{
                        width: `${metrics.grossBilled > 0 ? ((metrics.billReceived / metrics.grossBilled) * 100).toFixed(1) : 0}%`,
                      }}
                      className="bg-emerald-500 h-full"
                      title={`Net Paid: ${fmtCr(metrics.billReceived)}`}
                    />
                    <div
                      style={{ width: `${metrics.deductionRate}%` }}
                      className="bg-rose-500/70 h-full"
                      title={`Deductions: ${fmtCr(metrics.deductions)} (${metrics.deductionRate}%)`}
                    />
                  </div>
                  <p className={`text-[7.5px] mt-0.5 font-mono ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
                    Net retained:{' '}
                    {metrics.grossBilled > 0 ? (100 - Number(metrics.deductionRate)).toFixed(1) : 0}% of Gross
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Dual Realization Progress Bars */}
          <div
            className={`my-2 space-y-2 p-2.5 rounded-xl border transition-all ${
              isDark ? 'border-white/5 bg-slate-950/40' : 'border-slate-200 bg-white/80'
            }`}
          >
            {/* Bar 1: Investment vs Remaining WO Value */}
            <div>
              <div
                className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[8.5px] font-bold uppercase mb-1 font-mono ${
                  isDark ? 'text-slate-400' : 'text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="truncate">1. Capital Investment Realization</span>
                  <ChartInfoTooltip
                    description="Visual breakdown of total investment disbursed against overall portfolio work order capacity."
                    formula="Remaining WO Value = Total WO Value - Approved Requisition Investment"
                  />
                </div>
                <span className={`shrink-0 ${isDark ? 'text-slate-300' : 'text-slate-900'}`}>
                  WO Value: {fmtCr(metrics.woValue)}
                </span>
              </div>
              <div className={`h-3 w-full rounded-full overflow-hidden flex ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
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
              <div
                className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mt-1 text-[8px] font-mono ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                <span className="flex items-center gap-1 truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" /> Total Inv:{' '}
                  {fmtCr(metrics.investment)} ({metrics.investmentPct}%)
                </span>
                <span className="flex items-center gap-1 truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500/30 shrink-0" /> Remaining:{' '}
                  {fmtCr(metrics.remainingWOValue)}
                </span>
              </div>
            </div>

            {/* Bar 2: Recovery Realization against Total Investment */}
            <div className={`border-t pt-1.5 ${isDark ? 'border-white/5' : 'border-slate-200'}`}>
              <div
                className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[8.5px] font-bold uppercase mb-1 font-mono ${
                  isDark ? 'text-slate-400' : 'text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="truncate">2. Recovery Realization (Investment Pool)</span>
                  <ChartInfoTooltip
                    description="Visual realization of actual contractor bill payments recovered against the disbursed investment pool."
                    formula="Pending Recovery = Approved Requisitions - Agency Billed Payments"
                  />
                </div>
                <span className={`shrink-0 ${isDark ? 'text-slate-300' : 'text-slate-900'}`}>
                  Pool: {fmtCr(metrics.investment)}
                </span>
              </div>
              <div className={`h-3 w-full rounded-full overflow-hidden flex ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                <div
                  style={{ width: `${Math.max(1, metrics.recoveryBarPct)}%` }}
                  className="bg-emerald-500 h-full transition-all duration-500"
                  title={`Agency Paid: ${fmtCr(metrics.billReceived)} (${metrics.recoveryAgainstInvestPct}% of Investment)`}
                />
                {metrics.pendingRecovery > 0 && (
                  <div
                    style={{ width: `${Math.max(0, 100 - metrics.recoveryBarPct)}%` }}
                    className="bg-rose-500/80 h-full transition-all duration-500"
                    title={`Pending Bill Recovery: ${fmtCr(metrics.pendingRecovery)}`}
                  />
                )}
              </div>
              <div
                className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mt-1 text-[8px] font-mono ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                <span className="flex items-center gap-1 truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /> Agency Paid:{' '}
                  {fmtCr(metrics.billReceived)} ({metrics.recoveryAgainstInvestPct}%)
                </span>
                {metrics.surplusRecovery > 0 ? (
                  <span className="flex items-center gap-1 truncate text-emerald-500 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /> Surplus: +
                    {fmtCr(metrics.surplusRecovery)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500/80 shrink-0" /> Pending:{' '}
                    {fmtCr(metrics.pendingRecovery)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Work Order Physical Progress Stage Bands Breakdown */}
          <div
            className={`mt-2 p-2.5 rounded-xl border transition-all ${
              isDark ? 'border-white/5 bg-slate-950/40' : 'border-slate-200 bg-white/80'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <p
                className={`text-[8.5px] font-black uppercase tracking-wider font-mono ${
                  isDark ? 'text-slate-400' : 'text-slate-700'
                }`}
              >
                Work Order Distribution across Progress Stages ({metrics.totalProjects} Projects)
              </p>
              <ChartInfoTooltip
                description="Distribution of portfolio work orders across physical completion stages."
                formula="Stage Share % = (Work Orders in Band / Total Projects) × 100"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[8px] font-mono">
              {metrics.bands.map((b, i) => (
                <div
                  key={i}
                  className={`p-1.5 rounded-lg border flex flex-col justify-between transition-all ${
                    isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`font-bold truncate text-[7.5px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}
                      title={b.label}
                    >
                      {b.label}
                    </span>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: b.color }}
                    />
                  </div>
                  <div className="flex items-baseline justify-between gap-1 mt-1">
                    <span className={`font-black text-sm ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{b.count}</span>
                    <span className="text-[7.5px] text-slate-400">{b.pct}%</span>
                  </div>
                  <div className={`h-1 w-full rounded-full overflow-hidden mt-1 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                    <div
                      style={{ width: `${b.pct}%`, backgroundColor: b.color }}
                      className="h-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* Work Order Wise Breakdown View */
        <div className="flex-1 flex flex-col justify-between my-2">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <input
                type="text"
                placeholder="Search WO No, site, or dept..."
                value={searchWo}
                onChange={(e) => {
                  setSearchWo(e.target.value);
                  setWoPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl border text-[10px] w-full sm:w-64 focus:outline-none transition ${
                  isDark
                    ? 'bg-slate-900/80 border-white/10 text-slate-200 placeholder-slate-500 focus:border-amber-500/50'
                    : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400 focus:border-amber-500/50'
                }`}
              />
              <span className={`text-[9px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Showing {pagedWos.length} of {filteredWos.length} Work Orders
              </span>
            </div>

            <div className="space-y-2">
              {pagedWos.length === 0 ? (
                <div
                  className={`text-center py-8 text-xs font-bold uppercase tracking-wider ${
                    isDark ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  No work orders matching search criteria
                </div>
              ) : (
                pagedWos.map((item) => (
                  <div
                    key={item.work_order_no}
                    onClick={() => navigate(`/projects/${item.work_order_no}/digital-twin`)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer group ${
                      isDark
                        ? 'bg-slate-900/60 border-white/5 hover:border-white/15 hover:bg-slate-900/90'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-mono text-xs font-black group-hover:underline ${
                              isDark ? 'text-amber-400' : 'text-amber-600'
                            }`}
                          >
                            {item.work_order_no}
                          </span>
                          <span className={`px-2 py-0.5 rounded-md text-[8px] font-bold border ${item.band.bg}`}>
                            {item.band.label}
                          </span>
                        </div>
                        <p
                          className={`text-[9.5px] truncate mt-0.5 ${
                            isDark ? 'text-slate-300' : 'text-slate-700 font-medium'
                          }`}
                        >
                          {item.site_details || 'Site Project'} •{' '}
                          <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                            {item.department || 'General'}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 font-mono text-[9px]">
                        <div className="text-right">
                          <span className="text-[7.5px] uppercase font-bold text-slate-400 block">WO Value</span>
                          <span className={`font-black ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>
                            {fmtCr(item.woValue)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[7.5px] uppercase font-bold text-slate-400 block">Approved Inv</span>
                          <span className="font-black text-amber-400">{fmtCr(item.investment)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[7.5px] uppercase font-bold text-slate-400 block">Agency Paid</span>
                          <span className="font-black text-emerald-400">{fmtCr(item.billReceived)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar & Recovery Indicator */}
                    <div className="space-y-1">
                      <div className={`h-2 w-full rounded-full overflow-hidden flex ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                        <div
                          style={{
                            width: `${item.woValue > 0 ? Math.min(100, (item.investment / item.woValue) * 100) : 0}%`,
                          }}
                          className="bg-amber-500 h-full"
                          title={`Investment: ${fmtCr(item.investment)}`}
                        />
                      </div>
                      <div
                        className={`flex items-center justify-between text-[7.5px] font-mono ${
                          isDark ? 'text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        <span>
                          Inv Share: {item.woValue > 0 ? ((item.investment / item.woValue) * 100).toFixed(1) : 0}% of WO
                        </span>
                        {item.surplusRecovery > 0 ? (
                          <span className="text-emerald-400 font-bold">✓ Surplus: +{fmtCr(item.surplusRecovery)}</span>
                        ) : item.pendingRecovery > 0 ? (
                          <span className="text-rose-400 font-bold">Pending: {fmtCr(item.pendingRecovery)}</span>
                        ) : (
                          <span className="text-emerald-400 font-bold">✓ Fully Recovered</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Centralized Pagination Primitive (§3.2 Guidelines Compliance) */}
          <div className="mt-3">
            <Pagination
              currentPage={woPage}
              totalPages={totalWoPages}
              onPageChange={setWoPage}
              showLabel={true}
              totalRecords={filteredWos.length}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default InvestmentRecoveryPlot;
