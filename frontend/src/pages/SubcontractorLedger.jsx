import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, TextArea, Badge, Modal, Table, TableHeader, TableBody, TableRow, TableCell, Pagination } from '../components/ui';
import {
  getSubcontractorLedger,
  getSubcontractorLedgerEntries,
  getSubcontractorRequisitions,
  adjustSubcontractorBalance
} from '../api/requisitionsApi';
import {
  exportSubcontractorRequisitionsToExcel,
  exportSubcontractorBalancesToExcel,
  exportSubcontractorLedgerStatementToExcel,
  exportAllSubcontractorLedgersToExcel
} from '../utils/exportHelpers';
import { formatPaymentOffice, getRequisitionFinancialState } from '../utils/requisitionUtils';
import { useSubcontractorLedgerUrlState } from '../hooks/useSubcontractorLedgerUrlState';

const VIEW_TABS = [
  { value: 'contractors', label: 'Contractor Ledger' },
  { value: 'requisitions', label: 'Requisitions by Contractor' }
];

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleDateString('en-IN') : '—');

const TX_TYPE_LABELS = {
  ESTIMATE_ITEM_APPROVAL: 'Credit (Approved Scope)',
  ESTIMATE_ITEM_REVERSAL: 'Reversal (Revision Reduced)',
  REQUISITION_APPROVAL: 'Debit (Requisition)',
  REQUISITION_PAYMENT: 'Debit (Paid)',
  REQUISITION_RELEASE: 'Release (Internal)',
  ADMIN_ADJUSTMENT: 'Admin Adjustment'
};

const formatTransactionLabel = (entry) => {
  if (entry.transaction_type === 'REQUISITION_PAYMENT') return 'Debit (Paid)';
  if (entry.transaction_type === 'REQUISITION_APPROVAL') {
    if (entry.settlement_status === 'SETTLED') return 'Debit (Paid)';
    if (entry.settlement_status === 'RELEASED') return 'Debit (Released)';
    return 'Debit (Reserved)';
  }
  return TX_TYPE_LABELS[entry.transaction_type] || entry.transaction_type;
};

/**
 * Contractor-Centric Subcontractor Ledger
 * Organizes finances by canonical subcontractor_id:
 * Contractor -> Work Orders -> Work Scopes
 * Strictly enforces that capacity is isolated per (work_order_no, subcontractor_id, subcontract_work_id).
 */
const SubcontractorLedger = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canView = ['je', 'zo', 'ho', 'admin'].includes(user?.role);
  const canAdjust = ['ho', 'admin'].includes(user?.role);

  const pageSize = 15;
  const [isExporting, setIsExporting] = useState(false);
  const [expandedContractors, setExpandedContractors] = useState({});

  // Synchronized URL Routing & State Machine
  const {
    viewMode,
    setViewMode,
    workOrderFilter,
    setWorkOrderFilter,
    searchInput,
    setSearchInput,
    debouncedSearch,
    page,
    setPage,
    dateBasis,
    setDateBasis,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    resetFilters,
    viewingEntry,
    setViewingEntry,
    adjustingEntry,
    setAdjustingEntry
  } = useSubcontractorLedgerUrlState();

  const hasContractorFilters = workOrderFilter || debouncedSearch;
  const hasRequisitionFilters = workOrderFilter || debouncedSearch || dateFrom || dateTo || dateBasis !== 'created';

  // Primary Contractor-Centric Query
  const { data: ledgerData, isLoading: loadingContractors, error: ledgerError } = useQuery({
    queryKey: ['subcontractorLedger', workOrderFilter, debouncedSearch, page],
    queryFn: async () => (await getSubcontractorLedger({
      page,
      limit: pageSize,
      work_order_no: workOrderFilter || undefined,
      search: debouncedSearch || undefined
    })).data,
    enabled: canView && viewMode === 'contractors'
  });

  const contractors = useMemo(() => ledgerData?.contractors || [], [ledgerData?.contractors]);
  const flatBalances = useMemo(() => ledgerData?.balances || [], [ledgerData?.balances]);
  const totalContractors = ledgerData?.pagination?.total || 0;
  const totalPages = ledgerData?.pagination?.totalPages || 1;

  // Requisitions Query
  const { data: requisitions = [], isLoading: loadingRequisitions, error: requisitionsError } = useQuery({
    queryKey: ['subcontractorRequisitions', workOrderFilter, debouncedSearch, dateFrom, dateTo, dateBasis],
    queryFn: async () => (await getSubcontractorRequisitions({
      work_order_no: workOrderFilter || undefined,
      search: debouncedSearch || undefined,
      date_basis: dateBasis,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined
    })).data?.requisitions || [],
    enabled: canView && viewMode === 'requisitions'
  });

  // Group requisitions by canonical contractor
  const groupedRequisitions = useMemo(() => {
    const groups = [];
    const indexByKey = {};
    for (const r of requisitions) {
      const key = r.subcontractor_id || r.material_details || 'unknown';
      const contractorName = r.subcontractor?.subcontractor_name || r.material_details || 'Unnamed Contractor';
      if (!(key in indexByKey)) {
        indexByKey[key] = groups.length;
        groups.push({
          subcontractor_id: r.subcontractor_id,
          contractorName,
          rows: []
        });
      }
      groups[indexByKey[key]].rows.push(r);
    }
    return groups;
  }, [requisitions]);

  const toggleContractorExpand = (contractorId) => {
    setExpandedContractors(prev => ({
      ...prev,
      [contractorId]: !prev[contractorId]
    }));
  };

  const expandAllContractors = () => {
    const all = {};
    contractors.forEach(c => { all[c.subcontractor_id] = true; });
    setExpandedContractors(all);
  };

  const collapseAllContractors = () => {
    setExpandedContractors({});
  };

  const allContractorsExpanded = useMemo(() => {
    if (contractors.length === 0) return false;
    return contractors.every(c => expandedContractors[c.subcontractor_id]);
  }, [contractors, expandedContractors]);



  const handleExportRequisitions = () => {
    exportSubcontractorRequisitionsToExcel(requisitions, {
      workOrderFilter,
      searchFilter: debouncedSearch,
      dateBasis,
      dateFrom,
      dateTo
    });
  };

  const handleExportBalances = async () => {
    try {
      setIsExporting(true);
      const res = await getSubcontractorLedger({
        work_order_no: workOrderFilter || undefined,
        search: debouncedSearch || undefined,
        export: 'true'
      });
      const balancesToExport = res.data?.balances || res.data?.contractors?.flatMap((c) => c.balances || []) || [];
      exportSubcontractorBalancesToExcel(balancesToExport, {
        workOrderFilter,
        searchFilter: debouncedSearch
      });
    } catch (err) {
      console.error('Export balances failed:', err);
      alert('Failed to export balances: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportContractorStatement = async (contractor, chosenWorkOrder) => {
    try {
      setIsExporting(true);
      const res = await getSubcontractorLedgerEntries({
        subcontractor_id: contractor.subcontractor_id,
        work_order_no: chosenWorkOrder || workOrderFilter || undefined
      });
      const entries = res.data?.entries || [];

      await exportSubcontractorLedgerStatementToExcel({
        subcontractor: contractor.subcontractor_name,
        subHead: 'Consolidated Statement',
        workOrder: chosenWorkOrder || workOrderFilter || 'All Work Orders',
        balance: {
          approved_scope: contractor.total_approved,
          reserved: contractor.total_reserved,
          paid: contractor.total_paid,
          remaining: contractor.total_remaining
        },
        entries
      });
    } catch (err) {
      console.error('Export statement failed:', err);
      alert('Failed to export statement: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportFullLedger = async () => {
    try {
      setIsExporting(true);
      const [entriesRes, balancesRes, requisitionsRes] = await Promise.all([
        getSubcontractorLedgerEntries({
          work_order_no: workOrderFilter || undefined,
          search: debouncedSearch || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined
        }),
        getSubcontractorLedger({
          work_order_no: workOrderFilter || undefined,
          search: debouncedSearch || undefined,
          export: 'true'
        }),
        getSubcontractorRequisitions({
          work_order_no: workOrderFilter || undefined,
          search: debouncedSearch || undefined,
          date_basis: dateBasis,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined
        })
      ]);
      const entries = entriesRes.data?.entries || [];
      const allBalances = balancesRes.data?.balances || balancesRes.data?.contractors?.flatMap((c) => c.balances || []) || [];
      const exportRequisitions = requisitionsRes.data?.requisitions || [];

      await exportAllSubcontractorLedgersToExcel(entries, allBalances, exportRequisitions, {
        workOrderFilter,
        searchFilter: debouncedSearch,
        dateBasis,
        dateFrom,
        dateTo
      });
    } catch (err) {
      console.error('Export full ledger failed:', err);
      alert('Failed to export full ledger: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsExporting(false);
    }
  };

  const isLoading = viewMode === 'contractors' ? loadingContractors : loadingRequisitions;
  const queryError = viewMode === 'contractors' ? ledgerError : requisitionsError;
  const hasFilters = viewMode === 'contractors' ? hasContractorFilters : hasRequisitionFilters;
  const displayError = queryError?.response?.data?.message || queryError?.message || '';

  if (!canView) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-5 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-400 font-mono">
            FINANCE &amp; REQUISITIONS · SUBCONTRACTOR LEDGER
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-white mt-1">Subcontractor Ledger</h1>
          <p className="text-xs text-slate-400 mt-1">
            Contractor-centric financial position across Work Orders and Work Scopes with strict capacity isolation.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate('/requisitions')}>
          ← Back to Requisitions
        </Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      {/* View Tabs */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-900/60 border border-white/5 w-fit">
        {VIEW_TABS.map((tab) => {
          const isActive = viewMode === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setViewMode(tab.value)}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 select-none ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20 ring-1 ring-indigo-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filters Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/5 flex flex-col sm:flex-row flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Work Order No.</span>
          <Input
            type="text"
            placeholder="Filter by Work Order..."
            value={workOrderFilter}
            onChange={(e) => setWorkOrderFilter(e.target.value)}
            size="sm"
          />
        </div>
        <div className="w-full sm:w-64">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Search</span>
          <Input
            type="text"
            placeholder="Search contractor, work type, or WO..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            size="sm"
          />
        </div>

        {viewMode === 'requisitions' && (
          <>
            <div className="w-full sm:w-36">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Date Basis</span>
              <select
                value={dateBasis}
                onChange={(e) => setDateBasis(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="created">Creation Date</option>
                <option value="approved">Approval Date</option>
                <option value="paid">Payment Date</option>
              </select>
            </div>
            <div className="w-full sm:w-36">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">From</span>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} size="sm" />
            </div>
            <div className="w-full sm:w-36">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">To</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} size="sm" />
            </div>
          </>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset Filters
          </Button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {viewMode === 'contractors' ? (
            <>
              <Button
                variant="glass"
                size="sm"
                onClick={handleExportBalances}
                disabled={(contractors.length === 0 && flatBalances.length === 0) || isExporting}
                className="text-xs"
              >
                {isExporting ? 'Exporting…' : 'Export Summary to Excel'}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleExportFullLedger}
                disabled={(contractors.length === 0 && flatBalances.length === 0) || isExporting}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs"
              >
                {isExporting ? 'Exporting…' : 'Export Full Ledger'}
              </Button>
            </>
          ) : (
            <Button
              variant="glass"
              size="sm"
              onClick={handleExportRequisitions}
              disabled={requisitions.length === 0}
              className="text-xs"
            >
              Export Requisitions to Excel
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-16 text-center text-xs text-slate-400">Loading Subcontractor Ledger data…</div>
      ) : viewMode === 'contractors' ? (
        contractors.length === 0 ? (
          flatBalances.length > 0 ? (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                    <h3 className="text-sm font-bold text-amber-300">Legacy / Unlinked Scopes</h3>
                  </div>
                  <p className="text-xs text-amber-200/80 mt-1">
                    These scopes originate from legacy Cost Estimates prior to Subcontractor Master linking. Capacities are strictly isolated per Work Order.
                  </p>
                </div>
                <span className="text-xs font-mono font-bold text-amber-300 bg-amber-500/10 px-3 py-1 rounded-xl border border-amber-500/20 shrink-0 self-start sm:self-auto">
                  {flatBalances.length} {flatBalances.length === 1 ? 'Legacy Scope' : 'Legacy Scopes'}
                </span>
              </div>

              {/* Legacy Scopes Table */}
              <div className="rounded-2xl border border-white/5 overflow-hidden">
                <Table containerClassName="min-w-[850px]">
                  <TableHeader>
                    <TableRow hover={false}>
                      <TableCell isHeader>Work Order</TableCell>
                      <TableCell isHeader>Subcontractor (Legacy Name)</TableCell>
                      <TableCell isHeader>Sub Head</TableCell>
                      <TableCell isHeader align="right">Estimated Total</TableCell>
                      <TableCell isHeader align="right">Paid Total</TableCell>
                      <TableCell isHeader align="right">Available Balance</TableCell>
                      <TableCell isHeader className="text-right">Actions</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flatBalances.map((b) => (
                      <TableRow key={`${b.work_order_no}-${b.material_sub_head}-${b.material_details}`}>
                        <TableCell>
                          <div className="font-mono text-xs font-bold text-indigo-300">{b.work_order_no}</div>
                          {b.project?.department && (
                            <div className="text-[10px] text-slate-400">{b.project.department}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold text-white text-xs">{b.material_details}</div>
                          {b.project?.site_details && (
                            <div className="text-[10px] text-slate-400 truncate max-w-[200px]" title={b.project.site_details}>
                              {b.project.site_details}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-300">{b.material_sub_head}</span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="font-mono text-xs text-slate-300">{formatCurrency(b.estimated_total)}</span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="font-mono text-xs text-slate-300">{formatCurrency(b.paid_total)}</span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                            {formatCurrency(b.available_balance)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5 items-center">
                            <Button
                              variant="glass"
                              size="sm"
                              onClick={() => setViewingEntry({
                                work_order_no: b.work_order_no,
                                material_sub_head: b.material_sub_head,
                                material_details: b.material_details,
                                subcontractor_name: b.material_details,
                                department: b.project?.department,
                                approved_scope: b.estimated_total,
                                reserved: b.reserved_total || b.reserved_amount || 0,
                                paid: b.paid_total || 0,
                                remaining: b.available_balance || 0
                              })}
                              className="text-xs h-7 px-2.5"
                            >
                              View Transactions
                            </Button>
                            {canAdjust && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setAdjustingEntry(b)}
                                className="text-xs h-7 px-2 text-slate-400 hover:text-white"
                              >
                                Adjust
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  maxVisible={5}
                  showLabel={true}
                  totalRecords={totalContractors}
                />
              )}
            </div>
          ) : (
            <div className="rounded-3xl border border-white/5 p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
              {hasFilters ? 'No contractors match the active filters.' : 'No subcontractor ledger records found.'}
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-slate-400 font-medium">
                Showing <strong className="text-white">{contractors.length}</strong> {contractors.length === 1 ? 'contractor' : 'contractors'}
              </span>
              <button
                type="button"
                onClick={allContractorsExpanded ? collapseAllContractors : expandAllContractors}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer"
              >
                {allContractorsExpanded ? 'Collapse All Contractors' : 'Expand All Contractors'}
              </button>
            </div>

            {/* Contractor Cards */}
            {contractors.map((c) => {
              const isExpanded = Boolean(expandedContractors[c.subcontractor_id]);
              const scopes = c.scopes || [];

              return (
                <div
                  key={c.subcontractor_id}
                  className="rounded-3xl border border-white/10 bg-slate-900/60 overflow-hidden shadow-lg transition-all"
                >
                  {/* Contractor Header */}
                  <div
                    onClick={() => toggleContractorExpand(c.subcontractor_id)}
                    className="p-5 cursor-pointer hover:bg-white/[0.03] transition flex flex-col lg:flex-row lg:items-center justify-between gap-4 select-none"
                  >
                    <div className="flex items-start sm:items-center gap-3.5">
                      <div className="w-7 h-7 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0 mt-0.5 sm:mt-0">
                        <svg
                          className={`w-4 h-4 transform transition-transform duration-200 ${isExpanded ? 'rotate-90' : 'rotate-0'}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-2.5">
                          <h2 className="text-lg font-bold text-white tracking-tight">{c.subcontractor_name}</h2>
                          <Badge variant={c.is_active ? 'success' : 'slate'} className="text-[10px]">
                            {c.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                          <span>{c.work_order_count} {c.work_order_count === 1 ? 'Work Order' : 'Work Orders'}</span>
                          <span>•</span>
                          <span>{c.scope_count} {c.scope_count === 1 ? 'Work Scope' : 'Work Scopes'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Contractor Totals Ribbon */}
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-right">
                        <div className="text-[10px] uppercase font-bold text-slate-400">Total Approved</div>
                        <div className="text-xs font-mono font-semibold text-slate-200">{formatCurrency(c.total_approved)}</div>
                      </div>
                      <div className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-right">
                        <div className="text-[10px] uppercase font-bold text-amber-400">Total Reserved</div>
                        <div className="text-xs font-mono font-semibold text-amber-300">{formatCurrency(c.total_reserved)}</div>
                      </div>
                      <div className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-right">
                        <div className="text-[10px] uppercase font-bold text-slate-400">Total Paid</div>
                        <div className="text-xs font-mono font-semibold text-slate-300">{formatCurrency(c.total_paid)}</div>
                      </div>
                      <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-right">
                        <div className="text-[10px] uppercase font-bold text-emerald-400">Remaining (Info)</div>
                        <div className="text-xs font-mono font-bold text-emerald-300">{formatCurrency(c.total_remaining)}</div>
                      </div>

                      <Button
                        variant="glass"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExportContractorStatement(c);
                        }}
                        className="text-xs text-indigo-300 hover:text-white border-indigo-500/30 shrink-0 ml-1"
                      >
                        Export Statement
                      </Button>
                    </div>
                  </div>

                  {/* Expanded: Work Orders & Scopes Breakdown */}
                  {isExpanded && (
                    <div className="border-t border-white/5 bg-slate-950/40 p-4 sm:p-6 space-y-5">
                      {scopes.map((woScope) => {
                        const works = woScope.works || [];
                        return (
                          <div
                            key={woScope.work_order_no}
                            className="rounded-2xl border border-white/10 bg-slate-900/90 overflow-hidden shadow-sm"
                          >
                            {/* Work Order Header */}
                            <div className="p-3.5 bg-white/[0.02] border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                                    {woScope.work_order_no}
                                  </span>
                                  {woScope.department && (
                                    <span className="text-xs font-medium text-slate-400">· {woScope.department}</span>
                                  )}
                                </div>
                                {woScope.site_details && (
                                  <p className="text-xs text-slate-400 mt-1">Site: {woScope.site_details}</p>
                                )}
                              </div>

                              <div className="flex items-center gap-3">
                                <div className="text-right text-xs">
                                  <span className="text-slate-400">WO Approved: </span>
                                  <span className="font-mono font-semibold text-slate-200">{formatCurrency(woScope.approved_scope)}</span>
                                  <span className="text-slate-500 mx-1.5">|</span>
                                  <span className="text-slate-400">Remaining: </span>
                                  <span className="font-mono font-bold text-emerald-400">{formatCurrency(woScope.remaining)}</span>
                                </div>
                                <Button
                                  variant="glass"
                                  size="sm"
                                  onClick={() => setViewingEntry({
                                    subcontractor_id: c.subcontractor_id,
                                    subcontractor_name: c.subcontractor_name,
                                    work_order_no: woScope.work_order_no,
                                    department: woScope.department,
                                    approved_scope: woScope.approved_scope,
                                    reserved: woScope.reserved,
                                    paid: woScope.paid,
                                    remaining: woScope.remaining
                                  })}
                                  className="text-xs h-7 px-2.5 text-indigo-300"
                                >
                                  View WO Ledger
                                </Button>
                              </div>
                            </div>

                            {/* Scopes Table */}
                            <Table containerClassName="min-w-[750px]">
                              <TableHeader>
                                <TableRow hover={false}>
                                  <TableCell isHeader className="w-1/3">Work Scope / Details</TableCell>
                                  <TableCell isHeader align="right">Approved Scope</TableCell>
                                  <TableCell isHeader align="right">Reserved</TableCell>
                                  <TableCell isHeader align="right">Actually Paid</TableCell>
                                  <TableCell isHeader align="right">Remaining Balance</TableCell>
                                  <TableCell isHeader className="text-right">Actions</TableCell>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {works.map((w) => (
                                  <TableRow key={w.subcontract_work_id || w.material_details}>
                                    <TableCell>
                                      <div className="font-semibold text-white text-xs">{w.material_details}</div>
                                      <div className="text-[11px] text-slate-400">
                                        Sub Head: {w.sub_head} · Unit: <span className="font-mono">{w.unit}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell align="right">
                                      <span className="font-mono text-xs text-slate-300">{formatCurrency(w.approved_scope)}</span>
                                    </TableCell>
                                    <TableCell align="right">
                                      <span className="font-mono text-xs text-amber-300">{formatCurrency(w.reserved)}</span>
                                    </TableCell>
                                    <TableCell align="right">
                                      <span className="font-mono text-xs text-slate-300">{formatCurrency(w.paid)}</span>
                                    </TableCell>
                                    <TableCell align="right">
                                      <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                                        {formatCurrency(w.remaining)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex justify-end gap-1.5 items-center">
                                        <Button
                                          variant="glass"
                                          size="sm"
                                          onClick={() => setViewingEntry({
                                            subcontractor_id: c.subcontractor_id,
                                            subcontractor_name: c.subcontractor_name,
                                            work_order_no: woScope.work_order_no,
                                            subcontract_work_id: w.subcontract_work_id,
                                            material_details: w.material_details,
                                            sub_head: w.sub_head,
                                            department: woScope.department,
                                            approved_scope: w.approved_scope,
                                            reserved: w.reserved,
                                            paid: w.paid,
                                            remaining: w.remaining
                                          })}
                                          className="text-xs h-7 px-2.5"
                                        >
                                          View Transactions
                                        </Button>
                                        {canAdjust && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setAdjustingEntry({
                                              work_order_no: woScope.work_order_no,
                                              material_sub_head: w.sub_head,
                                              material_details: w.material_details,
                                              estimated_total: w.approved_scope,
                                              paid_total: w.paid,
                                              available_balance: w.remaining
                                            })}
                                            className="text-xs h-7 px-2 text-slate-400 hover:text-white"
                                          >
                                            Adjust
                                          </Button>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              maxVisible={5}
              showLabel={true}
              totalRecords={totalContractors}
            />
          </div>
        )
      ) : groupedRequisitions.length === 0 ? (
        <div className="rounded-3xl border border-white/5 p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          {hasFilters ? 'No requisitions match these filters.' : 'No Subcontractor requisitions found.'}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="px-1 text-xs text-slate-400">
            Showing <strong className="text-white">{groupedRequisitions.length}</strong> contractors with requisitions
          </div>

          {groupedRequisitions.map((group) => {
            const activeRows = group.rows.filter((r) => getRequisitionFinancialState(r).financiallyActive);
            const totalRequested = activeRows.reduce((sum, r) => sum + Number(r.requisition_amount || 0), 0);
            const totalApproved = activeRows.reduce((sum, r) => sum + getRequisitionFinancialState(r).effectiveLiability, 0);

            return (
              <div key={group.subcontractor_id || group.contractorName} className="rounded-3xl border border-white/10 bg-slate-900/60 overflow-hidden">
                <div className="p-4 bg-white/[0.02] border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-white">{group.contractorName}</h3>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {group.rows.length} {group.rows.length === 1 ? 'requisition' : 'requisitions'}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div>
                      <span className="text-slate-400">Active Requested: </span>
                      <span className="font-mono font-bold text-white">{formatCurrency(totalRequested)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Active Approved: </span>
                      <span className="font-mono font-bold text-emerald-400">{formatCurrency(totalApproved)}</span>
                    </div>
                  </div>
                </div>

                <Table containerClassName="min-w-[900px]">
                  <TableHeader>
                    <TableRow hover={false}>
                      <TableCell isHeader>Requisition No.</TableCell>
                      <TableCell isHeader>Work Order</TableCell>
                      <TableCell isHeader>Scope / Work</TableCell>
                      <TableCell isHeader align="right">Requested</TableCell>
                      <TableCell isHeader align="right">Approved</TableCell>
                      <TableCell isHeader>Status</TableCell>
                      <TableCell isHeader>Payment Office</TableCell>
                      <TableCell isHeader>Requested By</TableCell>
                      <TableCell isHeader>Date</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map((r) => (
                      <TableRow key={r.requisition_id}>
                        <TableCell>
                          <span className="font-mono font-semibold text-slate-200">{r.requisition_no}</span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-indigo-300">{r.work_order_no}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-300">
                            {r.subcontract_work?.material_details || r.material_details || r.material_sub_head}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="font-mono text-xs text-slate-200">{formatCurrency(r.requisition_amount)}</span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="font-mono text-xs text-emerald-400 font-semibold">{formatCurrency(r.approved_amount)}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getRequisitionFinancialState(r).status === 'Paid' ? 'emerald' : ['Released', 'Rejected', 'Cancelled'].includes(getRequisitionFinancialState(r).status) ? 'red' : 'amber'}>
                            {getRequisitionFinancialState(r).status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-300">{formatPaymentOffice(r.payment_destination)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-400">{r.requester_name || r.requester_user_id}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-400">{formatDate(r.created_at)}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      )}

      {/* Transaction Entries Modal */}
      <SubcontractorLedgerEntriesModal
        entry={viewingEntry}
        onClose={() => setViewingEntry(null)}
      />

      {/* Admin Balance Adjustment Modal */}
      <AdjustBalanceModal
        entry={adjustingEntry}
        onClose={() => setAdjustingEntry(null)}
        onSuccess={() => {
          setAdjustingEntry(null);
          queryClient.invalidateQueries({ queryKey: ['subcontractorLedger'] });
        }}
      />
    </div>
  );
};

const SubcontractorLedgerEntriesModal = ({ entry, onClose }) => {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['subcontractorLedgerEntries', entry?.subcontractor_id, entry?.work_order_no, entry?.subcontract_work_id, entry?.material_sub_head, entry?.material_details],
    queryFn: async () => (await getSubcontractorLedgerEntries({
      subcontractor_id: entry.subcontractor_id || undefined,
      work_order_no: entry.work_order_no || undefined,
      subcontract_work_id: entry.subcontract_work_id || undefined,
      material_sub_head: entry.material_sub_head || entry.sub_head || undefined,
      material_details: entry.material_details || undefined
    })).data?.entries || [],
    enabled: !!entry
  });

  const handleExportModalLedger = () => {
    if (!entry) return;
    exportSubcontractorLedgerStatementToExcel({
      subcontractor: entry.subcontractor_name || entry.material_details,
      subHead: entry.material_sub_head || entry.sub_head || 'All Scopes',
      workOrder: entry.work_order_no || 'All Work Orders',
      balance: {
        department: entry.department,
        approved_scope: entry.approved_scope,
        reserved: entry.reserved,
        paid: entry.paid,
        remaining: entry.remaining
      },
      entries
    });
  };

  const titleSubtitle = entry
    ? `${entry.subcontractor_name || entry.material_details} · ${entry.work_order_no || 'All Work Orders'}${entry.material_details ? ` · ${entry.material_details}` : ''}`
    : '';

  return (
    <Modal
      isOpen={!!entry}
      onClose={onClose}
      title="Subcontractor Ledger — Payment Statement"
      subtitle={titleSubtitle}
      size="xl"
    >
      {/* Scope Capacity KPI Strip */}
      {entry && entry.approved_scope != null && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
          <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Approved Scope</span>
            <span className="text-sm font-mono font-bold text-slate-200">{formatCurrency(entry.approved_scope)}</span>
          </div>
          <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[10px] text-amber-400 block uppercase font-bold tracking-wider">Reserved (Pending)</span>
            <span className="text-sm font-mono font-bold text-amber-300">{formatCurrency(entry.reserved || 0)}</span>
          </div>
          <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Actually Paid</span>
            <span className="text-sm font-mono font-bold text-slate-200">{formatCurrency(entry.paid || 0)}</span>
          </div>
          <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <span className="text-[10px] text-emerald-400 block uppercase font-bold tracking-wider">Remaining Capacity</span>
            <span className="text-sm font-mono font-bold text-emerald-300">{formatCurrency(entry.remaining || 0)}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
        <span className="text-xs text-slate-400">
          Chronological disbursement and payment statement. Capacity is strictly governed by approved Work Order scope.
        </span>
        <Button
          variant="glass"
          size="sm"
          onClick={handleExportModalLedger}
          disabled={entries.length === 0}
          className="text-xs font-bold text-indigo-300 border-indigo-500/20 shrink-0"
        >
          Export Statement to Excel
        </Button>
      </div>
      {isLoading ? (
        <div className="py-8 text-center text-xs text-slate-400">Loading transaction history…</div>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 font-bold uppercase tracking-wider">
          No payment transactions found for this scope.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/5 overflow-hidden">
          <Table className="min-w-[1050px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader className="w-24 min-w-[6rem]">Date</TableCell>
                <TableCell isHeader>Type</TableCell>
                <TableCell isHeader>Doc / Ref No.</TableCell>
                <TableCell isHeader>Description / Remarks</TableCell>
                <TableCell isHeader align="right" className="w-40 min-w-[10rem]">Paid Amount</TableCell>
                <TableCell isHeader align="right" className="w-44 min-w-[11rem]">Cumulative Paid</TableCell>
                <TableCell isHeader>By</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const paidAmount = Number(e.debit_amount || 0) || (Number(e.amount) < 0 ? Math.abs(Number(e.amount)) : (Number(e.amount) > 0 ? Number(e.amount) : 0));
                const cumPaid = e.cumulative_paid != null 
                  ? Number(e.cumulative_paid) 
                  : (e.scope_running_balance != null && e.scope_running_balance < 0 ? Math.abs(Number(e.scope_running_balance)) : paidAmount);

                return (
                  <TableRow key={e.ledger_id}>
                    <TableCell className="w-24 min-w-[6rem]">
                      <span className="block text-slate-400 text-xs leading-4">
                        <span className="block whitespace-nowrap">{new Date(e.created_at).toLocaleDateString('en-IN')}</span>
                        <span className="block whitespace-nowrap">{new Date(e.created_at).toLocaleTimeString('en-IN')}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                        {formatTransactionLabel(e)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {e.requisition_no ? (
                        <span className="font-mono text-indigo-300 text-xs font-bold">Req: {e.requisition_no}</span>
                      ) : e.reference_doc_no ? (
                        <span className="font-mono text-slate-400 text-xs">{e.reference_doc_no}</span>
                      ) : (
                        <span className="text-slate-500 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-slate-300 text-xs truncate max-w-[180px] inline-block" title={e.remarks || e.item_description || ''}>
                        {e.remarks || e.item_description || '—'}
                      </span>
                    </TableCell>
                    <TableCell align="right" className="w-40 min-w-[10rem] whitespace-nowrap">
                      {paidAmount > 0 ? (
                        <span className="font-mono font-bold text-slate-200">+{formatCurrency(paidAmount)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TableCell>
                    <TableCell align="right" className="w-44 min-w-[11rem] whitespace-nowrap">
                      <span className="font-mono font-bold text-indigo-300">
                        {formatCurrency(cumPaid)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-slate-400 text-xs whitespace-nowrap">{e.created_by_name}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Modal>
  );
};

const AdjustBalanceModal = ({ entry, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!entry) return null;

  const currentEst = Number(entry.estimated_total || 0);
  const currentPaid = Number(entry.paid_total || 0);
  const currentAvail = Number(entry.available_balance || 0);

  const delta = Number(amount) || 0;
  const newEst = currentEst + delta;
  const newAvail = newEst - currentPaid;

  const isFloorViolated = delta !== 0 && newEst < currentPaid;
  const isValid = delta !== 0 && !isFloorViolated && remarks.trim().length >= 5;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await adjustSubcontractorBalance({
        adjustment_id: crypto.randomUUID(),
        work_order_no: entry.work_order_no,
        material_sub_head: entry.material_sub_head,
        material_details: entry.material_details,
        adjustment_amount: delta,
        remarks: remarks.trim()
      });
      onSuccess();
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || 'Adjustment failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={!!entry}
      onClose={onClose}
      title="Adjust Subcontractor Balance"
      subtitle={`${entry.material_details} · ${entry.material_sub_head} · ${entry.work_order_no}`}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 p-3 bg-white/[0.02] border border-white/5 rounded-2xl text-center">
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Estimated</span>
            <span className="text-xs font-mono font-bold text-slate-300">{formatCurrency(currentEst)}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Paid So Far</span>
            <span className="text-xs font-mono font-bold text-slate-400">{formatCurrency(currentPaid)}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Available</span>
            <span className="text-xs font-mono font-bold text-emerald-400">{formatCurrency(currentAvail)}</span>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
            Adjustment Amount (INR)
          </label>
          <Input
            type="number"
            step="0.01"
            placeholder="e.g. 5000 or -5000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSubmitting}
            required
          />
          <span className="text-[10px] text-slate-500 block mt-1">
            Enter positive amount to increase allocation, or negative to reduce allocation.
          </span>
        </div>

        {delta !== 0 && (
          <div className={`p-3 rounded-xl border text-xs ${
            isFloorViolated
              ? 'bg-red-950/20 border-red-900/30 text-red-300'
              : 'bg-indigo-950/20 border-indigo-900/30 text-indigo-300'
          }`}>
            {isFloorViolated ? (
              <span>⚠️ Cannot reduce estimated total below already paid disbursements ({formatCurrency(currentPaid)}).</span>
            ) : (
              <div className="flex justify-between items-center text-[11px] font-mono">
                <span>New Estimated: {formatCurrency(newEst)}</span>
                <span>New Available: {formatCurrency(newAvail)}</span>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
            Reason / Remarks (Mandatory)
          </label>
          <TextArea
            placeholder="Detailed reason for the adjustment (min 5 characters)..."
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            disabled={isSubmitting}
            required
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={!isValid || isSubmitting}>
            {isSubmitting ? 'Adjusting…' : 'Confirm Adjustment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default SubcontractorLedger;
