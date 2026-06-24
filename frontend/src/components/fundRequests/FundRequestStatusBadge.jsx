import React from 'react';

export const STATUS_CONFIG = {
  Pending: { className: 'amber', label: 'Pending', dot: 'bg-amber-400', pill: 'bg-amber-500/10 border-amber-500/25 text-amber-400' },
  Approved: { className: 'green', label: 'Approved', dot: 'bg-emerald-400', pill: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' },
  Hold: { className: 'red', label: 'Hold', dot: 'bg-red-400', pill: 'bg-red-500/10 border-red-500/25 text-red-400' },
  Cancelled: { className: 'grey', label: 'Cancelled', dot: 'bg-slate-400', pill: 'bg-slate-500/10 border-slate-500/25 text-slate-400' }
};

const FundRequestStatusBadge = ({ status }) => {
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG['Pending'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

export default FundRequestStatusBadge;
