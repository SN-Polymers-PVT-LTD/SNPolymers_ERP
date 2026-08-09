import React from 'react';
import { Table, TableHeader, TableBody, TableRow, TableCell, Button } from '../ui';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const WorkOrderFundSummaryTable = ({ rows, mode, onCreateRequest, isZoUser }) => {
  const isNotSent = mode === 'notSentToHo';

  const headers = isNotSent
    ? ['Work Order No', 'Zonal Office', 'Work Order Value', 'Estimated Value', 'FR Submitted']
    : ['Work Order No', 'Zonal Office', 'Estimated Value', 'Total FR Submitted', 'Remaining FR Amount'];

  return (
    <Table>
      <TableHeader className="bg-slate-900/90 border-b border-white/10">
        <TableRow hover={false} className="border-b border-white/10 bg-slate-900/90">
          {headers.map((h) => (
            <TableCell key={h} isHeader className="text-slate-300 font-black uppercase tracking-widest text-[10px] py-3.5 px-3 bg-slate-900/90 whitespace-nowrap">
              {h}
            </TableCell>
          ))}
          {isNotSent && isZoUser && (
            <TableCell isHeader className="text-slate-300 font-black uppercase tracking-widest text-[10px] py-3.5 px-3 bg-slate-900/90 whitespace-nowrap">
              Actions
            </TableCell>
          )}
        </TableRow>
      </TableHeader>
      <TableBody className="divide-y divide-white/5">
        {rows.map((row) => (
          <TableRow
            key={row.work_order_no}
            className="hover:bg-gradient-to-r hover:from-amber-500/10 hover:via-white/[0.03] hover:to-transparent border-b border-white/5"
          >
            <TableCell className="py-3 px-3 whitespace-nowrap">
              <span className="font-mono text-slate-200 font-semibold bg-white/5 border border-white/10 px-2 py-0.5 rounded-md text-xs">
                {row.work_order_no}
              </span>
            </TableCell>
            <TableCell className="py-3 px-3 whitespace-nowrap">
              <span className="bg-sky-500/10 text-sky-300 border border-sky-500/20 px-2 py-0.5 rounded-full text-xs font-bold inline-block">
                {row.zo_name || 'ZO User'}
              </span>
            </TableCell>
            {isNotSent ? (
              <>
                <TableCell className="py-3 px-3 font-mono font-black text-violet-400 text-xs whitespace-nowrap">
                  {row.work_order_value != null ? formatCurrency(row.work_order_value) : '—'}
                </TableCell>
                <TableCell className="py-3 px-3 font-mono font-black text-sky-400 text-xs whitespace-nowrap">
                  {row.estimated_value != null ? formatCurrency(row.estimated_value) : '—'}
                </TableCell>
                <TableCell className="py-3 px-3 text-xs font-bold text-rose-400 whitespace-nowrap">0</TableCell>
              </>
            ) : (
              <>
                <TableCell className="py-3 px-3 font-mono font-black text-sky-400 text-xs whitespace-nowrap">
                  {row.estimated_value != null ? formatCurrency(row.estimated_value) : '—'}
                </TableCell>
                <TableCell className="py-3 px-3 font-mono font-black text-amber-400 text-xs whitespace-nowrap">
                  {formatCurrency(row.total_fr_amount)}
                </TableCell>
                <TableCell className="py-3 px-3 font-mono font-black text-emerald-400 text-xs whitespace-nowrap">
                  {formatCurrency(row.remaining_amount)}
                </TableCell>
              </>
            )}
            {isNotSent && isZoUser && (
              <TableCell className="py-3 px-3 whitespace-nowrap">
                <Button
                  variant="glass"
                  size="xs"
                  className="text-slate-950 font-black bg-amber-500 hover:bg-amber-400 border border-amber-400"
                  onClick={() => onCreateRequest?.(row.work_order_no)}
                >
                  New Request
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default WorkOrderFundSummaryTable;
