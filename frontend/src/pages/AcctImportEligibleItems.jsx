import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Badge, Input, Select, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { getImportEligibleItems, dismissImportEligibleItem } from '../api/acctRequisitionsApi';

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
 * Standalone housekeeping view over the same accumulating On
 * Hold/Rejected/Pending Review list the import modal (ImportEligibleItemsModal,
 * opened from within an Open sheet) draws from. This page exists purely to
 * browse and dismiss — importing into a sheet still happens from within that
 * sheet, since importing always needs a target sheet_id. Dismiss here never
 * touches the source item's real data (034_add_line_item_import.sql); it only
 * sets import_dismissed so stale items stop cluttering the eligible list.
 */
const AcctImportEligibleItems = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';

  const [error, setError] = useState('');
  const [dismissingItemId, setDismissingItemId] = useState(null);
  const [particularsFilter, setParticularsFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const queryKey = ['acctImportEligibleItems', particularsFilter, statusFilter];

  const { data: eligibleItems = [], isLoading, error: queryError } = useQuery({
    queryKey,
    queryFn: async () => (await getImportEligibleItems({
      limit: 100,
      particulars: particularsFilter || undefined,
      status: statusFilter || undefined
    })).data?.items || [],
    enabled: isAccountsUser
  });

  const displayError = error || queryError?.response?.data?.message || queryError?.message || '';

  // Optimistic remove: dismissing takes the item out of this list for good,
  // so drop it from the cache immediately instead of waiting on a round trip
  // + refetch, and put it back if the request actually fails. Must target the
  // same filter-parametrized queryKey the list is currently rendered from —
  // a static key here would silently miss whichever filtered view is active.
  const handleDismiss = async (itemId) => {
    setError('');
    setDismissingItemId(itemId);
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (old) => (old || []).filter((i) => i.id !== itemId));
    try {
      await dismissImportEligibleItem(itemId);
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      setError(err.response?.data?.message || 'Failed to dismiss line item.');
    } finally {
      setDismissingItemId(null);
    }
  };

  if (!isAccountsUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · HO Approval
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Held / Rejected / Pending Review Items</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Every On Hold, Rejected, or Pending Review line item across all sheets that hasn't been
            imported into a new sheet yet. Import from within an Open sheet's "Import Held / Rejected"
            button, or dismiss an item here if it'll never be re-requested.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions')}>
          ← Back to Sheets
        </Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col sm:flex-row gap-4 mb-6">
        <Input
          type="text"
          placeholder="Search particulars..."
          value={particularsFilter}
          onChange={(e) => setParticularsFilter(e.target.value)}
          size="sm"
          containerClassName="sm:w-64"
        />
        <Select
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          size="sm"
          containerClassName="sm:w-48"
        />
        {(particularsFilter || statusFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setParticularsFilter(''); setStatusFilter(''); }}
          >
            Reset Filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading…</div>
      ) : eligibleItems.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          {particularsFilter || statusFilter
            ? 'No items match these filters.'
            : 'No On Hold, Rejected, or Pending Review items are waiting to be imported.'}
        </div>
      ) : (
        <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[1150px]">
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
                    <button
                      type="button"
                      onClick={() => navigate(`/acct-requisitions/sheets/${item.sheet_id}`)}
                      className="text-amber-500 hover:text-amber-400 font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {item.sheet_number || '—'}
                    </button>
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
                    <Button
                      variant="glass"
                      size="sm"
                      loading={dismissingItemId === item.id}
                      onClick={() => handleDismiss(item.id)}
                    >
                      Dismiss
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
};

export default AcctImportEligibleItems;
