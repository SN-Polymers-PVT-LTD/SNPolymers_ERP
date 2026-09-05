import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Badge, Modal, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { getSubcontractorLedger, getSubcontractorLedgerEntries, getSubcontractorRequisitions } from '../api/requisitionsApi';
import { exportSubcontractorRequisitionsToExcel } from '../utils/exportHelpers';

const VIEW_TABS = [
  { value: 'balances', label: 'Balances' },
  { value: 'requisitions', label: 'Requisitions by Subcontractor' }
];

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleDateString('en-IN') : '—');
const formatDateTime = (dateStr) => (dateStr ? new Date(dateStr).toLocaleString('en-IN') : '—');

/**
 * Browse view over the Subcontractor Ledger (047_subcontractor_ledger.sql).
 * Two tabs:
 *  - Balances: one row per (work_order_no, material_sub_head, material_details)
 *    — the running balance, which is deliberately scoped per work order (two
 *    same-named subcontractors on two projects never share a balance).
 *  - Requisitions by Subcontractor: every actual Requisition raised against
 *    a Sub Contractor, across all work orders, grouped client-side by
 *    (material_sub_head, material_details) so you can see everything raised
 *    against one person/firm regardless of which project it was on — a
 *    reporting view, not a balance-tracking one. Filterable by work order
 *    and a requisition creation date range, with an Excel export of the
 *    currently filtered rows.
 */
const SubcontractorLedger = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canView = ['je', 'zo', 'ho', 'admin'].includes(user?.role);

  const [viewMode, setViewMode] = useState('balances');
  const [workOrderFilter, setWorkOrderFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewingEntry, setViewingEntry] = useState(null);

  const hasBalanceFilters = workOrderFilter || searchFilter;
  const hasRequisitionFilters = workOrderFilter || searchFilter || dateFrom || dateTo;

  const { data: balances = [], isLoading: loadingBalances, error: balancesError } = useQuery({
    queryKey: ['subcontractorLedger', workOrderFilter, searchFilter],
    queryFn: async () => (await getSubcontractorLedger({
      limit: 100,
      work_order_no: workOrderFilter || undefined,
      search: searchFilter || undefined
    })).data?.balances || [],
    enabled: canView && viewMode === 'balances'
  });

  const { data: requisitions = [], isLoading: loadingRequisitions, error: requisitionsError } = useQuery({
    queryKey: ['subcontractorRequisitions', workOrderFilter, searchFilter, dateFrom, dateTo],
    queryFn: async () => (await getSubcontractorRequisitions({
      work_order_no: workOrderFilter || undefined,
      search: searchFilter || undefined,
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

  const isLoading = viewMode === 'balances' ? loadingBalances : loadingRequisitions;
  const queryError = viewMode === 'balances' ? balancesError : requisitionsError;
  const hasFilters = viewMode === 'balances' ? hasBalanceFilters : hasRequisitionFilters;
  const displayError = queryError?.response?.data?.message || queryError?.message || '';

  const resetFilters = () => {
    setWorkOrderFilter('');
    setSearchFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const handleExport = () => {
    exportSubcontractorRequisitionsToExcel(requisitions);
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
            placeholder="Sub head or subcontractor..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            size="sm"
          />
        </div>
        {viewMode === 'requisitions' && (
          <>
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
        {viewMode === 'requisitions' && (
          <Button variant="glass" size="sm" onClick={handleExport} disabled={requisitions.length === 0} className="ml-auto">
            Export to Excel
          </Button>
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
                      <Button variant="glass" size="sm" onClick={() => setViewingEntry(b)}>
                        View Ledger
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : groupedRequisitions.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          {hasFilters ? 'No requisitions match these filters.' : 'No Subcontractor requisitions yet.'}
        </div>
      ) : (
        <div className="space-y-5">
          {groupedRequisitions.map((group) => {
            const totalRequisitioned = group.rows.reduce((sum, r) => sum + Number(r.requisition_amount || 0), 0);
            const totalApproved = group.rows.reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);
            return (
              <div key={`${group.material_sub_head}|||${group.material_details}`} className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 bg-white/[0.02] border-b border-white/5">
                  <div>
                    <span className="text-sm font-bold text-slate-200">{group.material_details}</span>
                    <span className="text-xs text-slate-500 ml-2">· {group.material_sub_head}</span>
                  </div>
                  <div className="flex gap-4 text-[11px]">
                    <span className="text-slate-400">Requisitioned: <span className="text-slate-200 font-mono font-bold">{formatCurrency(totalRequisitioned)}</span></span>
                    <span className="text-slate-400">Approved: <span className="text-emerald-400 font-mono font-bold">{formatCurrency(totalApproved)}</span></span>
                  </div>
                </div>
                <Table containerClassName="min-w-[900px]">
                  <TableHeader>
                    <TableRow hover={false}>
                      <TableCell isHeader>Requisition No.</TableCell>
                      <TableCell isHeader>Work Order</TableCell>
                      <TableCell isHeader align="right">Requested</TableCell>
                      <TableCell isHeader align="right">Approved</TableCell>
                      <TableCell isHeader>Status</TableCell>
                      <TableCell isHeader>Requested By</TableCell>
                      <TableCell isHeader>Date</TableCell>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      )}

      <SubcontractorLedgerEntriesModal
        entry={viewingEntry}
        onClose={() => setViewingEntry(null)}
      />
    </>
  );
};

const SubcontractorLedgerEntriesModal = ({ entry, onClose }) => {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['subcontractorLedgerEntries', entry?.work_order_no, entry?.material_sub_head, entry?.material_details],
    queryFn: async () => (await getSubcontractorLedgerEntries(
      entry.work_order_no, entry.material_sub_head, entry.material_details
    )).data?.entries || [],
    enabled: !!entry
  });

  return (
    <Modal
      isOpen={!!entry}
      onClose={onClose}
      title="Subcontractor Ledger — Transaction Trail"
      subtitle={entry ? `${entry.material_details} · ${entry.material_sub_head} · ${entry.work_order_no}` : ''}
      size="lg"
    >
      {isLoading ? (
        <div className="py-8 text-center text-xs text-slate-500">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 font-bold uppercase tracking-wider">
          No transactions yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[600px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader>Date</TableCell>
                <TableCell isHeader>Type</TableCell>
                <TableCell isHeader align="right">Amount</TableCell>
                <TableCell isHeader>By</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.ledger_id}>
                  <TableCell>
                    <span className="text-slate-400 text-xs">{formatDateTime(e.created_at)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {e.transaction_type === 'ESTIMATE_ITEM_APPROVAL' ? 'Credit (Estimate Item)' : 'Debit (Requisition)'}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    <span className={`font-mono font-bold ${Number(e.amount) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {Number(e.amount) >= 0 ? '+' : ''}{formatCurrency(e.amount)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-400 text-xs">{e.created_by_name}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Modal>
  );
};

export default SubcontractorLedger;
