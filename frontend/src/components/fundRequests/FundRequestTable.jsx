import React from 'react';
import FundRequestStatusBadge from './FundRequestStatusBadge';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const MOCK_PROJECTS = [
  { name: 'Mumbai Metro Line 9 Extension', zone: 'West Zone', ho: 'Ashwin Guha' },
  { name: 'Delhi Water Treatment Plant Phase 3', zone: 'North Zone', ho: 'A. Gupta' },
  { name: 'Kolkata Flyover Rehabilitation', zone: 'East Zone', ho: 'Ashwin Guha' },
  { name: 'Chennai Smart City Drainage Link', zone: 'South Zone', ho: 'A. Gupta' },
  { name: 'Bengaluru Highway Corridor B', zone: 'South Zone', ho: 'Ashwin Guha' }
];

export const getMockProjectForRequest = (index) => {
  const idx = (index ?? 0) % MOCK_PROJECTS.length;
  return MOCK_PROJECTS[idx];
};

const FundRequestTable = ({ requests, user, onRowClick, onActionClick, onCancelClick }) => {
  const isHoOrAdmin = user?.role === 'ho' || user?.role === 'admin';
  const isZoOrAdmin = user?.role === 'zo' || user?.role === 'staff' || user?.role === 'admin';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-500">
            <th className="py-4 px-5 w-8">
              <input type="checkbox" className="rounded bg-slate-900 border-white/10 text-amber-500 focus:ring-0 cursor-pointer" readOnly />
            </th>
            {['Fund Request Order No', 'Requested Amount', 'Approved Amount', 'Request Date', 'Current Status', 'Actions'].map((h) => (
              <th key={h} className="py-4 px-5 font-extrabold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-xs text-slate-300">
          {requests.map((req, index) => {
            const isPending = req.request_status === 'Pending';
            const canCancel = isPending && isZoOrAdmin;
            const canAct = isPending && isHoOrAdmin;

            return (
              <tr 
                key={req.fund_request_id} 
                onClick={() => onRowClick && onRowClick(req)}
                className="hover:bg-white/[0.025] transition-colors duration-200 group cursor-pointer"
              >
                <td className="py-4 px-5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="rounded bg-slate-900 border-white/10 text-amber-500 focus:ring-0 cursor-pointer" readOnly />
                </td>
                <td className="py-4 px-5 font-mono font-semibold text-slate-100 whitespace-nowrap">
                  {req.zo_fr_no}
                </td>
                <td className="py-4 px-5 font-mono font-bold text-slate-200 whitespace-nowrap">
                  {formatCurrency(req.zo_fr_amount)}
                </td>
                <td className="py-4 px-5 font-mono font-bold text-emerald-400 whitespace-nowrap">
                  {formatCurrency(req.approve_ho_amount)}
                </td>
                <td className="py-4 px-5 text-[11px] text-slate-400 whitespace-nowrap">
                  {formatDate(req.zo_date)}
                </td>
                <td className="py-4 px-5 whitespace-nowrap">
                  <FundRequestStatusBadge status={req.request_status} />
                </td>
                <td className="py-4 px-5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    {canAct && (
                      <button
                        onClick={() => onActionClick(req)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all font-bold text-[10px] uppercase tracking-wider"
                      >
                        Take Action
                      </button>
                    )}
                    {canCancel && (
                      <button
                        onClick={() => onCancelClick(req.fund_request_id, req.zo_fr_no)}
                        className="px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all font-bold text-[10px] uppercase tracking-wider"
                      >
                        Cancel
                      </button>
                    )}
                    <button 
                      onClick={() => onRowClick && onRowClick(req)}
                      className="p-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/5 text-slate-400 hover:text-slate-200 transition-all"
                      title="View Details"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default FundRequestTable;
