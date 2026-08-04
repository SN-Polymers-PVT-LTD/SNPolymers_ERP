import React, { useMemo } from 'react';
import { useTheme } from '../../ThemeContext';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { fmtCr } from '../utils/formatters';

export const ExecutiveKpiStrip = ({ data = null, projects = [] }) => {
  const { isDark } = useTheme();

  const kpis = useMemo(() => {
    const pList = projects || [];

    // Client-side fallback metrics
    const fallbackWOVal = pList.reduce((a, p) => a + Number(p.work_order_value || 0), 0);
    const fallbackEst = pList.reduce(
      (a, p) => a + Number(p.approved_estimate_amount || (p.estimate_status === 'Final Approved' ? p.estimate_amount : 0) || p.estimate_amount || p.work_order_value || 0),
      0
    );
    const fallbackReq = pList.reduce((a, p) => a + Number(p.approved_requisitions_amount || p.requisition_amount || 0), 0);
    const fallbackApp = pList.reduce((a, p) => a + Number(p.approved_ho_amount || p.ho_allocated_amount || p.approve_ho_amount || p.approved_amount || 0), 0);
    const fallbackBal = pList.reduce((a, p) => a + Number(p.available_balance || p.balance || 0), 0);
    const fallbackRef = pList.reduce((a, p) => a + Number(p.excess_refunded_amount || p.total_refunded || p.refund_amount || 0), 0);
    const fallbackGB = pList.reduce((a, p) => a + Number(p.gross_billed || 0), 0);
    const fallbackAP = pList.reduce((a, p) => a + Number(p.agency_payment ?? p.agency_paid ?? 0), 0);
    const fallbackDue = Math.max(0, fallbackWOVal - fallbackGB);

    // Property-level resilient values
    const woVal = data?.totalWOValue ?? fallbackWOVal;
    const estVal = data?.totalEstimateAmount?.amount ?? fallbackEst;
    const reqVal = data?.totalRequisition?.amount ?? fallbackReq;
    const appVal = data?.totalApproved?.amount ?? fallbackApp;
    const balVal = data?.zoAvailableBalance ?? fallbackBal;
    const refVal = data?.totalRefundAmount ?? fallbackRef;
    const gbVal = data?.grossBillAmount?.amount ?? fallbackGB;
    const apVal = data?.agencyPayment?.amount ?? fallbackAP;
    const dueVal = data?.dueBill?.amount ?? fallbackDue;

    // Subtext calculations
    const estPct = data?.totalEstimateAmount?.pctOfWOValue ?? (woVal > 0 ? ((estVal / woVal) * 100).toFixed(1) : 0);
    const reqPct = data?.totalRequisition?.pctOfEstimate ?? (estVal > 0 ? ((reqVal / estVal) * 100).toFixed(1) : 0);
    const appPct = data?.totalApproved?.pctOfRequisition ?? (reqVal > 0 ? ((appVal / reqVal) * 100).toFixed(1) : 0);
    const gbPct = data?.grossBillAmount?.pctOfEstimate ?? (estVal > 0 ? ((gbVal / estVal) * 100).toFixed(1) : 0);
    const apPct = data?.agencyPayment?.pctOfGrossBill ?? (gbVal > 0 ? ((apVal / gbVal) * 100).toFixed(1) : 0);
    const duePct = data?.dueBill?.pctOfWOValue ?? (woVal > 0 ? ((dueVal / woVal) * 100).toFixed(1) : 0);

    return [
      {
        id: 'wo_value',
        title: 'TOTAL WO VALUE',
        description: 'Consolidated monetary value of all awarded work orders.',
        formula: 'Sum(work_order_value)',
        titleColor: '#34d399',
        topGlow: 'linear-gradient(90deg, #10b981 0%, rgba(16,185,129,0) 80%)',
        value: fmtCr(woVal),
        subtext: null,
      },
      {
        id: 'estimate',
        title: 'TOTAL ESTIMATE AMOUNT',
        description: 'Aggregated cost estimate value of final approved sheets.',
        formula: "Sum(estimate_amount where status = 'Final Approved')",
        titleColor: '#c084fc',
        topGlow: 'linear-gradient(90deg, #a855f7 0%, rgba(168,85,247,0) 80%)',
        value: fmtCr(estVal),
        subtext: `${estPct}% of WO Value`,
      },
      {
        id: 'requisition',
        title: 'TOTAL REQUISITION (ZO → JE)',
        description: 'Total site fund requisitions processed for Junior Engineers by Zonal Offices.',
        formula: "Sum(approved_amount where status = 'Approved')",
        titleColor: '#fb923c',
        topGlow: 'linear-gradient(90deg, #f97316 0%, rgba(249,115,22,0) 80%)',
        value: fmtCr(reqVal),
        subtext: `${reqPct}% of Estimate`,
      },
      {
        id: 'approved',
        title: 'TOTAL APPROVED (HO → ZO)',
        description: 'Total funds authorized and allocated from Head Office to Zones.',
        formula: "Sum(approve_ho_amount where status = 'Approved')",
        titleColor: '#fbbf24',
        topGlow: 'linear-gradient(90deg, #f59e0b 0%, rgba(245,158,11,0) 80%)',
        value: fmtCr(appVal),
        subtext: `${appPct}% of Req`,
      },
      {
        id: 'zo_balance',
        title: 'ZO AVAILABLE BALANCE',
        description: 'Liquid fund balance currently available across all Zonal Office ledgers.',
        formula: 'Sum(available_balance)',
        titleColor: '#38bdf8',
        topGlow: 'linear-gradient(90deg, #0284c7 0%, rgba(2,132,199,0) 80%)',
        value: fmtCr(balVal),
        subtext: null,
      },
      {
        id: 'refund',
        title: 'TOTAL REFUND AMOUNT',
        description: 'Unspent excess funds returned from Zonal Offices to Head Office.',
        formula: "Sum(transaction_type = 'RETURN')",
        titleColor: '#2dd4bf',
        topGlow: 'linear-gradient(90deg, #14b8a6 0%, rgba(20,184,166,0) 80%)',
        value: fmtCr(refVal),
        subtext: null,
      },
      {
        id: 'gross_bill',
        title: 'GROSS BILL AMOUNT',
        description: 'Gross contractor billings submitted across all work orders.',
        formula: 'Sum(gross_bill)',
        titleColor: '#f87171',
        topGlow: 'linear-gradient(90deg, #ef4444 0%, rgba(239,68,68,0) 80%)',
        value: fmtCr(gbVal),
        subtext: `${gbPct}% of Estimate`,
      },
      {
        id: 'agency_payment',
        title: 'AGENCY PAYMENT',
        description: 'Net payments disbursed to contractors after statutory withholdings.',
        formula: 'Sum(agency_payment)',
        titleColor: '#818cf8',
        topGlow: 'linear-gradient(90deg, #6366f1 0%, rgba(99,102,241,0) 80%)',
        value: fmtCr(apVal),
        subtext: `${apPct}% of Gross Bill`,
      },
      {
        id: 'due_bill',
        title: 'REMAINING BILL AMOUNT',
        description: 'Pending unbilled work order value exposure remaining in portfolio.',
        formula: 'Total WO Value - Gross Bill Amount',
        titleColor: '#ec4899',
        topGlow: 'linear-gradient(90deg, #db2777 0%, rgba(219,39,119,0) 80%)',
        value: fmtCr(dueVal),
        subtext: `${duePct}% of WO`,
      },
    ];

  }, [data, projects]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mb-6">
      {kpis.map((kpi) => (
        <div
          key={kpi.id}
          className={`relative p-3.5 rounded-2xl border flex flex-col justify-between transition-all duration-300 hover:-translate-y-0.5 overflow-hidden ${
            isDark
              ? 'bg-[#101520]/90 border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:border-white/20'
              : 'bg-white border-slate-200 shadow-sm hover:shadow-md'
          }`}
          style={{ minHeight: '135px' }}
        >
          {/* Colored Top Glow Accent Line */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: kpi.topGlow }} />

          {/* Top Right Corner Info Button */}
          <div className="absolute top-2.5 right-2.5 z-10">
            <ChartInfoTooltip description={kpi.description} formula={kpi.formula} />
          </div>

          {/* Title */}
          <p
            className="text-[9.5px] font-black tracking-wider uppercase leading-snug pr-6 truncate"
            style={{ color: kpi.titleColor }}
            title={kpi.title}
          >
            {kpi.title}
          </p>

          {/* Main Value */}
          <div className="my-auto py-1">
            <span className={`text-base xl:text-lg font-bold font-mono tracking-tight ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {kpi.value}
            </span>
          </div>

          {/* Subtext */}
          {kpi.subtext ? (
            <p
              className={`text-[9.5px] font-medium leading-tight whitespace-pre-line ${
                isDark ? 'text-slate-400/80' : 'text-slate-600'
              }`}
              title={kpi.subtext}
            >
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

export default ExecutiveKpiStrip;
