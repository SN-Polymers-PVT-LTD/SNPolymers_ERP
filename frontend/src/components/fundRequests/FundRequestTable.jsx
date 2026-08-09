import React from 'react';
import { Table, TableHeader, TableBody, TableRow, TableCell, Button } from '../ui';
import FundRequestStatusBadge from './FundRequestStatusBadge';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const FundRequestTable = ({ requests, user, onRowClick, onActionClick, onCancelClick }) => {
  const isHoOrAdmin = user?.role === 'ho' || user?.role === 'admin';
  const isZoOrAdmin = user?.role === 'zo' || user?.role === 'staff' || user?.role === 'admin';

  return (
    <Table>
      <TableHeader className="bg-slate-900/90 border-b border-white/10">
        <TableRow hover={false} className="border-b border-white/10 bg-slate-900/90">
           {['FR Order No', 'Work Order No', 'Work Order Value', 'Estimated Value', 'Zonal Office', 'Requested Amount', 'Approved Amount', 'Request Date', 'Status', 'Actions'].map((h) => (
            <TableCell key={h} isHeader={true} className="text-slate-300 font-black uppercase tracking-widest text-[10px] py-3.5 px-3 bg-slate-900/90 whitespace-nowrap">
              {h}
            </TableCell>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody className="divide-y divide-white/5">
        {requests.map((req) => {
          const isPending = req.request_status === 'Pending';
          const isHold = req.request_status === 'Hold';
          const canCancel = isPending && isZoOrAdmin;
          const canAct = (isPending || isHold) && isHoOrAdmin;

          return (
            <TableRow 
              key={req.fund_request_id} 
              onClick={() => onRowClick && onRowClick(req)}
              interactive={true}
              className="hover:bg-gradient-to-r hover:from-amber-500/10 hover:via-white/[0.03] hover:to-transparent border-l-2 border-l-transparent hover:border-l-amber-400 transition-all duration-200 border-b border-white/5 group"
            >
              <TableCell className="py-3 px-3 whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5 font-mono font-extrabold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md text-xs tracking-tight shadow-inner group-hover:border-amber-400/40 group-hover:bg-amber-500/20 transition-all">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  {req.zo_fr_no}
                </span>
              </TableCell>
              <TableCell className="py-3 px-3 whitespace-nowrap">
                {req.work_order_no ? (
                  <span className="font-mono text-slate-200 font-semibold bg-white/5 border border-white/10 px-2 py-0.5 rounded-md text-xs hover:border-amber-500/30 transition-colors">
                    {req.work_order_no}
                  </span>
                ) : (
                  <span className="text-slate-600 font-bold">—</span>
                )}
              </TableCell>
              {/* Work Order Value — item 4(a) */}
              <TableCell className="py-3 px-3 font-mono font-black text-violet-400 text-xs tracking-tight whitespace-nowrap">
                {req.work_order_value != null ? formatCurrency(req.work_order_value) : <span className="text-slate-600 font-bold">—</span>}
              </TableCell>
              {/* Estimated Value — item 4(a) */}
              <TableCell className="py-3 px-3 font-mono font-black text-sky-400 text-xs tracking-tight whitespace-nowrap">
                {req.estimated_value != null ? formatCurrency(req.estimated_value) : <span className="text-slate-600 font-bold">—</span>}
              </TableCell>
              <TableCell className="py-3 px-3 whitespace-nowrap">
                <span className="bg-sky-500/10 text-sky-300 border border-sky-500/20 px-2 py-0.5 rounded-full text-xs font-bold inline-block">
                  {req.zo_name || 'ZO User'}
                </span>
              </TableCell>
              <TableCell className="py-3 px-3 font-mono font-black text-amber-400 text-xs tracking-tight whitespace-nowrap">
                {formatCurrency(req.zo_fr_amount)}
              </TableCell>
              <TableCell className="py-3 px-3 font-mono font-black text-emerald-400 text-xs tracking-tight whitespace-nowrap">
                {req.approve_ho_amount ? (
                  formatCurrency(req.approve_ho_amount)
                ) : (
                  <span className="text-slate-600 font-bold">—</span>
                )}
              </TableCell>
              <TableCell className="py-3 px-3 text-xs text-slate-300 font-semibold whitespace-nowrap">
                {formatDate(req.zo_date)}
              </TableCell>
              <TableCell className="py-3 px-3 whitespace-nowrap">
                <FundRequestStatusBadge status={req.request_status} />
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()} className="py-3 px-3 whitespace-nowrap">
                <div className="flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity duration-200">
                  {canAct && (
                    <Button
                      variant="glass"
                      size="xs"
                      className="text-slate-950 font-black bg-amber-500 hover:bg-amber-400 border border-amber-400 shadow-md shadow-amber-500/20 px-2 py-1"
                      onClick={() => onActionClick ? onActionClick(req) : onRowClick && onRowClick(req)}
                    >
                      Take Action
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="danger"
                      size="xs"
                      className="bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/30 font-bold px-2 py-1"
                      onClick={() => onCancelClick(req.fund_request_id, req.zo_fr_no)}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    variant="glass"
                    size="xs"
                    className="bg-white/10 hover:bg-white/20 text-slate-100 font-extrabold border border-white/15 shadow-sm px-2 py-1"
                    onClick={() => onRowClick && onRowClick(req)}
                    title="View Details"
                  >
                    View
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

export default FundRequestTable;
