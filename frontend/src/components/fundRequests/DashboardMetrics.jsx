import React from 'react';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—';

const DashboardMetrics = ({ requests }) => {
  const totalCount = requests.length;
  const pendingCount = requests.filter(r => r.request_status === 'Pending').length;
  
  // Calculate MoM percentage change for Total Fund Requests
  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const thisMonthRequests = requests.filter(r => {
    const d = new Date(r.zo_date || r.created_at);
    return d >= startOfThisMonth;
  });

  const lastMonthRequests = requests.filter(r => {
    const d = new Date(r.zo_date || r.created_at);
    return d >= startOfLastMonth && d < startOfThisMonth;
  });

  const thisMonthCount = thisMonthRequests.length;
  const lastMonthCount = lastMonthRequests.length;

  let totalTrendText = '+0% this month';
  let totalTrendColor = 'text-slate-400';

  if (thisMonthCount > 0 || lastMonthCount > 0) {
    if (lastMonthCount === 0) {
      totalTrendText = `+${thisMonthCount} new this month`;
      totalTrendColor = 'text-emerald-400';
    } else {
      const pctChange = Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 100);
      if (pctChange > 0) {
        totalTrendText = `+${pctChange}% this month`;
        totalTrendColor = 'text-emerald-400';
      } else if (pctChange < 0) {
        totalTrendText = `${pctChange}% this month`;
        totalTrendColor = 'text-red-400';
      } else {
        totalTrendText = '0% change this MoM';
        totalTrendColor = 'text-slate-400';
      }
    }
  }

  // Pending action trend
  const pendingTrendText = pendingCount > 0 ? `${pendingCount} awaiting action` : 'All caught up';
  const pendingTrendColor = pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400';

  // Approved This Month (filtered by approval date this month)
  const approvedThisMonthList = requests.filter(
    r => r.request_status === 'Approved' && r.approve_ho_date && new Date(r.approve_ho_date) >= startOfThisMonth
  );
  const approvedSumThisMonth = approvedThisMonthList.reduce((sum, r) => sum + Number(r.approve_ho_amount || 0), 0);
  const approvedCountThisMonth = approvedThisMonthList.length;
  const approvedTrendText = `${approvedCountThisMonth} request${approvedCountThisMonth !== 1 ? 's' : ''} approved`;

  // Funds on hold trend and sum
  const holdSum = requests
    .filter(r => r.request_status === 'Hold')
    .reduce((sum, r) => sum + Number(r.zo_fr_amount || 0), 0);
  const holdCount = requests.filter(r => r.request_status === 'Hold').length;
  const holdTrendText = holdCount > 0 ? `${holdCount} request${holdCount !== 1 ? 's' : ''} on hold` : '0 requests on hold';
  const holdTrendColor = holdCount > 0 ? 'text-red-400' : 'text-slate-400';

  const metrics = [
    {
      label: 'Total Fund Requests',
      value: totalCount,
      trend: totalTrendText,
      trendColor: totalTrendColor,
      icon: (
        <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      )
    },
    {
      label: 'Pending Approval',
      value: pendingCount,
      trend: pendingTrendText,
      trendColor: pendingTrendColor,
      icon: (
        <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      label: 'Approved This Month',
      value: formatCurrency(approvedSumThisMonth),
      trend: approvedTrendText,
      trendColor: 'text-emerald-400',
      icon: (
        <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      label: 'Funds On Hold',
      value: formatCurrency(holdSum),
      trend: holdTrendText,
      trendColor: holdTrendColor,
      icon: (
        <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      )
    }
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {metrics.map((m) => (
        <div key={m.label} className="glass-panel rounded-2xl p-4 border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent flex flex-col justify-between text-left">
          <div className="flex justify-between items-start gap-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-tight">{m.label}</span>
            <div className="p-1 rounded-lg bg-white/[0.02] border border-white/5 shrink-0">
              {m.icon}
            </div>
          </div>
          <div className="mt-4">
            <p className="font-black text-slate-100 text-lg sm:text-xl tracking-tight leading-none">{m.value}</p>
            <span className={`text-[8px] font-bold uppercase tracking-wider block mt-1.5 ${m.trendColor}`}>
              {m.trend}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DashboardMetrics;
