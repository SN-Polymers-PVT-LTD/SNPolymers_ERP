import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Badge, Table, TableHeader, TableBody, TableRow, TableCell } from '../ui';
import { getImportEligibleItems, importLineItem, dismissImportEligibleItem } from '../../api/acctRequisitionsApi';

const STATUS_VARIANTS = { 'On Hold': 'orange', Rejected: 'red', 'Pending Review': 'indigo' };

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
 */
const ImportEligibleItemsModal = ({ isOpen, onClose, targetSheetId, onImported }) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [actingItemId, setActingItemId] = useState(null);

  const { data: eligibleItems = [], isLoading } = useQuery({
    queryKey: ['acctImportEligibleItems'],
    queryFn: async () => (await getImportEligibleItems({ limit: 100 })).data?.items || [],
    enabled: isOpen
  });

  // Optimistic remove: both actions take an item out of THIS eligible list
  // for good (imported = used up, dismissed = hidden), so there's nothing to
  // reconcile on success — just drop it from the cache immediately instead
  // of waiting on a round trip + refetch. On failure, put the snapshot back
  // and surface the error, same rollback shape as handleAddItem's optimistic
  // add in AcctRequisitionSheetView.
  const removeItemOptimistically = (itemId) => {
    const previous = queryClient.getQueryData(['acctImportEligibleItems']);
    queryClient.setQueryData(['acctImportEligibleItems'], (old) => (old || []).filter((i) => i.id !== itemId));
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
      queryClient.setQueryData(['acctImportEligibleItems'], previous);
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
      queryClient.setQueryData(['acctImportEligibleItems'], previous);
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

      {isLoading ? (
        <p className="text-xs text-slate-500 text-center p-8">Loading…</p>
      ) : eligibleItems.length === 0 ? (
        <p className="text-xs text-slate-500 text-center p-8">
          No On Hold, Rejected, or Pending Review items are available to import.
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
