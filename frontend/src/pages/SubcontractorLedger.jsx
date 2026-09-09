import { useState, useMemo, useEffect } from 'react';
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
import { isFinanciallyActiveRequisition } from '../utils/requisitionUtils';

const VIEW_TABS = [
  { value: 'balances', label: 'Balances' },
  { value: 'requisitions', label: 'Requisitions by Subcontractor' }
];

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleDateString('en-IN') : '—');
const formatDateTime = (dateStr) => (dateStr ? new Date(dateStr).toLocaleString('en-IN') : '—');

const TX_TYPE_LABELS = {
  ESTIMATE_ITEM_APPROVAL: 'Credit (Estimate Item)',
  ESTIMATE_ITEM_REVERSAL: 'Reversal (Estimate Rejected)',
  REQUISITION_APPROVAL: 'Debit (Requisition)',
  ADMIN_ADJUSTMENT: 'Admin Adjustment'
};

/**
 * Modal to resolve multi-work-order ambiguity when viewing or exporting a
 * grouped subcontractor's ledger statement.
 */
const MultiWorkOrderModal = ({ group, action, onClose, onSelect }) => {
  const distinctWOs = useMemo(() => {
    const wos = [...new Set((group.rows || []).map(r => r.work_order_no).filter(Boolean))];
    return wos.map(wo => {
      const rowsForWo = group.rows.filter(r => r.work_order_no === wo);
      const sample = rowsForWo[0] || {};
      const totalAmount = rowsForWo.reduce((sum, r) => sum + Number(r.requisition_amount || 0), 0);
      const approvedAmount = rowsForWo.reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);
      return {
        work_order_no: wo,
        department: sample.department || '—',
        site_details: sample.site_details || '—',
        count: rowsForWo.length,
        totalAmount,
        approvedAmount
      };
    });
  }, [group]);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`${action === 'view' ? 'View' : 'Export'} Ledger — Select Work Order`}
      size="lg"
      footer={
        <div className="flex justify-between items-center w-full">
          <Button
            variant="glass"
            size="sm"
            onClick={() => onSelect('')}
            className="text-xs border-indigo-500/30 text-indigo-300 hover:text-indigo-200"
          >
            {action === 'view' ? 'View Combined (All Work Orders)' : 'Export Combined (All Work Orders)'}
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-left">
        <p className="text-xs text-slate-400">
          <span className="font-semibold text-slate-200">{group.material_details}</span> ({group.material_sub_head}) is associated with{' '}
          <span className="text-amber-400 font-bold">{distinctWOs.length} work orders</span>. Select a specific work order to scope the statement, or view combined:
        </p>

        <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
          {distinctWOs.map((wo) => (
            <div
              key={wo.work_order_no}
              className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-indigo-500/40 hover:bg-white/[0.06] transition flex flex-col sm:flex-row justify-between sm:items-center gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-slate-100">{wo.work_order_no}</span>
                  {wo.department !== '—' && (
                    <Badge variant="slate" className="text-[10px]">{wo.department}</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Site: <span className="text-slate-300">{wo.site_details}</span>
                </p>
                <div className="flex gap-3 text-[11px] text-slate-400 mt-1.5">
                  <span>Requisitions: <strong className="text-slate-200">{wo.count}</strong></span>
                  <span>Requested: <strong className="text-slate-200 font-mono">{formatCurrency(wo.totalAmount)}</strong></span>
                  <span>Approved: <strong className="text-emerald-400 font-mono">{formatCurrency(wo.approvedAmount)}</strong></span>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSelect(wo.work_order_no)}
                className="shrink-0 text-xs"
              >
                {action === 'view' ? 'Select & View' : 'Select & Export'}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};

/**
 * Browse view over the Subcontractor Ledger (047_subcontractor_ledger.sql / 049).
 * Two tabs:
 *  - Balances: running balances per (work_order_no, material_sub_head, material_details),
 *    with export and audited administrative balance adjustments for HO/Admin.
 *  - Requisitions by Subcontractor: grouped requisition history with creation vs approval
 *    date filtering, comprehensive subcontractor ledger statements, and Excel exports.
 */
const SubcontractorLedger = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canView = ['je', 'zo', 'ho', 'admin'].includes(user?.role);
  const canAdjust = ['ho', 'admin'].includes(user?.role);

  const [viewMode, setViewMode] = useState('balances');
  const [workOrderFilter, setWorkOrderFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [dateBasis, setDateBasis] = useState('created'); // 'created' | 'approved'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewingEntry, setViewingEntry] = useState(null);
  const [adjustingEntry, setAdjustingEntry] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [multiWoPicker, setMultiWoPicker] = useState(null); // { group, action: 'view' | 'export' }
  const [collapsedGroups, setCollapsedGroups] = useState({});

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset page to 1 whenever any filter changes
  useEffect(() => {
    setPage(1);
  }, [workOrderFilter, dateFrom, dateTo, dateBasis]);

  const hasBalanceFilters = workOrderFilter || debouncedSearch;
  const hasRequisitionFilters = workOrderFilter || debouncedSearch || dateFrom || dateTo || dateBasis !== 'created';

  const { data: balancesData, isLoading: loadingBalances, error: balancesError } = useQuery({
    queryKey: ['subcontractorLedger', workOrderFilter, debouncedSearch, page],
    queryFn: async () => (await getSubcontractorLedger({
      page,
      limit: pageSize,
      work_order_no: workOrderFilter || undefined,
      search: debouncedSearch || undefined
    })).data,
    enabled: canView && viewMode === 'balances'
  });

  const balances = balancesData?.balances || [];
  const totalBalances = balancesData?.pagination?.total || 0;
  const totalPages = balancesData?.pagination?.totalPages || 1;

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

  const groupedRequisitions = useMemo(() => {
    const groups = [];
    const indexByKey = {};
    for (const r of requisitions) {
      const key = `${r.material_sub_head}|||${r.material_details}`;
      if (!(key in indexByKey)) {
        indexByKey[key] = groups.length;
        groups.push({ material_sub_head: r.material_sub_head, material_details: r.material_details, rows: [] });
      }
      groups[indexByKey[key]].rows.push(r);
    }
    return groups;
  }, [requisitions]);

  const toggleGroupCollapse = (key) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const allGroupsCollapsed = useMemo(() => {
    if (!groupedRequisitions || groupedRequisitions.length === 0) return false;
    return groupedRequisitions.every(g => {
      const key = `${g.material_sub_head}|||${g.material_details}`;
      return Boolean(collapsedGroups[key]);
    });
  }, [groupedRequisitions, collapsedGroups]);

  const toggleAllGroups = () => {
    if (allGroupsCollapsed) {
      setCollapsedGroups({});
    } else {
      const next = {};
      groupedRequisitions.forEach(g => {
        const key = `${g.material_sub_head}|||${g.material_details}`;
        next[key] = true;
      });
      setCollapsedGroups(next);
    }
  };

  const isLoading = viewMode === 'balances' ? loadingBalances : loadingRequisitions;
  const queryError = viewMode === 'balances' ? balancesError : requisitionsError;
  const hasFilters = viewMode === 'balances' ? hasBalanceFilters : hasRequisitionFilters;
  const displayError = queryError?.response?.data?.message || queryError?.message || '';

  const resetFilters = () => {
    setWorkOrderFilter('');
    setSearchInput('');
    setDebouncedSearch('');
    setDateFrom('');
    setDateTo('');
    setDateBasis('created');
    setPage(1);
  };

  const handleExportRequisitions = () => {
    exportSubcontractorRequisitionsToExcel(requisitions, {
      workOrderFilter,
      searchFilter: debouncedSearch,
      dateBasis,
      dateFrom,
      dateTo
    });
  };

  /**
   * Reusable batch-fetcher that loops through all pages and enforces a hard
   * failure if the retrieved row count does not strictly match the server-filtered total.
   */
  const fetchAllBalancesWithCountInvariant = async (filters) => {
    const allBalances = [];
    let fetchPage = 1;
    let totalPages_;
    let serverFilteredTotal;
    do {
      const res = await getSubcontractorLedger({
        page: fetchPage,
        limit: 100,
        work_order_no: filters.workOrder || undefined,
        search: filters.search || undefined
      });
      const batch = res.data?.balances || [];
      allBalances.push(...batch);
      totalPages_ = res.data?.pagination?.totalPages || 1;
      serverFilteredTotal = res.data?.pagination?.total || 0;
      fetchPage += 1;
    } while (fetchPage <= totalPages_);

    if (serverFilteredTotal > 0 && allBalances.length !== serverFilteredTotal) {
      throw new Error(
        `Export data integrity check failed: retrieved ${allBalances.length} rows but expected ${serverFilteredTotal}. Export aborted to prevent partial data download.`
      );
    }
    return allBalances;
  };

  const handleExportBalances = async () => {
    try {
      setIsExporting(true);
      const allBalances = await fetchAllBalancesWithCountInvariant({
        workOrder: workOrderFilter,
        search: debouncedSearch
      });

      exportSubcontractorBalancesToExcel(allBalances, {
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

  const handleExportFullLedger = async () => {
    try {
      setIsExporting(true);
      const res = await getSubcontractorLedgerEntries({
        work_order_no: workOrderFilter || undefined,
        search: debouncedSearch || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });
      const entries = res.data?.entries || [];

      // Collect all balances matching current filters across pages with count invariant check
      const allBalances = await fetchAllBalancesWithCountInvariant({
        workOrder: workOrderFilter,
        search: debouncedSearch
      });

      await exportAllSubcontractorLedgersToExcel(entries, allBalances, requisitions, {
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

  const handleExportSubcontractorLedger = async (group, chosenWorkOrder) => {
    try {
      setIsExporting(true);
      const workOrder = chosenWorkOrder !== undefined ? chosenWorkOrder : (workOrderFilter || group.rows[0]?.work_order_no);
      const res = await getSubcontractorLedgerEntries({
        work_order_no: workOrder || undefined,
        material_sub_head: group.material_sub_head,
        material_details: group.material_details
      });
      const entries = res.data?.entries || [];

      const relevantRows = workOrder
        ? group.rows.filter(r => r.work_order_no === workOrder)
        : group.rows;

      await exportSubcontractorLedgerStatementToExcel({
        subcontractor: group.material_details,
        subHead: group.material_sub_head,
        workOrder: workOrder || 'All Work Orders',
        requisitions: relevantRows,
        entries
      });
    } catch (err) {
      console.error('Export subcontractor ledger failed:', err);
      alert('Failed to export subcontractor ledger: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsExporting(false);
    }
  };

  const handleGroupAction = (group, action) => {
    const distinct = [...new Set((group.rows || []).map(r => r.work_order_no).filter(Boolean))];
    if (distinct.length > 1 && !workOrderFilter) {
      setMultiWoPicker({ group, action });
    } else {
      const wo = workOrderFilter || distinct[0] || '';
      if (action === 'view') {
        setViewingEntry({
          work_order_no: wo,
          material_sub_head: group.material_sub_head,
          material_details: group.material_details
        });
      } else {
        handleExportSubcontractorLedger(group, wo);
      }
    }
  };

  if (!canView) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-400 font-mono">
            Cost Estimates &amp; Requisitions · Subcontractor Ledger
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Subcontractor Ledger</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Every subcontractor's running balance, scoped to its own work order. Credited the moment HO
            approves a Sub Contractor estimate line item; debited the moment a Requisition against that
            subcontractor is approved.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate('/requisitions')}>
          ← Back to Requisitions
        </Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      <div className="flex gap-2 mb-6">
        {VIEW_TABS.map((tab) => {
          const isActive = viewMode === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setViewMode(tab.value)}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 select-none ${
                isActive
                  ? 'bg-indigo-500 text-slate-950 shadow-md shadow-indigo-500/20 font-extrabold ring-1 ring-indigo-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 bg-white/[0.02] border border-white/5'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col sm:flex-row flex-wrap items-end gap-3 mb-6">
        <div className="w-full sm:w-56">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">Work Order No.</span>
          <Input
            type="text"
            placeholder="Filter by work order..."
            value={workOrderFilter}
            onChange={(e) => setWorkOrderFilter(e.target.value)}
            size="sm"
          />
        </div>
        <div className="w-full sm:w-56">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">Search</span>
          <Input
            type="text"
            placeholder="Sub head, name, WO or Req..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            size="sm"
          />
        </div>

        {viewMode === 'requisitions' && (
          <>
            <div className="w-full sm:w-36">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">Date Basis</span>
              <select
                value={dateBasis}
                onChange={(e) => setDateBasis(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="created" className="bg-slate-900 text-slate-200">Creation Date</option>
                <option value="approved" className="bg-slate-900 text-slate-200">Approval Date</option>
              </select>
            </div>
            <div className="w-full sm:w-36">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">From</span>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} size="sm" />
            </div>
            <div className="w-full sm:w-36">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">To</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} size="sm" />
            </div>
          </>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset Filters
          </Button>
        )}

        {viewMode === 'balances' ? (
          <Button
            variant="glass"
            size="sm"
            onClick={handleExportBalances}
            disabled={balances.length === 0}
            className="ml-auto"
          >
            Export Balances to Excel
          </Button>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="default"
              size="sm"
              onClick={handleExportFullLedger}
              disabled={requisitions.length === 0 || isExporting}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/20"
            >
              {isExporting ? 'Exporting…' : 'Export Full Ledger to Excel'}
            </Button>
            <Button
              variant="glass"
              size="sm"
              onClick={handleExportRequisitions}
              disabled={requisitions.length === 0}
            >
              Export Requisitions to Excel
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading…</div>
      ) : viewMode === 'balances' ? (
        balances.length === 0 ? (
          <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
            {hasFilters ? 'No entries match these filters.' : 'No subcontractor balances yet.'}
          </div>
        ) : (
          <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
            <Table containerClassName="min-w-[1100px]">
              <TableHeader>
                <TableRow hover={false}>
                  <TableCell isHeader>Work Order</TableCell>
                  <TableCell isHeader>Sub Head</TableCell>
                  <TableCell isHeader>Subcontractor</TableCell>
                  <TableCell isHeader align="right">Estimated Total</TableCell>
                  <TableCell isHeader align="right">Paid So Far</TableCell>
                  <TableCell isHeader align="right">Remaining Balance</TableCell>
                  <TableCell isHeader>Actions</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((b) => (
                  <TableRow key={`${b.work_order_no}-${b.material_sub_head}-${b.material_details}`}>
                    <TableCell>
                      <span className="font-mono text-slate-300">{b.work_order_no}</span>
                      {b.project?.department && (
                        <div className="text-[10px] text-slate-500 mt-0.5">{b.project.department}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-slate-300">{b.material_sub_head}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-slate-300">{b.material_details}</span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="text-slate-400">{formatCurrency(b.estimated_total)}</span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="text-slate-400">{formatCurrency(b.paid_total)}</span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-bold text-emerald-400">{formatCurrency(b.available_balance)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="glass" size="sm" onClick={() => setViewingEntry(b)}>
                          View Ledger
                        </Button>
                        {canAdjust && (
                          <Button variant="ghost" size="sm" onClick={() => setAdjustingEntry(b)}>
                            Adjust
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              maxVisible={5}
              showLabel={true}
              totalRecords={totalBalances}
            />
          </div>
        )
      ) : groupedRequisitions.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          {hasFilters ? 'No requisitions match these filters.' : 'No Subcontractor requisitions yet.'}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-slate-400 font-medium">
              Showing <strong className="text-slate-200">{groupedRequisitions.length}</strong> {groupedRequisitions.length === 1 ? 'subcontractor' : 'subcontractors'}
            </span>
            <button
              type="button"
              onClick={toggleAllGroups}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition flex items-center gap-1.5 cursor-pointer select-none"
            >
              <svg
                className={`w-3.5 h-3.5 transform transition-transform duration-200 ${allGroupsCollapsed ? '-rotate-90' : 'rotate-0'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              <span>{allGroupsCollapsed ? 'Expand All' : 'Collapse All'}</span>
            </button>
          </div>

          {groupedRequisitions.map((group) => {
            const groupKey = `${group.material_sub_head}|||${group.material_details}`;
            const isCollapsed = Boolean(collapsedGroups[groupKey]);
            // GAP-07: Use authoritative predicate to filter active requisitions for liabilities
            const activeRows = group.rows.filter((r) => isFinanciallyActiveRequisition(r.requisition_status));
            const totalRequisitioned = activeRows.reduce((sum, r) => sum + Number(r.requisition_amount || 0), 0);
            const totalApproved = activeRows.reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);
            const inactiveCount = group.rows.length - activeRows.length;

            return (
              <div key={groupKey} className="glass-panel rounded-3xl border border-white/5 overflow-hidden transition-all duration-200">
                <div
                  onClick={() => toggleGroupCollapse(groupKey)}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors select-none ${
                    isCollapsed ? '' : 'border-b border-white/5'
                  }`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleGroupCollapse(groupKey);
                    }
                  }}
                  title={isCollapsed ? 'Click to expand' : 'Click to collapse'}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-slate-400 group-hover:text-white transition-colors shrink-0">
                      <svg
                        className={`w-3.5 h-3.5 transform transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    <div>
                      <span className="text-sm font-bold text-slate-200">{group.material_details}</span>
                      <span className="text-xs text-slate-500 ml-2">· {group.material_sub_head}</span>
                      <span className="ml-2.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/5 border border-white/10 text-slate-400">
                        {group.rows.length} {group.rows.length === 1 ? 'requisition' : 'requisitions'}
                      </span>
                      {inactiveCount > 0 && (
                        <span className="text-[10px] text-slate-500 ml-2 italic">({inactiveCount} cancelled / rejected excluded)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex gap-4 text-[11px]">
                      <span className="text-slate-400">Active Requested: <span className="text-slate-200 font-mono font-bold">{formatCurrency(totalRequisitioned)}</span></span>
                      <span className="text-slate-400">Active Approved: <span className="text-emerald-400 font-mono font-bold">{formatCurrency(totalApproved)}</span></span>
                    </div>
                    <div className="flex items-center gap-2 pl-3 border-l border-white/10">
                      <Button
                        variant="glass"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGroupAction(group, 'view');
                        }}
                        className="text-[11px] h-7 px-2.5"
                      >
                        View Ledger
                      </Button>
                      <Button
                        variant="glass"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGroupAction(group, 'export');
                        }}
                        disabled={isExporting}
                        className="text-[11px] h-7 px-2.5 text-indigo-300 hover:text-indigo-200 border-indigo-500/20"
                      >
                        Export Ledger
                      </Button>
                    </div>
                  </div>
                </div>

                {!isCollapsed && (
                  <Table containerClassName="min-w-[900px]">
                    <TableHeader>
                      <TableRow hover={false}>
                        <TableCell isHeader>Requisition No.</TableCell>
                        <TableCell isHeader>Work Order</TableCell>
                        <TableCell isHeader align="right">Requested</TableCell>
                        <TableCell isHeader align="right">Approved</TableCell>
                        <TableCell isHeader>Status</TableCell>
                        <TableCell isHeader>Requested By</TableCell>
                        <TableCell isHeader>Creation Date</TableCell>
                        <TableCell isHeader>Approved On</TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((r) => (
                        <TableRow key={r.requisition_id}>
                          <TableCell>
                            <span className="font-mono text-slate-300">{r.requisition_no}</span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-slate-400 text-xs">{r.work_order_no}</span>
                          </TableCell>
                          <TableCell align="right">
                            <span className="text-slate-300 font-mono">{formatCurrency(r.requisition_amount)}</span>
                          </TableCell>
                          <TableCell align="right">
                            <span className="text-slate-300 font-mono">{formatCurrency(r.approved_amount)}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={r.requisition_status === 'Approved' ? 'emerald' : r.requisition_status === 'Cancelled' ? 'red' : 'amber'}>
                              {r.requisition_status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-400 text-xs">{r.requester_name}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-400 text-xs">{formatDate(r.created_at)}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-400 text-xs">{formatDate(r.payment_date)}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>
      )}

      <SubcontractorLedgerEntriesModal
        entry={viewingEntry}
        onClose={() => setViewingEntry(null)}
      />

      <AdjustBalanceModal
        entry={adjustingEntry}
        onClose={() => setAdjustingEntry(null)}
        onSuccess={() => {
          setAdjustingEntry(null);
          queryClient.invalidateQueries({ queryKey: ['subcontractorLedger'] });
        }}
      />

      {multiWoPicker && (
        <MultiWorkOrderModal
          group={multiWoPicker.group}
          action={multiWoPicker.action}
          onClose={() => setMultiWoPicker(null)}
          onSelect={(selectedWo) => {
            const group = multiWoPicker.group;
            const action = multiWoPicker.action;
            setMultiWoPicker(null);
            if (action === 'view') {
              setViewingEntry({
                work_order_no: selectedWo,
                material_sub_head: group.material_sub_head,
                material_details: group.material_details
              });
            } else {
              handleExportSubcontractorLedger(group, selectedWo);
            }
          }}
        />
      )}
    </>
  );
};

const SubcontractorLedgerEntriesModal = ({ entry, onClose }) => {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['subcontractorLedgerEntries', entry?.work_order_no, entry?.material_sub_head, entry?.material_details],
    queryFn: async () => (await getSubcontractorLedgerEntries(
      entry.work_order_no || undefined, entry.material_sub_head, entry.material_details
    )).data?.entries || [],
    enabled: !!entry
  });

  const handleExportModalLedger = () => {
    if (!entry) return;
    exportSubcontractorLedgerStatementToExcel({
      subcontractor: entry.material_details,
      subHead: entry.material_sub_head,
      workOrder: entry.work_order_no,
      balance: entry,
      entries
    });
  };

  return (
    <Modal
      isOpen={!!entry}
      onClose={onClose}
      title="Subcontractor Ledger — Transaction Trail"
      subtitle={entry ? `${entry.material_details} · ${entry.material_sub_head} · ${entry.work_order_no}` : ''}
      size="xl"
    >
      <div className="flex justify-between items-center mb-4">
        <span className="text-xs text-slate-400">
          Chronological dual-entry transaction trail with running balances.
        </span>
        <Button
          variant="glass"
          size="sm"
          onClick={handleExportModalLedger}
          disabled={entries.length === 0}
          className="text-xs font-bold text-indigo-300 border-indigo-500/20"
        >
          Export Statement to Excel
        </Button>
      </div>
      {isLoading ? (
        <div className="py-8 text-center text-xs text-slate-500">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 font-bold uppercase tracking-wider">
          No transactions yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[850px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader>Date</TableCell>
                <TableCell isHeader>Type</TableCell>
                <TableCell isHeader>Doc / Ref No.</TableCell>
                <TableCell isHeader>Description / Remarks</TableCell>
                <TableCell isHeader align="right">Credit (+)</TableCell>
                <TableCell isHeader align="right">Debit (-)</TableCell>
                <TableCell isHeader align="right">Running Balance</TableCell>
                <TableCell isHeader>By</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const credit = Number(e.credit_amount || 0) || (Number(e.amount) > 0 ? Number(e.amount) : 0);
                const debit = Number(e.debit_amount || 0) || (Number(e.amount) < 0 ? Math.abs(Number(e.amount)) : 0);

                return (
                  <TableRow key={e.ledger_id}>
                    <TableCell>
                      <span className="text-slate-400 text-xs whitespace-nowrap">{formatDateTime(e.created_at)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {TX_TYPE_LABELS[e.transaction_type] || e.transaction_type}
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
                    <TableCell align="right">
                      {credit > 0 ? (
                        <span className="font-mono font-bold text-emerald-400">+{formatCurrency(credit)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {debit > 0 ? (
                        <span className="font-mono font-bold text-red-400">-{formatCurrency(debit)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-mono font-bold text-slate-200">
                        {e.running_balance != null ? formatCurrency(e.running_balance) : '—'}
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
