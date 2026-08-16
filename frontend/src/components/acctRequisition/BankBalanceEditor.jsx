import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '../ui';
import { upsertBankBalance } from '../../api/acctRequisitionsApi';

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({
  bank_name: '',
  balance_date: todayISO(),
  available_balance: ''
});

/**
 * Bank Balance Master upsert (product doc §3 / §13): Accounts can both
 * reconcile an existing account's balance and add a brand-new bank account —
 * bank_name has no fixed enum server-side (any string becomes a valid
 * debit_bank_ac_type via the bank_balance_master(bank_name) FK), so this is a
 * free-text input with a <datalist> of existing names rather than a fixed
 * Select, to avoid gating account creation while still steering reconciliation
 * of an existing account away from a typo'd duplicate row.
 */
const BankBalanceEditor = ({ bankBalances = [] }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const bankName = form.bank_name.trim();
    if (!bankName) {
      setError('Name of the Bank is required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.balance_date)) {
      setError('Date of Balance is required.');
      return;
    }
    if (form.available_balance === '' || Number(form.available_balance) < 0) {
      setError('Available Balance must be zero or a positive amount.');
      return;
    }

    setSubmitting(true);
    try {
      await upsertBankBalance({
        bank_name: bankName,
        balance_date: form.balance_date,
        available_balance: Number(form.available_balance)
      });
      setForm(emptyForm());
      setSuccess(`Balance saved for ${bankName}.`);
      queryClient.invalidateQueries({ queryKey: ['acctBankBalances'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save bank balance.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
      <Input
        label="Name of the Bank"
        required
        list="bank-balance-editor-known-banks"
        placeholder="e.g. CANARA SNP CA"
        value={form.bank_name}
        onChange={(e) => setField('bank_name', e.target.value)}
        helperText={
          bankBalances.length > 0
            ? `Existing accounts: ${bankBalances.map(b => b.bank_name).join(', ')}. Match spelling exactly to reconcile an existing account instead of creating a new one.`
            : 'Any name you enter here becomes a new bank account.'
        }
      />
      <datalist id="bank-balance-editor-known-banks">
        {bankBalances.map(b => (
          <option key={b.bank_name} value={b.bank_name} />
        ))}
      </datalist>

      <Input
        label="Date of Balance"
        type="date"
        required
        value={form.balance_date}
        onChange={(e) => setField('balance_date', e.target.value)}
      />

      <Input
        label="Available Balance"
        type="number"
        min="0"
        step="0.01"
        required
        value={form.available_balance}
        onChange={(e) => setField('available_balance', e.target.value)}
      />

      {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}
      {success && <p className="text-[10px] font-semibold text-emerald-400">{success}</p>}

      <Button type="submit" variant="primary" size="sm" loading={submitting}>
        Save Balance
      </Button>
    </form>
  );
};

export default BankBalanceEditor;
