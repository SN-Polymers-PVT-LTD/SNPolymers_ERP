import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Button, Input, Badge, SkeletonTable, Pagination, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSheets, createSheet, deleteSheetIfEmpty } from '../api/acctRequisitionsApi';
import RequisitionDetailsPanel from '../components/acctRequisition/RequisitionDetailsPanel';

const getStatusBadgeVariant = (status) => {
  switch (status) {
    case 'Open':
      return 'amber';
    case 'Submitted':
      return 'blue';
    case 'Reviewed':
      return 'emerald';
    default:
      return 'slate';
  }
};

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

const formatDate = (dateStr) => {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-IN');
};

const AcctRequisitions = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [creating, setCreating] = useState(false);
  const [discardingId, setDiscardingId] = useState(null);
  const [activeView, setActiveView] = useState('Sheets');

  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';

  const { data: sheetsData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['acctSheets', { page, searchQuery, dateFrom, dateTo, statusFilter }],
    queryFn: async () => {
      const params = { page, limit };
      if (searchQuery) params.sheet_number = searchQuery;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (statusFilter !== 'All') params.sheet_status = statusFilter;
      const res = await getSheets(params);
      return res.data;
    },
    staleTime: 15 * 1000,
    enabled: isAccountsUser
  });

  const sheets = sheetsData?.sheets || [];
  const totalPages = sheetsData?.pagination?.totalPages || 1;
  const totalItems = sheetsData?.pagination?.total || 0;
  const displayError = error || queryError?.response?.data?.message || queryError?.message || '';

  const openCount = sheets.filter(s => s.sheet_status === 'Open').length;
  const submittedCount = sheets.filter(s => s.sheet_status === 'Submitted').length;
  const reviewedCount = sheets.filter(s => s.sheet_status === 'Reviewed').length;

  const handleCardClick = (sheet) => {
    navigate(`/acct-requisitions/sheets/${sheet.id}`);
  };

  const handleCreateSheet = async () => {
    setError('');
    setCreating(true);
    try {
      const res = await createSheet({});
      queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
      navigate(`/acct-requisitions/sheets/${res.data.sheet.id}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create sheet.');
    } finally {
      setCreating(false);
    }
  };

  // Lets Accounts discard a still-Open, zero-item sheet directly from the
  // list, instead of the only prior path — open its detail page, then leave,
  // which fires the same deleteSheetIfEmpty as a side effect of unmounting.
  // Without this, a sheet created by accident (e.g. a double-clicked "New
  // Sheet") and never opened just sits here forever with its number
  // permanently burned (030_allow_empty_open_sheet_delete.sql) and no way to
  // clear it from this view.
  const handleDiscardSheet = async (e, sheet) => {
    e.stopPropagation();
    setError('');
    setSuccess('');
    setDiscardingId(sheet.id);
    try {
      const res = await deleteSheetIfEmpty(sheet.id);
      queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
      // A restored count means an item that was imported into this sheet
      // (then removed again before submit) is back in the Held/Rejected
      // eligible list (039_delete_empty_sheet_restores_imports.sql).
      const restoredCount = res.data?.restoredImportCount || 0;
      if (restoredCount > 0) {
        queryClient.invalidateQueries({ queryKey: ['acctImportEligibleItems'] });
        setSuccess(`Sheet discarded. ${restoredCount} item(s) restored to the Held/Rejected eligible list.`);
      } else {
        setSuccess('Sheet discarded.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to discard sheet.');
    } finally {
      setDiscardingId(null);
    }
  };

  const resetFilters = () => {
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('All');
    setPage(1);
  };

  if (!isAccountsUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-6 pb-6 border-b border-white/5 shrink-0">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · HO Approval
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Requisition Sheets</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">Manage, review, and track the workflow status of all requisition sheets.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions/bank-balances')}>
            Manage Bank Balances
          </Button>
          <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions/import-eligible-items')}>
            Held / Rejected Items
          </Button>
          <Button onClick={handleCreateSheet} loading={creating}>New Sheet</Button>
        </div>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-6 flex items-center gap-2.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          {success}
        </div>
      )}

      {/* Top Stats */}
      <div className="glass-panel p-5 rounded-2xl mb-8 border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02] flex justify-around items-center text-center divide-x divide-white/5 shrink-0">
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Total Sheets</span>
          <span className="text-2xl font-black text-slate-100 font-mono">{totalItems}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">Open (this page)</span>
          <span className="text-2xl font-black text-amber-400 font-mono">{openCount}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-sky-500 block mb-1">Submitted (this page)</span>
          <span className="text-2xl font-black text-sky-400 font-mono">{submittedCount}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500 block mb-1">Reviewed (this page)</span>
          <span className="text-2xl font-black text-emerald-400 font-mono">{reviewedCount}</span>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex items-center gap-2 mb-6 shrink-0">
        {['Sheets', 'Requisition Details'].map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setActiveView(view)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
              activeView === view
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/5'
            }`}
          >
            {view}
          </button>
        ))}
      </div>

      {activeView === 'Requisition Details' ? (
        <RequisitionDetailsPanel sheetDetailBasePath="/acct-requisitions/sheets" />
      ) : (
      /* Main Two-Column Workspace */
      <div className="flex flex-col md:flex-row gap-6 flex-grow overflow-hidden min-h-0">

        {/* Left Column: Search & Filters */}
        <div className="w-full md:w-64 flex flex-col gap-4 shrink-0">
          <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col gap-5">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Search Req. No.</span>
              <Input
                type="text"
                placeholder="Enter req. no..."
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
              {['All', 'Open', 'Submitted', 'Reviewed'].map((s) => {
                const isActive = statusFilter === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setStatusFilter(s); setPage(1); }}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center justify-between select-none ${
                      isActive
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-extrabold ring-1 ring-amber-400'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <span>{s === 'All' ? 'All Sheets' : `${s} Sheets`}</span>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-slate-950"></span>}
                  </button>
                );
              })}
            </div>

            {(searchQuery || dateFrom || dateTo || statusFilter !== 'All') && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="w-full">
                Reset Filters
              </Button>
            )}
          </div>
        </div>

        {/* Right Column: Sheet List — a dense table row per sheet reads more
            like the spreadsheet this team already works in day to day, and
            fits more sheets on screen at once than a 2-column card grid. */}
        <div className="flex-grow flex flex-col min-h-0 bg-white/[0.01] border border-white/5 rounded-3xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-center mb-6 shrink-0 z-10">
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Requisition Sheets</h3>
            <span className="text-[10px] font-bold text-slate-500 font-mono">Found {totalItems} results</span>
          </div>

          <div className="flex-grow overflow-y-auto no-scrollbar min-h-0 pr-1 mb-4 z-10">
            {loading ? (
              <SkeletonTable rows={8} cols={6} />
            ) : sheets.length === 0 ? (
              <div className="text-center py-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl">
                No matching requisition sheets found.
              </div>
            ) : (
              <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                <Table containerClassName="min-w-[720px]">
                  <TableHeader>
                    <TableRow hover={false}>
                      <TableCell isHeader>Req. No.</TableCell>
                      <TableCell isHeader>Status</TableCell>
                      <TableCell isHeader align="right">Items</TableCell>
                      <TableCell isHeader>Date</TableCell>
                      <TableCell isHeader align="right">Total Requested</TableCell>
                      <TableCell isHeader />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheets.map((sheet) => (
                      <TableRow key={sheet.id} onClick={() => handleCardClick(sheet)} interactive>
                        <TableCell>
                          <span className="text-sm font-black text-amber-500 font-mono tracking-wide">{sheet.sheet_number}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(sheet.sheet_status)} showDot={false}>{sheet.sheet_status}</Badge>
                        </TableCell>
                        <TableCell align="right">
                          <span className="text-xs text-slate-400 font-medium font-mono">{sheet.item_count}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                            {sheet.submitted_at ? `Submitted ${formatDate(sheet.submitted_at)}` : `Created ${formatDate(sheet.created_at)}`}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="text-sm font-black text-slate-200 font-mono">{formatINR(sheet.total_req_amount)}</span>
                        </TableCell>
                        <TableCell align="right">
                          <div className="flex items-center justify-end gap-2">
                            {sheet.sheet_status === 'Open' && sheet.item_count === 0 && (
                              <Button
                                variant="glass"
                                size="sm"
                                loading={discardingId === sheet.id}
                                onClick={(e) => handleDiscardSheet(e, sheet)}
                              >
                                Discard
                              </Button>
                            )}
                            <span className="inline-flex h-8 w-8 rounded-xl bg-white/5 group-hover:bg-white/10 border border-white/5 group-hover:border-white/10 items-center justify-center text-slate-400 group-hover:text-slate-200 transition-all duration-300">
                              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                              </svg>
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            maxVisible={5}
            showLabel={true}
            totalRecords={totalItems}
            className="rounded-2xl z-10"
          />
        </div>
      </div>
      )}
    </>
  );
};

export default AcctRequisitions;
