import React from 'react';
import FundRequestStatusBadge from './FundRequestStatusBadge';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const formatDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const FundRequestTable = ({ requests, user, onCancelClick, onActionClick }) => {
  const isHoOrAdmin = user?.role === 'ho' || user?.role === 'admin';
  const isZoOrAdmin = user?.role === 'zo' || user?.role === 'staff' || user?.role === 'admin';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-500">
            {['Request No.', 'Date', 'Requested Amount', 'Status', 'ZO Remarks', 'HO Approved Amount', 'Account', 'HO Remarks', 'Actions'].map((h) => (
              <th key={h} className="py-4 px-5 font-extrabold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-xs text-slate-300">
          {requests.map((req) => {
            const isPending = req.request_status === 'Pending';
            const canCancel = isPending && isZoOrAdmin;
            const canAct = isPending && isHoOrAdmin;
            return (
              <tr key={req.fund_request_id} className="hover:bg-white/[0.025] transition-colors duration-200 group">
                <td className="py-4 px-5 font-mono font-semibold text-slate-100 whitespace-nowrap">
                  {req.zo_fr_no}
                </td>
                <td className="py-4 px-5 text-[11px] text-slate-400 whitespace-nowrap">
                  {formatDate(req.zo_date)}
                </td>
                <td className="py-4 px-5 font-mono font-bold text-slate-200 whitespace-nowrap">
                  {formatCurrency(req.zo_fr_amount)}
                </td>
                <td className="py-4 px-5 whitespace-nowrap">
                  <FundRequestStatusBadge status={req.request_status} />
                </td>
                <td className="py-4 px-5 max-w-[150px]">
                  <span className="block truncate text-slate-400" title={req.zo_remarks}>{req.zo_remarks || '—'}</span>
                </td>
                <td className="py-4 px-5 font-mono font-bold text-emerald-400 whitespace-nowrap">
                  {formatCurrency(req.approve_ho_amount)}
                </td>
                <td className="py-4 px-5 whitespace-nowrap">
                  {req.transfer_from_account ? (
                    <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/25 text-blue-400 font-mono text-[10px] font-bold">
                      {req.transfer_from_account}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-4 px-5 max-w-[150px]">
                  <span className="block truncate text-slate-400" title={req.ho_remarks}>{req.ho_remarks || '—'}</span>
                </td>
                <td className="py-4 px-5 whitespace-nowrap">
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
                    {!canCancel && !canAct && '—'}
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
