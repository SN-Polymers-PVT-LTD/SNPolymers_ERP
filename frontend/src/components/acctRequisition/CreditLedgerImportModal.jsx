import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Table, TableHeader, TableBody, TableRow, TableCell } from '../ui';
import { getCreditLedger, importCreditInstallment } from '../../api/acctRequisitionsApi';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

/**
 * Lists every Open credit purchase (credit_ledger, 042_credit_purchases_and_ledger.sql)
 * and lets Accounts pull one into the current (Open) sheet as a new
 * installment line item, prefilled with the dealer and the original
 * purchase's Particulars/Account Sub-title (import_credit_installment_transact,
 * 043_credit_installment_copies_particulars.sql) — only amount, debit bank,
 * and payment mode are left for Accounts to fill in, since those vary per
 * installment.
 *
 * Unlike ImportEligibleItemsModal's Hold/Reject import, this is repeatable —
 * the source credit_ledger row is untouched by an import, so it stays in
 * this list (still Open) until its own remaining_balance is driven to zero
 * by a later approval. No optimistic removal on import, just an
 * invalidate — the row's Paid/Remaining figures don't actually move until
 * the new installment is later approved.
 */
const CreditLedgerImportModal = ({ isOpen, onClose, targetSheetId, onImported }) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [importingId, setImportingId] = useState(null);

  const queryKey = ['acctCreditLedger', 'Open'];

  const { data: entries = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await getCreditLedger({ status: 'Open', limit: 100 })).data?.entries || [],
    enabled: isOpen
  });

  const handleImport = async (ledgerId) => {
    setError('');
    setImportingId(ledgerId);
    try {
      await importCreditInstallment(ledgerId, targetSheetId);
      queryClient.invalidateQueries({ queryKey });
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to import installment.');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" subtitle="Accounts" title="Import from Credit Ledger">
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-slate-500 text-center p-8">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-slate-500 text-center p-8">
          No open credit purchases are available to pull an installment from.
        </p>
      ) : (
        <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[950px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader>Dealer</TableCell>
                <TableCell isHeader>Source</TableCell>
                <TableCell isHeader align="right">Opening Balance</TableCell>
                <TableCell isHeader align="right">Paid So Far</TableCell>
                <TableCell isHeader align="right">Remaining Balance</TableCell>
                <TableCell isHeader>Actions</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <span className="text-slate-300">{entry.beneficiary?.beneficiary_name || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-400 text-xs">
                      {entry.source?.particulars || '—'}
                      {entry.source?.sheet_number ? ` · ${entry.source.sheet_number}` : ''}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="text-slate-400">{formatCurrency(entry.opening_balance)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="text-slate-400">{formatCurrency(entry.paid_total)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-bold text-slate-200">{formatCurrency(entry.remaining_balance)}</span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="amber"
                      size="sm"
                      loading={importingId === entry.id}
                      onClick={() => handleImport(entry.id)}
                    >
                      Import
                    </Button>
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

export default CreditLedgerImportModal;
