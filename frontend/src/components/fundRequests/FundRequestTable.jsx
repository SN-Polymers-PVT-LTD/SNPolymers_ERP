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
      <TableHeader>
        <TableRow hover={false}>
          <TableCell isHeader={true} className="w-8">
            <input type="checkbox" className="rounded bg-slate-900 border-white/10 text-amber-500 focus:ring-0 cursor-pointer" readOnly />
          </TableCell>
           {['Fund Request Order No', 'Work Order No', 'Zonal Office', 'Requested Amount', 'Approved Amount', 'Request Date', 'Current Status', 'Actions'].map((h) => (
            <TableCell key={h} isHeader={true}>
              {h}
            </TableCell>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
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
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="rounded bg-slate-900 border-white/10 text-amber-500 focus:ring-0 cursor-pointer" readOnly />
              </TableCell>
              <TableCell className="font-mono font-semibold text-slate-100">
                {req.zo_fr_no}
              </TableCell>
              <TableCell className="font-mono text-[11px] text-slate-300">
                {req.work_order_no || '—'}
              </TableCell>
              <TableCell className="text-xs font-semibold text-slate-300">
                {req.zo_name || '—'}
              </TableCell>
              <TableCell className="font-mono font-bold text-slate-200">
                {formatCurrency(req.zo_fr_amount)}
              </TableCell>
              <TableCell className="font-mono font-bold text-emerald-400">
                {formatCurrency(req.approve_ho_amount)}
              </TableCell>
              <TableCell className="text-[11px] text-slate-400">
                {formatDate(req.zo_date)}
              </TableCell>
              <TableCell>
                <FundRequestStatusBadge status={req.request_status} />
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  {canAct && (
                    <Button
                      variant="success"
                      size="xs"
                      onClick={() => onActionClick ? onActionClick(req) : onRowClick && onRowClick(req)}
                    >
                      Take Action
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => onCancelClick(req.fund_request_id, req.zo_fr_no)}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => onRowClick && onRowClick(req)}
                    title="View Details"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
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
