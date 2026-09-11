import { useState, useEffect } from 'react';
import { Modal, Button, FormattedCurrencyInput, TextArea } from '../ui';
import { adjustCreditLedgerBalance } from '../../api/acctRequisitionsApi';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

/**
 * HO-only manual correction of an Open credit ledger entry's remaining
 * balance (adjust_credit_ledger_balance_transact, 044). Remarks are
 * required and audited server-side — this is a data-correction tool (e.g.
 * reconciling against what the dealer/subcontractor actually reports), not
 * a normal part of the installment-approval flow.
 */
const AdjustCreditBalanceModal = ({ isOpen, onClose, entry, onAdjusted }) => {
  const [newBalance, setNewBalance] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && entry) {
      setNewBalance(entry.remaining_balance ?? '');
      setRemarks('');
      setError('');
    }
  }, [isOpen, entry]);

  const handleSave = async () => {
    setError('');
    if (newBalance === '' || Number(newBalance) < 0) {
      setError('Enter a valid new remaining balance.');
      return;
    }
    if (Number(newBalance) > Number(entry.opening_balance)) {
      setError(`New balance cannot exceed the opening balance (${formatCurrency(entry.opening_balance)}).`);
      return;
    }
    if (!remarks.trim()) {
      setError('Remarks are required to adjust a balance.');
      return;
    }

    setSaving(true);
    try {
      const res = await adjustCreditLedgerBalance(entry.id, Number(newBalance), remarks.trim());
      onAdjusted?.(res.data?.entry);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to adjust credit ledger balance.');
    } finally {
      setSaving(false);
    }
  };

  if (!entry) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" subtitle="HO" title="Adjust Credit Balance">
      <div className="mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-slate-400">
        <div className="flex justify-between mb-1">
          <span>Dealer</span>
          <span className="text-slate-200 font-semibold">{entry.beneficiary?.beneficiary_name || '—'}</span>
        </div>
        <div className="flex justify-between mb-1">
          <span>Opening Balance</span>
          <span className="text-slate-300 font-mono">{formatCurrency(entry.opening_balance)}</span>
        </div>
        <div className="flex justify-between">
          <span>Current Remaining Balance</span>
          <span className="text-slate-300 font-mono">{formatCurrency(entry.remaining_balance)}</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium">
          {error}
        </div>
      )}

      <FormattedCurrencyInput
        label="New Remaining Balance"
        required
        value={newBalance}
        onValueChange={(val) => setNewBalance(val)}
        disabled={saving}
      />

      <div className="mt-4">
        <TextArea
          label="Remarks"
          required
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          disabled={saving}
          placeholder="Why is this balance being adjusted?"
        />
      </div>

      <Button variant="amber" onClick={handleSave} loading={saving} className="w-full mt-6">
        Save Adjustment
      </Button>
    </Modal>
  );
};

export default AdjustCreditBalanceModal;
