import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Button, Input, Badge, SkeletonTable, Pagination, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { useQuery } from '@tanstack/react-query';
import { getSheets } from '../api/acctRequisitionsApi';

const STATUS_TABS = [
  { value: 'Submitted', label: 'Pending Review', emptyText: 'No submitted sheets pending review.' },
  { value: 'Reviewed', label: 'Reviewed', emptyText: 'No fully-reviewed sheets yet.' }
];

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleDateString('en-IN') : null);

// Two-column layout (search/date/status filters on the left, results table
// on the right) mirroring AcctRequisitions.jsx's Accounts-side screen —
// same filtering vocabulary on both sides of this workflow instead of a
// bespoke pill-tab-only layout just for HO.
const AcctHoQueue = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isHoUser = user?.role === 'ho' || user?.role === 'admin';
  const [statusFilter, setStatusFilter] = useState('Submitted');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const activeTab = STATUS_TABS.find((t) => t.value === statusFilter) || STATUS_TABS[0];

  const handleStatusChange = (value) => {
    setStatusFilter(value);
    setPage(1);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  // A sheet moves from Submitted to Reviewed automatically once every item
  // on it has a decision (migration 028) — at which point it drops out of
  // the default queue view above. Without this tab there'd be nowhere an HO
  // user could find that sheet again to reopen a decided item on it (the
  // Accounts sheet list with the same filter is role-gated away from HO).
  //
  // getSheets defaults to page 1 / limit 20 server-side — omitting `page`
  // here used to silently cap this queue at the newest 20 sheets with no
  // pagination UI and no indication more existed beyond that.
  const { data, isLoading: loadingSheets } = useQuery({
    queryKey: ['acctSheets', statusFilter.toLowerCase(), page, searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      const params = { sheet_status: statusFilter, page };
      if (searchQuery) params.sheet_number = searchQuery;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      return (await getSheets(params)).data;
    },
    staleTime: 15 * 1000,
    enabled: isHoUser
  });
  const sheets = data?.sheets ?? [];
  const totalPages = data?.pagination?.totalPages || 1;
  const totalSheets = data?.pagination?.total || 0;

  if (!isHoUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  const totalAmount = sheets.reduce((sum, s) => sum + Number(s.total_req_amount || 0), 0);

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-6 pb-6 border-b border-white/5 shrink-0">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            HO · Accounts Requisition Review
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">HO Approval Queue</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            {statusFilter === 'Submitted'
              ? 'Submitted requisition sheets awaiting your review.'
              : 'Sheets you have fully reviewed — reopen an item here if it needs another look.'}
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions/bank-balances')}>
          View Bank Balances
        </Button>
      </div>

      <div className="glass-panel p-5 rounded-2xl mb-8 border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02] flex justify-around items-center text-center divide-x divide-white/5 shrink-0">
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">{activeTab.label} Sheets</span>
          <span className="text-2xl font-black text-slate-100 font-mono">{totalSheets}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">Total Requested (this page)</span>
          <span className="text-2xl font-black text-amber-400 font-mono">{formatINR(totalAmount)}</span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 flex-grow overflow-hidden min-h-0">
        {/* Left Column: Search & Filters */}
        <div className="w-full md:w-64 flex flex-col gap-4 shrink-0">
          <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col gap-5">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Search Sheet Number</span>
              <Input
                type="text"
                placeholder="Enter sheet number..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                size="sm"
              />
            </div>

            <div className="pt-4 border-t border-white/5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Created Date Range</span>
              <div className="space-y-2">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  size="sm"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  size="sm"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-white/5 space-y-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Status</span>
              {STATUS_TABS.map((tab) => {
                const isActive = statusFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => handleStatusChange(tab.value)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center justify-between select-none ${
                      isActive
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-extrabold ring-1 ring-amber-400'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-slate-950"></span>}
                  </button>
                );
              })}
            </div>

            {(searchQuery || dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="w-full">
                Reset Filters
              </Button>
            )}
          </div>
        </div>

        {/* Right Column: Sheet List */}
        <div className="flex-grow flex flex-col min-h-0 bg-white/[0.01] border border-white/5 rounded-3xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-center mb-6 shrink-0 z-10">
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">{activeTab.label} Sheets</h3>
            <span className="text-[10px] font-bold text-slate-500 font-mono">Found {totalSheets} results</span>
          </div>

          <div className="flex-grow overflow-y-auto no-scrollbar min-h-0 pr-1 mb-4 z-10">
            {loadingSheets ? (
              <SkeletonTable rows={8} cols={5} />
            ) : sheets.length === 0 ? (
              <div className="text-center py-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl">
                {activeTab.emptyText}
              </div>
            ) : (
              <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                <Table containerClassName="min-w-[640px]">
                  <TableHeader>
                    <TableRow hover={false}>
                      <TableCell isHeader>Sheet Number</TableCell>
                      <TableCell isHeader>Status</TableCell>
                      <TableCell isHeader align="right">Items</TableCell>
                      <TableCell isHeader>Submitted</TableCell>
                      <TableCell isHeader align="right">Total Requested</TableCell>
                      <TableCell isHeader />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheets.map((sheet) => (
                      <TableRow key={sheet.id} onClick={() => navigate(`/acct-requisitions/ho-queue/sheets/${sheet.id}`)} interactive>
                        <TableCell>
                          <span className="text-sm font-black text-amber-500 font-mono tracking-wide">{sheet.sheet_number}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={sheet.sheet_status === 'Reviewed' ? 'emerald' : 'blue'} showDot={false}>{sheet.sheet_status}</Badge>
                        </TableCell>
                        <TableCell align="right">
                          <span className="text-xs text-slate-400 font-medium font-mono">{sheet.item_count}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{formatDate(sheet.submitted_at)}</span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="text-sm font-black text-slate-200 font-mono">{formatINR(sheet.total_req_amount)}</span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="inline-flex h-8 w-8 rounded-xl bg-white/5 group-hover:bg-white/10 border border-white/5 group-hover:border-white/10 items-center justify-center text-slate-400 group-hover:text-slate-200 transition-all duration-300">
                            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              maxVisible={5}
              showLabel={true}
              totalRecords={totalSheets}
              className="rounded-2xl z-10"
            />
          )}
        </div>
      </div>
    </>
  );
};

export default AcctHoQueue;
