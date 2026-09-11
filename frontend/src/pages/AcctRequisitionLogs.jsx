import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../components/AuthContext';
import { Input, Badge, SkeletonTable, Pagination, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { getRequisitionLogs } from '../api/acctRequisitionsApi';

const LIMIT = 20;

const ACTION_STYLES = {
  LINE_ITEM_ADDED: { label: 'Item Added', variant: 'slate' },
  PENDING_HO_REVIEW_FIRST_SUBMIT: { label: 'Submitted', variant: 'blue' },
  PENDING_HO_REVIEW_ENTER: { label: 'Sent for Review', variant: 'blue' },
  RESUBMIT_AFTER_CORRECTION: { label: 'Resubmitted', variant: 'blue' },
  REOPEN: { label: 'Reopened', variant: 'amber' },
  HO_APPROVED: { label: 'Approved', variant: 'emerald' },
  HO_HELD: { label: 'On Hold', variant: 'amber' },
  HO_HOLD_RELEASED: { label: 'Hold Released', variant: 'amber' },
  HO_RETURNED: { label: 'Returned for Correction', variant: 'blue' },
  HO_REJECTED: { label: 'Rejected', variant: 'red' },
  STATUS_CHANGE: { label: 'Status Change', variant: 'slate' }
};

const formatINR = (value) => {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
};

const formatDateTime = (val) => (val ? new Date(val).toLocaleString('en-IN') : '—');

const AcctRequisitionLogs = () => {
  const { user } = useAuth();
  const canAccess = ['accounts', 'ho', 'admin'].includes(user?.role);

  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['acctRequisitionLogs', { page, dateFrom, dateTo }],
    queryFn: async () => {
      const params = { page, limit: LIMIT };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      return (await getRequisitionLogs(params)).data;
    },
    staleTime: 15 * 1000
  });

  if (!canAccess) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  const entries = data?.entries || [];
  const totalPages = data?.totalPages || 1;
  const totalCount = data?.totalCount || 0;
  const displayError = queryError?.response?.data?.message || queryError?.message || '';

  return (
    <>
      <div className="mb-8 pb-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · HO Approval
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Requisition Logs</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Full status-change history for every requisition line item — submissions, holds, approvals, rejections, resubmits and reopens.
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-64 shrink-0">
          <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col gap-4">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">From</span>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} size="sm" />
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">To</span>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} size="sm" />
            </div>
          </div>
        </div>

        <div className="flex-grow min-w-0">
          {displayError && (
            <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-4 flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              {displayError}
            </div>
          )}

          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Log Entries</h3>
            <span className="text-[10px] font-bold text-slate-500 font-mono">Found {totalCount} results</span>
          </div>

          {isLoading ? (
            <SkeletonTable rows={10} cols={6} />
          ) : entries.length === 0 ? (
            <div className="text-center py-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl">
              No log entries found.
            </div>
          ) : (
            <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
              <Table containerClassName="min-w-[900px]">
                <TableHeader>
                  <TableRow hover={false}>
                    <TableCell isHeader className="whitespace-nowrap">Timestamp</TableCell>
                    <TableCell isHeader>Sheet</TableCell>
                    <TableCell isHeader>Account Sub-title</TableCell>
                    <TableCell isHeader>Beneficiary A/c No.</TableCell>
                    <TableCell isHeader align="right">Req. Amount</TableCell>
                    <TableCell isHeader>Event</TableCell>
                    <TableCell isHeader>By</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const style = ACTION_STYLES[entry.action] || { label: entry.action, variant: 'slate' };
                    return (
                      <TableRow key={entry.id} hover={false}>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{formatDateTime(entry.timestamp)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-black text-amber-500 font-mono tracking-wide">{entry.line_item?.sheet_number || '—'}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-300 font-medium">{entry.line_item?.account_sub_title_text || '—'}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-400 font-mono">{entry.line_item?.beneficiary_ac_no || '—'}</span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="text-sm font-black text-slate-200 font-mono">{formatINR(entry.line_item?.req_amount)}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={style.variant} showDot={false}>{style.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-400">{entry.user_name || 'System'}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            maxVisible={5}
            showLabel
            totalRecords={totalCount}
            className="rounded-2xl mt-4"
          />
        </div>
      </div>
    </>
  );
};

export default AcctRequisitionLogs;
