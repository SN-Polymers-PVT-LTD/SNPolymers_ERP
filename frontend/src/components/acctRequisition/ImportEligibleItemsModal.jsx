import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Badge, Input, Select, Table, TableHeader, TableBody, TableRow, TableCell } from '../ui';
import { getImportEligibleItems, importLineItem, dismissImportEligibleItem, getAccountSubTitles } from '../../api/acctRequisitionsApi';

const STATUS_VARIANTS = { 'On Hold': 'orange', Rejected: 'red', 'Pending Review': 'indigo' };

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'On Hold', label: 'On Hold' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Pending Review', label: 'Pending Review' }
];

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

/**
 * Lists every On Hold/Rejected/Pending Review line item across ALL sheets
 * that hasn't yet been imported into a later sheet or dismissed
 * (034_add_line_item_import.sql),
 * and lets Accounts copy one into the current (Open) sheet as a fresh line
 * item, or dismiss it from the list for good. The source item is never
 * touched by either action — only its imported/dismissed bookkeeping
 * columns change.
 *
 * Filters (status, account sub-title, date range) narrow the same
 * getImportEligibleItems endpoint the standalone AcctImportEligibleItems.jsx
 * page already uses — this modal just adds account sub-title and date range
 * on top of that page's existing particulars/status filters.
 */
const ImportEligibleItemsModal = ({ isOpen, onClose, targetSheetId, onImported }) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [actingItemId, setActingItemId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [accountSubTitle, setAccountSubTitle] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const hasFilters = statusFilter || accountSubTitle || dateFrom || dateTo;
  const filters = { statusFilter, accountSubTitle, dateFrom, dateTo };
  const queryKey = ['acctImportEligibleItems', filters];

  const { data: subTitlesData } = useQuery({
    queryKey: ['acctSubTitlesForFilter'],
    queryFn: async () => (await getAccountSubTitles()).data?.accountSubTitles ?? [],
    staleTime: 60 * 1000,
    enabled: isOpen
  });
  const subTitleOptions = (subTitlesData || []).filter(t => t.is_active).map(t => ({ value: t.title, label: t.title }));

  const { data: eligibleItems = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await getImportEligibleItems({
      limit: 100,
      status: statusFilter || undefined,
      account_sub_title: accountSubTitle || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined
    })).data?.items || [],
    enabled: isOpen
  });

  const resetFilters = () => {
    setStatusFilter('');
    setAccountSubTitle('');
    setDateFrom('');
    setDateTo('');
  };

  // Optimistic remove: both actions take an item out of THIS eligible list
  // for good (imported = used up, dismissed = hidden), so there's nothing to
  // reconcile on success — just drop it from the cache immediately instead
  // of waiting on a round trip + refetch. On failure, put the snapshot back
  // and surface the error, same rollback shape as handleAddItem's optimistic
  // add in AcctRequisitionSheetView. Must target the same filter-parametrized
  // queryKey the list is currently rendered from.
  const removeItemOptimistically = (itemId) => {
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (old) => (old || []).filter((i) => i.id !== itemId));
    return previous;
  };

  const handleImport = async (itemId) => {
    setError('');
    setActingItemId(itemId);
    const previous = removeItemOptimistically(itemId);
    try {
      await importLineItem(itemId, targetSheetId);
      onImported?.();
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      setError(err.response?.data?.message || 'Failed to import line item.');
    } finally {
      setActingItemId(null);
    }
  };

  const handleDismiss = async (itemId) => {
    setError('');
    setActingItemId(itemId);
    const previous = removeItemOptimistically(itemId);
    try {
      await dismissImportEligibleItem(itemId);
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      setError(err.response?.data?.message || 'Failed to dismiss line item.');
    } finally {
      setActingItemId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" subtitle="Accounts" title="Import Held / Rejected / Pending Review Items">
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium">
          {error}
        </div>
      )}

      <div className="mb-4 p-3 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row flex-wrap items-end gap-3">
        <div className="w-full sm:w-40">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">Status</span>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={STATUS_OPTIONS} size="sm" />
        </div>
        <div className="w-full sm:w-44">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">Account Sub-title</span>
          <Select
            value={accountSubTitle}
            onChange={(e) => setAccountSubTitle(e.target.value)}
            options={[{ value: '', label: 'All sub-titles' }, ...subTitleOptions]}
            size="sm"
          />
        </div>
        <div className="w-full sm:w-36">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">From</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} size="sm" />
        </div>
        <div className="w-full sm:w-36">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">To</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} size="sm" />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset Filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-500 text-center p-8">Loading…</p>
      ) : eligibleItems.length === 0 ? (
        <p className="text-xs text-slate-500 text-center p-8">
          {hasFilters
            ? 'No On Hold, Rejected, or Pending Review items match these filters.'
            : 'No On Hold, Rejected, or Pending Review items are available to import.'}
        </p>
      ) : (
        <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[1050px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader>Particulars</TableCell>
                <TableCell isHeader>Account Sub-title</TableCell>
                <TableCell isHeader>Source Sheet</TableCell>
                <TableCell isHeader>Beneficiary</TableCell>
                <TableCell isHeader align="right">Amount</TableCell>
                <TableCell isHeader>Payment Mode</TableCell>
                <TableCell isHeader>Status</TableCell>
                <TableCell isHeader>Actions</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eligibleItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="text-slate-300">{item.particulars || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-300">{item.account_sub_title_text || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-400 font-mono text-xs">{item.sheet_number || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-400 text-xs">{item.beneficiary_name || '—'}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-bold text-slate-200">{formatCurrency(item.req_amount)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-400 text-xs">{item.payment_mode || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[item.requisition_status] || 'slate'}>
                      {item.requisition_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="amber"
                        size="sm"
                        loading={actingItemId === item.id}
                        onClick={() => handleImport(item.id)}
                      >
                        Import
                      </Button>
                      <Button
                        variant="glass"
                        size="sm"
                        loading={actingItemId === item.id}
                        onClick={() => handleDismiss(item.id)}
                      >
                        Dismiss
                      </Button>
                    </div>
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

export default ImportEligibleItemsModal;
